import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/properties/super_properties_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('register merges and persists across relaunch', () async {
    final kv = InMemoryKeyValueStore();
    final store = SuperPropertiesStore(kv);
    await store.load();

    await store.register({'plan': 'free', 'ab_group': 'a'});
    await store.register({'plan': 'pro'}); // later value wins
    expect(store.current, {'plan': 'pro', 'ab_group': 'a'});

    final relaunched = SuperPropertiesStore(kv);
    await relaunched.load();
    expect(relaunched.current, {'plan': 'pro', 'ab_group': 'a'});
  });

  test('clear empties memory and persistence', () async {
    final kv = InMemoryKeyValueStore();
    final store = SuperPropertiesStore(kv);
    await store.load();
    await store.register({'plan': 'pro'});

    await store.clear();
    expect(store.current, isEmpty);
    expect(kv.values[SuperPropertiesStore.storageKey], isNull);
  });

  test('current is an unmodifiable snapshot', () async {
    final store = SuperPropertiesStore(InMemoryKeyValueStore());
    await store.load();
    await store.register({'plan': 'pro'});
    expect(() => store.current['plan'] = 'hacked', throwsUnsupportedError);
  });
}
