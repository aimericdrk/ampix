import 'dart:convert';

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
  late List<http.Request> subscriberGets;
  late List<CustomerInfo> notified;

  setUp(() {
    store = FakeStoreChannel();
    receiptPosts = [];
    subscriberGets = [];
    notified = [];
  });
  tearDown(() => store.dispose());

  PurchasesApiClient api() => PurchasesApiClient(
        client: MockClient((request) async {
          if (request.method == 'POST' && request.url.path == '/v1/receipts') {
            receiptPosts.add(request);
            return http.Response(
              jsonEncode({'customerInfo': customerInfoJson()}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.method == 'GET' &&
              request.url.path.startsWith('/v1/subscribers/')) {
            subscriberGets.add(request);
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

  PurchaseController build() => PurchaseController(
        apiClient: api(),
        store: store,
        appUserId: () async => 'user-1',
        onCustomerInfoUpdated: notified.add,
        appAccountTokens: AppAccountTokenStore(
          store: InMemoryKeyValueStore(),
          uuidFactory: () => 'tok',
        ),
      );

  test('an out-of-band renewal posts a receipt, notifies, and finishes',
      () async {
    final controller = build()..start();
    addTearDown(controller.stop);
    controller.handleOutOfBandTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'renewtok',
      storeProductId: 'com.myampix.pro_month',
      transactionId: 'tx_renew',
      reason: 'renewal',
    ));
    await controller.idle;

    final posted = jsonDecode(receiptPosts.single.body) as Map<String, dynamic>;
    expect(posted['fetch_token'], 'renewtok');
    expect(posted['app_user_id'], 'user-1');
    expect(notified, hasLength(1));
    expect(store.finishedTransactionIds.single, 'tx_renew');
  });

  test('a failed out-of-band receipt post never throws and leaves the '
      'transaction unfinished for retry', () async {
    final failingApi = PurchasesApiClient(
      client: MockClient((request) async => http.Response('{}', 503)),
      serverUrl: 'http://localhost:8080',
      apiKey: 'mp_pub_test',
    );
    final controller = PurchaseController(
      apiClient: failingApi,
      store: store,
      appUserId: () async => 'user-1',
      onCustomerInfoUpdated: notified.add,
      appAccountTokens: AppAccountTokenStore(
        store: InMemoryKeyValueStore(),
        uuidFactory: () => 'tok',
      ),
    );

    // Must never throw synchronously nor leave an unhandled rejection.
    controller.handleOutOfBandTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'renewtok',
      storeProductId: 'sku',
      transactionId: 'tx_renew',
      reason: 'renewal',
    ));
    await controller.idle;

    expect(notified, isEmpty);
    expect(store.finishedTransactionIds, isEmpty);
  });

  test('out-of-band events are processed one at a time, in order', () async {
    final controller = build();
    controller.handleOutOfBandTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'r1',
      storeProductId: 'sku',
      transactionId: 'tx1',
      reason: 'renewal',
    ));
    controller.handleOutOfBandTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'r2',
      storeProductId: 'sku',
      transactionId: 'tx2',
      reason: 'renewal',
    ));
    await controller.idle;

    expect(store.finishedTransactionIds, ['tx1', 'tx2']);
    expect(notified, hasLength(2));
  });

  test(
      'restorePurchases replays restore txns to /v1/receipts, then refetches '
      'and returns the subscriber CustomerInfo', () async {
    store.restoreEmissions = const [
      StoreTransactionEvent(
        platform: 'APP_STORE',
        fetchToken: 'r1',
        storeProductId: 'com.myampix.pro_month',
        transactionId: 'tx_r1',
        reason: 'restore',
      ),
      StoreTransactionEvent(
        platform: 'APP_STORE',
        fetchToken: 'r2',
        storeProductId: 'com.myampix.pro_year',
        transactionId: 'tx_r2',
        reason: 'restore',
      ),
    ];
    final controller = build()..start();
    addTearDown(controller.stop);

    final info = await controller.restorePurchases();

    expect(store.restoreCalls, 1);
    expect(receiptPosts, hasLength(2)); // one per restored transaction
    expect(
      receiptPosts.map((r) => (jsonDecode(r.body) as Map)['fetch_token']),
      containsAll(<String>['r1', 'r2']),
    );
    expect(store.finishedTransactionIds, containsAll(<String>['tx_r1', 'tx_r2']));
    expect(subscriberGets, hasLength(1)); // final refetch (§4)
    expect(info, isNotNull);
    expect(notified.last, info); // refetch also fires the listener
  });

  test(
      'restorePurchases returns the POST-restore CustomerInfo even though '
      'native pushes the restore replay ASYNCHRONOUSLY (the real-device '
      'timing FakeStoreChannel.restore() now simulates) — final-review I-1: '
      'a Duration.zero-based wait would race ahead of the receipt post below '
      'and return the stale pre-restore CustomerInfo instead', () async {
    store.restoreEmissions = const [
      StoreTransactionEvent(
        platform: 'APP_STORE',
        fetchToken: 'r1',
        storeProductId: 'com.myampix.pro_month',
        transactionId: 'tx_r1',
        reason: 'restore',
      ),
    ];
    final preRestore = <String, Object?>{
      'entitlements': {'all': <String, dynamic>{}, 'active': <String, dynamic>{}},
      'subscriptions': <dynamic>[],
      'firstSeen': '2026-07-01T00:00:00Z',
      'managementURL': null,
    };
    final api = PurchasesApiClient(
      client: MockClient((request) async {
        if (request.method == 'POST' && request.url.path == '/v1/receipts') {
          receiptPosts.add(request);
          return http.Response(
            jsonEncode({'customerInfo': customerInfoJson()}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.method == 'GET' &&
            request.url.path.startsWith('/v1/subscribers/')) {
          subscriberGets.add(request);
          // Honest server behavior: the restored entitlement only shows up
          // once its receipt has actually posted — unlike the shared api()
          // helper, which returns the same canned body regardless of order
          // and so can't distinguish a premature fetch from a correct one.
          final body = receiptPosts.isEmpty ? preRestore : customerInfoJson();
          return http.Response(
            jsonEncode({'customerInfo': body}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('{}', 404);
      }),
      serverUrl: 'http://localhost:8080',
      apiKey: 'mp_pub_test',
    );
    final controller = PurchaseController(
      apiClient: api,
      store: store,
      appUserId: () async => 'user-1',
      onCustomerInfoUpdated: notified.add,
      appAccountTokens: AppAccountTokenStore(
        store: InMemoryKeyValueStore(),
        uuidFactory: () => 'tok',
      ),
    )..start();
    addTearDown(controller.stop);

    final info = await controller.restorePurchases();

    // Both would have already been asserted true even under the old bug (the
    // receipt eventually posts, and getSubscriber eventually runs) — the
    // regression is specifically that the OLD code called getSubscriber too
    // early, so `info` reflects the last delivered subscriber body, not the
    // receipt-posted one, whenever the two race. Reflecting the restored
    // entitlement in the very info this call resolves with — never a stale
    // pre-restore one — is exactly what the fix guarantees.
    expect(receiptPosts, hasLength(1));
    expect(info.entitlements.all, contains('pro'));
    expect(info.entitlements.active, contains('pro'));
  });

  test('restorePurchases with no emissions still refetches the subscriber',
      () async {
    final controller = build()..start();
    addTearDown(controller.stop);
    final info = await controller.restorePurchases();
    expect(store.restoreCalls, 1);
    expect(receiptPosts, isEmpty);
    expect(subscriberGets, hasLength(1));
    expect(info, isNotNull);
  });

  test('start is idempotent (no double-listen) and stop is safe to call '
      'twice', () async {
    final controller = build();
    controller
      ..start()
      ..start();

    store.emitTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'r1',
      storeProductId: 'sku',
      transactionId: 'tx1',
      reason: 'renewal',
    ));
    await pumpEventQueue();
    await controller.idle;
    expect(receiptPosts, hasLength(1)); // not double-processed

    await controller.stop();
    await controller.stop(); // no throw
  });
}
