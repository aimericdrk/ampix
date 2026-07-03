import 'package:myampmix_analytics/src/context/context_collector.dart';

class FakeContextDataSource implements ContextDataSource {
  int appInfoCalls = 0;
  String networkValue = 'wifi';

  @override
  Future<AppInfo> appInfo() async {
    appInfoCalls++;
    return const AppInfo(version: '1.4.2', build: '142');
  }

  @override
  Future<DeviceInfo> deviceInfo() async => const DeviceInfo(
    os: 'ios',
    osVersion: '18.5',
    model: 'iPhone16,2',
    manufacturer: 'Apple',
  );

  @override
  String locale() => 'fr_FR';

  @override
  String timezone() => 'Europe/Paris';

  @override
  ScreenSize screenSize() => const ScreenSize(width: 393, height: 852);

  @override
  Future<String> network() async => networkValue;
}
