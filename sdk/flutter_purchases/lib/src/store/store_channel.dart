import 'dart:async';

/// Localized store metadata for one product, returned by the native
/// `getProducts` call (design §5). The concrete channel that produces these
/// ships in P3.4; P3.3 only defines the contract.
class StoreProductMetadata {
  const StoreProductMetadata({
    required this.storeProductId,
    required this.priceString,
    required this.price,
    required this.currencyCode,
    required this.title,
    required this.description,
    this.subscriptionPeriodIso8601,
  });

  final String storeProductId;
  final String priceString;
  final double price;
  final String currencyCode;
  final String title;
  final String description;
  final String? subscriptionPeriodIso8601;

  /// Defensive parse of one native `getProducts` entry (a platform-channel
  /// map). Returns null (never throws) for anything without a non-empty
  /// `storeProductId`; optional fields default to empty/zero.
  static StoreProductMetadata? parse(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['storeProductId'];
    if (id is! String || id.isEmpty) return null;
    final period = raw['subscriptionPeriodIso8601'];
    return StoreProductMetadata(
      storeProductId: id,
      priceString: _asString(raw['priceString']),
      price: _asDouble(raw['price']) ?? 0,
      currencyCode: _asString(raw['currencyCode']),
      title: _asString(raw['title']),
      description: _asString(raw['description']),
      subscriptionPeriodIso8601:
          period is String && period.isNotEmpty ? period : null,
    );
  }

  static String _asString(Object? value) => value is String ? value : '';

  static double? _asDouble(Object? value) {
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}

/// The receipt of a native store purchase, before server validation (design §5).
/// `fetchToken` is the iOS StoreKit 2 JWS or the Android purchaseToken.
class StorePurchase {
  const StorePurchase({
    required this.platform,
    required this.fetchToken,
    required this.storeProductId,
    this.transactionId,
  });

  final String platform; // "APP_STORE" | "PLAY_STORE"
  final String fetchToken;
  final String storeProductId;
  final String? transactionId;

  /// Defensive parse of a native `purchase` result (a platform-channel map).
  /// Returns null (never throws) when `platform`/`fetchToken`/`storeProductId`
  /// are missing or wrongly typed; `transactionId` is optional (nullable —
  /// e.g. a Play Billing purchase pending acknowledgement).
  static StorePurchase? parse(Object? raw) {
    if (raw is! Map) return null;
    final platform = raw['platform'];
    final fetchToken = raw['fetchToken'];
    final storeProductId = raw['storeProductId'];
    if (platform != 'APP_STORE' && platform != 'PLAY_STORE') return null;
    if (fetchToken is! String || fetchToken.isEmpty) return null;
    if (storeProductId is! String || storeProductId.isEmpty) return null;
    final transactionId = raw['transactionId'];
    return StorePurchase(
      platform: platform,
      fetchToken: fetchToken,
      storeProductId: storeProductId,
      transactionId: transactionId is String && transactionId.isNotEmpty
          ? transactionId
          : null,
    );
  }
}

/// An out-of-band transaction pushed on the native EventChannel (design §5):
/// a renewal, restore, or purchase the app didn't directly initiate.
///
/// Named `StoreTransactionEvent` — not `StoreTransaction` — because P3.1
/// already committed and exports a narrower `StoreTransaction`
/// (`transactionId`/`productId` only) as part of `PurchaseResult` in
/// `lib/src/models/purchase_result.dart`. Reusing that name here would
/// collide at the package barrel. P3.4 should reconcile the two shapes (see
/// the P3.3 report).
class StoreTransactionEvent {
  const StoreTransactionEvent({
    required this.platform,
    required this.fetchToken,
    required this.storeProductId,
    required this.transactionId,
    required this.reason,
  });

  final String platform; // "APP_STORE" | "PLAY_STORE"
  final String fetchToken;
  final String storeProductId;
  final String transactionId;
  final String reason; // "purchase" | "renewal" | "restore"

  /// Defensive parse of a raw EventChannel payload (design §5). Returns null
  /// (never throws) on any missing/wrongly-typed required field. An
  /// absent/unrecognized `reason` falls back to `"purchase"` (a direct-buy
  /// result carries no reason).
  static StoreTransactionEvent? parse(Object? raw) {
    if (raw is! Map) return null;
    final platform = raw['platform'];
    final fetchToken = raw['fetchToken'];
    final storeProductId = raw['storeProductId'];
    final transactionId = raw['transactionId'];
    if (platform != 'APP_STORE' && platform != 'PLAY_STORE') return null;
    if (fetchToken is! String || fetchToken.isEmpty) return null;
    if (storeProductId is! String || storeProductId.isEmpty) return null;
    if (transactionId is! String || transactionId.isEmpty) return null;
    final reason = raw['reason'];
    return StoreTransactionEvent(
      platform: platform,
      fetchToken: fetchToken,
      storeProductId: storeProductId,
      transactionId: transactionId,
      reason: reason == 'renewal' || reason == 'restore'
          ? reason as String
          : 'purchase',
    );
  }
}

/// Dart-side contract for the native store layer (StoreKit 2 / Play Billing).
///
/// P3.3 defines this seam so the facade can be wired to a fake and never touch
/// a real platform channel in tests; the concrete MethodChannel/EventChannel
/// implementation (and the purchase/offerings orchestration built on top of it)
/// ships in P3.4.
abstract interface class StoreChannel {
  Future<List<StoreProductMetadata>> getProducts(List<String> productIds);
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  });
  Future<void> finishTransaction(String transactionId);
  Future<void> restore();
  Future<bool> canMakePayments();
  Stream<StoreTransactionEvent> get transactions;
}
