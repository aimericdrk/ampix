import 'dart:async';

import 'package:flutter/services.dart' show PlatformException;

import 'models/customer_info.dart';
import 'models/package.dart';
import 'models/purchase_result.dart';
import 'models/purchases_error.dart';
import 'models/store_product.dart';
import 'network/purchases_api_client.dart';
import 'store/app_account_token_store.dart';
import 'store/store_channel.dart';

/// Non-fatal internal warning sink (finish/out-of-band failures that must
/// never crash the caller). Defaults to a no-op; the facade wires its own
/// `_log`.
typedef PurchaseWarningLogger = void Function(
  String message, [
  Object? error,
  StackTrace? stackTrace,
]);

void _noopLogger(String message, [Object? error, StackTrace? stackTrace]) {}

/// Purchase orchestration (design §4): runs the native store purchase, posts
/// the receipt to `mobile_purchase`, refreshes the cache + fires the update
/// listener via [onCustomerInfoUpdated], then finishes the transaction. Also
/// owns the out-of-band path ([handleOutOfBandTransaction], driven by the
/// facade's subscription to `StoreChannel.transactions`) and
/// [restorePurchases]. Store `PlatformException` codes and server RFC-7807
/// statuses surface as typed [PurchasesError] (design §6); a failed receipt
/// post after a granted native purchase leaves the transaction UNFINISHED so
/// it re-delivers on next launch instead of being lost.
class PurchaseController {
  PurchaseController({
    required PurchasesApiClient apiClient,
    required StoreChannel store,
    required Future<String> Function() appUserId,
    required void Function(CustomerInfo) onCustomerInfoUpdated,
    required AppAccountTokenStore appAccountTokens,
    PurchaseWarningLogger logger = _noopLogger,
  })  : _apiClient = apiClient,
        _store = store,
        _appUserId = appUserId,
        _onCustomerInfoUpdated = onCustomerInfoUpdated,
        _appAccountTokens = appAccountTokens,
        _logger = logger;

  final PurchasesApiClient _apiClient;
  final StoreChannel _store;
  final Future<String> Function() _appUserId;
  final void Function(CustomerInfo) _onCustomerInfoUpdated;
  final AppAccountTokenStore _appAccountTokens;
  final PurchaseWarningLogger _logger;

  /// Serializes out-of-band receipt processing so [restorePurchases] /
  /// [idle] can await a settled state before refetching.
  Future<void> _tail = Future<void>.value();

  StreamSubscription<StoreTransactionEvent>? _subscription;

  /// Subscribes to the native out-of-band transaction stream (renewals /
  /// interrupted purchases / restore replays). Idempotent. A stream-level
  /// error is logged and never propagates.
  void start() {
    _subscription ??= _store.transactions.listen(
      handleOutOfBandTransaction,
      onError: (Object error, StackTrace stackTrace) {
        _logger('StoreChannel transaction stream error', error, stackTrace);
      },
    );
  }

  /// Cancels the out-of-band subscription (if any). Safe to call more than
  /// once.
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }

  Future<PurchaseResult> purchasePackage(Package packageToPurchase) =>
      purchaseStoreProduct(packageToPurchase.storeProduct);

  Future<PurchaseResult> purchaseStoreProduct(StoreProduct product) async {
    final appUserId = await _appUserId();
    final appAccountToken = await _appAccountTokens.tokenFor(appUserId);

    final StorePurchase purchase;
    try {
      purchase = await _store.purchase(
        storeProductId: product.identifier,
        appAccountToken: appAccountToken,
      );
    } on PlatformException catch (error) {
      throw _mapPlatformException(error);
    }

    // A failure here (402/409/503/network → PurchasesError) deliberately
    // leaves the transaction unfinished: it re-delivers via the transactions
    // stream on next launch instead of being lost (design §4).
    final customerInfo = await _apiClient.postReceipt(
      appUserId: appUserId,
      platform: purchase.platform,
      fetchToken: purchase.fetchToken,
      productId: purchase.storeProductId,
    );

    _onCustomerInfoUpdated(customerInfo);
    final transactionId = purchase.transactionId;
    if (transactionId != null) await _finishQuietly(transactionId);

    return PurchaseResult(
      customerInfo: customerInfo,
      storeTransaction: transactionId == null
          ? null
          : StoreTransaction(
              transactionId: transactionId,
              productId: purchase.storeProductId,
            ),
    );
  }

  /// Handles one out-of-band transaction (renewal / interrupted purchase /
  /// restore replay) pushed on `StoreChannel.transactions`. Enqueued on
  /// [_tail] so events are processed one at a time, in order. Never throws:
  /// a failed post is logged and left unfinished for retry (design §4).
  void handleOutOfBandTransaction(StoreTransactionEvent transaction) {
    _tail = _tail.then((_) async {
      try {
        final customerInfo = await _apiClient.postReceipt(
          appUserId: await _appUserId(),
          platform: transaction.platform,
          fetchToken: transaction.fetchToken,
          productId: transaction.storeProductId,
        );
        _onCustomerInfoUpdated(customerInfo);
        await _finishQuietly(transaction.transactionId);
      } on Object catch (error, stackTrace) {
        _logger(
          'out-of-band transaction failed; left unfinished for retry',
          error,
          stackTrace,
        );
      }
    });
  }

  /// Resolves when every out-of-band transaction enqueued so far has been
  /// processed.
  Future<void> get idle => _tail;

  /// Restores entitlements (design §4): triggers the native restore (which
  /// re-emits the user's current transactions as `reason: restore` events on
  /// `StoreChannel.transactions`, each handled by [handleOutOfBandTransaction]),
  /// then refetches the subscriber as the authoritative [CustomerInfo].
  Future<CustomerInfo> restorePurchases() async {
    await _store.restore();
    // Yield once so any restore transactions the native side already pushed
    // synchronously are enqueued on [_tail] before we drain it.
    await Future<void>.delayed(Duration.zero);
    await _tail;
    final customerInfo = await _apiClient.getSubscriber(await _appUserId());
    _onCustomerInfoUpdated(customerInfo);
    return customerInfo;
  }

  Future<void> _finishQuietly(String transactionId) async {
    try {
      await _store.finishTransaction(transactionId);
    } on Object catch (error, stackTrace) {
      _logger(
        'finishTransaction failed (server already granted; will retry)',
        error,
        stackTrace,
      );
    }
  }

  PurchasesError _mapPlatformException(PlatformException error) {
    switch (error.code) {
      case 'userCancelled':
        return PurchasesError(
          PurchasesErrorCode.purchaseCancelledError,
          'Purchase was cancelled.',
          underlyingErrorMessage: error.message,
        );
      case 'paymentPending':
        return PurchasesError(
          PurchasesErrorCode.paymentPendingError,
          'The payment is pending.',
          underlyingErrorMessage: error.message,
        );
      case 'productNotAvailable':
        return PurchasesError(
          PurchasesErrorCode.productNotAvailableForPurchaseError,
          'The product is not available for purchase.',
          underlyingErrorMessage: error.message,
        );
      case 'storeProblem':
      default:
        return PurchasesError(
          PurchasesErrorCode.storeProblemError,
          'There was a problem with the store.',
          underlyingErrorMessage: error.message,
        );
    }
  }
}
