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

  /// Fires once per [StoreTransactionEvent.restoreComplete] sentinel
  /// received on [StoreChannel.transactions] (final-review I-1). A broadcast
  /// stream so a concurrent [restorePurchases] call can each take their own
  /// `.first`.
  final StreamController<void> _restoreComplete =
      StreamController<void>.broadcast();

  /// Subscribes to the native out-of-band transaction stream (renewals /
  /// interrupted purchases / restore replays). Idempotent. Never throws:
  /// starting the subscription is wrapped in a try/catch and the
  /// subscription's `onError` is always set, so neither a synchronous setup
  /// failure nor a later stream-level error can escape [start] or crash the
  /// caller — this matters because `StoreChannel.transactions` is backed by
  /// a real platform `EventChannel` in production, and calling `.listen()`
  /// on one with no live platform binding (e.g. a host app that hasn't yet
  /// called `WidgetsFlutterBinding.ensureInitialized()`, or a unit test
  /// exercising the real channel without a live `TestWidgetsFlutterBinding`)
  /// can throw. A caught failure leaves [_subscription] unset so a later
  /// [start] call retries.
  void start() {
    if (_subscription != null) return;
    try {
      _subscription = _store.transactions.listen(
        _dispatchTransactionEvent,
        onError: (Object error, StackTrace stackTrace) {
          _logger('StoreChannel transaction stream error', error, stackTrace);
        },
      );
    } on Object catch (error, stackTrace) {
      _logger(
        'StoreChannel transaction stream failed to start',
        error,
        stackTrace,
      );
    }
  }

  /// Routes one [StoreChannel.transactions] event: the
  /// [StoreTransactionEvent.restoreComplete] sentinel signals
  /// [_restoreComplete] (consumed by [restorePurchases]) instead of being
  /// posted as a receipt; every other event is a real out-of-band
  /// transaction handled by [handleOutOfBandTransaction]. Because both this
  /// listener and the sentinel arrive on one ordered stream, by the time the
  /// sentinel is dispatched here every preceding restore transaction has
  /// already been enqueued on [_tail] (final-review I-1).
  void _dispatchTransactionEvent(StoreTransactionEvent event) {
    if (event.isRestoreComplete) {
      _restoreComplete.add(null);
      return;
    }
    handleOutOfBandTransaction(event);
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
  ///
  /// final-review I-1: on a real device, `_store.restore()` ACKS immediately
  /// — native pushes the replay (and the terminating
  /// [StoreTransactionEvent.restoreComplete] sentinel) asynchronously
  /// afterward, possibly well after this method's `await` returns. A fixed
  /// `Future.delayed(Duration.zero)` yield used to stand in for "the replay
  /// is done", which only ever worked against a fake that pushed its events
  /// synchronously; on real async native it let [_apiClient.getSubscriber]
  /// race ahead of the restore receipts and return stale pre-restore info.
  /// Waiting for the sentinel instead is correct regardless of how long the
  /// native replay takes.
  Future<CustomerInfo> restorePurchases() async {
    // Subscribe BEFORE triggering restore so the sentinel can never be
    // missed (start() already listens; this just takes that same ordered
    // stream's next completion event).
    final restoreComplete = _restoreComplete.stream.first;
    await _store.restore();
    await restoreComplete;
    // Every restore transaction that preceded the sentinel has therefore
    // already been enqueued via [_dispatchTransactionEvent]; drain their
    // receipt posts before refetching.
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
