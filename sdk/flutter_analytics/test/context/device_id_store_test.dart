import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/context/device_id_store.dart';
import 'package:myampix_analytics/src/storage/key_value_store.dart';

import '../helpers/in_memory_key_value_store.dart';

/// Every write fails — proves a broken store degrades to "no device id"
/// instead of throwing into the host app.
class _FailingKeyValueStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => null;

  @override
  Future<void> setString(String key, String value) async =>
      throw StateError('setString failed');

  @override
  Future<void> remove(String key) async => throw StateError('remove failed');
}

void main() {
  test('adopts and persists the OS-supplied id', () async {
    final store = InMemoryKeyValueStore();
    final deviceId = DeviceIdStore(store: store, idFactory: () => 'minted');

    expect(await deviceId.resolve('IDFV-1111'), 'IDFV-1111');
    expect(store.values[DeviceIdStore.storageKey], 'IDFV-1111');
    expect(deviceId.value, 'IDFV-1111');
  });

  test('mints a UUID when the platform supplies none (Android)', () async {
    final store = InMemoryKeyValueStore();
    final deviceId = DeviceIdStore(store: store, idFactory: () => 'minted');

    expect(await deviceId.resolve(null), 'minted');
    expect(store.values[DeviceIdStore.storageKey], 'minted');
  });

  test('a blank platform id counts as none', () async {
    final deviceId = DeviceIdStore(
      store: InMemoryKeyValueStore(),
      idFactory: () => 'minted',
    );

    expect(await deviceId.resolve('   '), 'minted');
  });

  test('the first resolved id is frozen, even if the OS rotates its own', () async {
    final store = InMemoryKeyValueStore();
    var minted = 0;

    await DeviceIdStore(
      store: store,
      idFactory: () => 'minted-${++minted}',
    ).resolve('IDFV-1111');

    // A later launch: iOS handed out a NEW identifierForVendor (every app from
    // this vendor was uninstalled in between). The persisted id still wins, so
    // the device does not read as two devices.
    final next = DeviceIdStore(store: store, idFactory: () => 'minted-${++minted}');
    expect(await next.resolve('IDFV-2222'), 'IDFV-1111');
    expect(minted, 0); // nothing was minted either
  });

  test('resolves once, then answers from memory', () async {
    final store = InMemoryKeyValueStore();
    final deviceId = DeviceIdStore(store: store, idFactory: () => 'minted');

    await deviceId.resolve(null);
    store.values.clear(); // prove the second call never reads the store again

    expect(await deviceId.resolve(null), 'minted');
    expect(store.values, isEmpty);
  });

  test('a failing store degrades to no device id, never throws', () async {
    final deviceId = DeviceIdStore(
      store: _FailingKeyValueStore(),
      idFactory: () => 'minted',
    );

    expect(await deviceId.resolve('IDFV-1111'), isNull);
    expect(deviceId.value, isNull);
  });
}
