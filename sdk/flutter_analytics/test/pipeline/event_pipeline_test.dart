import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/context/context_collector.dart';
import 'package:myampmix_analytics/src/identity/identity_manager.dart';
import 'package:myampmix_analytics/src/pipeline/event_pipeline.dart';
import 'package:myampmix_analytics/src/properties/super_properties_store.dart';
import 'package:myampmix_analytics/src/properties/timed_event_tracker.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  late AnalyticsDatabase db;
  late DriftEventStore store;
  late FakeClock clock;
  late IdentityManager identity;
  late SuperPropertiesStore superProps;
  late TimedEventTracker timedEvents;
  var optedOut = false;

  setUp(() async {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftEventStore(db);
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    final kv = InMemoryKeyValueStore();
    identity = IdentityManager(store: kv, idFactory: () => 'anon-1');
    await identity.load();
    superProps = SuperPropertiesStore(kv);
    await superProps.load();
    timedEvents = TimedEventTracker(clock);
    optedOut = false;
  });

  tearDown(() => db.close());

  EventPipeline build({void Function(int)? onQueued}) => EventPipeline(
    clock: clock,
    store: store,
    identity: identity,
    sessionId: () => 'session-1',
    superProperties: superProps,
    timedEvents: timedEvents,
    contextCollector: ContextCollector(FakeContextDataSource()),
    maxQueueSize: 100,
    isOptedOut: () => optedOut,
    idFactory: () => 'insert-1',
    onEventQueued: onQueued,
  );

  test('persists a fully assembled contract event', () async {
    await superProps.register({'plan': 'pro'});
    await build().track('checkout_completed', {'value': 9.99});

    final stored = (await store.oldest(1)).single.event;
    expect(stored.toJson(), {
      'insert_id': 'insert-1',
      'event': 'checkout_completed',
      'distinct_id': 'anon-1',
      'anon_id': 'anon-1',
      'session_id': 'session-1',
      'timestamp': clock.nowMs(),
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
  });

  test('explicit properties win over super properties', () async {
    await superProps.register({'plan': 'free'});
    await build().track('e', {'plan': 'pro'});
    expect((await store.oldest(1)).single.event.properties['plan'], 'pro');
  });

  test(r'attaches $duration_ms from a pending timeEvent', () async {
    timedEvents.start('level_completed');
    clock.advance(const Duration(seconds: 42));
    await build().track('level_completed');
    expect(
      (await store.oldest(1)).single.event.properties[r'$duration_ms'],
      42000,
    );
  });

  test(r'three-way precedence: super properties < explicit properties < '
      r'$duration_ms', () async {
    await superProps.register({r'$duration_ms': 111});
    timedEvents.start('level_completed');
    clock.advance(const Duration(seconds: 42));
    await build().track('level_completed', {r'$duration_ms': 222});
    expect(
      (await store.oldest(1)).single.event.properties[r'$duration_ms'],
      42000,
    );
  });

  test('drops events while opted out', () async {
    optedOut = true;
    await build().track('e');
    expect(await store.count(), 0);
  });

  test('reports queue size after each insert', () async {
    int? reported;
    await build(onQueued: (count) => reported = count).track('e');
    expect(reported, 1);
  });
}
