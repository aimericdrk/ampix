import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../myampix.dart';
import '../storage/key_value_store.dart';
import 'myampix_observer.dart' show AutocaptureTrackFn;

/// Channel MyAmpix's native plugin code forwards the app's own
/// in-app-purchase transactions over — an iOS `SKPaymentTransactionObserver`
/// (`ios/Classes/MyampixAnalyticsPlugin.swift`) and an Android Play Billing
/// `PurchasesUpdatedListener` (`android/.../MyampixAnalyticsPlugin.kt`)
/// both post to this same `EventChannel` name.
const String purchasesChannelName = 'myampix_analytics/purchases';

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
/// **Emits each transaction at most once, ever.** Both stores REPLAY
/// history rather than only announcing new sales: iOS `SKPaymentQueue`
/// re-delivers its transactions to every freshly attached observer (so once
/// per cold start), and a `restoreCompletedTransactions()` after a login
/// replays every renewal an auto-renewable subscription has ever billed.
/// Left unguarded that turns one subscriber into dozens of
/// `$in_app_purchase` events per launch — real money multiplied by however
/// many times the app happened to start. So every emission is gated on a
/// seen-transaction set persisted through [KeyValueStore]
/// ([PurchaseDedupeStore]), which survives app restarts. Renewals still each
/// emit exactly once: the key is the per-transaction id, not the
/// subscription's shared original id.
///
/// Toggle via `MyAmpixConfig.autocapturePurchases` (checked at emission
/// time via `MyAmpix.instance.autocapturePurchasesEnabled`, mirroring
/// `MyAmpixObserver`/`MyAmpixTracker`). Never throws: a malformed native
/// payload is dropped, not propagated (design §13).
class PurchaseAutocapture {
  PurchaseAutocapture({
    required KeyValueStore store,
    @visibleForTesting Stream<dynamic>? purchaseStream,
    @visibleForTesting AutocaptureTrackFn? track,
  }) : _purchaseStream =
           purchaseStream ??
           const EventChannel(purchasesChannelName).receiveBroadcastStream(),
       _track = track ?? _defaultTrack,
       _seen = PurchaseDedupeStore(store: store);

  final Stream<dynamic> _purchaseStream;
  final AutocaptureTrackFn _track;
  final PurchaseDedupeStore _seen;
  StreamSubscription<dynamic>? _subscription;

  /// Payloads that arrived before [_seen] finished loading. The native halves
  /// flush their own buffers the instant Dart subscribes, so the replay burst
  /// lands within milliseconds of [start] — well before a `SharedPreferences`
  /// read completes. Holding them here (rather than subscribing late) means
  /// nothing is dropped and nothing is emitted un-deduped.
  final List<dynamic> _pendingPayloads = [];

  static void _defaultTrack(String event, Map<String, Object?> properties) {
    if (!MyAmpix.instance.autocapturePurchasesEnabled) return;
    MyAmpix.instance.track(event, properties: properties);
  }

  /// Begins listening for native purchase notifications. Idempotent: a
  /// second call while already listening is a no-op.
  void start() {
    if (_subscription != null) return;
    _subscription = _purchaseStream.listen(
      _onPayload,
      onError: (Object error, StackTrace stackTrace) {
        // Never-throw guarantee (design §13): a channel-level error must
        // never crash the host or tear down the caller.
      },
    );
    // Subscribe first, load second: the subscription is what makes the native
    // side flush its buffered replay, and _onPayload parks anything that beats
    // the load.
    _seen.load().then((_) {
      final buffered = List<dynamic>.from(_pendingPayloads);
      _pendingPayloads.clear();
      buffered.forEach(_handlePayload);
    });
  }

  /// Stops listening. Safe to call even if [start] was never called.
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    _pendingPayloads.clear();
  }

  void _onPayload(dynamic payload) {
    if (!_seen.isLoaded) {
      _pendingPayloads.add(payload);
      return;
    }
    _handlePayload(payload);
  }

  void _handlePayload(dynamic payload) {
    try {
      if (payload is! Map) return;
      final map = payload;

      final productId = map['productId'];
      final store = map['store'];
      final transactionId = map['transactionId'];
      if (productId is! String || productId.isEmpty) return;
      // `is! String` first so `store` promotes and the dedupe key below
      // needs no cast; it rejects exactly what the two comparisons already
      // rejected (a null or non-string store is neither literal).
      if (store is! String) return;
      if (store != 'app_store' && store != 'play_store') return;
      if (transactionId == null || transactionId.toString().isEmpty) return;

      // The store replayed something we have already reported (a cold-start
      // queue replay, or a post-login restore). Reporting it again would
      // invent revenue that never happened.
      if (!_seen.markSeen(
        store: store,
        transactionId: transactionId.toString(),
        productId: productId,
      )) {
        return;
      }

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

/// The seen-transaction set behind [PurchaseAutocapture]'s
/// emit-at-most-once guarantee, persisted through [KeyValueStore] so it
/// outlives the process — an in-memory set would be re-emptied by the very
/// cold start that triggers the store's replay.
///
/// Deliberately NOT cleared by `MyAmpix.reset()`: the transactions belong to
/// the App Store / Play account on the device, not to the analytics identity,
/// and a logout must not re-open the door to re-reporting them.
///
/// Bounded to the [maxEntries] most recent ids (FIFO) so a long-lived
/// subscriber cannot grow the entry without limit; the cap is far above the
/// renewal count any real subscription reaches, and eviction only ever
/// discards ids old enough that the stores no longer replay them.
class PurchaseDedupeStore {
  PurchaseDedupeStore({required KeyValueStore store}) : _store = store;

  static const storageKey = 'mam_seen_purchase_transactions';
  static const maxEntries = 500;
  static const _separator = '\n';

  final KeyValueStore _store;

  /// Insertion-ordered (Dart `Set` preserves it), oldest first — which is
  /// what makes FIFO eviction a plain `skip` on the tail.
  final Set<String> _seen = <String>{};
  bool _loaded = false;

  bool get isLoaded => _loaded;

  Future<void> load() async {
    try {
      final raw = await _store.getString(storageKey);
      if (raw != null && raw.isNotEmpty) {
        _seen.addAll(raw.split(_separator).where((e) => e.isNotEmpty));
      }
    } on Object catch (_) {
      // A failed read degrades to "nothing seen yet", never a crash. Worst
      // case that is one duplicate burst, not a dead autocapture.
    } finally {
      // Set regardless: a store that cannot be read must not wedge
      // PurchaseAutocapture into buffering payloads forever.
      _loaded = true;
    }
  }

  /// Records this transaction and reports whether it is NEW — `true` means
  /// "emit it", `false` means "already reported, drop it".
  ///
  /// The key carries the product id alongside the transaction id because a
  /// single Play Billing purchase can span several products, and each is its
  /// own `$in_app_purchase`.
  bool markSeen({
    required String store,
    required String transactionId,
    required String productId,
  }) {
    final key = '$store:$transactionId:$productId';
    if (!_seen.add(key)) return false;
    _persist();
    return true;
  }

  void _persist() {
    if (_seen.length > maxEntries) {
      final trimmed = _seen.skip(_seen.length - maxEntries).toList();
      _seen
        ..clear()
        ..addAll(trimmed);
    }
    // Fire-and-forget: a purchase event must never wait on a preferences
    // write, and a failed write degrades to a possible future duplicate.
    unawaited(_store.setString(storageKey, _seen.join(_separator)));
  }
}
