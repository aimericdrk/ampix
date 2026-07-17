import 'dart:async';

import 'package:myampix_purchases/src/store/store_channel.dart';

/// Hand-rolled fake for the P3.3 facade tests: records call counts, returns
/// canned values, and lets a test drive the out-of-band transaction stream.
/// No mocktail/mockito — matches the flutter_analytics test conventions.
class FakeStoreChannel implements StoreChannel {
  int getProductsCalls = 0;
  int purchaseCalls = 0;
  int finishCalls = 0;
  int restoreCalls = 0;
  int canMakePaymentsCalls = 0;

  final StreamController<StoreTransactionEvent> _transactions =
      StreamController<StoreTransactionEvent>.broadcast();

  void emitTransaction(StoreTransactionEvent transaction) =>
      _transactions.add(transaction);

  Future<void> dispose() => _transactions.close();

  @override
  Future<List<StoreProductMetadata>> getProducts(
      List<String> productIds) async {
    getProductsCalls++;
    return const <StoreProductMetadata>[];
  }

  @override
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  }) async {
    purchaseCalls++;
    return StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws-$appAccountToken',
      storeProductId: storeProductId,
    );
  }

  @override
  Future<void> finishTransaction(String transactionId) async {
    finishCalls++;
  }

  @override
  Future<void> restore() async {
    restoreCalls++;
  }

  @override
  Future<bool> canMakePayments() async {
    canMakePaymentsCalls++;
    return true;
  }

  @override
  Stream<StoreTransactionEvent> get transactions => _transactions.stream;
}
