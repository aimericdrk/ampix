import 'dart:convert';

import 'package:drift/drift.dart';

import '../model/event.dart';
import 'database.dart';

/// A queued event together with its queue row id.
class StoredEvent {
  const StoredEvent({required this.id, required this.event});

  final int id;
  final AnalyticsEvent event;
}

/// Persistent write-before-send event queue (design §5).
abstract interface class EventStore {
  /// Persists [event]; evicts the oldest rows beyond [maxQueueSize].
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize});

  /// Oldest-first peek. Rows stay queued until [delete] confirms delivery.
  Future<List<StoredEvent>> oldest(int limit);

  /// Called only after the server acknowledged the batch with 202.
  Future<void> delete(List<int> ids);

  Future<int> count();

  /// Opt-out purge.
  Future<void> clear();
}

class DriftEventStore implements EventStore {
  DriftEventStore(this._db);

  final AnalyticsDatabase _db;

  @override
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}) =>
      _db.transaction(() async {
        await _db
            .into(_db.pendingEvents)
            .insert(
              PendingEventsCompanion.insert(
                payload: jsonEncode(event.toJson()),
              ),
            );
        final excess = await count() - maxQueueSize;
        if (excess > 0) {
          await _db.customStatement(
            'DELETE FROM pending_events WHERE id IN '
            '(SELECT id FROM pending_events ORDER BY id ASC LIMIT ?)',
            [excess],
          );
        }
      });

  @override
  Future<List<StoredEvent>> oldest(int limit) async {
    final rows =
        await (_db.select(_db.pendingEvents)
              ..orderBy([(t) => OrderingTerm.asc(t.id)])
              ..limit(limit))
            .get();
    return [
      for (final row in rows)
        StoredEvent(
          id: row.id,
          event: AnalyticsEvent.fromJson(
            jsonDecode(row.payload) as Map<String, dynamic>,
          ),
        ),
    ];
  }

  @override
  Future<void> delete(List<int> ids) =>
      (_db.delete(_db.pendingEvents)..where((t) => t.id.isIn(ids))).go();

  @override
  Future<int> count() => _db.pendingEvents.count().getSingle();

  @override
  Future<void> clear() => _db.delete(_db.pendingEvents).go();
}
