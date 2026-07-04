/// Immutable SDK configuration passed to `MyAmpMix.init`.
class MyAmpMixConfig {
  const MyAmpMixConfig({
    required this.serverUrl,
    this.flushAt = 20,
    this.flushInterval = const Duration(seconds: 10),
    this.maxQueueSize = 10000,
    this.sessionTimeout = const Duration(minutes: 30),
    this.maxRetryDelay = const Duration(minutes: 5),
    this.debug = false,
    this.autocaptureScreens = true,
    this.autocaptureTaps = true,
    this.autocapturePurchases = true,
    this.autocaptureAttribution = true,
  }) : assert(
         flushAt > 0 && flushAt <= 100,
         'flushAt must be 1..100 (server INGEST_MAX_BATCH is 100)',
       ),
       assert(maxQueueSize > 0, 'maxQueueSize must be positive');

  /// Base URL of the MyAmpMix backend, e.g. `https://analytics.example.com`.
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
  final bool debug;

  /// Enables `MyAmpMixObserver` to emit `$screen_view` (design §11, M2).
  /// Independently toggleable from [autocaptureTaps].
  final bool autocaptureScreens;

  /// Enables `MyAmpMixTracker` to emit `$tap`/`$rage_tap` (design §11, M2).
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
  /// [MyAmpMix.trackDeepLink], which is always available regardless of this
  /// flag. Like [autocapturePurchases], this is the one attribution path that
  /// opens a real platform channel, so gating it at subscribe-time gives host
  /// apps a clean escape hatch (`autocaptureAttribution: false`) that keeps
  /// `MyAmpMix.init()` from touching a platform channel in their widget
  /// tests. Independently toggleable from the other autocapture flags.
  final bool autocaptureAttribution;
}
