import '../util/clock.dart';

/// Implements `timeEvent(name)`: the next `track(name)` gets `$duration_ms`
/// attached (design §7). Timers are in-memory only.
class TimedEventTracker {
  TimedEventTracker(this._clock);

  final Clock _clock;
  final Map<String, int> _startsMs = {};

  void start(String event) => _startsMs[event] = _clock.nowMs();

  /// Returns elapsed ms and forgets the timer, or null if none was started.
  int? popDurationMs(String event) {
    final startMs = _startsMs.remove(event);
    return startMs == null ? null : _clock.nowMs() - startMs;
  }

  /// Called by reset().
  void clear() => _startsMs.clear();
}
