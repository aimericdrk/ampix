/// Injectable time source. Every time read in the SDK goes through this
/// interface so tests can substitute a fake clock.
abstract interface class Clock {
  DateTime now();
  int nowMs();
}

/// Production clock.
class SystemClock implements Clock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now();

  @override
  int nowMs() => DateTime.now().millisecondsSinceEpoch;
}
