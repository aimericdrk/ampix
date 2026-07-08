import 'package:myampix_analytics/src/context/context_collector.dart';

class FakeContextDataSource implements ContextDataSource {
  int appInfoCalls = 0;
  int deviceInfoCalls = 0;
  String networkValue = 'wifi';

  @override
  Future<AppInfo> appInfo() async {
    appInfoCalls++;
    return const AppInfo(version: '1.4.2', build: '142');
  }

  @override
  Future<DeviceInfo> deviceInfo() async {
    deviceInfoCalls++;
    return const DeviceInfo(
      os: 'ios',
      osVersion: '18.5',
      model: 'iPhone16,2',
      manufacturer: 'Apple',
    );
  }

  @override
  String locale() => 'fr_FR';

  @override
  String timezone() => 'Europe/Paris';

  @override
  ScreenSize screenSize() => const ScreenSize(width: 393, height: 852);

  @override
  Future<String> network() async => networkValue;
}

/// Every method throws — proves context collection never leaks exceptions
/// into the host app (global SDK constraint).
class ThrowingContextDataSource implements ContextDataSource {
  @override
  Future<AppInfo> appInfo() async => throw StateError('appInfo failed');

  @override
  Future<DeviceInfo> deviceInfo() async =>
      throw StateError('deviceInfo failed');

  @override
  String locale() => throw StateError('locale failed');

  @override
  String timezone() => throw StateError('timezone failed');

  @override
  ScreenSize screenSize() => throw StateError('screenSize failed');

  @override
  Future<String> network() async => throw StateError('network failed');
}
