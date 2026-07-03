import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/identity/identity_manager.dart';

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

  test('identify switches distinct id, keeps anon id, persists across relaunch', () async {
    final store = InMemoryKeyValueStore();
    final identity = IdentityManager(store: store, idFactory: () => 'anon-1');
    await identity.load();

    expect(await identity.identify('u_42'), isTrue);
    expect(await identity.identify('u_42'), isFalse); // repeat is a no-op
    expect(identity.distinctId, 'u_42');
    expect(identity.anonId, 'anon-1');

    final relaunched = IdentityManager(store: store, idFactory: () => 'anon-2');
    await relaunched.load();
    expect(relaunched.distinctId, 'u_42');
    expect(relaunched.anonId, 'anon-1');
  });

  test('reset generates a fresh anonymous identity', () async {
    final store = InMemoryKeyValueStore();
    var calls = 0;
    final identity =
        IdentityManager(store: store, idFactory: () => 'anon-${++calls}');
    await identity.load();
    await identity.identify('u_42');

    await identity.reset();
    expect(identity.anonId, 'anon-2');
    expect(identity.distinctId, 'anon-2');
    expect(store.values[IdentityManager.distinctIdKey], isNull);
  });
}
