import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/properties/timed_event_tracker.dart';

import '../helpers/fake_clock.dart';

void main() {
  test('popDurationMs returns elapsed time once, then null', () {
    final clock = FakeClock();
    final tracker = TimedEventTracker(clock);

    tracker.start('level_completed');
    clock.advance(const Duration(seconds: 42));

    expect(tracker.popDurationMs('level_completed'), 42000);
    expect(tracker.popDurationMs('level_completed'), isNull); // consumed
  });

  test('returns null for events never started and after clear', () {
    final clock = FakeClock();
    final tracker = TimedEventTracker(clock);

    expect(tracker.popDurationMs('unknown'), isNull);

    tracker.start('a');
    tracker.clear();
    expect(tracker.popDurationMs('a'), isNull);
  });
}
