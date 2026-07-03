import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/people.dart';

import 'helpers/fake_clock.dart';
import 'helpers/in_memory_stores.dart';

void main() {
  test('maps every api call to its contract §4 operation', () async {
    final store = InMemoryProfileOpStore();
    final clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: clock,
      isOptedOut: () => false,
      maxQueueSize: 100,
    );

    people.set({'plan': 'pro'});
    people.setOnce({'signup_source': 'organic'});
    people.increment({'sessions': 1});
    people.append({'badges': 'beta'});
    people.unset(['plan', 'badges']);
    people.deleteUser();
    await pumpEventQueue();

    final ops = [for (final row in store.rows) row.op.toJson()];
    expect(ops, [
      {
        'distinct_id': 'u_42',
        'op': 'set',
        'properties': {'plan': 'pro'},
        'timestamp': clock.nowMs(),
      },
      {
        'distinct_id': 'u_42',
        'op': 'set_once',
        'properties': {'signup_source': 'organic'},
        'timestamp': clock.nowMs(),
      },
      {
        'distinct_id': 'u_42',
        'op': 'increment',
        'properties': {'sessions': 1},
        'timestamp': clock.nowMs(),
      },
      {
        'distinct_id': 'u_42',
        'op': 'append',
        'properties': {'badges': 'beta'},
        'timestamp': clock.nowMs(),
      },
      {
        'distinct_id': 'u_42',
        'op': 'unset',
        'properties': {'plan': null, 'badges': null},
        'timestamp': clock.nowMs(),
      },
      {
        'distinct_id': 'u_42',
        'op': 'delete',
        'properties': <String, Object?>{},
        'timestamp': clock.nowMs(),
      },
    ]);
  });

  test('drops operations while opted out', () async {
    final store = InMemoryProfileOpStore();
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: FakeClock(),
      isOptedOut: () => true,
      maxQueueSize: 100,
    );
    people.set({'plan': 'pro'});
    await pumpEventQueue();
    expect(store.rows, isEmpty);
  });

  test('reports queue size after each enqueue', () async {
    final store = InMemoryProfileOpStore();
    final counts = <int>[];
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: FakeClock(),
      isOptedOut: () => false,
      maxQueueSize: 100,
      onQueued: counts.add,
    );
    people.set({'a': 1});
    people.set({'b': 2});
    await pumpEventQueue();
    expect(counts, [1, 2]);
  });

  test('noop instance never throws and stores nothing', () async {
    final people = People.noop();
    expect(() {
      people.set({'a': 1});
      people.increment({'n': 1});
      people.deleteUser();
    }, returnsNormally);
    await pumpEventQueue();
  });
}
