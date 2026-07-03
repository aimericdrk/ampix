import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'database.g.dart';

/// Events queued for `/ingest/events`, serialized contract JSON per row.
class PendingEvents extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get payload => text()();
}

/// Profile operations queued for `/ingest/profiles`.
class PendingProfileOps extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get payload => text()();
}

@DriftDatabase(tables: [PendingEvents, PendingProfileOps])
class AnalyticsDatabase extends _$AnalyticsDatabase {
  AnalyticsDatabase(super.e);

  /// Opens the on-device database under the application support directory.
  static AnalyticsDatabase open() => AnalyticsDatabase(
    LazyDatabase(() async {
      final directory = await getApplicationSupportDirectory();
      return NativeDatabase.createInBackground(
        File(p.join(directory.path, 'myampmix_analytics.sqlite')),
      );
    }),
  );

  @override
  int get schemaVersion => 1;
}
