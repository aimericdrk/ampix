import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import 'attribution/attribution_autocapture.dart';
import 'attribution/attribution_store.dart';
import 'autocapture/myampix_observer.dart';
import 'autocapture/purchase_autocapture.dart';
import 'autocapture/screenshot_autocapture.dart';
import 'autocapture/screenshot_capturer.dart';
import 'config.dart';
import 'context/context_collector.dart';
import 'context/platform_context_data_source.dart';
import 'identity/identity_manager.dart';
import 'identity/rc_link_store.dart';
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

/// Testing-only dependency overrides for [MyAmpix.init]. Production code
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

  /// Test-only seam replacing the real `myampix_analytics/purchases`
  /// `EventChannel` stream so native store-purchase autocapture can be
  /// driven with a fake payload instead of a real platform channel. Not
  /// part of the frozen §8 surface.
  final Stream<dynamic>? purchaseStream;

  /// Test-only seam replacing the real `myampix_analytics/attribution`
  /// `EventChannel` stream so native install-referrer autocapture can be
  /// driven with a fake referrer payload instead of a real platform channel.
  /// Not part of the frozen §8 surface.
  final Stream<dynamic>? attributionStream;

  /// Test-only seam replacing the real `RepaintBoundary`-backed screenshot
  /// capturer so the capture→hash→throttle→upload mapping (§18) can be driven
  /// with canned JPEG bytes instead of rendering a real frame. Passing it also
  /// forces the screenshot wiring on outside debug builds. Not part of the
  /// frozen §8 surface.
  final ScreenshotCapturer? screenshotCapturer;

  /// Test-only seam overriding the delay the screenshot autocapture waits for
  /// the navigation transition to settle before capturing (production default
  /// comes from `MyAmpixConfig.screenshotSettleDelay`, ~1s). Tests pass
  /// `Duration.zero` so they don't wait. Not part of the frozen §8 surface.
  final Duration? screenshotSettleDelay;
}

/// Public facade — the exact shared-contracts §8 surface. Every method is
/// guarded: the SDK never throws into the host app (design §13). The M2
/// widgets (MyAmpixObserver, MyAmpixTracker) ship in the autocapture
/// milestone, not in phase 1.
class MyAmpix {
  MyAmpix._();

  static MyAmpix _instance = MyAmpix._();

  static MyAmpix get instance => _instance;

  bool _initialized = false;
  MamLogger _logger = const MamLogger();
  bool _autocaptureScreens = true;
  bool _autocaptureTaps = true;
  bool _autocapturePurchases = true;
  bool _autocaptureAttribution = true;

  /// Whether reference screenshot capture (§18) has been activated. There is
  /// no config flag: [retakeScreenshots] is the one and only switch, so a
  /// plain `MyAmpix.init()` never shows the capture button or captures
  /// anything until the host explicitly opts in by calling it.
  bool _screenshotsArmed = false;

