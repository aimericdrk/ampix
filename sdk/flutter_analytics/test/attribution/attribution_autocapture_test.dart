import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/attribution/attribution_autocapture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AttributionAutocapture (direct, injected stream/handler)', () {
    late StreamController<dynamic> controller;
    late List<String> referrers;
    late AttributionAutocapture autocapture;

    setUp(() {
      controller = StreamController<dynamic>.broadcast();
      referrers = [];
      autocapture = AttributionAutocapture(
        attributionStream: controller.stream,
        onReferrer: referrers.add,
      );
      autocapture.start();
    });

    tearDown(() async {
      await autocapture.stop();
      await controller.close();
    });

    test('a raw referrer string is forwarded to the handler', () async {
      controller.add('utm_source=google-play&utm_campaign=launch');
      await pumpEventQueue();

      expect(referrers, ['utm_source=google-play&utm_campaign=launch']);
    });

    test(
      "a {'referrer': ...} map payload is unwrapped and forwarded",
      () async {
        controller.add({'referrer': 'utm_source=meta'});
        await pumpEventQueue();

        expect(referrers, ['utm_source=meta']);
      },
    );

    test('malformed payloads never throw and forward nothing', () async {
      controller
        ..add(42)
        ..add(null)
        ..add('') // empty referrer
        ..add(<String, Object?>{}) // no referrer key
        ..add({'referrer': 123}) // wrong type
        ..add(['not', 'a', 'map']);
      await pumpEventQueue();

      expect(referrers, isEmpty);
    });

    test('start() is idempotent and stop() is safe to call twice', () async {
      autocapture.start(); // second call must not double-listen
      controller.add('utm_source=x');
      await pumpEventQueue();
      expect(referrers, hasLength(1));

      await autocapture.stop();
      await autocapture.stop(); // must not throw
    });

    test('a channel-level stream error never throws', () async {
      controller.addError(StateError('platform channel boom'));
      await pumpEventQueue();
      expect(referrers, isEmpty); // observing, no crash
    });
  });
}
