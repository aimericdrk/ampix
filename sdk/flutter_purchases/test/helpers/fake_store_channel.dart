import 'dart:async';

import 'package:myampix_purchases/src/store/store_channel.dart';

/// Hand-rolled fake for the P3.3/P3.4 facade tests: records call counts,
/// returns canned/configurable values, and lets a test drive the out-of-band
/// transaction stream. No mocktail/mockito — matches the flutter_analytics
/// test conventions.
class FakeStoreChannel implements StoreChannel {
  int getProductsCalls = 0;
  int purchaseCalls = 0;
  int finishCalls = 0;
  int restoreCalls = 0;
  int canMakePaymentsCalls = 0;

  /// The ids most recently passed to [getProducts] (one entry per call).
  final List<List<String>> getProductsCallArgs = [];

  /// The `{storeProductId, appAccountToken}` args of every [purchase] call.
  final List<Map<String, String>> purchaseCallArgs = [];

  /// Every id passed to [finishTransaction], in call order.
  final List<String> finishedTransactionIds = [];

  /// [getProducts] result (defaults to empty — native metadata unavailable).
  List<StoreProductMetadata> productsResult = const [];

  /// [purchase] result when [purchaseError] is unset. Defaults to a canned
  /// success carrying no `transactionId` unless overridden.
  StorePurchase? purchaseResult;

  /// When set, [purchase] throws this instead of returning [purchaseResult].
  Object? purchaseError;

  final StreamController<StoreTransactionEvent> _transactions =
      StreamController<StoreTransactionEvent>.broadcast();

  /// Transactions [restore] replays on the transactions stream (defaults to
  /// none). Simulates the native contract: `restore()` re-emits the user's
  /// current entitlements as `reason: restore` events before its Future
  /// resolves.
  List<StoreTransactionEvent> restoreEmissions = const [];

  void emitTransaction(StoreTransactionEvent transaction) =>
      _transactions.add(transaction);

  Future<void> dispose() => _transactions.close();

  @override
  Future<List<StoreProductMetadata>> getProducts(
      List<String> productIds) async {
    getProductsCalls++;
    getProductsCallArgs.add(productIds);
    return productsResult;
  }

  @override
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  }) async {
    purchaseCalls++;
    purchaseCallArgs.add({
      'storeProductId': storeProductId,
      'appAccountToken': appAccountToken,
    });
    final error = purchaseError;
    if (error != null) throw error;
    return purchaseResult ??
        StorePurchase(
          platform: 'APP_STORE',
          fetchToken: 'jws-$appAccountToken',
          storeProductId: storeProductId,
        );
  }

  @override
  Future<void> finishTransaction(String transactionId) async {
    finishCalls++;
    finishedTransactionIds.add(transactionId);
  }

  @override
  Future<void> restore() async {
    restoreCalls++;
    for (final event in restoreEmissions) {
      _transactions.add(event);
    }
  }

  @override
  Future<bool> canMakePayments() async {
    canMakePaymentsCalls++;
    return true;
  }

  @override
  Stream<StoreTransactionEvent> get transactions => _transactions.stream;
}
