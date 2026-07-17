import 'dart:async';

import 'package:flutter/foundation.dart' show visibleForTesting, debugPrint;
import 'package:http/http.dart' as http;

import 'configuration.dart';
import 'identity/app_user_id_store.dart';
import 'models/customer_info.dart';
import 'models/login_result.dart';
import 'models/purchases_error.dart';
import 'network/purchases_api_client.dart';
import 'store/store_channel.dart';

/// Callback fired with the latest [CustomerInfo] whenever it changes (login,
/// logout — and, from P3.4, purchase / out-of-band transactions). A throwing
/// listener never escapes into the SDK. Mirrors RevenueCat's listener typedef.
typedef CustomerInfoUpdateListener = void Function(CustomerInfo customerInfo);

/// Testing-only dependency overrides for [MyAmpixPurchases.configure].
/// Production code must not pass this parameter.
@visibleForTesting
class SdkOverrides {
  const SdkOverrides({
    this.httpClient,
    this.keyValueStore,
    this.storeChannel,
    this.nowIso8601,
    this.uuidFactory,
  });

  final http.Client? httpClient;
  final KeyValueStore? keyValueStore;
  final StoreChannel? storeChannel;
  final String Function()? nowIso8601;
  final String Function()? uuidFactory;
}

/// The RevenueCat-style static facade (design §2/§4). Configuration and the
/// identity/customer-info orchestration live here; every internal step is
/// guarded so a host app can never crash on an SDK call — the throwing
/// methods (`getCustomerInfo`, `logIn`, `logOut`, and from P3.4
/// `getOfferings`/`purchase*`) surface a typed [PurchasesError], and
/// pre-configure calls raise [PurchasesErrorCode.configurationError]. The
/// purchase/offerings surface ships in P3.4 on top of the [StoreChannel] seam
/// defined here.
class MyAmpixPurchases {
  MyAmpixPurchases._();

  static final MyAmpixPurchases _instance = MyAmpixPurchases._();

  bool _configured = false;
  MyAmpixLogLevel _logLevel = MyAmpixLogLevel.warn;
  PurchasesApiClient? _apiClient;
  AppUserIdStore? _appUserIdStore;
  CustomerInfo? _cachedCustomerInfo;
  // P3.4 stores its own StoreChannel reference once it adds the methods
  // (getOfferings/purchase*) that call it directly; P3.3 only needs the
  // transaction-stream subscription below.
  StreamSubscription<StoreTransactionEvent>? _transactionsSubscription;
  final List<CustomerInfoUpdateListener> _listeners =
      <CustomerInfoUpdateListener>[];

  /// Serializes every guarded call onto one chain so calls observe the same
  /// ordering a synchronous API would imply. Each step always completes
  /// normally on this chain — it never rethrows into it — so one failure
  /// never blocks a later call.
  Future<void> _tail = Future<void>.value();

  // ---- configuration & identity ----

  /// Configures the SDK (design §4). Resolves the app-user-id (explicit id
  /// via [AppUserIdStore.setId], else the persisted/minted anonymous
  /// `$RCAnonymousID:` via [AppUserIdStore.currentId]) and wires the
  /// (optional, fake-in-tests) [StoreChannel]'s transaction stream. Does not
  /// block on the network. Never throws: on failure the SDK stays
  /// unconfigured and later calls throw/no-op with `configurationError`.
  static Future<void> configure(
    PurchasesConfiguration configuration, {
    @visibleForTesting SdkOverrides? overrides,
  }) async {
    final instance = _instance;
    try {
      final keyValueStore =
          overrides?.keyValueStore ?? await SharedPrefsKeyValueStore.open();
      final httpClient = overrides?.httpClient ?? http.Client();
      final appUserIdStore = AppUserIdStore(
        store: keyValueStore,
        uuidFactory: overrides?.uuidFactory,
      );

      final explicitId = configuration.appUserID;
      if (explicitId != null) {
        await appUserIdStore.setId(explicitId);
      } else {
        await appUserIdStore.currentId();
      }

      final apiClient = PurchasesApiClient(
        client: httpClient,
        serverUrl: configuration.serverUrl,
        apiKey: configuration.apiKey,
        nowIso8601: overrides?.nowIso8601,
      );
      final storeChannel = overrides?.storeChannel;

      // Any subscription from a previous configure() (e.g. a reconfigure
      // without an intervening shutdown) is replaced, never leaked.
      await instance._transactionsSubscription?.cancel();

      instance._apiClient = apiClient;
      instance._appUserIdStore = appUserIdStore;
      instance._transactionsSubscription = storeChannel?.transactions.listen(
        (_) {
          // P3.4 turns an out-of-band transaction into a receipt submission
          // + cache refresh + listener dispatch; P3.3 only wires the
          // subscription so there is something to cancel on shutdown.
        },
        onError: (Object error, StackTrace stackTrace) {
          instance._log(
            MyAmpixLogLevel.error,
            'StoreChannel transaction stream error',
            error,
            stackTrace,
          );
        },
      );
      instance._cachedCustomerInfo = null;
      instance._logLevel = configuration.logLevel;
      instance._configured = true;
    } on Object catch (error, stackTrace) {
      instance._configured = false;
      instance._log(
        MyAmpixLogLevel.error,
        'MyAmpixPurchases.configure failed; SDK left unconfigured',
        error,
        stackTrace,
      );
    }
  }

