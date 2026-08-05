import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/store/app_account_token_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  late InMemoryKeyValueStore store;

  setUp(() => store = InMemoryKeyValueStore());

  test('an app-user-id that is already a valid UUID is used as-is', () async {
    final tokens =
        AppAccountTokenStore(store: store, uuidFactory: () => 'unused');
    const uuid = '123e4567-e89b-12d3-a456-426614174000';

    final token = await tokens.tokenFor(uuid);

    expect(token, uuid);
    expect(store.writeCount, 0); // never persisted — nothing to mint
  });

  test('a non-UUID app-user-id mints + persists a UUID via uuidFactory',
      () async {
    var calls = 0;
    final tokens = AppAccountTokenStore(
      store: store,
      uuidFactory: () {
        calls++;
        return 'minted-uuid-1';
      },
    );

    final token = await tokens.tokenFor(r'$RCAnonymousID:abc123');

    expect(token, 'minted-uuid-1');
    expect(calls, 1);
    expect(store.writeCount, 1);
  });

  test('the same app-user-id always yields the same token (stable across '
      'purchases)', () async {
    var calls = 0;
    final tokens = AppAccountTokenStore(
      store: store,
      uuidFactory: () {
        calls++;
        return 'minted-uuid-$calls';
      },
    );

    final first = await tokens.tokenFor('user-1');
    final second = await tokens.tokenFor('user-1');

    expect(first, second);
    expect(calls, 1); // minted once, reused thereafter
  });

  test('the token survives across a fresh AppAccountTokenStore instance '
      '(persisted, not just in-memory-cached)', () async {
    final tokens1 = AppAccountTokenStore(
      store: store,
      uuidFactory: () => 'minted-uuid-1',
    );
    final first = await tokens1.tokenFor('user-1');

    final tokens2 = AppAccountTokenStore(
      store: store,
      uuidFactory: () => 'minted-uuid-2',
    );
    final second = await tokens2.tokenFor('user-1');

    expect(first, 'minted-uuid-1');
    expect(second, 'minted-uuid-1'); // reused from the persisted store
  });

  test('different app-user-ids get different tokens', () async {
    var calls = 0;
    final tokens = AppAccountTokenStore(
      store: store,
      uuidFactory: () {
        calls++;
        return 'minted-uuid-$calls';
      },
    );

    final a = await tokens.tokenFor('user-a');
    final b = await tokens.tokenFor('user-b');

    expect(a, isNot(b));
  });

  test('defaults to a real Uuid v4 factory when none is injected', () async {
    final tokens = AppAccountTokenStore(store: store);
    final token = await tokens.tokenFor('user-1');
    expect(
      RegExp(
              r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
          .hasMatch(token),
      isTrue,
    );
  });
}
