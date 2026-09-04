import '../attribution/attribution_store.dart';
import '../model/event.dart';
import '../version.dart';
import 'device_id_store.dart';

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
    this.id,
  });

  final String os;
  final String osVersion;
  final String model;
  final String manufacturer;

  /// The OS-supplied stable identifier (iOS `identifierForVendor`), or null
  /// on platforms that expose none — `DeviceIdStore` mints one in that case.
  final String? id;
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

  /// The platform brightness as `'light' | 'dark'`. Read fresh per event, not
  /// cached: unlike the device model it flips while the app is running
  /// (system appearance schedule, Control Centre).
  String theme();

  /// `'wifi' | 'cellular' | 'offline'` per contract §4.
  Future<String> network();
}

/// Builds the contract-§4 `context` block for every event. App and device
/// info are fetched once and cached; network state and theme are fresh per
/// event. When an [AttributionStore] is supplied, the current marketing touch
/// (`utm_*` last touch + `first_utm_*` first touch) is attached to every
/// event's context so ingest can populate the `events` table's attribution
/// columns (shared-contracts §5/§14).
///
/// Four fields the platform cannot answer on its own are threaded in from the
/// facade: [deviceId] (resolved once, then persisted), while [deviceToken],
/// [uniqueId] and [themeOverride] read the host's current declaration on every
/// collect, so a token, identifier or appearance declared mid-session applies
/// from the next event on.
class ContextCollector {
  ContextCollector(
    this._source, {
    AttributionStore? attribution,
    DeviceIdStore? deviceId,
    String? Function()? deviceToken,
    String? Function()? uniqueId,
    String? Function()? themeOverride,
  }) : _attribution = attribution,
       _deviceId = deviceId,
       _deviceToken = deviceToken,
       _uniqueId = uniqueId,
       _themeOverride = themeOverride;

  final ContextDataSource _source;
  final AttributionStore? _attribution;
  final DeviceIdStore? _deviceId;
  final String? Function()? _deviceToken;
  final String? Function()? _uniqueId;
  final String? Function()? _themeOverride;
  AppInfo? _appInfo;
  DeviceInfo? _deviceInfo;

  Future<EventContext> collect() async {
    try {
      final appInfo = _appInfo ??= await _source.appInfo();
      final deviceInfo = _deviceInfo ??= await _source.deviceInfo();
      final screen = _source.screenSize();
      final attribution = _attribution;
      return EventContext(
        appVersion: appInfo.version,
        appBuild: appInfo.build,
        os: deviceInfo.os,
        osVersion: deviceInfo.osVersion,
        deviceModel: deviceInfo.model,
        deviceManufacturer: deviceInfo.manufacturer,
        deviceId: await _deviceId?.resolve(deviceInfo.id),
        deviceToken: _deviceToken?.call(),
        uniqueId: _uniqueId?.call(),
        locale: _source.locale(),
        timezone: _source.timezone(),
        screenWidth: screen.width,
        screenHeight: screen.height,
        theme: _themeOverride?.call() ?? _source.theme(),
        network: await _source.network(),
        sdkVersion: mamSdkVersion,
        utmSource: attribution?.utmSource,
        utmMedium: attribution?.utmMedium,
        utmCampaign: attribution?.utmCampaign,
        utmContent: attribution?.utmContent,
        utmTerm: attribution?.utmTerm,
        firstUtmSource: attribution?.firstUtmSource,
        firstUtmCampaign: attribution?.firstUtmCampaign,
      );
    } catch (_) {
      // Deliberately swallowed: the SDK never throws into the host app.
      // Degrade to a context that still identifies the SDK version so the
      // event can always be built.
      return const EventContext(sdkVersion: mamSdkVersion);
    }
  }
}
