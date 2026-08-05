import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('setId (logIn) persists a custom id and clears anonymity', () async {
    final store = InMemoryKeyValueStore();
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaa-bbbb-4ccc-8ddd-ee',
    );
    await ids.currentId();

    await ids.setId('user_42');
    expect(await ids.currentId(), 'user_42');
    expect(store.values[AppUserIdStore.storageKey], 'user_42');
    expect(ids.isAnonymous, isFalse);
  });

  test('reset (logOut) mints a fresh anonymous id, distinct from the prior id',
      () async {
    final store = InMemoryKeyValueStore();
    var n = 0;
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'id${++n}-bbbb-4ccc-8ddd-ee',
    );
    await ids.setId('user_42');

    final anon = await ids.reset();
    expect(anon, r'$RCAnonymousID:id1bbbb4ccc8dddee');
    expect(anon, isNot('user_42'));
    expect(await ids.currentId(), anon);
    expect(store.values[AppUserIdStore.storageKey], anon);
    expect(ids.isAnonymous, isTrue);
  });
}
