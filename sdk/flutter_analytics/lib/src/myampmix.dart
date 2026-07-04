import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import 'autocapture/purchase_autocapture.dart';
import 'config.dart';
import 'context/context_collector.dart';
import 'context/platform_context_data_source.dart';
import 'identity/identity_manager.dart';
import 'network/uploader.dart';
import 'optout/opt_out_state.dart';
import 'people.dart';
import 'pipeline/event_pipeline.dart';
import 'properties/super_properties_store.dart';
import 'properties/timed_event_tracker.dart';
import 'session/session_manager.dart';
import 'storage/database.dart';
import 'storage/event_store.dart';
import 'storage/key_value_store.dart';
import 'storage/profile_op_store.dart';
import 'util/clock.dart';
import 'util/logger.dart';

/// Testing-only dependency overrides for [MyAmpMix.init]. Production code
/// must not pass this parameter.
@visibleForTesting
class SdkOverrides {
  const SdkOverrides({
    this.clock,
    this.httpClient,
    this.database,
    this.keyValueStore,
    this.contextDataSource,
    this.idFactory,
    this.random,
    this.eventStore,
    this.purchaseStream,
  });

  final Clock? clock;
  final http.Client? httpClient;
  final AnalyticsDatabase? database;
  final KeyValueStore? keyValueStore;
  final ContextDataSource? contextDataSource;
  final String Function()? idFactory;
  final math.Random? random;

  /// Test-only seam to inject a store that fails, proving the never-throw
  /// guard (`_guard`) swallows exceptions raised deep in the write path
  /// instead of letting them propagate into the host app. Not part of the
  /// frozen §8 surface.
  final EventStore? eventStore;

  /// Test-only seam replacing the real `myampmix_analytics/purchases`
  /// `EventChannel` stream so native store-purchase autocapture can be
  /// driven with a fake payload instead of a real platform channel. Not
  /// part of the frozen §8 surface.
  final Stream<dynamic>? purchaseStream;
}

/// Public facade — the exact shared-contracts §8 surface. Every method is
/// guarded: the SDK never throws into the host app (design §13). The M2
/// widgets (MyAmpMixObserver, MyAmpMixTracker) ship in the autocapture
/// milestone, not in phase 1.
class MyAmpMix {
  MyAmpMix._();

  static MyAmpMix _instance = MyAmpMix._();

  static MyAmpMix get instance => _instance;

  bool _initialized = false;
  MamLogger _logger = const MamLogger(enabled: false);
  bool _autocaptureScreens = true;
  bool _autocaptureTaps = true;
  bool _autocapturePurchases = true;

  late final AnalyticsDatabase _database;
  late final IdentityManager _identity;
  late final SuperPropertiesStore _superProperties;
  late final TimedEventTracker _timedEvents;
  late final OptOutState _optOut;
  late final EventPipeline _pipeline;
  late final SessionManager _session;
  late final Uploader _uploader;
  _SdkLifecycleObserver? _observer;
  PurchaseAutocapture? _purchaseAutocapture;

  /// Profile operations (`people.set/setOnce/increment/append/unset/deleteUser`).
  People people = People.noop();

  /// Initializes the SDK. Never throws: on failure the SDK stays disabled
  /// and every call becomes a logged no-op. Idempotent: calling it while
  /// the SDK is already initialized is a logged no-op that keeps the
  /// existing instance (no new timers, observers or database connections).
  static Future<void> init(
    String token, {
    required MyAmpMixConfig config,
    @visibleForTesting SdkOverrides? overrides,
  }) async {
    if (_instance._initialized) {
      MamLogger(
        enabled: config.debug,
      ).log('MyAmpMix.init ignored: SDK is already initialized.');
      return;
    }
    final sdk = MyAmpMix._();
    try {
      await sdk._start(token, config, overrides);
      _instance = sdk;
    } on Object catch (error, stackTrace) {
      MamLogger(
        enabled: config.debug,
      ).log('init failed; SDK disabled', error, stackTrace);
    }
  }

