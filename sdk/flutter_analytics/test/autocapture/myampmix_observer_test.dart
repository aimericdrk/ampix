import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/model/event.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_key_value_store.dart';

class _Emitted {
  _Emitted(this.event, this.properties);
  final String event;
  final Map<String, Object?> properties;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  setUp(MyAmpMixObserver.resetForTesting);
  tearDown(MyAmpMixObserver.resetForTesting);

  group('MyAmpMixObserver (direct, injected track/clock)', () {
    late FakeClock clock;
    late List<_Emitted> emitted;
    late GlobalKey<NavigatorState> navKey;
    late MyAmpMixObserver observer;

    setUp(() {
      clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
      emitted = [];
      navKey = GlobalKey<NavigatorState>();
      observer = MyAmpMixObserver(
        clock: clock,
        track: (event, properties) => emitted.add(_Emitted(event, properties)),
      );
    });

    Future<void> pumpApp(WidgetTester tester) => tester.pumpWidget(
      MaterialApp(
        navigatorKey: navKey,
        navigatorObservers: [observer],
        initialRoute: '/',
        routes: {
          '/': (_) => const Scaffold(body: Text('A')),
          '/b': (_) => const Scaffold(body: Text('B')),
        },
      ),
    );

    testWidgets(r'emits $screen_view for the initial route with no '
        r'$previous_screen', (tester) async {
      await pumpApp(tester);

      expect(emitted, hasLength(1));
      expect(emitted.single.event, r'$screen_view');
      expect(emitted.single.properties[r'$screen_name'], '/');
      expect(
        emitted.single.properties.containsKey(r'$previous_screen'),
        isFalse,
      );
      expect(
        emitted.single.properties.containsKey(r'$time_on_previous_ms'),
        isFalse,
      );
    });

    testWidgets(r'didPush of a named route carries $previous_screen and '
        r'$time_on_previous_ms', (tester) async {
      await pumpApp(tester);
      clock.advance(const Duration(seconds: 5));

      unawaited(navKey.currentState!.pushNamed('/b'));
      await tester.pumpAndSettle();

      expect(emitted, hasLength(2));
      final second = emitted[1];
      expect(second.event, r'$screen_view');
      expect(second.properties[r'$screen_name'], '/b');
      expect(second.properties[r'$previous_screen'], '/');
      expect(second.properties[r'$time_on_previous_ms'], 5000);
    });

    testWidgets(r'didPop emits $screen_view for the now-visible route', (
      tester,
    ) async {
      await pumpApp(tester);
      clock.advance(const Duration(seconds: 5));
      unawaited(navKey.currentState!.pushNamed('/b'));
      await tester.pumpAndSettle();

      clock.advance(const Duration(seconds: 2));
      navKey.currentState!.pop();
      await tester.pumpAndSettle();

      expect(emitted, hasLength(3));
      final third = emitted[2];
      expect(third.properties[r'$screen_name'], '/');
      expect(third.properties[r'$previous_screen'], '/b');
      expect(third.properties[r'$time_on_previous_ms'], 2000);
    });

    testWidgets(r'didReplace emits $screen_view for the new route', (
      tester,
    ) async {
      await pumpApp(tester);
      clock.advance(const Duration(seconds: 1));

      unawaited(navKey.currentState!.pushReplacementNamed('/b'));
      await tester.pumpAndSettle();

      expect(emitted, hasLength(2));
      expect(emitted[1].properties[r'$screen_name'], '/b');
      expect(emitted[1].properties[r'$previous_screen'], '/');
    });

    testWidgets('an unnamed route falls back to the route runtimeType', (
      tester,
    ) async {
      await pumpApp(tester);
      final route = MaterialPageRoute<void>(
        builder: (_) => const Scaffold(body: Text('C')),
      );
      unawaited(navKey.currentState!.push(route));
      await tester.pumpAndSettle();

      expect(
        emitted.last.properties[r'$screen_name'],
        route.runtimeType.toString(),
      );
    });

    testWidgets(r'dialogs (non-PageRoute) do not emit $screen_view', (
      tester,
    ) async {
      await pumpApp(tester);
      final beforeCount = emitted.length;

      unawaited(
        showDialog<void>(
          context: navKey.currentContext!,
          builder: (_) => const AlertDialog(title: Text('hi')),
        ),
      );
      await tester.pumpAndSettle();
      expect(emitted, hasLength(beforeCount));

      navKey.currentState!.pop();
      await tester.pumpAndSettle();
      expect(emitted, hasLength(beforeCount));
    });

    testWidgets(
      'currentScreenName is shared static state read by the tap capturer',
      (tester) async {
        await pumpApp(tester);
        expect(MyAmpMixObserver.currentScreenName, '/');

        unawaited(navKey.currentState!.pushNamed('/b'));
        await tester.pumpAndSettle();
        expect(MyAmpMixObserver.currentScreenName, '/b');
      },
    );

    testWidgets('a throwing track callback never escapes the observer', (
      tester,
    ) async {
      final throwingObserver = MyAmpMixObserver(
        clock: clock,
        track: (event, properties) => throw StateError('boom'),
      );
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [throwingObserver],
          home: const Scaffold(body: Text('A')),
        ),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('MyAmpMixObserver wired through the real facade', () {
    late FakeClock clock;
    late InMemoryKeyValueStore keyValueStore;
    late AnalyticsDatabase database;
    late DriftEventStore store;

    setUp(() {
      clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
      keyValueStore = InMemoryKeyValueStore();
      database = AnalyticsDatabase(NativeDatabase.memory());
      store = DriftEventStore(database);
    });

    tearDown(() => MyAmpMix.shutdownForTesting());

    Future<void> initSdk({required bool autocaptureScreens}) => MyAmpMix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: MyAmpMixConfig(
        serverUrl: 'http://localhost:8080',
        autocaptureScreens: autocaptureScreens,
        // This suite exercises SCREEN autocapture only. Disable native purchase
        // AND attribution autocapture so init() never subscribes to the real
        // `myampmix_analytics/purchases` or `.../attribution` EventChannels —
        // those subscriptions hang under testWidgets' fake-async. Each has its
        // own dedicated suite (purchase_autocapture_test.dart /
        // attribution/*_test.dart) that injects a stream instead.
        autocapturePurchases: false,
        autocaptureAttribution: false,
      ),
      overrides: SdkOverrides(
        clock: clock,
        database: database,
        keyValueStore: keyValueStore,
        contextDataSource: FakeContextDataSource(),
        random: FixedRandom(0.5),
      ),
    );

    // Asserts against the injected local queue directly instead of waiting
    // on a real network flush: a `waitFor` helper looping on
    // `Future.delayed` never completes under `testWidgets` because its fake
    // clock only advances when a test explicitly pumps it. The write path
    // (identity/session/context/sanitization → store.add) only involves
    // microtasks and in-memory sqlite, so a single `tester.pump()` after the
    // triggering action is enough to drain the facade's `_guard` chain.
    Future<List<AnalyticsEvent>> queuedEvents() async => [
      for (final row in await store.oldest(1000)) row.event,
    ];

    testWidgets(
      r'autocaptureScreens: true delivers a full-context $screen_view '
      'to the local queue via MyAmpMix.instance.track',
      (tester) async {
        await initSdk(autocaptureScreens: true);
        await tester.pumpWidget(
          MaterialApp(
            navigatorObservers: [MyAmpMixObserver(clock: clock)],
            initialRoute: '/',
            routes: {
              '/': (_) => const Scaffold(body: Text('A')),
              '/b': (_) => const Scaffold(body: Text('B')),
            },
          ),
        );
        await tester.pump(); // flush the facade's microtask _guard chain

        final events = await queuedEvents();
        final screenView = events.firstWhere((e) => e.event == r'$screen_view');
        expect(screenView.properties[r'$screen_name'], '/');
        expect(screenView.distinctId, isNotEmpty);
        expect(screenView.sessionId, isNotEmpty);
        expect(screenView.context.sdkVersion, '0.1.0');

        // Cancels the uploader's periodic flush timer before the widget
        // tree is torn down: testWidgets asserts no timers are left
        // pending as soon as the callback returns, which runs BEFORE the
        // group's tearDown (a plain `tearDown()` callback fires later, via
        // package:test's own lifecycle).
        await MyAmpMix.shutdownForTesting();
      },
    );

    testWidgets(r'autocaptureScreens: false suppresses $screen_view entirely', (
      tester,
    ) async {
      await initSdk(autocaptureScreens: false);
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [MyAmpMixObserver(clock: clock)],
          initialRoute: '/',
          routes: {
            '/': (_) => const Scaffold(body: Text('A')),
            '/b': (_) => const Scaffold(body: Text('B')),
          },
        ),
      );
      await tester.pump();

      final events = await queuedEvents();
      // The pipeline is alive (session-lifecycle events reached the queue),
      // yet no $screen_view made it through.
      expect(events.any((e) => e.event == r'$app_open'), isTrue);
      expect(events.where((e) => e.event == r'$screen_view'), isEmpty);

      await MyAmpMix.shutdownForTesting();
    });

    testWidgets(r'opted-out $screen_view is dropped by the pipeline', (
      tester,
    ) async {
      await initSdk(autocaptureScreens: true);
      MyAmpMix.instance.optOutTracking();
      await tester.pumpWidget(
        MaterialApp(
          navigatorObservers: [MyAmpMixObserver(clock: clock)],
          initialRoute: '/',
          routes: {'/': (_) => const Scaffold(body: Text('A'))},
        ),
      );
      await tester.pump();

      MyAmpMix.instance.optInTracking();
      MyAmpMix.instance.track('after_opt_in');
      await tester.pump();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'after_opt_in'), isTrue);
      expect(events.where((e) => e.event == r'$screen_view'), isEmpty);

      await MyAmpMix.shutdownForTesting();
    });
  });
}
