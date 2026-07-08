import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Channel MyAmpix's native plugin code forwards install-attribution data
/// over. On Android the plugin
/// (`android/.../MyampixAnalyticsPlugin.kt`) fetches the Google Play
/// **install referrer** once on first launch and posts its raw
/// URL-query-encoded string to this `EventChannel`. **iOS has no
/// install-referrer equivalent** (`ios/Classes/MyampixAnalyticsPlugin.swift`
/// registers this channel as a documented no-op), so iOS attribution is
/// deep-link-only via `MyAmpix.trackDeepLink`.
const String attributionChannelName = 'myampix_analytics/attribution';

/// Called with the raw install-referrer string once native forwards it.
typedef ReferrerHandler = void Function(String referrer);

/// Autocaptures the Android install referrer and re-emits it as the reserved
/// `$campaign_touch` event (`$attribution_source: "install_referrer"`,
/// shared-contracts §4).
///
/// Mirrors [PurchaseAutocapture] exactly: it is the one attribution path that
/// opens a real platform channel, so `MyAmpix.init()` only ever constructs
/// and [start]s it when `config.autocaptureAttribution` is true — an
/// unconditional real-channel subscription DEADLOCKS host-app + our own
/// `testWidgets` fake-async. Tests inject a fake [attributionStream] via
/// `SdkOverrides` instead of touching the real channel.
///
/// Never throws (design §13): a malformed native payload or a channel-level
/// error degrades to "no touch", never a crash.
class AttributionAutocapture {
  AttributionAutocapture({
    required ReferrerHandler onReferrer,
    @visibleForTesting Stream<dynamic>? attributionStream,
  }) : _onReferrer = onReferrer,
       _stream =
           attributionStream ??
           const EventChannel(attributionChannelName).receiveBroadcastStream();

  final Stream<dynamic> _stream;
  final ReferrerHandler _onReferrer;
  StreamSubscription<dynamic>? _subscription;

  /// Begins listening for native attribution payloads. Idempotent: a second
  /// call while already listening is a no-op.
  void start() {
    if (_subscription != null) return;
    _subscription = _stream.listen(
      _handlePayload,
      onError: (Object error, StackTrace stackTrace) {
        // Never-throw guarantee (design §13): a channel-level error must
        // never crash the host or tear down the caller.
      },
    );
  }

  /// Stops listening. Safe to call even if [start] was never called.
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  void _handlePayload(dynamic payload) {
    try {
      final referrer = _extractReferrer(payload);
      if (referrer == null || referrer.isEmpty) return;
      _onReferrer(referrer);
    } on Object catch (_) {
      // Never-throw guarantee (design §13): a hostile/malformed native
      // payload degrades to "no touch", never a crash.
    }
  }

  /// Accepts either the raw referrer string or a `{'referrer': '...'}` map,
  /// so the native side can forward either shape.
  String? _extractReferrer(dynamic payload) {
    if (payload is String) return payload;
    if (payload is Map) {
      final value = payload['referrer'] ?? payload['installReferrer'];
      if (value is String) return value;
    }
    return null;
  }
}
