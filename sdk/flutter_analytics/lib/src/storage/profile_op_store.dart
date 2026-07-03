import 'dart:convert';

import 'package:drift/drift.dart';

import '../model/profile_operation.dart';
import 'database.dart';

class StoredProfileOp {
  const StoredProfileOp({required this.id, required this.op});

  final int id;
  final ProfileOperation op;
}

/// Persistent queue for `/ingest/profiles` operations.
abstract interface class ProfileOpStore {
  Future<void> add(ProfileOperation op, {required int maxQueueSize});
  Future<List<StoredProfileOp>> oldest(int limit);
  Future<void> delete(List<int> ids);
  Future<int> count();
  Future<void> clear();
}

class DriftProfileOpStore implements ProfileOpStore {
  DriftProfileOpStore(this._db);

  final AnalyticsDatabase _db;

  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) =>
      _db.transaction(() async {
        await _db
            .into(_db.pendingProfileOps)
            .insert(
              PendingProfileOpsCompanion.insert(
                payload: jsonEncode(op.toJson()),
              ),
            );
        final excess = await count() - maxQueueSize;
        if (excess > 0) {
          await _db.customStatement(
            'DELETE FROM pending_profile_ops WHERE id IN '
            '(SELECT id FROM pending_profile_ops ORDER BY id ASC LIMIT ?)',
            [excess],
          );
        }
      });

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async {
    final rows =
        await (_db.select(_db.pendingProfileOps)
              ..orderBy([(t) => OrderingTerm.asc(t.id)])
              ..limit(limit))
            .get();
    return [
      for (final row in rows)
        StoredProfileOp(
          id: row.id,
          op: ProfileOperation.fromJson(
            jsonDecode(row.payload) as Map<String, dynamic>,
          ),
        ),
    ];
  }

  @override
  Future<void> delete(List<int> ids) =>
      (_db.delete(_db.pendingProfileOps)..where((t) => t.id.isIn(ids))).go();

  @override
  Future<int> count() => _db.pendingProfileOps.count().getSingle();

  @override
  Future<void> clear() => _db.delete(_db.pendingProfileOps).go();
}
