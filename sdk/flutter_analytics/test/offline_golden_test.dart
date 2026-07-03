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

/// Multiset view of [values]: value → occurrence count.
Map<String, int> countBy(Iterable<String> values) {
  final counts = <String, int>{};
  for (final value in values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'golden: offline → kill → relaunch → flush delivers everything once',
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

      // Every event delivered so far across ALL /ingest/events requests, in
      // wire order — a LIST, not a set, so duplicate deliveries are visible.
      List<Map<String, dynamic>> delivered() => [
        for (final request in requests.where(
          (r) => r.url.path == '/ingest/events',
        ))
          ...((jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                      as Map<String, dynamic>)['events']
                  as List)
              .cast<Map<String, dynamic>>(),
      ];

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

      // Snapshot the FULL wire payloads stamped at queue time (insert_id →
      // all 8 contract fields), so delivery can be checked for deep payload
      // equality, not just id membership.
      final queued = await DriftEventStore(database).oldest(100);
      expect(queued, hasLength(5)); // 3 run-1 lifecycle + 2 tracked
      final queuedJsonById = {
        for (final stored in queued)
          stored.event.insertId: stored.event.toJson(),
      };
      final trackedQueued = queuedJsonById.entries
          .where(
            (entry) =>
                entry.value['event'] == 'offline_1' ||
                entry.value['event'] == 'offline_2',
          )
          .toList();
      expect(trackedQueued, hasLength(2));

      // ── "Kill": tear down without closing the shared in-memory DB. ──
      await MyAmpMix.shutdownForTesting(closeDatabase: false);

      // ── Run 2: relaunch hours later with network restored. ──
      clock.advance(const Duration(hours: 2));
      online = true;
      await boot();
      MyAmpMix.instance.flush();

      // Everything that may EVER legitimately reach the wire, as a multiset
      // of event names: run 1's offline-queued events plus run 2's relaunch
      // lifecycle (the 2 h-stale session is finalized, then a new session
      // begins — no $first_open on a second launch).
      const expectedNames = [
        r'$session_start', r'$first_open', r'$app_open', // run 1 lifecycle
        'offline_1', 'offline_2', // run 1 tracked while offline
        r'$session_end', r'$session_start', r'$app_open', // run 2 relaunch
      ];

      // Bounded poll — 10 ms steps, 3 s hard cap — until the FULL expected
      // batch is on the wire (not merely the first request), then settle.
      for (
        var i = 0;
        i < 300 && delivered().length < expectedNames.length;
        i++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      await pumpEventQueue(times: 50);
      final sent = delivered();

      // No extras and nothing missing: the delivered event names are exactly
      // the expected multiset (each name exactly as often as expected).
      expect(sent, hasLength(expectedNames.length));
      expect(
        countBy(sent.map((e) => e['event'] as String)),
        countBy(expectedNames),
      );

      // Exactly-once: every insert_id queued BEFORE the kill arrives EXACTLY
      // once (the ORIGINAL idempotency keys survive the kill, no duplicates),
      // and no insert_id at all is ever delivered twice.
      final idCounts = countBy(sent.map((e) => e['insert_id'] as String));
      for (final id in queuedJsonById.keys) {
        expect(
          idCounts[id],
          1,
          reason: 'queued insert_id $id must be delivered exactly once',
        );
      }
      expect(
        idCounts.values.every((count) => count == 1),
        isTrue,
        reason: 'no insert_id may be delivered more than once',
      );

      // Full payload equality for the explicitly tracked events: all 8 wire
      // fields (insert_id, event, distinct_id, anon_id, session_id,
      // timestamp, properties, context) must deep-equal the pre-kill queue
      // snapshot — the kill/relaunch cycle must not rewrite any field.
      for (final entry in trackedQueued) {
        final match = sent.singleWhere((e) => e['insert_id'] == entry.key);
        expect(
          match,
          equals(entry.value),
          reason: '${entry.value['event']} payload must survive unchanged',
        );
      }

      await MyAmpMix.shutdownForTesting();
    },
  );
}
