import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import 'helpers/fake_clock.dart';
import 'helpers/fake_context_data_source.dart';
import 'helpers/fixed_random.dart';
import 'helpers/in_memory_key_value_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('golden: offline → kill → relaunch → flush delivers everything once',
      () async {
    final database = AnalyticsDatabase(NativeDatabase.memory());
    final keyValueStore = InMemoryKeyValueStore();
    final clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    var online = false;
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      if (!online) throw const SocketException('offline');
      requests.add(request);
      return http.Response('{"accepted": 100, "rejected": []}', 202);
    });

    Future<void> boot() => MyAmpMix.init(
          'mam_0123456789abcdef0123456789abcdef',
          config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
          overrides: SdkOverrides(
            clock: clock,
            httpClient: client,
            database: database,
            keyValueStore: keyValueStore,
            contextDataSource: FakeContextDataSource(),
            random: FixedRandom(0.5),
          ),
        );

    // ── Run 1: offline. Events must persist, nothing must be sent. ──
    await boot();
    MyAmpMix.instance.track('offline_1');
    MyAmpMix.instance.track('offline_2');
    MyAmpMix.instance.flush();
    await pumpEventQueue(times: 50);
    expect(requests, isEmpty);

    // Snapshot the insert_ids stamped at queue time.
    final queued = await DriftEventStore(database).oldest(100);
    final queuedIds = {for (final stored in queued) stored.event.insertId};
    expect(
        {for (final stored in queued) stored.event.event}
            .containsAll({'offline_1', 'offline_2'}),
        isTrue);

    // ── "Kill": tear down without closing the shared in-memory DB. ──
    await MyAmpMix.shutdownForTesting(closeDatabase: false);

    // ── Run 2: relaunch hours later with network restored. ──
    clock.advance(const Duration(hours: 2));
    online = true;
    await boot();
    MyAmpMix.instance.flush();
    for (var i = 0; i < 200 && requests.isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    await pumpEventQueue(times: 50);

    final delivered = [
      for (final request
          in requests.where((r) => r.url.path == '/ingest/events'))
        ...((jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                as Map<String, dynamic>)['events'] as List)
            .cast<Map<String, dynamic>>(),
    ];
    final deliveredNames = delivered.map((e) => e['event']).toSet();
    final deliveredIds = delivered.map((e) => e['insert_id']).toSet();

    // All offline events arrive, with the ORIGINAL insert_ids (idempotency),
    // and the stale session was finalized on relaunch.
    expect(deliveredNames.containsAll({'offline_1', 'offline_2'}), isTrue);
    expect(deliveredIds.containsAll(queuedIds), isTrue);
    expect(deliveredNames, contains(r'$session_end'));

    await MyAmpMix.shutdownForTesting();
  });
}
