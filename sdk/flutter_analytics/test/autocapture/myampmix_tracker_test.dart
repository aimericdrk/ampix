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

  group('MyAmpMixTracker (direct, injected track/clock)', () {
    late FakeClock clock;
    late List<_Emitted> emitted;

    setUp(() {
      clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
      emitted = [];
    });

    void fakeTrack(String event, Map<String, Object?> properties) =>
        emitted.add(_Emitted(event, properties));

    testWidgets(
      r'a tap emits $tap with widget type/label/position and does NOT '
      "block the tapped widget's own onTap",
      (tester) async {
        var tapped = false;
        await tester.pumpWidget(
          MyAmpMixTracker(
            clock: clock,
            track: fakeTrack,
            child: MaterialApp(
              home: Scaffold(
                body: Center(
                  child: GestureDetector(
                    key: const Key('my-button'),
                    // A bare, colorless SizedBox never self-hit-tests, and
                    // GestureDetector defaults to HitTestBehavior.deferToChild
                    // whenever it has a child — so without this, tester.tap()
                    // could never reach this detector at all.
                    behavior: HitTestBehavior.opaque,
                    onTap: () => tapped = true,
                    child: const SizedBox(width: 50, height: 50),
                  ),
                ),
              ),
            ),
          ),
        );

        final center = tester.getCenter(find.byKey(const Key('my-button')));
        await tester.tap(find.byKey(const Key('my-button')));
        await tester.pump();

        expect(tapped, isTrue, reason: "host app's own onTap still fires");
        expect(emitted, hasLength(1));
        final tap = emitted.single;
        expect(tap.event, r'$tap');
        expect(tap.properties[r'$widget_type'], 'GestureDetector');
        expect(tap.properties[r'$widget_label'], 'my-button');
        expect(tap.properties[r'$pos_x'], center.dx);
        expect(tap.properties[r'$pos_y'], center.dy);
      },
    );

    testWidgets('a drag past tap slop is not captured as a tap', (
      tester,
    ) async {
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: Container(
                  key: const Key('drag-area'),
                  width: 200,
                  height: 200,
                  color: Colors.blue,
                ),
              ),
            ),
          ),
        ),
      );

      final start =
          tester.getTopLeft(find.byKey(const Key('drag-area'))) +
          const Offset(10, 10);
      final gesture = await tester.startGesture(start);
      await gesture.moveBy(const Offset(60, 0)); // > 18px tap slop
      await gesture.up();
      await tester.pump();

      expect(emitted, isEmpty);
    });

    testWidgets('a long press past the tap duration is not captured', (
      tester,
    ) async {
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: Container(
                  key: const Key('press-area'),
                  width: 50,
                  height: 50,
                  color: Colors.blue,
                ),
              ),
            ),
          ),
        ),
      );

      final position = tester.getCenter(find.byKey(const Key('press-area')));
      final gesture = await tester.startGesture(position);
      clock.advance(const Duration(milliseconds: 600)); // > 500ms tap max
      await gesture.up();
      await tester.pump();

      expect(emitted, isEmpty);
    });

    testWidgets(
      r'$screen_name is stamped from MyAmpMixObserver.currentScreenName '
      'when available',
      (tester) async {
        MyAmpMixObserver.currentScreenName = '/checkout';
        await tester.pumpWidget(
          MyAmpMixTracker(
            clock: clock,
            track: fakeTrack,
            child: MaterialApp(
              home: Scaffold(
                body: Center(
                  child: GestureDetector(
                    key: const Key('btn'),
                    // See the "my-button" test above: without this, a
                    // childless SizedBox never self-hit-tests.
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: const SizedBox(width: 40, height: 40),
                  ),
                ),
              ),
            ),
          ),
        );

        await tester.tap(find.byKey(const Key('btn')));
        await tester.pump();

        expect(emitted.single.properties[r'$screen_name'], '/checkout');
      },
    );

    testWidgets(
      r'three rapid same-spot taps fire one $rage_tap without suppressing '
      r'the individual $tap events',
      (tester) async {
        await tester.pumpWidget(
          MyAmpMixTracker(
            clock: clock,
            track: fakeTrack,
            child: MaterialApp(
              home: Scaffold(
                body: Center(
                  child: GestureDetector(
                    key: const Key('rage-btn'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: const SizedBox(width: 40, height: 40),
                  ),
                ),
              ),
            ),
          ),
        );

        for (var i = 0; i < 3; i++) {
          await tester.tap(find.byKey(const Key('rage-btn')));
          await tester.pump();
        }

        final taps = emitted.where((e) => e.event == r'$tap').toList();
        final rageTaps = emitted.where((e) => e.event == r'$rage_tap').toList();
        expect(taps, hasLength(3));
        expect(rageTaps, hasLength(1));
        expect(rageTaps.single.properties[r'$tap_count'], 3);
      },
    );

    testWidgets(r'taps spread out in time do NOT fire a $rage_tap', (
      tester,
    ) async {
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: GestureDetector(
                  key: const Key('slow-btn'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(width: 40, height: 40),
                ),
              ),
            ),
          ),
        ),
      );

      for (var i = 0; i < 3; i++) {
        await tester.tap(find.byKey(const Key('slow-btn')));
        await tester.pump();
        clock.advance(const Duration(seconds: 2)); // > 1s rage window
      }

      expect(emitted.where((e) => e.event == r'$tap'), hasLength(3));
      expect(emitted.where((e) => e.event == r'$rage_tap'), isEmpty);
    });

    testWidgets(r'taps spread out in space do NOT fire a $rage_tap', (
      tester,
    ) async {
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(
                    key: const Key('left-btn'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: const SizedBox(width: 40, height: 40),
                  ),
                  GestureDetector(
                    key: const Key('right-btn'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: const SizedBox(width: 40, height: 40),
                  ),
                ],
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('left-btn')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('right-btn')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('left-btn')));
      await tester.pump();

      expect(emitted.where((e) => e.event == r'$tap'), hasLength(3));
      expect(emitted.where((e) => e.event == r'$rage_tap'), isEmpty);
    });

    testWidgets('a throwing track callback never escapes the tracker', (
      tester,
    ) async {
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          track: (event, properties) => throw StateError('boom'),
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: GestureDetector(
                  key: const Key('btn'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(width: 40, height: 40),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('btn')));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });

  group('MyAmpMixTracker wired through the real facade', () {
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

    Future<void> initSdk({required bool autocaptureTaps}) => MyAmpMix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: MyAmpMixConfig(
        serverUrl: 'http://localhost:8080',
        autocaptureTaps: autocaptureTaps,
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
    // only involves microtasks and in-memory sqlite, so a single
    // `tester.pump()` after the triggering action is enough to drain the
    // facade's `_guard` chain.
    Future<List<AnalyticsEvent>> queuedEvents() async => [
      for (final row in await store.oldest(1000)) row.event,
    ];

    testWidgets(r'autocaptureTaps: true delivers a full-context $tap to the '
        'local queue via MyAmpMix.instance.track', (tester) async {
      await initSdk(autocaptureTaps: true);
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: GestureDetector(
                  key: const Key('btn'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(width: 40, height: 40),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('btn')));
      await tester.pump();

      final events = await queuedEvents();
      final tap = events.firstWhere((e) => e.event == r'$tap');
      expect(tap.distinctId, isNotEmpty);
      expect(tap.context.sdkVersion, '0.1.0');
      expect(tap.properties[r'$widget_type'], 'GestureDetector');

      // Cancels the uploader's periodic flush timer before the widget tree
      // is torn down: testWidgets asserts no timers are left pending as
      // soon as the callback returns, which runs BEFORE the group's
      // tearDown (a plain `tearDown()` callback fires later, via
      // package:test's own lifecycle).
      await MyAmpMix.shutdownForTesting();
    });

    testWidgets(r'autocaptureTaps: false suppresses $tap entirely', (
      tester,
    ) async {
      await initSdk(autocaptureTaps: false);
      await tester.pumpWidget(
        MyAmpMixTracker(
          clock: clock,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: GestureDetector(
                  key: const Key('btn'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(width: 40, height: 40),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('btn')));
      await tester.pump();
      MyAmpMix.instance.track('marker');
      await tester.pump();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'marker'), isTrue);
      expect(events.where((e) => e.event == r'$tap'), isEmpty);

      await MyAmpMix.shutdownForTesting();
    });
  });
}