  late final AnalyticsDatabase _database;
  late final AttributionStore _attribution;
  late final IdentityManager _identity;
  late final SuperPropertiesStore _superProperties;
  RcLinkStore? _rcLink;
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
    required MyAmpixConfig config,
    @visibleForTesting SdkOverrides? overrides,
  }) async {
    if (_instance._initialized) {
      MamLogger.fromConfig(
        config,
      ).log('MyAmpix.init ignored: SDK is already initialized.');
      return;
    }
    final sdk = MyAmpix._();
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
    MyAmpixConfig config,
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
    _rcLink = RcLinkStore(store: keyValueStore);
    await _rcLink!.load();
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

    // Debug-only init banner: proves logging is actually ON (needs
    // MyAmpixConfig(logLevel: MyAmpixLogLevel.debug) or debug: true — a debug BUILD alone is not
    // enough) and echoes the effective setup so you can confirm what the SDK is running with.
    _logger.log(
      'MyAmpix initialized '
      '| serverUrl=${config.serverUrl} '
      '| flushAt=${config.flushAt} flushInterval=${config.flushInterval.inSeconds}s '
      '| autocapture{screens:$_autocaptureScreens, taps:$_autocaptureTaps, '
      'purchases:$_autocapturePurchases, attribution:$_autocaptureAttribution} '
      '| distinctId=${_identity.distinctId} '
      '| superProperties=${_superProperties.current}',
    );

    // Native store-purchase autocapture (shared-contracts §4). Gated on
    // `config.autocapturePurchases` (default true): when enabled we subscribe
    // to the platform plugin's transaction stream (the real
    // `myampix_analytics/purchases` EventChannel, or an injected test stream).
    // Unlike the screen/tap capturers — which are pure-Dart observers — this is
    // the one autocapture that opens a real platform channel, so gating at
    // subscribe-time gives host apps a clean escape hatch (`autocapturePurchases:
    // false`) that keeps `MyAmpix.init()` from ever touching a platform channel
    // in their widget tests. Emission is ALSO guarded by
    // `autocapturePurchasesEnabled` (defense in depth).
    if (config.autocapturePurchases) {
      _purchaseAutocapture = PurchaseAutocapture(
        store: keyValueStore,
        purchaseStream: overrides?.purchaseStream,
      );
      _purchaseAutocapture!.start();
    }

    // Native install-referrer autocapture (shared-contracts §4/§5). Gated on
    // `config.autocaptureAttribution` (default true) for EXACTLY the same
    // reason as the purchase block above: this opens the real
    // `myampix_analytics/attribution` EventChannel, and an unconditional
    // subscription DEADLOCKS host-app + our own `testWidgets` fake-async.
    // Gating at subscribe-time gives host apps a clean escape hatch
    // (`autocaptureAttribution: false`) that keeps `MyAmpix.init()` from
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

    // Reference screenshot capture (shared-contracts §18): a DEBUG-ONLY
    // developer tool, gated on `kDebugMode` so a release/production build
    // never captures or uploads — only the developer's debug build populates
    // the admin's reference images. There is NO config flag: the wiring is
    // built unconditionally in debug builds, but stays dormant
    // (`_screenshotsArmed` false) until the host calls [retakeScreenshots] —
    // the one activation switch. Construction alone never renders or touches
    // the network, so a plain `MyAmpix.init()` stays safe under `testWidgets`
    // fake-async. We build it from the injected capturer (or the real
    // `RepaintBoundary` one) and reuse the same http client the uploader
    // uses. A test seam (`overrides?.screenshotCapturer`) forces the wiring
    // on for the dedicated screenshot tests.
    final wantScreenshots = kDebugMode || overrides?.screenshotCapturer != null;
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
        // Wait AT LEAST `screenshotSettleDelay` (default 1s) — the test seam
        // still wins so tests pass Duration.zero — on top of the capturer's
        // own "poll until the transition settles" logic.
        settleDelay:
            overrides?.screenshotSettleDelay ?? config.screenshotSettleDelay,
        logger: _logger,
      );
    }
  }

  void track(String event, {Map<String, Object?>? properties}) {
    _guard('track', () => _pipeline.track(event, properties));
  }

  /// Manually records a screen view for navigation the `MyAmpixObserver`
  /// (a `NavigatorObserver`) can't see — bottom-nav tabs, `IndexedStack` /
  /// `PageView` index changes, custom routers. Without this, such switches are
  /// not route pushes, so no `$screen_view` fires and every tab collapses into
  /// one screen.
  ///
  /// Emits the reserved `$screen_view` (with `$screen_name`, and
  /// `$previous_screen` when the screen actually changed) and updates the
  /// shared current-screen name (`MyAmpixObserver.currentScreenName`) so
  /// autocaptured `$tap` / `$rage_tap` — and a [captureScreenshotNow] pressed
  /// here — are stamped with the right screen. It routes through the same
  /// public [track] path as the observer. An empty [screenName] is a no-op.
  /// Never throws.
  ///
  /// Use STABLE names per layout: give each real screen / tab its own name and
  /// group dynamic detail screens under one (e.g. `product_detail`), using
  /// event properties for per-item analytics.
  void trackScreen(String screenName) {
    try {
      if (screenName.isEmpty) return;
      final previous = MyAmpixObserver.currentScreenName;
      MyAmpixObserver.currentScreenName = screenName;
      final properties = <String, Object?>{r'$screen_name': screenName};
      if (previous != null && previous != screenName) {
        properties[r'$previous_screen'] = previous;
      }
      track(r'$screen_view', properties: properties);
    } on Object catch (error, stackTrace) {
      _logger.log('trackScreen failed', error, stackTrace);
    }
  }

  /// Whether the manual reference-capture UX is live: debug build, init
  /// complete, and [retakeScreenshots] called (the one activation switch).
  /// `MyAmpixTracker` reads this to decide whether to show its capture
  /// button — always false in a release build, so end users never see it.
  bool get manualScreenshotAvailable =>
      _initialized && _screenshotsArmed && _screenshotAutocapture != null;

  /// Captures + uploads the CURRENT screen's reference screenshot right now
  /// (shared-contracts §18) — the tracker's capture button calls this. The
  /// capture always runs and replaces whatever the backend holds for
  /// `(screen, app_version)` (upsert): pressing the button IS the retake.
  /// Runs OUTSIDE the `_guard` chain so a slow upload never blocks later
  /// track/identify calls. A no-op when capture isn't live (release builds,
  /// or [retakeScreenshots] never called), the user opted out, or no screen
  /// name is known yet. Never throws.
  Future<void> captureScreenshotNow() async {
    try {
      final capture = _screenshotAutocapture;
      if (capture == null || !_screenshotsArmed) return;
      if (_optOut.isOptedOut) return;
      final screenName = MyAmpixObserver.currentScreenName;
      if (screenName == null || screenName.isEmpty) {
        _logger.log('captureScreenshotNow skipped: no current screen name.');
        return;
      }
      await capture.captureNow(screenName);
    } on Object catch (error, stackTrace) {
      _logger.log('captureScreenshotNow failed', error, stackTrace);
    }
  }

  /// ACTIVATES reference screenshot capture (shared-contracts §18) — the one
  /// and only switch: there is no config flag, so calling this after
  /// `MyAmpix.init` is all a host app needs to do. In a DEBUG build it makes
  /// [manualScreenshotAvailable] true (the tracker's capture button appears)
  /// and un-gates [captureScreenshotNow]; a release/production build stays a
  /// no-op — the capture wiring is never built there, so end users never see
  /// the button or send screenshots. Also clears the persisted "already
  /// captured" markers, so a retake replaces whatever the backend holds
  /// (upsert). Never throws.
  Future<void> retakeScreenshots() async {
    try {
      _screenshotsArmed = true;
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
  /// Read by `MyAmpixObserver`'s default wiring; not part of the frozen §8
  /// method surface, but a public property of the facade class.
  bool get autocaptureScreensEnabled => _initialized && _autocaptureScreens;

  /// Whether `$tap`/`$rage_tap` autocapture is enabled (`config.autocaptureTaps`).
  /// Read by `MyAmpixTracker`'s default wiring; not part of the frozen §8
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

  /// The current distinct id, or null before [init] completes its identity load.
  /// Pass this to other SDKs (e.g. RevenueCat's `Purchases.logIn`) to share identity.
  String? getDistinctId() {
    if (!_initialized) return null;
    return _identity.distinctId;
  }

  /// Declares the RevenueCat app_user_id for the current user so MyAmpix can
  /// attach RevenueCat webhook events to this user. Safe to call on every launch.
  void setRevenueCatAppUserId(String id) {
    final trimmed = id.trim();
    if (trimmed.isEmpty) return;
    _guard('setRevenueCatAppUserId', () async {
      await _rcLink?.set(trimmed);
      await _pipeline.track(r'$rc_link', {r'$rc_app_user_id': trimmed});
    });
  }

  void identify(String userId) => _guard('identify', () async {
    final changed = await _identity.identify(userId);
    // Debug-only: shows the identity transition. `changed=false` means the user was already
    // identified as this id (no $identify event is emitted in that case).
    _logger.log(
      'identify → distinctId now "${_identity.distinctId}" '
      '(anonId ${_identity.anonId}, changed=$changed)',
    );
    if (changed) {
      await _pipeline.track(r'$identify', {r'$anon_id': _identity.anonId});
    }
    final rcId = _rcLink?.value;
    if (rcId != null) {
      await _pipeline.track(r'$rc_link', {r'$rc_app_user_id': rcId});
    }
  });

  void alias(String aliasId) => _guard(
    'alias',
    () => _pipeline.track(r'$identify', {r'$alias': aliasId}),
  );

  /// Logout. Clears super properties, the RC link and any timed events, and
  /// drops the identified user back to anonymous.
  ///
  /// Resetting an ALREADY-anonymous install keeps the existing anonymous id
  /// rather than minting another one — see [IdentityManager.reset]. Super
  /// properties, the RC link and timed events are cleared either way: those
  /// are state the host registered explicitly, and it asked for them to go.
  void reset() => _guard('reset', () async {
    final reidentified = await _identity.reset();
    await _superProperties.clear();
    await _rcLink?.clear();
    _timedEvents.clear();
    // Debug-only: reset wipes super properties (so any registered `country` is GONE after this).
    // `reidentified=false` means the SDK was already anonymous, so the existing anonymous id is
    // kept — the reset had no identity to drop.
    _logger.log(
      'reset → anonymous distinctId "${_identity.distinctId}" '
      '(reidentified=$reidentified), super properties cleared',
    );
  });

  void timeEvent(String event) =>
      _guard('timeEvent', () => _timedEvents.start(event));

  void registerSuperProperties(Map<String, Object?> properties) => _guard(
    'registerSuperProperties',
    () async {
      await _superProperties.register(properties);
      // Debug-only: confirms the registration landed and shows the FULL super-property set now
      // attached to every subsequent event — verify e.g. `{country: FR, …}` here.
      _logger.log(
        'registerSuperProperties($properties) '
        '→ super properties now ${_superProperties.current}',
      );
    },
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
      _logger.log('flush ignored: MyAmpix.init has not completed.');
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
      _logger.log('$operation ignored: MyAmpix.init has not completed.');
      return;
    }
    _tail = _tail.then((_) async {
      // Debug-only: log EVERY public SDK call as it runs (track, identify, alias, reset, flush,
      // people.*, registerSuperProperties, timeEvent, optIn/optOut, …). Enable with
      // MyAmpixConfig(logLevel: MyAmpixLogLevel.debug) or debug: true.
      _logger.log('→ $operation()');
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
    _instance = MyAmpix._();
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
