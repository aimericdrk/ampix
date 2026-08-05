import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('mints and persists a \$RCAnonymousID: id on first use', () async {
    final store = InMemoryKeyValueStore();
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );

    final id = await ids.currentId();
    expect(id, r'$RCAnonymousID:aaaaaaaabbbb4ccc8dddeeeeeeeeeeee');
    expect(store.values[AppUserIdStore.storageKey], id);
    expect(ids.isAnonymous, isTrue);
  });

  test('reuses the persisted id across instances (no re-mint)', () async {
    final store = InMemoryKeyValueStore();
    final first = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaa-bbbb-4ccc-8ddd-ee',
    );
    final minted = await first.currentId();

    final second = AppUserIdStore(
      store: store,
      uuidFactory: () => 'ffff-9999-4ccc-8ddd-ee',
    );
    expect(await second.currentId(), minted);
  });

  test(
      'concurrent currentId() calls on the same instance mint+persist '
      'exactly once (no split identity)', () async {
    final store = InMemoryKeyValueStore();
    var mintCount = 0;
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'id${++mintCount}-bbbb-4ccc-8ddd-ee',
    );

    final results = await Future.wait([ids.currentId(), ids.currentId()]);

    expect(results[0], results[1]);
    expect(mintCount, 1);
    expect(store.writeCount, 1);
    expect(store.values[AppUserIdStore.storageKey], results[0]);
  });
}
