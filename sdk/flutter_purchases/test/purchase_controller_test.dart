import 'dart:convert';

import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/myampix_purchases.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';
import 'package:myampix_purchases/src/purchase_controller.dart';
import 'package:myampix_purchases/src/store/app_account_token_store.dart';

import 'helpers/fake_store_channel.dart';
import 'helpers/in_memory_key_value_store.dart';
import 'helpers/purchase_fixtures.dart';

void main() {
  late FakeStoreChannel store;
  late List<http.Request> receiptPosts;
  late List<CustomerInfo> notified;
  late InMemoryKeyValueStore keyValueStore;

  setUp(() {
    store = FakeStoreChannel();
    receiptPosts = [];
    notified = [];
    keyValueStore = InMemoryKeyValueStore();
  });
  tearDown(() => store.dispose());

  /// Routes /v1/receipts by status; captures the POST for body assertions.
  PurchasesApiClient apiReturning(int status) => PurchasesApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST' && request.url.path == '/v1/receipts') {
            receiptPosts.add(request);
            if (status != 200) {
              return http.Response(jsonEncode(rfc7807(status)), status);
            }
            return http.Response(
              jsonEncode({'customerInfo': customerInfoJson()}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
        serverUrl: 'http://localhost:8080',
        apiKey: 'mp_pub_test',
      );

  PurchaseController build(
    PurchasesApiClient api, {
    String appUserId = r'$RCAnonymousID:0123456789abcdef0123456789abcdef',
  }) =>
      PurchaseController(
        apiClient: api,
        store: store,
        appUserId: () async => appUserId,
        onCustomerInfoUpdated: notified.add,
        appAccountTokens: AppAccountTokenStore(
          store: keyValueStore,
          uuidFactory: () => 'minted-token-1',
        ),
      );

  test('happy path: purchase → POST receipt → notify → finish → '
      'PurchaseResult', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws.tok',
      storeProductId: 'com.myampix.pro_month',
      transactionId: '2000000123456789',
    );
    final controller = build(apiReturning(200));

    final result =
        await controller.purchaseStoreProduct(storeProduct('com.myampix.pro_month'));

    // Native purchase was invoked with the derived (minted) appAccountToken.
    expect(store.purchaseCallArgs.single, {
      'storeProductId': 'com.myampix.pro_month',
      'appAccountToken': 'minted-token-1',
    });
    // The receipt POST carried the §4 fields.
    final posted = jsonDecode(receiptPosts.single.body) as Map<String, dynamic>;
    expect(posted['app_user_id'],
        r'$RCAnonymousID:0123456789abcdef0123456789abcdef');
    expect(posted['platform'], 'APP_STORE');
    expect(posted['fetch_token'], 'jws.tok');
    expect(posted['product_id'], 'com.myampix.pro_month');
    // Cache/listener fired, transaction finished, result returned.
    expect(notified, hasLength(1));
    expect(store.finishedTransactionIds.single, '2000000123456789');
    expect(result.storeTransaction!.transactionId, '2000000123456789');
    expect(result.customerInfo, notified.single);
  });

  test('the SAME app-user-id always sends the SAME appAccountToken across '
      'purchases', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 't',
      storeProductId: 'sku',
      transactionId: 'tx1',
    );
    final controller = build(apiReturning(200), appUserId: 'user-1');

    await controller.purchaseStoreProduct(storeProduct('sku'));
    await controller.purchaseStoreProduct(storeProduct('sku'));

    expect(
      store.purchaseCallArgs.map((c) => c['appAccountToken']).toSet(),
      {'minted-token-1'},
    );
  });

  test('an app-user-id that is already a UUID is used as the token directly',
      () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 't',
      storeProductId: 'sku',
      transactionId: 'tx1',
    );
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    final controller = build(apiReturning(200), appUserId: uuid);

    await controller.purchaseStoreProduct(storeProduct('sku'));

    expect(store.purchaseCallArgs.single['appAccountToken'], uuid);
  });

  test('user cancel maps to purchaseCancelledError (userCancelled) and never '
      'posts', () async {
    store.purchaseError = PlatformException(code: 'userCancelled');
    final controller = build(apiReturning(200));

    await expectLater(
      controller.purchaseStoreProduct(storeProduct('sku')),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.purchaseCancelledError)
          .having((e) => e.userCancelled, 'userCancelled', isTrue)),
    );
    expect(receiptPosts, isEmpty);
    expect(store.finishedTransactionIds, isEmpty);
  });

  test('paymentPending / productNotAvailable / storeProblem codes map through',
      () async {
    for (final entry in {
      'paymentPending': PurchasesErrorCode.paymentPendingError,
      'productNotAvailable': PurchasesErrorCode.productNotAvailableForPurchaseError,
      'storeProblem': PurchasesErrorCode.storeProblemError,
      'somethingUnmapped': PurchasesErrorCode.storeProblemError, // default
    }.entries) {
      store.purchaseError = PlatformException(code: entry.key);
      await expectLater(
        build(apiReturning(200)).purchaseStoreProduct(storeProduct('sku')),
        throwsA(isA<PurchasesError>().having((e) => e.code, 'code', entry.value)),
      );
    }
  });

  test('server 402 after a successful store purchase: leave txn UNFINISHED '
      'and throw', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 't',
      storeProductId: 'sku',
      transactionId: 'tx9',
    );
    await expectLater(
      build(apiReturning(402)).purchaseStoreProduct(storeProduct('sku')),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.invalidReceiptError)),
    );
    expect(receiptPosts, hasLength(1)); // it was attempted
    expect(store.finishedTransactionIds, isEmpty); // NOT finished → retries
    expect(notified, isEmpty);
  });

  test('a purchase with no transactionId (nullable) skips finish and yields '
      'a null storeTransaction', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'PLAY_STORE',
      fetchToken: 'ptok',
      storeProductId: 'sku',
    );
    final result = await build(apiReturning(200)).purchaseStoreProduct(storeProduct('sku'));

    expect(result.storeTransaction, isNull);
    expect(store.finishedTransactionIds, isEmpty);
    expect(notified, hasLength(1));
  });

  test('a finish() failure after a granted receipt does not fail the purchase',
      () async {
    final failingFinish = _FinishThrowsStoreChannel()
      ..purchaseResult = const StorePurchase(
        platform: 'APP_STORE',
        fetchToken: 't',
        storeProductId: 'sku',
        transactionId: 'tx1',
      );
    final controller = PurchaseController(
      apiClient: apiReturning(200),
      store: failingFinish,
      appUserId: () async => 'u',
      onCustomerInfoUpdated: notified.add,
      appAccountTokens:
          AppAccountTokenStore(store: keyValueStore, uuidFactory: () => 'tok'),
    );

    final result = await controller.purchaseStoreProduct(storeProduct('sku'));
    expect(result.customerInfo, isNotNull);
    expect(notified, hasLength(1)); // grant still observed
  });

  test('purchasePackage delegates to the package storeProduct', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'PLAY_STORE',
      fetchToken: 'ptok',
      storeProductId: 'sku_pkg',
      transactionId: 'GPA.1',
    );
    await build(apiReturning(200)).purchasePackage(packageFor('sku_pkg'));
    expect(store.purchaseCallArgs.single['storeProductId'], 'sku_pkg');
  });
}

/// A store channel whose finishTransaction always throws (still a real
/// purchase result), proving the finish guard.
class _FinishThrowsStoreChannel extends FakeStoreChannel {
  @override
  Future<void> finishTransaction(String transactionId) async =>
      throw PlatformException(code: 'storeProblem');
}
