import 'dart:io';
import 'dart:ui' as ui;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'context_collector.dart';

/// Production [ContextDataSource] backed by the platform plugins
/// (design §10 table: field-by-field iOS/Android sources).
///
/// Every plugin call is contained: a failing plugin degrades the affected
/// field to a safe fallback instead of throwing into the host app.
class PlatformContextDataSource implements ContextDataSource {
  PlatformContextDataSource({
    DeviceInfoPlugin? deviceInfoPlugin,
    Connectivity? connectivity,
  }) : _deviceInfoPlugin = deviceInfoPlugin ?? DeviceInfoPlugin(),
       _connectivity = connectivity ?? Connectivity();

  final DeviceInfoPlugin _deviceInfoPlugin;
  final Connectivity _connectivity;

  @override
  Future<AppInfo> appInfo() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return AppInfo(version: info.version, build: info.buildNumber);
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return const AppInfo(version: '', build: '');
    }
  }

  @override
  Future<DeviceInfo> deviceInfo() async {
    try {
      if (Platform.isIOS) {
        final ios = await _deviceInfoPlugin.iosInfo;
        return DeviceInfo(
          os: 'ios',
          osVersion: ios.systemVersion,
          model: ios.utsname.machine,
          manufacturer: 'Apple',
        );
      }
      if (Platform.isAndroid) {
        final android = await _deviceInfoPlugin.androidInfo;
        return DeviceInfo(
          os: 'android',
          osVersion: android.version.release,
          model: android.model,
          manufacturer: android.manufacturer,
        );
      }
      return _fallbackDeviceInfo();
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return _fallbackDeviceInfo();
    }
  }

  DeviceInfo _fallbackDeviceInfo() => DeviceInfo(
    os: Platform.operatingSystem,
    osVersion: Platform.operatingSystemVersion,
    model: 'unknown',
    manufacturer: 'unknown',
  );

  @override
  String locale() {
    try {
      return ui.PlatformDispatcher.instance.locale.toString();
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return '';
    }
  }

  // M1 limitation (design §16): may be an abbreviation (e.g. CEST) rather
  // than an IANA name. The field is optional in contract §4.
  @override
  String timezone() {
    try {
      return DateTime.now().timeZoneName;
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return '';
    }
  }

  @override
  ScreenSize screenSize() {
    try {
      final views = ui.PlatformDispatcher.instance.views;
      if (views.isEmpty) return const ScreenSize(width: 0, height: 0);
      final view = views.first;
      return ScreenSize(
        width: (view.physicalSize.width / view.devicePixelRatio).round(),
        height: (view.physicalSize.height / view.devicePixelRatio).round(),
      );
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return const ScreenSize(width: 0, height: 0);
    }
  }

  @override
  Future<String> network() async {
    try {
      final results = await _connectivity.checkConnectivity();
      if (results.contains(ConnectivityResult.wifi) ||
          results.contains(ConnectivityResult.ethernet)) {
        return 'wifi';
      }
      if (results.contains(ConnectivityResult.mobile)) return 'cellular';
      return 'offline';
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      return 'offline';
    }
  }
}
