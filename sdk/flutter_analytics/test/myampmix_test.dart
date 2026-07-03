import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show AppLifecycleState;

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/model/event.dart';
import 'package:myampmix_analytics/src/properties/super_properties_store.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';
import 'package:myampmix_analytics/src/storage/key_value_store.dart';

import 'helpers/fake_clock.dart';
import 'helpers/fake_context_data_source.dart';
import 'helpers/fixed_random.dart';
import 'helpers/in_memory_key_value_store.dart';
import 'helpers/in_memory_stores.dart';

class ThrowingKeyValueStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => throw StateError('boom');

  @override
  Future<void> setString(String key, String value) async =>
      throw StateError('boom');

  @override
  Future<void> remove(String key) async => throw StateError('boom');
}

/// Throws for any custom (non `$`-prefixed) event while letting the SDK's
/// own session-lifecycle events through, so `MyAmpMix.init` still completes
/// normally. Used to prove the never-throw guard swallows an exception
/// raised deep in the write path when the host app calls `track()` after a
/// successful init (controller-adjudicated requirement 1).
class ThrowingEventStore implements EventStore {
  /// Every event name [add] was invoked with, recorded BEFORE throwing, so
  /// tests can assert the guarded call actually reached the store (and did
  /// not pass vacuously through the pre-init no-op branch of `_guard`).
  final List<String> attemptedEvents = [];

