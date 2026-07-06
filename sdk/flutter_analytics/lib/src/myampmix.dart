import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import 'attribution/attribution_autocapture.dart';
import 'attribution/attribution_store.dart';
import 'autocapture/purchase_autocapture.dart';
import 'autocapture/screenshot_autocapture.dart';
import 'autocapture/screenshot_capturer.dart';
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
    this.attributionStream,
    this.screenshotCapturer,
    this.screenshotSettleDelay,
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

  /// Test-only seam replacing the real `myampmix_analytics/attribution`
  /// `EventChannel` stream so native install-referrer autocapture can be
  /// driven with a fake referrer payload instead of a real platform channel.
  /// Not part of the frozen §8 surface.
  final Stream<dynamic>? attributionStream;

  /// Test-only seam replacing the real `RepaintBoundary`-backed screenshot
  /// capturer so the capture→hash→throttle→upload mapping (§18) can be driven
  /// with canned JPEG bytes instead of rendering a real frame. Only consulted
  /// when `config.autocaptureScreenshots` is true. Not part of the frozen §8
  /// surface.
  final ScreenshotCapturer? screenshotCapturer;

  /// Test-only seam overriding the delay the screenshot autocapture waits for
  /// the navigation transition to settle before capturing (production default
  /// ~400ms). Tests pass `Duration.zero` so they don't wait. Not part of the
  /// frozen §8 surface.
  final Duration? screenshotSettleDelay;
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
  MamLogger _logger = const MamLogger();
  bool _autocaptureScreens = true;
  bool _autocaptureTaps = true;
  bool _autocapturePurchases = true;
  bool _autocaptureAttribution = true;
  bool _autocaptureScreenshots = true;

  late final AnalyticsDatabase _database;
  late final AttributionStore _attribution;
  late final IdentityManager _identity;
  late final SuperPropertiesStore _superProperties;
  late final TimedEventTracker _timedEvents;
  late final OptOutState _optOut;
  late final EventPipeline _pipeline;
  late final SessionManager _session;
  late final Uploader _uploader;
  _SdkLifecycleObserver? _observer;
  PurchaseAutocapture? _purchaseAutocapture;
  AttributionAutocapture? _attributionAutocapture;
  ScreenshotAutocapture? _screenshotAutocapture;

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
      MamLogger.fromConfig(
        config,
      ).log('MyAmpMix.init ignored: SDK is already initialized.');
      return;
    }
    final sdk = MyAmpMix._();
    try {
      await sdk._start(token, config, overrides);
      _instance = sdk;
    } on Object catch (error, stackTrace) {
      MamLogger.fromConfig(
        config,
      ).log('init failed; SDK disabled', error, stackTrace);
    }
  }

  Future<void> _start(
    String token,
    MyAmpMixConfig config,
    SdkOverrides? overrides,
  ) async {
    WidgetsFlutterBinding.ensureInitialized();
    // Compute the effective level once here; `_logger` is then threaded to
    // every sub-component (uploader, pipeline, people, screenshot autocapture).
    _logger = MamLogger.fromConfig(config);
    _autocaptureScreens = config.autocaptureScreens;
    _autocaptureTaps = config.autocaptureTaps;
    _autocapturePurchases = config.autocapturePurchases;
    _autocaptureAttribution = config.autocaptureAttribution;
    _autocaptureScreenshots = config.autocaptureScreenshots;
    final clock = overrides?.clock ?? const SystemClock();
    final idFactory = overrides?.idFactory ?? (() => const Uuid().v7());
    final keyValueStore =
        overrides?.keyValueStore ?? await SharedPrefsKeyValueStore.open();
    final contextDataSource =
        overrides?.contextDataSource ?? PlatformContextDataSource();
    _database = overrides?.database ?? AnalyticsDatabase.open();
    final events = overrides?.eventStore ?? DriftEventStore(_database);
    final profiles = DriftProfileOpStore(_database);

    _identity = IdentityManager(store: keyValueStore, idFactory: idFactory);
    await _identity.load();
    _attribution = AttributionStore(keyValueStore);
    try {
      await _attribution.load();
    } on Object catch (error, stackTrace) {
      // Corrupt persisted attribution must degrade to "no touch", never fail
      // init (mirrors the corrupt super-properties handling above).
      _logger.log(
        'Corrupt persisted attribution; starting with no touch.',
        error,
        stackTrace,
      );
    }
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

    final httpClient = overrides?.httpClient ?? http.Client();
    _uploader = Uploader(
      client: httpClient,
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
        contextDataSource,
        attribution: _attribution,
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

    // Native install-referrer autocapture (shared-contracts §4/§5). Gated on
    // `config.autocaptureAttribution` (default true) for EXACTLY the same
    // reason as the purchase block above: this opens the real
    // `myampmix_analytics/attribution` EventChannel, and an unconditional
    // subscription DEADLOCKS host-app + our own `testWidgets` fake-async.
    // Gating at subscribe-time gives host apps a clean escape hatch
    // (`autocaptureAttribution: false`) that keeps `MyAmpMix.init()` from
    // touching a platform channel in their widget tests. `trackDeepLink` is
    // deliberately NOT gated — it is an explicit host call with no channel.
    if (config.autocaptureAttribution) {
      _attributionAutocapture = AttributionAutocapture(
        attributionStream: overrides?.attributionStream,
        onReferrer: (referrer) => _guard(
          'installReferrer',
          () => _recordCampaignTouch(
            utmFromReferrer(referrer),
            source: 'install_referrer',
          ),
        ),
      );
      _attributionAutocapture!.start();
    }

    // Automatic screenshot capture (shared-contracts §18). Gated on
    // `config.autocaptureScreenshots` (default true) for the SAME fake-async
    // reason as the purchase/attribution blocks: the default capturer renders
    // a real `RepaintBoundary` frame, so leaving it wired would make a plain
    // `MyAmpMix.init()` try to render/upload under `testWidgets`. When enabled
    // we build it from the injected capturer (or the real
    // `RepaintBoundary` one) and reuse the same http client the uploader uses.
    // Triggered lazily from `track()` on `$screen_view`; captures each screen
    // at most once per `app_version` (persisted in the keyValueStore).
    // Reference screenshots are a DEBUG-ONLY developer tool (§18): gated on
    // `kDebugMode` so a release/production build never captures or uploads —
    // only the developer's debug build populates the admin's reference images,
    // and only when they opt in. A test seam (`overrides?.screenshotCapturer`)
    // still forces the wiring on for the dedicated screenshot tests.
    final wantScreenshots =
        config.autocaptureScreenshots &&
        (kDebugMode || overrides?.screenshotCapturer != null);
    if (wantScreenshots) {
      _screenshotAutocapture = ScreenshotAutocapture(
        capturer:
            overrides?.screenshotCapturer ??
            RepaintBoundaryScreenshotCapturer(),
        client: httpClient,
        store: keyValueStore,
        serverUrl: config.serverUrl,
        token: token,
        appVersion: () async => (await contextDataSource.appInfo()).version,
        settleDelay: overrides?.screenshotSettleDelay,
        logger: _logger,
      );
    }
  }

  void track(String event, {Map<String, Object?>? properties}) {
    _guard('track', () => _pipeline.track(event, properties));
    _maybeCaptureScreenshot(event, properties);
  }

  /// Fires automatic screenshot capture on a `$screen_view` when enabled
  /// (shared-contracts §18). Fire-and-forget and fully guarded inside
  /// [ScreenshotAutocapture.onScreenView]; runs OUTSIDE the `_guard` chain so
  /// a slow capture/upload never blocks later track/identify calls. A no-op
  /// unless screenshot autocapture is wired (`config.autocaptureScreenshots`)
  /// and the caller is opted in.
  void _maybeCaptureScreenshot(
    String event,
    Map<String, Object?>? properties,
  ) {
    final capture = _screenshotAutocapture;
    if (capture == null) return;
    if (event != r'$screen_view') return;
    if (_optOut.isOptedOut) return;
    final screenName = properties?[r'$screen_name'];
    if (screenName is! String || screenName.isEmpty) return;
    unawaited(capture.onScreenView(screenName));
  }

  /// RETAKE reference screenshots (§18): clears the persisted "already
  /// captured" markers so the next `$screen_view` of each screen re-captures
  /// and re-uploads its image (the backend upserts, replacing the old one).
  /// Use after fixing a display bug or deleting an outdated capture in the
  /// dashboard. A no-op when reference screenshot capture is off (release
  /// builds / `autocaptureScreenshots: false`). Never throws.
  Future<void> retakeScreenshots() async {
    try {
      await _screenshotAutocapture?.reset();
    } on Object catch (error, stackTrace) {
      _logger.log('retakeScreenshots failed', error, stackTrace);
    }
  }

  /// Records a marketing-attribution touch from a deep link / app link the
  /// host app received (shared-contracts §4/§5). The host owns its own
  /// deep-link plumbing (this adds no dependency) and forwards the incoming
  /// [uri] here from its `onGenerateRoute`/`uni_links`/`app_links` handler.
  ///
  /// Parses the whitelisted `utm_source, utm_medium, utm_campaign,
  /// utm_content, utm_term` query params. On a link carrying at least one of
  /// them this records the touch (last touch always; first touch write-once,
  /// see [AttributionStore]) and emits the reserved `$campaign_touch` event
  /// with `$attribution_source: "deep_link"`. A link with no `utm_*` — or a
  /// malformed/odd URI — records nothing and emits nothing. Always available
  /// regardless of `config.autocaptureAttribution` (it is an explicit host
  /// call, not a platform-channel subscription). Never throws.
  void trackDeepLink(Uri uri) => _guard(
    'trackDeepLink',
    () => _recordCampaignTouch(utmFromUri(uri), source: 'deep_link'),
  );

  /// Records a parsed [utm] touch and emits the reserved `$campaign_touch`
  /// event. A no-`utm_*` touch is a no-op (no touch, no event). Recording
  /// happens BEFORE the emit so the `$campaign_touch` event's own context
  /// already carries the new touch, matching every subsequent event.
  Future<void> _recordCampaignTouch(
    Map<String, String> utm, {
    required String source,
  }) async {
    final recorded = await _attribution.record(utm);
    if (!recorded) return;
    final properties = <String, Object?>{
      for (final key in kUtmKeys)
        if (utm[key] != null) '\$$key': utm[key],
      r'$attribution_source': source,
    };
    await _pipeline.track(r'$campaign_touch', properties);
  }

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
  bool get autocapturePurchasesEnabled => _initialized && _autocapturePurchases;

  /// Whether native install-referrer autocapture is enabled
  /// (`config.autocaptureAttribution`). Not part of the frozen §8 method
  /// surface, but a public property of the facade class. Note `trackDeepLink`
  /// is always available regardless of this flag.
  bool get autocaptureAttributionEnabled =>
      _initialized && _autocaptureAttribution;

  /// Whether automatic screenshot capture is enabled
  /// (`config.autocaptureScreenshots`, shared-contracts §18). Not part of the
  /// frozen §8 method surface, but a public property of the facade class.
  bool get autocaptureScreenshotsEnabled =>
      _initialized && _autocaptureScreenshots;

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
      await sdk._attributionAutocapture?.stop();
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
