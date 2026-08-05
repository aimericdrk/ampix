import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/identity/rc_link_store.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('persists, survives reload, and clears', () async {
    final kv = InMemoryKeyValueStore();
    final store = RcLinkStore(store: kv);
    await store.load();
    expect(store.value, isNull);

    await store.set('rc-user-1');
    expect(store.value, 'rc-user-1');
    expect(kv.values[RcLinkStore.storageKey], 'rc-user-1');

    final relaunched = RcLinkStore(store: kv);
    await relaunched.load();
    expect(relaunched.value, 'rc-user-1');

    await relaunched.clear();
    expect(relaunched.value, isNull);
    expect(kv.values.containsKey(RcLinkStore.storageKey), isFalse);
  });
}
