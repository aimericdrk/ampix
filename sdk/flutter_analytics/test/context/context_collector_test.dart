import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/context/context_collector.dart';
import 'package:myampmix_analytics/src/version.dart';

import '../helpers/fake_context_data_source.dart';

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
      'network': 'wifi',
      'sdk_version': '0.1.0',
    });
  });

  test('caches static parts but refreshes network per call', () async {
    final source = FakeContextDataSource();
    final collector = ContextCollector(source);

    await collector.collect();
    source.networkValue = 'offline';
    final second = await collector.collect();

    expect(source.appInfoCalls, 1); // static info fetched once
    expect(source.deviceInfoCalls, 1); // static info fetched once
    expect(second.network, 'offline'); // network is fresh
  });

  test('collect() never throws even when every source call fails', () async {
    final collector = ContextCollector(ThrowingContextDataSource());

    final context = await collector.collect();

    expect(context.sdkVersion, mamSdkVersion);
    expect(context.toJson(), {'sdk_version': mamSdkVersion});
  });
}
