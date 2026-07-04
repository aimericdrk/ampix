import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../myampmix.dart';
import 'myampmix_observer.dart' show AutocaptureTrackFn;

/// Channel MyAmpMix's native plugin code forwards the app's own
/// in-app-purchase transactions over — an iOS `SKPaymentTransactionObserver`
/// (`ios/Classes/MyampmixAnalyticsPlugin.swift`) and an Android Play Billing
/// `PurchasesUpdatedListener` (`android/.../MyampmixAnalyticsPlugin.kt`)
/// both post to this same `EventChannel` name.
const String purchasesChannelName = 'myampmix_analytics/purchases';

/// Autocaptures the reserved `$in_app_purchase` event (shared-contracts §4)
/// from native store-transaction notifications forwarded by the platform
/// plugin.
///
/// **Distinct from any manually-tracked purchase:** per the design's
/// "manual vs automatic events" rule, every SDK-autocaptured event is
/// `$`-prefixed/reserved; a developer's own `track('purchase', ...)` (or
/// whatever name they choose) never is. This class only ever emits the
/// reserved `$in_app_purchase` name and always stamps
/// `$purchase_source: "native"`, so the two are always distinguishable by
/// event name — regardless of whether the host app ALSO manually tracks its
/// own purchase event.
///
/// This only observes the CURRENT APP'S OWN store transactions — the same
/// sandboxed StoreKit/Play Billing surface RevenueCat/Adjust hook into.
/// There is no API for a mobile SDK to see another app's or another user's
/// purchases.
///
/// Toggle via `MyAmpMixConfig.autocapturePurchases` (checked at emission
/// time via `MyAmpMix.instance.autocapturePurchasesEnabled`, mirroring
/// `MyAmpMixObserver`/`MyAmpMixTracker`). Never throws: a malformed native
/// payload is dropped, not propagated (design §13).
class PurchaseAutocapture {
  PurchaseAutocapture({
    @visibleForTesting Stream<dynamic>? purchaseStream,
    @visibleForTesting AutocaptureTrackFn? track,
  }) : _purchaseStream =
           purchaseStream ??
           const EventChannel(
             purchasesChannelName,
           ).receiveBroadcastStream(),
       _track = track ?? _defaultTrack;

  final Stream<dynamic> _purchaseStream;
  final AutocaptureTrackFn _track;
  StreamSubscription<dynamic>? _subscription;

  static void _defaultTrack(String event, Map<String, Object?> properties) {
    if (!MyAmpMix.instance.autocapturePurchasesEnabled) return;
    MyAmpMix.instance.track(event, properties: properties);
  }

  /// Begins listening for native purchase notifications. Idempotent: a
  /// second call while already listening is a no-op.
  void start() {
    if (_subscription != null) return;
    _subscription = _purchaseStream.listen(
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
      if (payload is! Map) return;
      final map = payload;

      final productId = map['productId'];
      final store = map['store'];
      final transactionId = map['transactionId'];
      if (productId is! String || productId.isEmpty) return;
      if (store != 'app_store' && store != 'play_store') return;
      if (transactionId == null || transactionId.toString().isEmpty) return;

      final properties = <String, Object?>{
        r'$product_id': productId,
        r'$price': _asNum(map['price']),
        r'$currency': map['currency'] is String ? map['currency'] : null,
        r'$quantity': _asInt(map['quantity']) ?? 1,
        r'$transaction_id': transactionId.toString(),
        r'$store': store,
        r'$purchase_source': 'native',
      };
      _track(r'$in_app_purchase', properties);
    } on Object catch (_) {
      // Never-throw guarantee (design §13): a hostile/malformed native
      // payload degrades to "no event", never a crash.
    }
  }

  num? _asNum(Object? value) {
    if (value is num) return value;
    if (value is String) return num.tryParse(value);
    return null;
  }

  int? _asInt(Object? value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}
