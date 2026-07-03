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
    void Function(Future<void> Function() body)? schedule,
  }) : _store = store,
       _distinctId = distinctId,
       _clock = clock,
       _isOptedOut = isOptedOut,
       _maxQueueSize = maxQueueSize,
       _onQueued = onQueued,
       _logger = logger,
       _schedule = schedule;

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

  /// Ordering seam: when set (the facade injects its `_guard` chain), every
  /// profile op runs in the SAME ordering domain as the deferred
  /// `identify()`/`reset()` bodies, so `identify('u'); people.set(...)`
  /// attributes the op to `'u'` and a post-`reset()` op carries the fresh
  /// anonymous id — never the previous user's profile. When null (direct
  /// construction in tests, `People.noop()`), ops chain on [_tail].
  final void Function(Future<void> Function() body)? _schedule;

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
    Future<void> body() async {
      try {
        // distinctId/timestamp are read INSIDE the scheduled body so a
        // deferred identify()/reset() queued earlier on the same chain has
        // already applied — the op reads post-identify identity state.
        final operation = ProfileOperation(
          distinctId: _distinctId(),
          op: op,
          properties: sanitizedProperties,
          timestamp: _clock.nowMs(),
        );
        await _store.add(operation, maxQueueSize: _maxQueueSize);
        _onQueued?.call(await _store.count());
      } on Object catch (error, stackTrace) {
        _logger.log('people.$op failed', error, stackTrace);
      }
    }

    final schedule = _schedule;
    if (schedule != null) {
      schedule(body);
    } else {
      _tail = _tail.then((_) => body());
    }
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
