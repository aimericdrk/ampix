import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/profile_op_store.dart';

void main() {
  ProfileOperation buildOp(String op) => ProfileOperation(
    distinctId: 'u_1',
    op: op,
    properties: const {'plan': 'pro'},
    timestamp: 1,
  );

  late AnalyticsDatabase db;
  late DriftProfileOpStore store;

  setUp(() {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftProfileOpStore(db);
  });

  tearDown(() => db.close());

  test('persists, peeks oldest-first, deletes and evicts', () async {
    for (var i = 0; i < 4; i++) {
      await store.add(buildOp('set_$i'), maxQueueSize: 3);
    }
    final rows = await store.oldest(10);
    expect(rows.map((r) => r.op.op).toList(), ['set_1', 'set_2', 'set_3']);
    expect(rows.first.op.toJson(), buildOp('set_1').toJson());

    await store.delete([rows.first.id]);
    expect(await store.count(), 2);

    await store.clear();
    expect(await store.count(), 0);
  });
}