  Future<void> _start(
    String token,
    MyAmpMixConfig config,
    SdkOverrides? overrides,
  ) async {
    WidgetsFlutterBinding.ensureInitialized();
    _logger = MamLogger(enabled: config.debug);
    _autocaptureScreens = config.autocaptureScreens;
    _autocaptureTaps = config.autocaptureTaps;
    _autocapturePurchases = config.autocapturePurchases;
    final clock = overrides?.clock ?? const SystemClock();
    final idFactory = overrides?.idFactory ?? (() => const Uuid().v7());
    final keyValueStore =
        overrides?.keyValueStore ?? await SharedPrefsKeyValueStore.open();
    _database = overrides?.database ?? AnalyticsDatabase.open();
    final events = overrides?.eventStore ?? DriftEventStore(_database);
    final profiles = DriftProfileOpStore(_database);

    _identity = IdentityManager(store: keyValueStore, idFactory: idFactory);
    await _identity.load();
    _superProperties = SuperPropertiesStore(keyValueStore);
    try {
      await _superProperties.load();
    } on Object catch (error, stackTrace) {
      // Corrupt persisted JSON must degrade to empty super properties, not
      // fail the whole init (controller-adjudicated requirement).
      _logger.log(
        'Corrupt persisted super properties; starting empty.',
        error,
        stackTrace,
      );
    }
    _timedEvents = TimedEventTracker(clock);
    _optOut = OptOutState(
      store: keyValueStore,
      events: events,
      profiles: profiles,
    );
    await _optOut.load();

    _uploader = Uploader(
      client: overrides?.httpClient ?? http.Client(),
      events: events,
      profiles: profiles,
      serverUrl: config.serverUrl,
      token: token,
      clock: clock,
      batchSize: config.flushAt,
      flushInterval: config.flushInterval,
      maxRetryDelay: config.maxRetryDelay,
      random: overrides?.random,
      logger: _logger,
    );

    _pipeline = EventPipeline(
      clock: clock,
      store: events,
      identity: _identity,
      sessionId: () => _session.sessionId,
      superProperties: _superProperties,
      timedEvents: _timedEvents,
      contextCollector: ContextCollector(
        overrides?.contextDataSource ?? PlatformContextDataSource(),
      ),
      maxQueueSize: config.maxQueueSize,
      isOptedOut: () => _optOut.isOptedOut,
      idFactory: idFactory,
      onEventQueued: (queuedCount) => _uploader.maybeFlush(queuedCount),
    );

    _session = SessionManager(
      clock: clock,
      store: keyValueStore,
      timeout: config.sessionTimeout,
      idFactory: idFactory,
      emit: (event, properties) => _pipeline.track(event, properties),
    );

    people = People(
      store: profiles,
      distinctId: () => _identity.distinctId,
      clock: clock,
      isOptedOut: () => _optOut.isOptedOut,
      maxQueueSize: config.maxQueueSize,
      onQueued: (queuedCount) => _uploader.maybeFlush(queuedCount),
      logger: _logger,
      // People ops must share the facade's ordering domain: identify() and
      // reset() run deferred on the _guard chain, so profile ops are
      // scheduled there too and observe post-identify/reset identity state
      // (People reads distinctId inside the scheduled body).
      schedule: (body) => _guard('people', body),
    );

    _initialized = true;
    await _session.start();
    // Registered only after start() succeeded: a failed init must not leak
    // an observer pointing at a discarded SessionManager.
    _observer = _SdkLifecycleObserver(_session, _logger);
    WidgetsBinding.instance.addObserver(_observer!);
    _uploader.start();

    // Native store-purchase autocapture (shared-contracts §4). Gated on
    // `config.autocapturePurchases` (default true): when enabled we subscribe
    // to the platform plugin's transaction stream (the real
    // `myampmix_analytics/purchases` EventChannel, or an injected test stream).
    // Unlike the screen/tap capturers — which are pure-Dart observers — this is
    // the one autocapture that opens a real platform channel, so gating at
    // subscribe-time gives host apps a clean escape hatch (`autocapturePurchases:
    // false`) that keeps `MyAmpMix.init()` from ever touching a platform channel
    // in their widget tests. Emission is ALSO guarded by
    // `autocapturePurchasesEnabled` (defense in depth).
    if (config.autocapturePurchases) {
      _purchaseAutocapture = PurchaseAutocapture(
        purchaseStream: overrides?.purchaseStream,
      );
      _purchaseAutocapture!.start();
    }
  }

  void track(String event, {Map<String, Object?>? properties}) =>
      _guard('track', () => _pipeline.track(event, properties));

