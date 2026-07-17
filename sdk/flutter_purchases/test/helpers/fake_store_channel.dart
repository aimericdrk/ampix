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

  /// When set, [getProducts] throws this instead of returning
  /// [productsResult] — simulates a total native failure (e.g. iOS's
  /// `Product.products(for:)` throwing), final-review M-2.
  Object? getProductsError;

  /// [purchase] result when [purchaseError] is unset. Defaults to a canned
  /// success carrying no `transactionId` unless overridden.
  StorePurchase? purchaseResult;

  /// When set, [purchase] throws this instead of returning [purchaseResult].
  Object? purchaseError;

  final StreamController<StoreTransactionEvent> _transactions =
      StreamController<StoreTransactionEvent>.broadcast();

  /// Transactions [restore] replays on the transactions stream (defaults to
  /// none). Simulates the REAL native contract (final-review I-1): `restore()`
  /// acks immediately — its Future resolves before anything is emitted — and
  /// the entitlements (followed by the `restore_complete` sentinel) are
  /// pushed asynchronously afterward, on a later event-loop turn than a
  /// `Future.delayed(Duration.zero)` yield would observe. A consumer that
  /// relies on synchronous/`Duration.zero` timing instead of the sentinel
  /// (the I-1 bug) fails against this fake.
  List<StoreTransactionEvent> restoreEmissions = const [];

  /// How long [restore] waits before pushing [restoreEmissions] + the
  /// completion sentinel. Real (not virtual/fake) time, deliberately longer
  /// than a zero-duration timer so it cannot be raced by one.
  static const Duration _restoreReplayDelay = Duration(milliseconds: 20);

  void emitTransaction(StoreTransactionEvent transaction) =>
      _transactions.add(transaction);

  Future<void> dispose() => _transactions.close();

  @override
  Future<List<StoreProductMetadata>> getProducts(
      List<String> productIds) async {
    getProductsCalls++;
    getProductsCallArgs.add(productIds);
    final error = getProductsError;
    if (error != null) throw error;
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
    // Ack immediately (this Future resolves now); the replay + completion
    // sentinel land on a later event-loop turn — see [_restoreReplayDelay].
    unawaited(Future<void>.delayed(_restoreReplayDelay, () {
      for (final event in restoreEmissions) {
        _transactions.add(event);
      }
      _transactions.add(const StoreTransactionEvent.restoreComplete());
    }));
  }

  @override
  Future<bool> canMakePayments() async {
    canMakePaymentsCalls++;
    return true;
  }

  @override
  Stream<StoreTransactionEvent> get transactions => _transactions.stream;
}
