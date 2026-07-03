import 'package:myampmix_analytics/src/model/event.dart';

AnalyticsEvent buildEvent({String name = 'test_event', String insertId = 'insert-1'}) =>
    AnalyticsEvent(
      insertId: insertId,
      event: name,
      distinctId: 'user-1',
      anonId: 'anon-1',
      sessionId: 'session-1',
      timestamp: 1751462400123,
      properties: const {'k': 'v'},
      context: const EventContext(os: 'ios', sdkVersion: '0.1.0'),
    );