  /// Whether [configure] has completed successfully. Never throws.
  static Future<bool> get isConfigured =>
      Future<bool>.value(_instance._configured);

  /// The active app-user-id (anonymous or custom). Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<String> get appUserID =>
      _instance._serialize<String>('appUserID', () async {
        _instance._requireConfigured();
        return _instance._appUserIdStore!.currentId();
      });

  /// Whether the active app-user-id is anonymous. Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<bool> get isAnonymous =>
      _instance._serialize<bool>('isAnonymous', () async {
        _instance._requireConfigured();
        return _instance._appUserIdStore!.isAnonymous;
      });

  // ---- customer info ----

  /// Returns the cached [CustomerInfo] when present, else fetches
  /// `GET /v1/subscribers/:appUserId`, caches it, and returns it (design §4).
  /// Throws [PurchasesErrorCode.configurationError] before [configure].
  static Future<CustomerInfo> getCustomerInfo() =>
      _instance._serialize<CustomerInfo>('getCustomerInfo', () async {
        _instance._requireConfigured();
        final cached = _instance._cachedCustomerInfo;
        if (cached != null) return cached;
        final appUserId = await _instance._appUserIdStore!.currentId();
        final info = await _instance._apiClient!.getSubscriber(appUserId);
        _instance._cachedCustomerInfo = info;
        return info;
      });

  /// Drops the cached [CustomerInfo] so the next [getCustomerInfo] refetches.
  /// Non-throwing; a logged no-op before [configure].
  static Future<void> invalidateCustomerInfoCache() {
    final instance = _instance;
    if (!instance._configured) {
      instance._log(
        MyAmpixLogLevel.debug,
        'invalidateCustomerInfoCache ignored: configure has not been called.',
      );
      return Future<void>.value();
    }
    return instance._guard('invalidateCustomerInfoCache', () {
      instance._cachedCustomerInfo = null;
    });
  }

  // ---- update listeners ----

  /// Registers a listener fired with the latest [CustomerInfo] on identity
  /// changes (and, from P3.4, purchases / out-of-band transactions).
  /// Listeners persist across [configure] and may be added before it. Never
  /// throws.
  static void addCustomerInfoUpdateListener(
    CustomerInfoUpdateListener listener,
  ) {
    _instance._listeners.add(listener);
  }

  /// Removes a previously registered listener. Never throws.
  static void removeCustomerInfoUpdateListener(
    CustomerInfoUpdateListener listener,
  ) {
    _instance._listeners.remove(listener);
  }

  // ---- account lifecycle ----

