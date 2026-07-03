import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/optout/opt_out_state.dart';

import '../helpers/builders.dart';
import '../helpers/in_memory_key_value_store.dart';
import '../helpers/in_memory_stores.dart';

void main() {
  test('optOut purges both queues and persists across relaunch', () async {
    final kv = InMemoryKeyValueStore();
    final events = InMemoryEventStore();
    final profiles = InMemoryProfileOpStore();
    await events.add(buildEvent(), maxQueueSize: 10);

    final state = OptOutState(store: kv, events: events, profiles: profiles);
    await state.load();
    expect(state.isOptedOut, isFalse);

    await state.optOut();
    expect(state.isOptedOut, isTrue);
    expect(await events.count(), 0);
    expect(await profiles.count(), 0);

    final relaunched = OptOutState(
      store: kv,
      events: events,
      profiles: profiles,
    );
    await relaunched.load();
    expect(relaunched.isOptedOut, isTrue);
  });

  test('optIn re-enables tracking and persists', () async {
    final kv = InMemoryKeyValueStore();
    final state = OptOutState(
      store: kv,
      events: InMemoryEventStore(),
      profiles: InMemoryProfileOpStore(),
    );
    await state.load();

    await state.optOut();
    await state.optIn();
    expect(state.isOptedOut, isFalse);

    final relaunched = OptOutState(
      store: kv,
      events: InMemoryEventStore(),
      profiles: InMemoryProfileOpStore(),
    );
    await relaunched.load();
    expect(relaunched.isOptedOut, isFalse);
  });
}
