import '../model/event.dart';
import '../version.dart';

class AppInfo {
  const AppInfo({required this.version, required this.build});

  final String version;
  final String build;
}

class DeviceInfo {
  const DeviceInfo({
    required this.os,
    required this.osVersion,
    required this.model,
    required this.manufacturer,
  });

  final String os;
  final String osVersion;
  final String model;
  final String manufacturer;
}

class ScreenSize {
  const ScreenSize({required this.width, required this.height});

  final int width;
  final int height;
}

/// Platform data behind an interface so tests inject fakes (design §10).
abstract interface class ContextDataSource {
  Future<AppInfo> appInfo();
  Future<DeviceInfo> deviceInfo();
  String locale();
  String timezone();
  ScreenSize screenSize();

  /// `'wifi' | 'cellular' | 'offline'` per contract §4.
  Future<String> network();
}

/// Builds the contract-§4 `context` block for every event. App and device
/// info are fetched once and cached; network state is fresh per event.
class ContextCollector {
  ContextCollector(this._source);

  final ContextDataSource _source;
  AppInfo? _appInfo;
  DeviceInfo? _deviceInfo;

  Future<EventContext> collect() async {
    final appInfo = _appInfo ??= await _source.appInfo();
    final deviceInfo = _deviceInfo ??= await _source.deviceInfo();
    final screen = _source.screenSize();
    return EventContext(
      appVersion: appInfo.version,
      appBuild: appInfo.build,
      os: deviceInfo.os,
      osVersion: deviceInfo.osVersion,
      deviceModel: deviceInfo.model,
      deviceManufacturer: deviceInfo.manufacturer,
      locale: _source.locale(),
      timezone: _source.timezone(),
      screenWidth: screen.width,
      screenHeight: screen.height,
      network: await _source.network(),
      sdkVersion: mamSdkVersion,
    );
  }
}