  @override
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}) async {
    attemptedEvents.add(event.event);
    if (!event.event.startsWith(r'$')) {
      throw StateError('event store boom');
    }
  }

  @override
  Future<List<StoredEvent>> oldest(int limit) async => const [];

  @override
  Future<void> delete(List<int> ids) async {}

  @override
  Future<int> count() async => 0;

  @override
  Future<void> clear() async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // The double-init test legitimately constructs a second in-memory
  // database while the first is still open; each has its own executor, so
  // drift's shared-executor race warning does not apply.
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  late List<http.Request> requests;
  late FakeClock clock;
  late InMemoryKeyValueStore keyValueStore;

  setUp(() {
    requests = [];
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    keyValueStore = InMemoryKeyValueStore();
  });

  tearDown(() => MyAmpMix.shutdownForTesting());

  MockClient acceptAll() => MockClient((request) async {
    requests.add(request);
    return http.Response('{"accepted": 100, "rejected": []}', 202);
  });

  Future<void> initSdk({http.Client? client, EventStore? eventStore}) =>
      MyAmpMix.init(
        'mam_0123456789abcdef0123456789abcdef',
        config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
        overrides: SdkOverrides(
          clock: clock,
          httpClient: client ?? acceptAll(),
          database: AnalyticsDatabase(NativeDatabase.memory()),
          keyValueStore: keyValueStore,
          contextDataSource: FakeContextDataSource(),
          random: FixedRandom(0.5),
          eventStore: eventStore,
        ),
      );

  Future<void> waitFor(bool Function() condition) async {
    for (var i = 0; i < 200 && !condition(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(condition(), isTrue);
  }

  List<Map<String, dynamic>> sentEvents() => [
    for (final request in requests.where((r) => r.url.path == '/ingest/events'))
      ...((jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                  as Map<String, dynamic>)['events']
              as List)
          .cast<Map<String, dynamic>>(),
  ];

  test('init + track + flush delivers a contract-shaped event', () async {
    await initSdk();
    MyAmpMix.instance.track('checkout_completed', properties: {'value': 9.99});
    MyAmpMix.instance.flush();
    await waitFor(
      () => sentEvents().any((e) => e['event'] == 'checkout_completed'),
    );

    final event = sentEvents().firstWhere(
      (e) => e['event'] == 'checkout_completed',
    );
    expect(event['insert_id'], isNotEmpty);
    expect(event['distinct_id'], event['anon_id']); // anonymous user
    expect(event['session_id'], isNotEmpty);
    expect(event['timestamp'], clock.nowMs());
    expect(event['properties'], {'value': 9.99});
    expect((event['context'] as Map)['sdk_version'], '0.1.0');
  });

  test('first launch sends the session lifecycle events in order', () async {
    await initSdk();
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().length >= 3);
    expect(
      sentEvents().map((e) => e['event']).toList(),
      containsAllInOrder([r'$session_start', r'$first_open', r'$app_open']),
    );
  });

  test(r'identify emits $identify and switches distinct_id', () async {
    await initSdk();
    MyAmpMix.instance.identify('u_42');
    MyAmpMix.instance.track('after_login');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == 'after_login'));

    final identifyEvent = sentEvents().firstWhere(
      (e) => e['event'] == r'$identify',
    );
    expect(identifyEvent['distinct_id'], 'u_42');
    expect(
      (identifyEvent['properties'] as Map)[r'$anon_id'],
      identifyEvent['anon_id'],
    );
    final after = sentEvents().firstWhere((e) => e['event'] == 'after_login');
    expect(after['distinct_id'], 'u_42');
  });

  test(r'alias emits $identify carrying $alias', () async {
    await initSdk();
    MyAmpMix.instance.alias('new-id');
    MyAmpMix.instance.flush();
    await waitFor(
      () => sentEvents().any(
        (e) =>
            e['event'] == r'$identify' &&
            (e['properties'] as Map)[r'$alias'] == 'new-id',
      ),
    );
  });

  test('background >30 min rotates the session', () async {
    await initSdk();
    final binding = TestWidgetsFlutterBinding.instance;

    binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await pumpEventQueue();

    clock.advance(const Duration(minutes: 31));
    binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await pumpEventQueue();

    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == r'$session_end'));

    final names = sentEvents().map((e) => e['event']).toList();
    expect(
      names,
      containsAll([r'$app_background', r'$session_end', r'$app_open']),
    );
    final sessionEnd = sentEvents().firstWhere(
      (e) => e['event'] == r'$session_end',
    );
    expect((sessionEnd['properties'] as Map)[r'$duration_ms'], isA<int>());
    final firstId = sentEvents().first['session_id'];
    final lastOpen = sentEvents().lastWhere((e) => e['event'] == r'$app_open');
    expect(lastOpen['session_id'], isNot(firstId));
  });

  test('people operations are delivered to /ingest/profiles', () async {
    await initSdk();
    MyAmpMix.instance.people.set({'plan': 'pro'});
    await pumpEventQueue();
    MyAmpMix.instance.flush();
    await waitFor(() => requests.any((r) => r.url.path == '/ingest/profiles'));

    final request = requests.firstWhere(
      (r) => r.url.path == '/ingest/profiles',
    );
    final ops =
        (jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                as Map<String, dynamic>)['operations']
            as List;
    expect((ops.single as Map)['op'], 'set');
    expect((ops.single as Map)['properties'], {'plan': 'pro'});
    expect((ops.single as Map)['distinct_id'], isNotEmpty);
  });

  test('opt-out drops events until opt-in', () async {
    await initSdk();
    MyAmpMix.instance.optOutTracking();
    await pumpEventQueue();

    MyAmpMix.instance.track('secret');
    MyAmpMix.instance.flush();
    await pumpEventQueue();
    expect(sentEvents().where((e) => e['event'] == 'secret'), isEmpty);

    MyAmpMix.instance.optInTracking();
    await pumpEventQueue();
    MyAmpMix.instance.track('visible');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == 'visible'));
  });

  test('registerSuperProperties and timeEvent flow through track', () async {
    await initSdk();
    MyAmpMix.instance.registerSuperProperties({'ab_group': 'b'});
    MyAmpMix.instance.timeEvent('level_completed');
    await pumpEventQueue();
    clock.advance(const Duration(seconds: 7));
    MyAmpMix.instance.track('level_completed');
    MyAmpMix.instance.flush();
    await waitFor(
      () => sentEvents().any((e) => e['event'] == 'level_completed'),
    );

    final event = sentEvents().firstWhere(
      (e) => e['event'] == 'level_completed',
    );
    expect((event['properties'] as Map)['ab_group'], 'b');
    expect((event['properties'] as Map)[r'$duration_ms'], 7000);
  });

  test(
    'reset issues a fresh anonymous identity and clears super properties',
    () async {
      await initSdk();
      MyAmpMix.instance.identify('u_42');
      MyAmpMix.instance.registerSuperProperties({'plan': 'pro'});
      await pumpEventQueue();
      MyAmpMix.instance.reset();
      await pumpEventQueue();
      MyAmpMix.instance.track('after_reset');
      MyAmpMix.instance.flush();
      await waitFor(() => sentEvents().any((e) => e['event'] == 'after_reset'));

      final event = sentEvents().firstWhere((e) => e['event'] == 'after_reset');
      expect(event['distinct_id'], isNot('u_42'));
      expect(event['distinct_id'], event['anon_id']);
      expect((event['properties'] as Map).containsKey('plan'), isFalse);
    },
  );

  test('no public method throws before init', () async {
    await MyAmpMix.shutdownForTesting(); // pristine uninitialized instance
    final sdk = MyAmpMix.instance;
    expect(() {
      sdk.track('e');
      sdk.identify('u');
      sdk.alias('a');
      sdk.reset();
      sdk.flush();
      sdk.timeEvent('e');
      sdk.registerSuperProperties({'k': 'v'});
      sdk.people.set({'k': 'v'});
      sdk.optOutTracking();
      sdk.optInTracking();
    }, returnsNormally);
  });

  test('init failure disables the SDK instead of throwing', () async {
    final db = AnalyticsDatabase(NativeDatabase.memory());
    await MyAmpMix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        clock: clock,
        httpClient: acceptAll(),
        database: db,
        keyValueStore: ThrowingKeyValueStore(),
        contextDataSource: FakeContextDataSource(),
      ),
    );
    expect(() => MyAmpMix.instance.track('e'), returnsNormally);
    await pumpEventQueue();
    await db.close();
  });

  // --- Controller-adjudicated requirement 1: never-throw wrapper ---------

  test('track() never throws even when the event store fails internally '
      'after a successful init', () async {
    final store = ThrowingEventStore();
    await initSdk(eventStore: store);

    // Init itself must have completed successfully (only $-prefixed
    // lifecycle events flow through the throwing store during init).
    expect(store.attemptedEvents, contains(r'$app_open'));

    expect(
      () => MyAmpMix.instance.track('checkout_completed'),
      returnsNormally,
    );
    await pumpEventQueue();
    // The guarded call really reached the store and threw there — it did
    // not pass vacuously through the pre-init no-op branch of _guard.
    expect(store.attemptedEvents, contains('checkout_completed'));
  });

  // --- Controller-adjudicated requirement 2: init ordering / corrupt data -

  test('corrupt persisted super properties degrade to empty instead of '
      'failing init', () async {
    keyValueStore.values[SuperPropertiesStore.storageKey] = 'not-json{{{';
    await initSdk();

    MyAmpMix.instance.track('after_corrupt_props');
    MyAmpMix.instance.flush();
    await waitFor(
      () => sentEvents().any((e) => e['event'] == 'after_corrupt_props'),
    );

    final event = sentEvents().firstWhere(
      (e) => e['event'] == 'after_corrupt_props',
    );
    expect((event['properties'] as Map).keys, isEmpty);
  });

  // --- Review fix 1: flush() is decoupled from the guard chain -----------

  test('a slow network flush does not block track() from reaching the '
      'local queue', () async {
    final gate = Completer<void>();
    final store = InMemoryEventStore();
    final slowClient = MockClient((request) async {
      requests.add(request);
      await gate.future;
      return http.Response('{"accepted": 100, "rejected": []}', 202);
    });
    await initSdk(client: slowClient, eventStore: store);

    MyAmpMix.instance.flush();
    // The drain is now in flight, blocked on the unanswered request.
    await waitFor(() => requests.any((r) => r.url.path == '/ingest/events'));

    MyAmpMix.instance.track('queued_during_flush');
    await waitFor(
      () => store.rows.any((r) => r.event.event == 'queued_during_flush'),
    );
    // The event reached the LOCAL queue while the network response was
    // still pending — the guard chain was not blocked behind the upload.
    expect(gate.isCompleted, isFalse);

    gate.complete();
    // Letting the flush finish surfaces no errors and delivers the event
    // queued mid-flight on the drain loop's next batch.
    await waitFor(
      () => sentEvents().any((e) => e['event'] == 'queued_during_flush'),
    );
  });

  // --- Review fix 3a: init() is idempotent --------------------------------

  test('a second init() call keeps the existing instance and starts no '
      'second session', () async {
    await initSdk();
    final first = MyAmpMix.instance;

    // A realistic double-init with a full fresh dependency set: were init
    // not idempotent, this would genuinely construct and start a second
    // uploader/session stack — caught by the event counts below.
    final secondDb = AnalyticsDatabase(NativeDatabase.memory());
    await MyAmpMix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        clock: clock,
        httpClient: acceptAll(),
        database: secondDb,
        keyValueStore: keyValueStore,
        contextDataSource: FakeContextDataSource(),
        random: FixedRandom(0.5),
      ),
    );
    expect(identical(MyAmpMix.instance, first), isTrue);

    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == r'$app_open'));
    // A non-idempotent init would have run SessionManager.start() again and
    // emitted a second $app_open (and $session_start) from a second
    // pipeline/uploader stack.
    final names = sentEvents().map((e) => e['event']);
    expect(names.where((n) => n == r'$app_open').length, 1);
    expect(names.where((n) => n == r'$session_start').length, 1);
    expect(names.where((n) => n == r'$first_open').length, 1);

    await secondDb.close();
  });
}
