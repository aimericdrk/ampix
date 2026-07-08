import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/storage/database.dart';
import 'package:myampix_analytics/src/storage/event_store.dart';

import '../helpers/builders.dart';

void main() {
  late AnalyticsDatabase db;
  late DriftEventStore store;

  setUp(() {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftEventStore(db);
  });

  tearDown(() => db.close());

  test(
    'persists events and returns them oldest-first with full payload',
    () async {
      await store.add(
        buildEvent(name: 'first', insertId: 'i-1'),
        maxQueueSize: 100,
      );
      await store.add(
        buildEvent(name: 'second', insertId: 'i-2'),
        maxQueueSize: 100,
      );

      final stored = await store.oldest(10);
      expect(stored.map((s) => s.event.event).toList(), ['first', 'second']);
      expect(
        stored.first.event.toJson(),
        buildEvent(name: 'first', insertId: 'i-1').toJson(),
      );
    },
  );

  test(
    'oldest() does not delete; delete() removes only the given ids',
    () async {
      await store.add(buildEvent(insertId: 'i-1'), maxQueueSize: 100);
      await store.add(buildEvent(insertId: 'i-2'), maxQueueSize: 100);

      final batch = await store.oldest(1);
      expect(await store.count(), 2);

      await store.delete([batch.single.id]);
      expect(await store.count(), 1);
      expect((await store.oldest(10)).single.event.insertId, 'i-2');
    },
  );

  test('evicts the oldest rows beyond maxQueueSize', () async {
    for (var i = 0; i < 5; i++) {
      await store.add(
        buildEvent(name: 'e$i', insertId: 'i-$i'),
        maxQueueSize: 3,
      );
    }
    final remaining = await store.oldest(10);
    expect(remaining.map((s) => s.event.event).toList(), ['e2', 'e3', 'e4']);
  });

  test('clear() empties the queue', () async {
    await store.add(buildEvent(), maxQueueSize: 10);
    await store.clear();
    expect(await store.count(), 0);
  });
}
