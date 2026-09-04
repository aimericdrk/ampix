/// Automatic context block, serialized as the `context` object of the ingest
/// contract (shared-contracts §4). Null fields are omitted from the JSON.
class EventContext {
  const EventContext({
    this.appVersion,
    this.appBuild,
    this.os,
    this.osVersion,
    this.deviceModel,
    this.deviceManufacturer,
    this.deviceId,
    this.deviceToken,
    this.uniqueId,
    this.locale,
    this.timezone,
    this.screenWidth,
    this.screenHeight,
    this.theme,
    this.network,
    this.sdkVersion,
    this.utmSource,
    this.utmMedium,
    this.utmCampaign,
    this.utmContent,
    this.utmTerm,
    this.firstUtmSource,
    this.firstUtmCampaign,
    this.installReferrer,
  });

  factory EventContext.fromJson(Map<String, dynamic> json) => EventContext(
    appVersion: json['app_version'] as String?,
    appBuild: json['app_build'] as String?,
    os: json['os'] as String?,
    osVersion: json['os_version'] as String?,
    deviceModel: json['device_model'] as String?,
    deviceManufacturer: json['device_manufacturer'] as String?,
    deviceId: json['device_id'] as String?,
    deviceToken: json['device_token'] as String?,
    uniqueId: json['unique_id'] as String?,
    locale: json['locale'] as String?,
    timezone: json['timezone'] as String?,
    screenWidth: json['screen_width'] as int?,
    screenHeight: json['screen_height'] as int?,
    theme: json['theme'] as String?,
    network: json['network'] as String?,
    sdkVersion: json['sdk_version'] as String?,
    utmSource: json['utm_source'] as String?,
    utmMedium: json['utm_medium'] as String?,
    utmCampaign: json['utm_campaign'] as String?,
    utmContent: json['utm_content'] as String?,
    utmTerm: json['utm_term'] as String?,
    firstUtmSource: json['first_utm_source'] as String?,
    firstUtmCampaign: json['first_utm_campaign'] as String?,
    installReferrer: json['install_referrer'] as String?,
  );

  final String? appVersion;
  final String? appBuild;
  final String? os;
  final String? osVersion;
  final String? deviceModel;
  final String? deviceManufacturer;

  /// Stable per-install device identifier: iOS `identifierForVendor`, or a
  /// UUID minted and persisted by the SDK where the OS supplies none
  /// (Android and everything else). See `DeviceIdStore`.
  final String? deviceId;

  /// Push notification token the host app declared via
  /// `MyAmpix.setDeviceToken` (FCM registration token / APNs device token).
  /// Null until the host declares one — the SDK cannot obtain it itself.
  final String? deviceToken;

  /// Free-form identifier the host app declared via `MyAmpix.setUniqueId` —
  /// whatever id the app already keys on elsewhere (its own device
  /// identifier, a CRM id, a licence key), so an event here can be joined to
  /// that system. Never interpreted by the SDK or the backend.
  final String? uniqueId;

  final String? locale;
  final String? timezone;
  final int? screenWidth;
  final int? screenHeight;

  /// The app's effective color scheme: `'light'` or `'dark'`. Follows the
  /// platform brightness unless the host declared its own via
  /// `MyAmpix.setTheme` (apps with an in-app appearance setting).
  final String? theme;

  final String? network;
  final String? sdkVersion;
  final String? utmSource;
  final String? utmMedium;
  final String? utmCampaign;
  final String? utmContent;
  final String? utmTerm;
  final String? firstUtmSource;
  final String? firstUtmCampaign;
  final String? installReferrer;

  Map<String, Object?> toJson() => <String, Object?>{
    'app_version': appVersion,
    'app_build': appBuild,
    'os': os,
    'os_version': osVersion,
    'device_model': deviceModel,
    'device_manufacturer': deviceManufacturer,
    'device_id': deviceId,
    'device_token': deviceToken,
    'unique_id': uniqueId,
    'locale': locale,
    'timezone': timezone,
    'screen_width': screenWidth,
    'screen_height': screenHeight,
    'theme': theme,
    'network': network,
    'sdk_version': sdkVersion,
    'utm_source': utmSource,
    'utm_medium': utmMedium,
    'utm_campaign': utmCampaign,
    'utm_content': utmContent,
    'utm_term': utmTerm,
    'first_utm_source': firstUtmSource,
    'first_utm_campaign': firstUtmCampaign,
    'install_referrer': installReferrer,
  }..removeWhere((_, value) => value == null);
}

/// One event, exactly as sent in the `events` array of `POST /ingest/events`
/// (shared-contracts §4).
class AnalyticsEvent {
  const AnalyticsEvent({
    required this.insertId,
    required this.event,
    required this.distinctId,
    required this.anonId,
    required this.sessionId,
    required this.timestamp,
    this.properties = const {},
    this.context = const EventContext(),
  });

  factory AnalyticsEvent.fromJson(Map<String, dynamic> json) => AnalyticsEvent(
    insertId: json['insert_id'] as String,
    event: json['event'] as String,
    distinctId: json['distinct_id'] as String,
    anonId: json['anon_id'] as String,
    sessionId: json['session_id'] as String,
    timestamp: json['timestamp'] as int,
    properties: (json['properties'] as Map<String, dynamic>?) ?? const {},
    context: EventContext.fromJson(
      (json['context'] as Map<String, dynamic>?) ?? const {},
    ),
  );

  /// UUID v7, dedup key for idempotent retries (design §5).
  final String insertId;
  final String event;
  final String distinctId;
  final String anonId;
  final String sessionId;

  /// Milliseconds since epoch, client clock.
  final int timestamp;
  final Map<String, Object?> properties;
  final EventContext context;

  Map<String, Object?> toJson() => {
    'insert_id': insertId,
    'event': event,
    'distinct_id': distinctId,
    'anon_id': anonId,
    'session_id': sessionId,
    'timestamp': timestamp,
    'properties': properties,
    'context': context.toJson(),
  };
}
