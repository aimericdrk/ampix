import 'dart:math';

/// Deterministic Random: nextDouble() always returns [value], making the
/// backoff jitter factor exactly `0.5 + value`.
class FixedRandom implements Random {
  FixedRandom(this.value);

  final double value;

  @override
  double nextDouble() => value;

  @override
  int nextInt(int max) => 0;

  @override
  bool nextBool() => false;
}
