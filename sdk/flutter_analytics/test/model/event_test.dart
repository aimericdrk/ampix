import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/event.dart';

void main() {
  test(
    'serializes exactly to the ingest contract shape (shared-contracts §4)',
    () {
      const event = AnalyticsEvent(
        insertId: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
        event: 'checkout_completed',
        distinctId: 'u_42',
        anonId: '018f6b2e-aaaa-7bbb-8ccc-1a2b3c4d5e6f',
        sessionId: '018f6b2e-dddd-7eee-8fff-1a2b3c4d5e6f',
        timestamp: 1751462400123,
        properties: {'plan': 'pro', 'value': 9.99},
        context: EventContext(
          appVersion: '1.4.2',
          appBuild: '142',
          os: 'ios',
          osVersion: '18.5',
          deviceModel: 'iPhone16,2',
          deviceManufacturer: 'Apple',
          locale: 'fr_FR',
          timezone: 'Europe/Paris',
          screenWidth: 393,
          screenHeight: 852,
          network: 'wifi',
          sdkVersion: '0.1.0',
        ),
      );

      expect(event.toJson(), {
        'insert_id': '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
        'event': 'checkout_completed',
        'distinct_id': 'u_42',
        'anon_id': '018f6b2e-aaaa-7bbb-8ccc-1a2b3c4d5e6f',
        'session_id': '018f6b2e-dddd-7eee-8fff-1a2b3c4d5e6f',
        'timestamp': 1751462400123,
        'properties': {'plan': 'pro', 'value': 9.99},
        'context': {
          'app_version': '1.4.2',
          'app_build': '142',
          'os': 'ios',
          'os_version': '18.5',
          'device_model': 'iPhone16,2',
          'device_manufacturer': 'Apple',
          'locale': 'fr_FR',
          'timezone': 'Europe/Paris',
          'screen_width': 393,
          'screen_height': 852,
          'network': 'wifi',
          'sdk_version': '0.1.0',
        },
      });
    },
  );

  test('omits null context fields', () {
    const context = EventContext(os: 'android');
    expect(context.toJson(), {'os': 'android'});
  });

  test('round-trips through json encode/decode (queue persistence)', () {
    const event = AnalyticsEvent(
      insertId: 'a',
      event: 'e',
      distinctId: 'd',
      anonId: 'an',
      sessionId: 's',
      timestamp: 1,
      properties: {'k': 'v'},
      context: EventContext(os: 'ios', screenWidth: 393),
    );
    final decoded = AnalyticsEvent.fromJson(
      jsonDecode(jsonEncode(event.toJson())) as Map<String, dynamic>,
    );
    expect(decoded.toJson(), event.toJson());
  });
}
