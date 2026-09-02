import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/identity/identity_manager.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('generates and persists a UUID v7 anon id on first launch', () async {
    final store = InMemoryKeyValueStore();
    final identity = IdentityManager(store: store);
    await identity.load();

    expect(identity.anonId, isNotEmpty);
    expect(identity.anonId[14], '7'); // UUID version nibble
    expect(identity.distinctId, identity.anonId);
    expect(store.values[IdentityManager.anonIdKey], identity.anonId);
  });

  test('reuses the persisted anon id on later launches', () async {
    final store = InMemoryKeyValueStore();
    final first = IdentityManager(store: store, idFactory: () => 'anon-1');
    await first.load();

    final second = IdentityManager(store: store, idFactory: () => 'anon-2');
    await second.load();
    expect(second.anonId, 'anon-1');
  });

  test(
    'identify switches distinct id, keeps anon id, persists across relaunch',
    () async {
      final store = InMemoryKeyValueStore();
      final identity = IdentityManager(store: store, idFactory: () => 'anon-1');
      await identity.load();

      expect(await identity.identify('u_42'), isTrue);
      expect(await identity.identify('u_42'), isFalse); // repeat is a no-op
      expect(identity.distinctId, 'u_42');
      expect(identity.anonId, 'anon-1');

      final relaunched = IdentityManager(
        store: store,
        idFactory: () => 'anon-2',
      );
      await relaunched.load();
      expect(relaunched.distinctId, 'u_42');
      expect(relaunched.anonId, 'anon-1');
    },
  );

  test('reset generates a fresh anonymous identity', () async {
    final store = InMemoryKeyValueStore();
    var calls = 0;
    final identity = IdentityManager(
      store: store,
      idFactory: () => 'anon-${++calls}',
    );
    await identity.load();
    await identity.identify('u_42');

    expect(await identity.reset(), isTrue);
    expect(identity.anonId, 'anon-2');
    expect(identity.distinctId, 'anon-2');
    expect(store.values[IdentityManager.distinctIdKey], isNull);
  });

  test(
    'reset on an already-anonymous install keeps the anonymous id instead of '
    r'stranding its events under one no $identify will ever name',
    () async {
      final store = InMemoryKeyValueStore();
      var calls = 0;
      final identity = IdentityManager(
        store: store,
        idFactory: () => 'anon-${++calls}',
      );
      await identity.load();
      expect(identity.distinctId, 'anon-1');

      // A host that resets without ever identifying: a logout on a launch
      // where nobody signed in, or the second reset of a delete-account flow
      // that already reset once.
      expect(await identity.reset(), isFalse);
      expect(await identity.reset(), isFalse);

      expect(identity.anonId, 'anon-1');
      expect(identity.distinctId, 'anon-1');
      expect(calls, 1); // no id minted beyond the first-launch one

      // ...so the events those resets straddle all stitch to the user who
      // eventually signs in, instead of splitting into three "Unknown user"s.
      expect(await identity.identify('u_42'), isTrue);
      expect(identity.anonId, 'anon-1');
    },
  );

  test(
    'reset after identify still issues a fresh anonymous id, and resetting '
    'again from there does not fragment it further',
    () async {
      final store = InMemoryKeyValueStore();
      var calls = 0;
      final identity = IdentityManager(
        store: store,
        idFactory: () => 'anon-${++calls}',
      );
      await identity.load();
      await identity.identify('u_42');

      expect(await identity.reset(), isTrue);
      expect(identity.anonId, 'anon-2'); // a real logout: u_42 is walked away from

      expect(await identity.reset(), isFalse);
      expect(identity.anonId, 'anon-2'); // ...but a second logout adds nothing
    },
  );

  test('identify before load() throws StateError', () async {
    final identity = IdentityManager(store: InMemoryKeyValueStore());
    await expectLater(identity.identify('u_42'), throwsStateError);
  });
}
