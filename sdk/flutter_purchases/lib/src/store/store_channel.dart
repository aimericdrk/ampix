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