  /// Whether `$screen_view` autocapture is enabled (`config.autocaptureScreens`).
  /// Read by `MyAmpMixObserver`'s default wiring; not part of the frozen §8
  /// method surface, but a public property of the facade class.
  bool get autocaptureScreensEnabled => _initialized && _autocaptureScreens;

  /// Whether `$tap`/`$rage_tap` autocapture is enabled (`config.autocaptureTaps`).
  /// Read by `MyAmpMixTracker`'s default wiring; not part of the frozen §8
  /// method surface, but a public property of the facade class.
  bool get autocaptureTapsEnabled => _initialized && _autocaptureTaps;

  /// Whether native `$in_app_purchase` autocapture is enabled
  /// (`config.autocapturePurchases`). Read by `PurchaseAutocapture`'s
  /// default wiring; not part of the frozen §8 method surface, but a
  /// public property of the facade class.
  bool get autocapturePurchasesEnabled =>
      _initialized && _autocapturePurchases;

  void identify(String userId) => _guard('identify', () async {
    final changed = await _identity.identify(userId);
    if (changed) {
      await _pipeline.track(r'$identify', {r'$anon_id': _identity.anonId});
    }
  });

  void alias(String aliasId) => _guard(
    'alias',
    () => _pipeline.track(r'$identify', {r'$alias': aliasId}),
  );

  void reset() => _guard('reset', () async {
    await _identity.reset();
    await _superProperties.clear();
    _timedEvents.clear();
  });

  void timeEvent(String event) =>
      _guard('timeEvent', () => _timedEvents.start(event));

  void registerSuperProperties(Map<String, Object?> properties) => _guard(
    'registerSuperProperties',
    () => _superProperties.register(properties),
  );

  void optOutTracking() => _guard('optOutTracking', () => _optOut.optOut());

  void optInTracking() => _guard('optInTracking', () => _optOut.optIn());

  /// Deliberately NOT routed through the [_guard] chain: a slow or failing
  /// network drain must never block later track/identify calls from
  /// reaching the LOCAL queue. It awaits a snapshot of the current chain so
  /// every previously issued call is queued before the drain reads the
  /// store, then runs the upload OUTSIDE the chain in its own try/catch —
  /// guarded calls issued after flush() chain independently of the network.
  void flush() {
    if (!_initialized) {
      _logger.log('flush ignored: MyAmpMix.init has not completed.');
      return;
    }
    final priorOps = _tail;
    unawaited(() async {
      try {
        await priorOps;
        await _uploader.flush(force: true);
      } on Object catch (error, stackTrace) {
        _logger.log('flush failed', error, stackTrace);
      }
    }());
  }

  /// Serializes every guarded call onto a single chain so that fire-and-
  /// forget calls observe the same ordering a synchronous API would imply
  /// (e.g. `track()` immediately followed by `flush()` must not let the
  /// flush's queue read run before the track's queue write lands). Mirrors
  /// the same hazard [People] documents and guards against via its own
  /// `_tail` chain. Also the never-throw guard: any synchronous throw or
  /// rejected Future from [body] is caught and logged, never propagated.
  Future<void> _tail = Future<void>.value();

  void _guard(String operation, FutureOr<void> Function() body) {
    if (!_initialized) {
      _logger.log('$operation ignored: MyAmpMix.init has not completed.');
      return;
    }
    _tail = _tail.then((_) async {
      try {
        await body();
      } on Object catch (error, stackTrace) {
        _logger.log('$operation failed', error, stackTrace);
      }
    });
  }

  /// Tears down timers/observers between tests.
  @visibleForTesting
  static Future<void> shutdownForTesting({bool closeDatabase = true}) async {
    final sdk = _instance;
    if (sdk._initialized) {
      sdk._uploader.dispose();
      await sdk._purchaseAutocapture?.stop();
      final observer = sdk._observer;
      if (observer != null) WidgetsBinding.instance.removeObserver(observer);
      if (closeDatabase) await sdk._database.close();
    }
    _instance = MyAmpMix._();
  }
}

class _SdkLifecycleObserver with WidgetsBindingObserver {
  _SdkLifecycleObserver(this._session, this._logger);

  final SessionManager _session;
  final MamLogger _logger;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    unawaited(
      _session
          .handleLifecycleState(state)
          .catchError(
            (Object error, StackTrace stackTrace) =>
                _logger.log('lifecycle handling failed', error, stackTrace),
          ),
    );
  }
}
