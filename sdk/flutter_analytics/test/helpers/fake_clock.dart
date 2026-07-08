import 'package:myampix_analytics/src/util/clock.dart';

/// Deterministic clock driven by tests.
class FakeClock implements Clock {
  FakeClock([DateTime? start]) : _now = start ?? DateTime.utc(2026, 7, 2, 12);

  DateTime _now;

  void advance(Duration duration) => _now = _now.add(duration);

  @override
  DateTime now() => _now;

  @override
  int nowMs() => _now.millisecondsSinceEpoch;
}
