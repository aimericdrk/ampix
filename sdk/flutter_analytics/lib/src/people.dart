import 'model/profile_operation.dart';
import 'pipeline/event_pipeline.dart' show sanitizeProperties;
import 'storage/profile_op_store.dart';
import 'util/clock.dart';
import 'util/logger.dart';

/// `MyAmpMix.instance.people` — maps 1:1 to `/ingest/profiles` operations
/// (shared-contracts §4 and §8). Methods are synchronous fire-and-forget
/// per the frozen surface and never throw into the host app.
class People {
  People({
    required ProfileOpStore store,
    required String Function() distinctId,
    required Clock clock,
    required bool Function() isOptedOut,
    required int maxQueueSize,
    void Function(int queuedCount)? onQueued,
    MamLogger logger = const MamLogger(enabled: false),
  }) : _store = store,
       _distinctId = distinctId,
       _clock = clock,
       _isOptedOut = isOptedOut,
       _maxQueueSize = maxQueueSize,
       _onQueued = onQueued,
       _logger = logger;

  /// Inert instance used before `MyAmpMix.init` completes (design §13).
  factory People.noop() => People(
    store: _NoopProfileOpStore(),
    distinctId: () => '',
    clock: const SystemClock(),
    isOptedOut: () => true,
    maxQueueSize: 0,
  );

  final ProfileOpStore _store;
  final String Function() _distinctId;
  final Clock _clock;
  final bool Function() _isOptedOut;
  final int _maxQueueSize;
  final void Function(int queuedCount)? _onQueued;
  final MamLogger _logger;

  /// Serializes the fire-and-forget store writes so that `onQueued` fires
  /// in call order. Without this, two synchronous calls (e.g. `set`
  /// followed immediately by `set`) can both mutate the store before either
  /// one's `count()` read runs, reporting the same (final) count for both
  /// instead of the count immediately after each call's own write.
  Future<void> _tail = Future<void>.value();

  void set(Map<String, Object?> properties) => _enqueue('set', properties);

  void setOnce(Map<String, Object?> properties) =>
      _enqueue('set_once', properties);

  void increment(Map<String, num> properties) =>
      _enqueue('increment', properties);

  void append(Map<String, Object?> properties) =>
      _enqueue('append', properties);

  void unset(List<String> propertyNames) =>
      _enqueue('unset', {for (final name in propertyNames) name: null});

  void deleteUser() => _enqueue('delete', const {});

  void _enqueue(String op, Map<String, Object?> properties) {
    if (_isOptedOut()) return;
    // Ingest contract's flat-properties rule applies to profile properties
    // too (shared-contracts §4): drop any nested Map/List value before it
    // ever reaches the queue or the wire.
    final sanitizedProperties = sanitizeProperties(properties, _logger);
    // distinctId/timestamp are read synchronously at call time so caller
    // ordering holds, matching EventPipeline.track's convention.
    final operation = ProfileOperation(
      distinctId: _distinctId(),
      op: op,
      properties: sanitizedProperties,
      timestamp: _clock.nowMs(),
    );
    _tail = _tail.then((_) async {
      try {
        await _store.add(operation, maxQueueSize: _maxQueueSize);
        _onQueued?.call(await _store.count());
      } on Object catch (error, stackTrace) {
        _logger.log('people.$op failed', error, stackTrace);
      }
    });
  }
}

class _NoopProfileOpStore implements ProfileOpStore {
  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) async {}

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async => const [];

  @override
  Future<void> delete(List<int> ids) async {}

  @override
  Future<int> count() async => 0;

  @override
  Future<void> clear() async {}
}
