import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/context/host_context_value_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('load() restores a value declared in an earlier launch', () async {
    final store = InMemoryKeyValueStore()
      ..values[HostContextValueStore.deviceTokenKey] = 'fcm-old';
    final tokens = HostContextValueStore(
      store: store,
      storageKey: HostContextValueStore.deviceTokenKey,
    );

    await tokens.load();

    expect(tokens.value, 'fcm-old');
  });

  test('set() overwrites, so a refreshed value replaces the stale one', () async {
    final store = InMemoryKeyValueStore();
    final tokens = HostContextValueStore(
      store: store,
      storageKey: HostContextValueStore.deviceTokenKey,
    );

    await tokens.set('fcm-1');
    await tokens.set('fcm-2');

    expect(tokens.value, 'fcm-2');
    expect(store.values[HostContextValueStore.deviceTokenKey], 'fcm-2');
  });

  test('clear() drops it from memory and from disk', () async {
    final store = InMemoryKeyValueStore();
    final tokens = HostContextValueStore(
      store: store,
      storageKey: HostContextValueStore.deviceTokenKey,
    );
    await tokens.set('fcm-1');

    await tokens.clear();

    expect(tokens.value, isNull);
    expect(store.values, isEmpty);
  });

  test('two instances keep their own key, so token and unique id never collide', () async {
    final store = InMemoryKeyValueStore();
    final tokens = HostContextValueStore(
      store: store,
      storageKey: HostContextValueStore.deviceTokenKey,
    );
    final uniqueId = HostContextValueStore(
      store: store,
      storageKey: HostContextValueStore.uniqueIdKey,
    );

    await tokens.set('fcm-1');
    await uniqueId.set('phone-mark-1');
    await tokens.clear();

    expect(tokens.value, isNull);
    expect(uniqueId.value, 'phone-mark-1');
    expect(store.values, {HostContextValueStore.uniqueIdKey: 'phone-mark-1'});
  });
}
