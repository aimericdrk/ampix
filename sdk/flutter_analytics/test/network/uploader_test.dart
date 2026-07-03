import 'dart:convert';
import 'dart:io';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';
import 'package:myampmix_analytics/src/network/uploader.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/builders.dart';
import '../helpers/fake_clock.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_stores.dart';

void main() {
  late InMemoryEventStore events;
  late InMemoryProfileOpStore profiles;
  late FakeClock clock;
  late List<http.Request> requests;

  setUp(() {
    events = InMemoryEventStore();
    profiles = InMemoryProfileOpStore();
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    requests = [];
  });

  Uploader build(http.Client client, {double jitter = 0.5}) => Uploader(
    client: client,
    events: events,
    profiles: profiles,
    serverUrl: 'http://localhost:8080',
    token: 'mam_0123456789abcdef0123456789abcdef',
    clock: clock,
    batchSize: 20,
    flushInterval: const Duration(seconds: 10),
    random: FixedRandom(jitter), // jitter factor = 0.5 + jitter
  );

  MockClient acceptAll({String body = '{"accepted": 20, "rejected": []}'}) =>
      MockClient((request) async {
        requests.add(request);
        return http.Response(body, 202);
      });

  Map<String, dynamic> decodeBody(http.Request request) =>
      jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
          as Map<String, dynamic>;

  test(
    'posts gzip batches of 20 with auth header; deletes only after 202',
    () async {
      for (var i = 0; i < 25; i++) {
        await events.add(
          buildEvent(name: 'e$i', insertId: 'i-$i'),
          maxQueueSize: 1000,
        );
      }
      await build(acceptAll()).flush();

      expect(requests, hasLength(2)); // 20 + 5
      final first = requests.first;
      expect(first.url.toString(), 'http://localhost:8080/ingest/events');
      expect(
        first.headers['Authorization'],
        'Bearer mam_0123456789abcdef0123456789abcdef',
      );
      expect(first.headers['Content-Encoding'], 'gzip');
      final payload = decodeBody(first);
      expect((payload['events'] as List).length, 20);
      expect(((payload['events'] as List).first as Map)['insert_id'], 'i-0');
      expect(await events.count(), 0);
    },
  );

  test(
    'keeps events and backs off after a 5xx; retries after the delay',
    () async {
      await events.add(buildEvent(), maxQueueSize: 10);
      var calls = 0;
      final client = MockClient((request) async {
        calls++;
        return http.Response('oops', 500);
      });
      final uploader = build(client); // jitter factor exactly 1.0

      await uploader.flush();
      expect(calls, 1);
      expect(await events.count(), 1); // retained

      clock.advance(const Duration(seconds: 1)); // inside 2 s backoff window
      await uploader.flush();
      expect(calls, 1); // no attempt

      clock.advance(const Duration(seconds: 1)); // 2 s elapsed
      await uploader.flush();
      expect(calls, 2);
    },
  );

  test('backoff doubles per consecutive failure', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('oops', 500);
    });
    final uploader = build(client);

    await uploader.flush(); // failure 1 → next delay 2 s
    clock.advance(const Duration(seconds: 2));
    await uploader.flush(); // failure 2 → next delay 4 s
    expect(calls, 2);

    clock.advance(const Duration(seconds: 3)); // still inside 4 s window
    await uploader.flush();
    expect(calls, 2);

    clock.advance(const Duration(seconds: 1)); // 4 s elapsed
    await uploader.flush();
    expect(calls, 3);
  });

  test('flush(force: true) ignores the backoff window', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('oops', 500);
    });
    final uploader = build(client);

    await uploader.flush();
    await uploader.flush(force: true);
    expect(calls, 2);
  });

  test('drops the batch on 400 without retrying', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final client = MockClient((request) async => http.Response('bad', 400));
    await build(client).flush();
    expect(await events.count(), 0);
  });

  test(
    '202 partial rejection: whole batch leaves the queue (rejected dropped)',
    () async {
      await events.add(buildEvent(insertId: 'ok'), maxQueueSize: 10);
      await events.add(buildEvent(insertId: 'bad'), maxQueueSize: 10);
      final client = acceptAll(
        body:
            '{"accepted": 1, "rejected": [{"index": 1, "reason": "missing insert_id"}]}',
      );
      await build(client).flush();
      expect(await events.count(), 0);
    },
  );

  test('keeps events when the network throws (offline)', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final client = MockClient(
      (request) async => throw const SocketException('offline'),
    );
    await build(client).flush();
    expect(await events.count(), 1);
  });

  test(
    'drains profile operations to /ingest/profiles with contract payload',
    () async {
      await profiles.add(
        const ProfileOperation(
          distinctId: 'u_42',
          op: 'set',
          properties: {'plan': 'pro'},
          timestamp: 1751462400123,
        ),
        maxQueueSize: 10,
      );
      await build(acceptAll()).flush();

      expect(requests.single.url.path, '/ingest/profiles');
      expect(decodeBody(requests.single), {
        'operations': [
          {
            'distinct_id': 'u_42',
            'op': 'set',
            'properties': {'plan': 'pro'},
            'timestamp': 1751462400123,
          },
        ],
      });
    },
  );

  test('maybeFlush triggers only at batchSize', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final uploader = build(acceptAll());

    uploader.maybeFlush(19);
    await pumpEventQueue();
    expect(requests, isEmpty);

    uploader.maybeFlush(20);
    await pumpEventQueue();
    expect(requests, hasLength(1));
  });

  test('periodic timer flushes every flushInterval', () {
    fakeAsync((async) {
      events.rows.add(StoredEvent(id: 1, event: buildEvent()));
      final uploader = build(acceptAll());
      uploader.start();
      expect(requests, isEmpty);

      async.elapse(const Duration(seconds: 10));
      expect(requests, hasLength(1));

      uploader.dispose();
      async.elapse(const Duration(seconds: 30));
      expect(requests, hasLength(1)); // timer cancelled
    });
  });
}
