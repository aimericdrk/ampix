import 'package:myampix_analytics/src/model/event.dart';
import 'package:myampix_analytics/src/model/profile_operation.dart';
import 'package:myampix_analytics/src/storage/event_store.dart';
import 'package:myampix_analytics/src/storage/profile_op_store.dart';

class InMemoryEventStore implements EventStore {
  final List<StoredEvent> rows = [];
  int _nextId = 1;

  @override
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}) async {
    rows.add(StoredEvent(id: _nextId++, event: event));
    while (rows.length > maxQueueSize) {
      rows.removeAt(0);
    }
  }

  @override
  Future<List<StoredEvent>> oldest(int limit) async =>
      rows.take(limit).toList();

  @override
  Future<void> delete(List<int> ids) async =>
      rows.removeWhere((row) => ids.contains(row.id));

  @override
  Future<int> count() async => rows.length;

  @override
  Future<void> clear() async => rows.clear();
}

class InMemoryProfileOpStore implements ProfileOpStore {
  final List<StoredProfileOp> rows = [];
  int _nextId = 1;

  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) async {
    rows.add(StoredProfileOp(id: _nextId++, op: op));
    while (rows.length > maxQueueSize) {
      rows.removeAt(0);
    }
  }

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async =>
      rows.take(limit).toList();

  @override
  Future<void> delete(List<int> ids) async =>
      rows.removeWhere((row) => ids.contains(row.id));

  @override
  Future<int> count() async => rows.length;

  @override
  Future<void> clear() async => rows.clear();
}
