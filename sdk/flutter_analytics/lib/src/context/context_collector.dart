import '../attribution/attribution_store.dart';
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
/// info are fetched once and cached; network state is fresh per event. When
/// an [AttributionStore] is supplied, the current marketing touch
/// (`utm_*` last touch + `first_utm_*` first touch) is attached to every
/// event's context so ingest can populate the `events` table's attribution
/// columns (shared-contracts §5/§14).
class ContextCollector {
  ContextCollector(this._source, {AttributionStore? attribution})
    : _attribution = attribution;

  final ContextDataSource _source;
  final AttributionStore? _attribution;
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
        locale: _source.locale(),
        timezone: _source.timezone(),
        screenWidth: screen.width,
        screenHeight: screen.height,
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
