/// Verbosity of the SDK's internal, debug-only logging (shared-contracts §20).
///
/// Ascending verbosity: [none] silences everything, each subsequent value
/// permits strictly more. The SDK only ever emits internal diagnostics — it
/// never surfaces errors to the host app — and every emission is additionally
/// gated to debug builds (`kDebugMode`), so nothing is ever printed in release.
enum MyAmpixLogLevel { none, error, warn, info, debug }

/// Immutable SDK configuration passed to `MyAmpix.init`.
class MyAmpixConfig {
  const MyAmpixConfig({
    required this.serverUrl,
    this.flushAt = 20,
    this.flushInterval = const Duration(seconds: 10),
    this.maxQueueSize = 10000,
    this.sessionTimeout = const Duration(minutes: 30),
    this.maxRetryDelay = const Duration(minutes: 5),
    this.debug = false,
    this.logLevel = MyAmpixLogLevel.none,
    this.autocaptureScreens = true,
    this.autocaptureTaps = true,
    this.autocapturePurchases = true,
    this.autocaptureAttribution = true,
    this.autocaptureScreenshots = false,
    this.screenshotSettleDelay = const Duration(seconds: 2),
  }) : assert(
         flushAt > 0 && flushAt <= 100,
         'flushAt must be 1..100 (server INGEST_MAX_BATCH is 100)',
       ),
       assert(maxQueueSize > 0, 'maxQueueSize must be positive');

  /// Base URL of the MyAmpix backend, e.g. `https://analytics.example.com`.
  final String serverUrl;

  /// Batch size that triggers an immediate flush (and the upload batch size).
  final int flushAt;

  /// Interval of the periodic flush timer.
  final Duration flushInterval;

  /// Maximum queued events/profile ops; oldest are evicted beyond this.
  final int maxQueueSize;

  /// Background time after which the session rotates.
  final Duration sessionTimeout;

  /// Upper bound for the exponential retry backoff.
  final Duration maxRetryDelay;

  /// Enables internal logging in debug builds.
  ///
  /// Retained for back-compat; prefer [logLevel]. When [logLevel] is left at
  /// its default [MyAmpixLogLevel.none] and this is `true`, the effective
  /// level is promoted to [MyAmpixLogLevel.debug] (see [effectiveLogLevel]).
  final bool debug;

  /// Verbosity of the SDK's internal, debug-only logging (shared-contracts
  /// §20). Defaults to [MyAmpixLogLevel.none] (silent), preserving the SDK's
  /// historically quiet default. Filtering is by effective level: internal
  /// diagnostics emit at [MyAmpixLogLevel.debug], error-carrying diagnostics
  /// at [MyAmpixLogLevel.error]. See [effectiveLogLevel] for the exact
  /// interaction with the legacy [debug] flag.
  final MyAmpixLogLevel logLevel;

  /// The log level the SDK actually applies, reconciling [logLevel] with the
  /// legacy [debug] flag.
  ///
  /// - When [logLevel] is set to anything other than its default
  ///   [MyAmpixLogLevel.none], it wins outright.
  /// - When [logLevel] is left at [MyAmpixLogLevel.none] **and** [debug] is
  ///   `true`, the effective level is [MyAmpixLogLevel.debug] (back-compat:
  ///   `debug: true` used to enable full internal logging).
  /// - Otherwise the effective level is [MyAmpixLogLevel.none].
  MyAmpixLogLevel get effectiveLogLevel =>
      logLevel == MyAmpixLogLevel.none && debug
      ? MyAmpixLogLevel.debug
      : logLevel;

  /// Enables `MyAmpixObserver` to emit `$screen_view` (design §11, M2).
  /// Independently toggleable from [autocaptureTaps].
  final bool autocaptureScreens;

  /// Enables `MyAmpixTracker` to emit `$tap`/`$rage_tap` (design §11, M2).
  /// Independently toggleable from [autocaptureScreens].
  final bool autocaptureTaps;

  /// Enables native store-purchase autocapture: `$in_app_purchase` emitted
  /// automatically when the platform plugin (iOS StoreKit
  /// `SKPaymentTransactionObserver` / Android Play Billing
  /// `PurchasesUpdatedListener`) reports one of the app's own purchase
  /// transactions (shared-contracts §4). Always distinguishable from a
  /// manually-tracked purchase: this reserved, `$`-prefixed event always
  /// carries `$purchase_source: "native"`, while a developer's own
  /// `track('purchase', ...)` call is never `$`-prefixed. Independently
  /// toggleable from [autocaptureScreens]/[autocaptureTaps].
  final bool autocapturePurchases;

  /// Enables native marketing-attribution autocapture: the Android install
  /// referrer (Google Play `InstallReferrerClient`) is fetched on first
  /// launch, its `utm_*` params parsed and re-emitted as the reserved
  /// `$campaign_touch` event (`$attribution_source: "install_referrer"`,
  /// shared-contracts §4/§5). iOS has no install-referrer equivalent, so on
  /// iOS this flag only governs whether the (no-op) attribution channel is
  /// subscribed; iOS attribution is deep-link-only via
  /// [MyAmpix.trackDeepLink], which is always available regardless of this
  /// flag. Like [autocapturePurchases], this is the one attribution path that
  /// opens a real platform channel, so gating it at subscribe-time gives host
  /// apps a clean escape hatch (`autocaptureAttribution: false`) that keeps
  /// `MyAmpix.init()` from touching a platform channel in their widget
  /// tests. Independently toggleable from the other autocapture flags.
  final bool autocaptureAttribution;

  /// Enables **reference** screenshot capture (shared-contracts §18) — a
  /// developer tool, **NOT** a per-user feature. It is off by default AND only
  /// ever runs in **debug builds** (`kDebugMode`): a release/production build
  /// never captures or uploads, so end users never send screenshots (bounded
  /// storage, no PII collected in the wild). The intended workflow: set this
  /// `true` in a DEBUG build, walk through your app once — each screen is
  /// captured once per `(screen_name, app_version)` and uploaded to
  /// `POST /ingest/screenshots` to become the ADMIN's reference image for that
  /// screen (used by the dashboard's user-path map + click heatmaps). Capture
  /// waits for the navigation transition to settle first (so it isn't grabbed
  /// mid-animation), renders the current frame via a root `RepaintBoundary`,
  /// downscales it (≤ 640px longest side, JPEG q≈70), blacks out any
  /// `MyAmpixPrivacy` regions, then uploads. To replace a bad/outdated
  /// capture, delete it in the dashboard and/or call
  /// `MyAmpix.instance.retakeScreenshots()` and re-navigate. Meaningful screen
  /// names require NAMED routes (`RouteSettings(name: ...)`) — otherwise the
  /// screen falls back to the route's runtime type.
  final bool autocaptureScreenshots;

  /// How long a reference screenshot capture (shared-contracts §18) waits after
  /// a `$screen_view` before grabbing the frame, so slow / animated screen
  /// transitions have finished and the frame isn't captured mid-animation.
  /// Defaults to `const Duration(seconds: 1)`.
  ///
  /// This is the MINIMUM wait: capture waits at least this long AND, in
  /// production, additionally polls until the UI stops animating (the
  /// `RepaintBoundaryScreenshotCapturer` watches `hasScheduledFrame`), so the
  /// net is "≥ [screenshotSettleDelay] AND after the transition settles".
  /// Increase it for heavier / longer transitions.
  final Duration screenshotSettleDelay;
}
