import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/context/context_collector.dart';
import 'package:myampix_analytics/src/context/device_id_store.dart';
import 'package:myampix_analytics/src/version.dart';

import '../helpers/fake_context_data_source.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('collect() fills every M1 context field per contract §4', () async {
    final collector = ContextCollector(FakeContextDataSource());
    final context = await collector.collect();

    expect(context.toJson(), {
      'app_version': '1.4.2',
      'app_build': '142',
      'os': 'ios',
      'os_version': '18.5',
      'device_model': 'iPhone16,2',
      'device_manufacturer': 'Apple',
      'locale': 'fr_FR',
      'timezone': 'Europe/Paris',
      'screen_width': 393,
      'screen_height': 852,
      'theme': 'light',
      'network': 'wifi',
      'sdk_version': '0.1.0',
    });
  });

  test('caches static parts but refreshes network and theme per call', () async {
    final source = FakeContextDataSource();
    final collector = ContextCollector(source);

    await collector.collect();
    source.networkValue = 'offline';
    source.themeValue = 'dark';
    final second = await collector.collect();

    expect(source.appInfoCalls, 1); // static info fetched once
    expect(source.deviceInfoCalls, 1); // static info fetched once
    expect(second.network, 'offline'); // network is fresh
    expect(second.theme, 'dark'); // appearance flips mid-session
  });

  test('a declared theme wins over the platform brightness', () async {
    final source = FakeContextDataSource()..themeValue = 'dark';
    String? declared;
    final collector = ContextCollector(source, themeOverride: () => declared);

    expect((await collector.collect()).theme, 'dark'); // follows the platform

    declared = 'light'; // host app forces light despite a dark system
    expect((await collector.collect()).theme, 'light');

    declared = null; // back to following the platform
    expect((await collector.collect()).theme, 'dark');
  });

  test('device id, token and unique id are attached when supplied', () async {
    final store = InMemoryKeyValueStore();
    String? token;
    String? uniqueId;
    final collector = ContextCollector(
      FakeContextDataSource(),
      deviceId: DeviceIdStore(store: store, idFactory: () => 'minted'),
      deviceToken: () => token,
      uniqueId: () => uniqueId,
    );

    final before = await collector.collect();
    expect(before.deviceId, 'IDFV-1111');
    expect(before.deviceToken, isNull); // none declared yet
    expect(before.uniqueId, isNull);

    // Both arrive mid-session: the messaging SDK hands the token over, the
    // host reads its own identifier off a platform channel.
    token = 'fcm-token-abc';
    uniqueId = 'phone-mark-1';
    final after = await collector.collect();
    expect(after.deviceToken, 'fcm-token-abc');
    expect(after.uniqueId, 'phone-mark-1');
  });

  test('collect() never throws even when every source call fails', () async {
    final collector = ContextCollector(ThrowingContextDataSource());

    final context = await collector.collect();

    expect(context.sdkVersion, mamSdkVersion);
    expect(context.toJson(), {'sdk_version': mamSdkVersion});
  });
}
