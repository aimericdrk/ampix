import 'customer_info.dart';

/// A minimal RevenueCat `StoreTransaction` (spec §3/§5). Built from the native
/// `purchase` result / EventChannel map; only the fields the Dart layer needs
/// to identify a transaction are kept (the receipt itself never leaves native).
class StoreTransaction {
  const StoreTransaction({
    required this.transactionId,
    required this.productId,
  });

  factory StoreTransaction.fromJson(Map<String, dynamic> json) =>
      StoreTransaction(
        transactionId: json['transactionId'] as String,
        productId: json['storeProductId'] as String,
      );

  final String transactionId;
  final String productId;

  Map<String, Object?> toJson() => {
        'transactionId': transactionId,
        'productId': productId,
      };
}

/// The result of a successful purchase (spec §3): the refreshed [CustomerInfo]
/// plus the [StoreTransaction]. `storeTransaction` is null for flows without a
/// single originating transaction (restore / out-of-band refresh).
class PurchaseResult {
  const PurchaseResult({
    required this.customerInfo,
    required this.storeTransaction,
  });

  final CustomerInfo customerInfo;
  final StoreTransaction? storeTransaction;

  Map<String, Object?> toJson() => {
        'customerInfo': customerInfo.toJson(),
        'storeTransaction': storeTransaction?.toJson(),
      };
}
