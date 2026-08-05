import 'dart:async';

import 'package:flutter/foundation.dart' show visibleForTesting, debugPrint;
import 'package:http/http.dart' as http;

import 'configuration.dart';
import 'identity/app_user_id_store.dart';
import 'models/customer_info.dart';
import 'models/login_result.dart';
import 'models/offerings.dart';
import 'models/package.dart';
import 'models/purchase_result.dart';
import 'models/purchases_error.dart';
import 'models/store_product.dart';
import 'network/purchases_api_client.dart';
import 'offerings_service.dart';
import 'purchase_controller.dart';
import 'store/app_account_token_store.dart';
import 'store/method_channel_store_channel.dart';
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
  OfferingsService? _offerings;
  PurchaseController? _purchases;
  StoreChannel? _storeChannel;
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
  /// `$RCAnonymousID:` via [AppUserIdStore.currentId]) and wires
  /// [OfferingsService] / [PurchaseController] against a [StoreChannel] —
  /// [SdkOverrides.storeChannel] when supplied (tests), else a real
  /// [MethodChannelStoreChannel] (production) — then starts the out-of-band
  /// transaction subscription. Does not block on the network. Never throws:
  /// on failure the SDK stays unconfigured and later calls throw/no-op with
  /// `configurationError`.
  ///
  /// StoreChannel wiring: unlike [httpClient]/[keyValueStore], the
  /// `?? MethodChannelStoreChannel()` fallback only became safe once
  /// [PurchaseController.start] guarded its `.listen()` call — calling
  /// `.listen()` on a real `EventChannel` with no live platform binding
  /// (e.g. a plain `flutter test` unit test that never calls
  /// `TestWidgetsFlutterBinding.ensureInitialized()`) can throw and leave the
  /// channel's internal broadcast controller reporting a *second*,
  /// hard-to-trace async error later, failing an unrelated test. Real apps
  /// call [configure] after `WidgetsFlutterBinding.ensureInitialized()`, so
  /// `.listen()` works there; the guard only protects the binding-less
  /// unit-test case. See the P3.4 report.
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
      // Same default pattern as httpClient/keyValueStore: tests inject a
      // fake via overrides, production gets the real MethodChannel/
      // EventChannel implementation. See the "StoreChannel wiring" note on
      // this method for why the real channel's `.listen()` (in
      // PurchaseController.start) needed to be made binding-safe first.
      final storeChannel = overrides?.storeChannel ?? MethodChannelStoreChannel();

      // Any subscription from a previous configure() (e.g. a reconfigure
      // without an intervening shutdown) is replaced, never leaked.
      await instance._purchases?.stop();

      instance._apiClient = apiClient;
      instance._appUserIdStore = appUserIdStore;
      instance._storeChannel = storeChannel;
      instance._offerings =
          OfferingsService(apiClient: apiClient, store: storeChannel);
      instance._purchases = PurchaseController(
        apiClient: apiClient,
        store: storeChannel,
        appUserId: appUserIdStore.currentId,
        onCustomerInfoUpdated: (info) {
          instance._cachedCustomerInfo = info;
          instance._dispatchUpdate(info);
        },
        appAccountTokens: AppAccountTokenStore(
          store: keyValueStore,
          uuidFactory: overrides?.uuidFactory,
        ),
        logger: (message, [error, stackTrace]) => instance._log(
          MyAmpixLogLevel.error,
          message,
          error,
          stackTrace,
        ),
      );
      instance._purchases!.start();
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

  // ---- offerings & purchases ----

  /// Fetches offerings from `mobile_purchase` and enriches each product with
  /// native store metadata (design §4). Cached after the first successful
  /// fetch. Throws [PurchasesErrorCode.configurationError] before
  /// [configure].
  static Future<Offerings> getOfferings() =>
      _instance._serialize<Offerings>('getOfferings', () async {
        _instance._requireConfigured();
        final (offerings, _) = _instance._requireStore();
        return offerings.getOfferings();
      });

  /// Purchases [packageToPurchase]'s underlying [StoreProduct] (design §4).
  /// Throws [PurchasesErrorCode.configurationError] before [configure]; a
  /// store or server failure surfaces as a typed [PurchasesError] (design
  /// §6).
  static Future<PurchaseResult> purchasePackage(Package packageToPurchase) =>
      _instance._serialize<PurchaseResult>('purchasePackage', () async {
        _instance._requireConfigured();
        final (_, purchases) = _instance._requireStore();
        return purchases.purchasePackage(packageToPurchase);
      });

  /// Purchases [product] directly (design §4). Throws
  /// [PurchasesErrorCode.configurationError] before [configure]; a store or
  /// server failure surfaces as a typed [PurchasesError] (design §6).
  static Future<PurchaseResult> purchaseStoreProduct(StoreProduct product) =>
      _instance._serialize<PurchaseResult>('purchaseStoreProduct', () async {
        _instance._requireConfigured();
        final (_, purchases) = _instance._requireStore();
        return purchases.purchaseStoreProduct(product);
      });

  /// Restores the user's entitlements (design §4): triggers the native
  /// restore, waits for any replayed transactions to be posted, then
  /// refetches [CustomerInfo]. Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<CustomerInfo> restorePurchases() =>
      _instance._serialize<CustomerInfo>('restorePurchases', () async {
        _instance._requireConfigured();
        final (_, purchases) = _instance._requireStore();
        return purchases.restorePurchases();
      });

  /// Whether the device/user is allowed to make payments (RevenueCat parity,
  /// design §2 — final-review M-1). Delegates to the native store layer
  /// (`AppStore.canMakePayments` / Play Billing's `SUBSCRIPTIONS` feature
  /// check). Guarded like every other store-backed call: throws
  /// [PurchasesErrorCode.configurationError] before [configure], never a raw
  /// throwable.
  static Future<bool> canMakePayments() =>
      _instance._serialize<bool>('canMakePayments', () async {
        _instance._requireConfigured();
        return _instance._requireStoreChannel().canMakePayments();
      });

  /// Sets the verbosity of the SDK's internal debug-only logging (design §7
  /// — final-review M-1). Takes effect immediately for every subsequent
  /// [_log] call; safe to call before or after [configure] and never throws.
  /// Note a LATER [configure] call resets the level to its
  /// [PurchasesConfiguration.logLevel] (defaults to [MyAmpixLogLevel.warn]),
  /// the same way it always has — call this again after reconfiguring if a
  /// non-default level should persist across it.
  static void setLogLevel(MyAmpixLogLevel level) {
    _instance._logLevel = level;
  }

  // ---- internals ----

  void _requireConfigured() {
    if (!_configured) {
      throw const PurchasesError(
        PurchasesErrorCode.configurationError,
        'MyAmpixPurchases.configure has not been called.',
      );
    }
  }

  /// The offerings/purchase orchestration, wired by every successful
  /// [configure] call (see the "StoreChannel wiring" note on [configure]).
  /// Call after [_requireConfigured] passes; the null-check below is a
  /// defensive guard against future wiring changes rather than a real,
  /// reachable case today.
  (OfferingsService, PurchaseController) _requireStore() {
    final offerings = _offerings;
    final purchases = _purchases;
    if (offerings == null || purchases == null) {
      throw const PurchasesError(
        PurchasesErrorCode.storeProblemError,
        'No StoreChannel was supplied to MyAmpixPurchases.configure — '
        'offerings/purchases are unavailable.',
      );
    }
    return (offerings, purchases);
  }

  /// The active [StoreChannel], wired by every successful [configure] call
  /// (final-review M-1's [canMakePayments]). Call after [_requireConfigured]
  /// passes; the null-check below is a defensive guard against future wiring
  /// changes, mirroring [_requireStore].
  StoreChannel _requireStoreChannel() {
    final store = _storeChannel;
    if (store == null) {
      throw const PurchasesError(
        PurchasesErrorCode.storeProblemError,
        'No StoreChannel was supplied to MyAmpixPurchases.configure — '
        'canMakePayments is unavailable.',
      );
    }
    return store;
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
    instance._offerings = null;
    instance._purchases = null;
    instance._storeChannel = null;
    instance._logLevel = MyAmpixLogLevel.warn;
    instance._listeners.clear();
    instance._tail = Future<void>.value();
  }

  /// Tears the SDK down between tests: cancels the out-of-band transaction
  /// subscription (if any) before resetting all other state.
  @visibleForTesting
  static Future<void> shutdownForTesting() async {
    await _instance._purchases?.stop();
    resetForTesting();
  }
}
