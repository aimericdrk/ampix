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
}