  /// Switches the active app-user-id to [appUserID], refetches + caches
  /// [CustomerInfo], and fires the update listeners (design §4). `created` is
  /// the client-side approximation (no server aliasing until roadmap P5): the
  /// fetched customer had no entitlements and no active subscriptions. Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<LogInResult> logIn(String appUserID) =>
      _instance._serialize<LogInResult>('logIn', () async {
        _instance._requireConfigured();
        await _instance._appUserIdStore!.setId(appUserID);
        final info = await _instance._apiClient!.getSubscriber(appUserID);
        _instance._cachedCustomerInfo = info;
        final created =
            info.entitlements.all.isEmpty && info.activeSubscriptions.isEmpty;
        _instance._dispatchUpdate(info);
        return LogInResult(customerInfo: info, created: created);
      });

  /// Logs the user out: mints a fresh anonymous `$RCAnonymousID:` id,
  /// refetches + caches [CustomerInfo], and fires the update listeners
  /// (design §4). Throws [PurchasesErrorCode.configurationError] before
  /// [configure].
  static Future<CustomerInfo> logOut() =>
      _instance._serialize<CustomerInfo>('logOut', () async {
        _instance._requireConfigured();
        final newId = await _instance._appUserIdStore!.reset();
        final info = await _instance._apiClient!.getSubscriber(newId);
        _instance._cachedCustomerInfo = info;
        _instance._dispatchUpdate(info);
        return info;
      });

  // ---- internals ----

  void _requireConfigured() {
    if (!_configured) {
      throw const PurchasesError(
        PurchasesErrorCode.configurationError,
        'MyAmpixPurchases.configure has not been called.',
      );
    }
  }

  /// Serializes a value-returning throwing op on [_tail]. A [PurchasesError]
  /// passes through unchanged; anything else maps to
  /// [PurchasesErrorCode.unknownError]. The chain step always completes
  /// normally so later calls are never blocked by an earlier failure.
  Future<T> _serialize<T>(String operation, Future<T> Function() body) {
    final completer = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        completer.complete(await body());
      } on PurchasesError catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      } on Object catch (error, stackTrace) {
        _log(MyAmpixLogLevel.error, '$operation failed', error, stackTrace);
        completer.completeError(
          PurchasesError(
            PurchasesErrorCode.unknownError,
            '$operation failed unexpectedly.',
            underlyingErrorMessage: '$error',
          ),
          stackTrace,
        );
      }
    });
    return completer.future;
  }

  /// Serializes a non-throwing void op on [_tail]. Any error from [body] is
  /// logged and swallowed (never-crash); the returned future always
  /// completes.
  Future<void> _guard(String operation, FutureOr<void> Function() body) {
    final completer = Completer<void>();
    _tail = _tail.then((_) async {
      try {
        await body();
      } on Object catch (error, stackTrace) {
        _log(MyAmpixLogLevel.error, '$operation failed', error, stackTrace);
      } finally {
        completer.complete();
      }
    });
    return completer.future;
  }

  /// Fires every listener with [info]; a throwing listener is logged and
  /// skipped so the rest still run — dispatch never crashes.
  void _dispatchUpdate(CustomerInfo info) {
    for (final listener in List<CustomerInfoUpdateListener>.of(_listeners)) {
      try {
        listener(info);
      } on Object catch (error, stackTrace) {
        _log(
          MyAmpixLogLevel.error,
          'CustomerInfo update listener threw',
          error,
          stackTrace,
        );
      }
    }
  }

  void _log(
    MyAmpixLogLevel level,
    String message, [
    Object? error,
    StackTrace? stackTrace,
  ]) {
    if (level.index < _logLevel.index) return;
    debugPrint(
      '[MyAmpixPurchases] $message${error != null ? ' | error=$error' : ''}',
    );
  }

  /// Resets all static state between tests (config, cache, listeners, chain).
  @visibleForTesting
  static void resetForTesting() {
    final instance = _instance;
    instance._configured = false;
    instance._apiClient = null;
    instance._appUserIdStore = null;
    instance._cachedCustomerInfo = null;
    instance._transactionsSubscription = null;
    instance._logLevel = MyAmpixLogLevel.warn;
    instance._listeners.clear();
    instance._tail = Future<void>.value();
  }

  /// Tears the SDK down between tests: cancels the transaction subscription
  /// (if any) before resetting all other state.
  @visibleForTesting
  static Future<void> shutdownForTesting() async {
    await _instance._transactionsSubscription?.cancel();
    resetForTesting();
  }
}
