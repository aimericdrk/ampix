import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/config.dart';

import 'helpers/fake_clock.dart';

void main() {
  test('config defaults match the design spec', () {
    const config = MyAmpMixConfig(serverUrl: 'http://localhost:8080');
    expect(config.serverUrl, 'http://localhost:8080');
    expect(config.flushAt, 20);
    expect(config.flushInterval, const Duration(seconds: 10));
    expect(config.maxQueueSize, 10000);
    expect(config.sessionTimeout, const Duration(minutes: 30));
    expect(config.maxRetryDelay, const Duration(minutes: 5));
    expect(config.debug, isFalse);
    expect(config.autocaptureScreens, isTrue);
    expect(config.autocaptureTaps, isTrue);
    expect(config.autocapturePurchases, isTrue);
    expect(config.autocaptureAttribution, isTrue);
  });

  test('fake clock advances deterministically', () {
    final clock = FakeClock(DateTime.utc(2026, 7, 2));
    final startMs = clock.nowMs();
    clock.advance(const Duration(minutes: 30));
    expect(clock.nowMs() - startMs, 30 * 60 * 1000);
    expect(clock.now(), DateTime.utc(2026, 7, 2, 0, 30));
  });
}
