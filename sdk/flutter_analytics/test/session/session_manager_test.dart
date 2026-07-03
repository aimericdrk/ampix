import 'dart:ui' show AppLifecycleState;

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/session/session_manager.dart';

import '../helpers/fake_clock.dart';
import '../helpers/in_memory_key_value_store.dart';

class Emitted {
  Emitted(this.event, this.properties, this.sessionId);

  final String event;
  final Map<String, Object?> properties;
  final String sessionId;
}

void main() {
  late FakeClock clock;
  late InMemoryKeyValueStore store;
  late List<Emitted> emitted;
  var idCounter = 0;

  setUp(() {
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    store = InMemoryKeyValueStore();
    emitted = [];
    idCounter = 0;
  });

  SessionManager build() {
    late SessionManager manager;
    manager = SessionManager(
      clock: clock,
      store: store,
      timeout: const Duration(minutes: 30),
      idFactory: () => 'session-${++idCounter}',
      emit: (event, properties) async =>
          emitted.add(Emitted(event, properties, manager.sessionId)),
    );
    return manager;
  }

  test(r'first launch emits $session_start, $first_open, $app_open', () async {
    final session = build();
    await session.start();

    expect(emitted.map((e) => e.event).toList(), [
      r'$session_start',
      r'$first_open',
      r'$app_open',
    ]);
    expect(session.sessionId, 'session-1');
  });

  test('short background keeps the session', () async {
    final session = build();
    await session.start();
    emitted.clear();

    await session.handleLifecycleState(AppLifecycleState.paused);
    clock.advance(const Duration(minutes: 10));
    await session.handleLifecycleState(AppLifecycleState.resumed);

    expect(emitted.map((e) => e.event).toList(), [
      r'$app_background',
      r'$app_open',
    ]);
    expect(session.sessionId, 'session-1');
  });

  test(
    r'30 min background rotates: $session_end has $duration_ms and old id',
    () async {
      final session = build();
      await session.start();
      clock.advance(const Duration(minutes: 5)); // 5 min of foreground use
      await session.handleLifecycleState(AppLifecycleState.paused);
      emitted.clear();

      clock.advance(const Duration(minutes: 31));
      await session.handleLifecycleState(AppLifecycleState.resumed);

      expect(emitted.map((e) => e.event).toList(), [
        r'$session_end',
        r'$session_start',
        r'$app_open',
      ]);
      final end = emitted.first;
      expect(end.properties[r'$duration_ms'], 5 * 60 * 1000);
      expect(end.sessionId, 'session-1'); // emitted under the OLD session id
      expect(session.sessionId, 'session-2');
    },
  );

  test('duplicate background states are ignored', () async {
    final session = build();
    await session.start();
    emitted.clear();

    await session.handleLifecycleState(AppLifecycleState.inactive);
    await session.handleLifecycleState(AppLifecycleState.hidden);
    await session.handleLifecycleState(AppLifecycleState.paused);

    expect(emitted.map((e) => e.event).toList(), [r'$app_background']);
  });

  test('relaunch after kill finalizes the stale session', () async {
    final first = build();
    await first.start();
    clock.advance(const Duration(minutes: 3));
    await first.handleLifecycleState(AppLifecycleState.paused);
    emitted.clear();

    clock.advance(const Duration(hours: 2)); // app was killed meanwhile
    final second = build(); // fresh instance, same persisted store
    await second.start();

    expect(emitted.map((e) => e.event).toList(), [
      r'$session_end',
      r'$session_start',
      r'$app_open',
    ]); // no $first_open
    expect(emitted.first.properties[r'$duration_ms'], 3 * 60 * 1000);
    expect(second.sessionId, 'session-2');
  });

  test('relaunch shortly after background resumes the same session', () async {
    final first = build();
    await first.start();
    await first.handleLifecycleState(AppLifecycleState.paused);
    emitted.clear();

    clock.advance(const Duration(minutes: 5));
    final second = build();
    await second.start();

    expect(emitted.map((e) => e.event).toList(), [r'$app_open']);
    expect(second.sessionId, 'session-1');
  });
}
