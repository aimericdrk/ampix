import 'dart:convert';

import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/myampix_purchases.dart';

import 'helpers/fake_store_channel.dart';
import 'helpers/in_memory_key_value_store.dart';
import 'helpers/purchase_fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeStoreChannel store;
  late InMemoryKeyValueStore keyValueStore;
  late List<http.Request> requests;

  setUp(() {
    store = FakeStoreChannel();
    keyValueStore = InMemoryKeyValueStore();
    requests = [];
    MyAmpixPurchases.resetForTesting();
  });
  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
    await store.dispose();
  });

  http.Client mockClient() => MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/v1/offerings') {
          return http.Response(jsonEncode(offeringsWire()), 200,
              headers: {'content-type': 'application/json'});
        }
        if (request.method == 'POST' && request.url.path == '/v1/receipts') {
          return http.Response(
            jsonEncode({'customerInfo': customerInfoJson()}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        if (request.url.path.startsWith('/v1/subscribers/')) {
          return http.Response(
            jsonEncode({'customerInfo': customerInfoJson()}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }
        return http.Response('{}', 404);
      });

  Future<void> configure() => MyAmpixPurchases.configure(
        PurchasesConfiguration(
            apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
        overrides: SdkOverrides(
          httpClient: mockClient(),
          keyValueStore: keyValueStore,
          storeChannel: store,
          uuidFactory: () => 'minted-uuid',
        ),
      );

  test('getOfferings returns enriched offerings through the facade',
      () async {
    store.productsResult = const [
      StoreProductMetadata(
        storeProductId: 'com.myampix.pro_month',
        priceString: r'$9.99',
        price: 9.99,
        currencyCode: 'USD',
        title: 'Pro Monthly',
        description: 'd',
        subscriptionPeriodIso8601: 'P1M',
      ),
    ];
    await configure();

    final offerings = await MyAmpixPurchases.getOfferings();
    expect(offerings.current!.availablePackages.single.storeProduct.title,
        'Pro Monthly');
  });

  test('getOfferings caches: a second call issues no new HTTP request',
      () async {
    await configure();
    await MyAmpixPurchases.getOfferings();
    final countAfterFirst = requests.length;
    await MyAmpixPurchases.getOfferings();
    expect(requests.length, countAfterFirst);
  });

  test('purchaseStoreProduct runs the full flow and fires the update listener',
      () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws',
      storeProductId: 'com.myampix.pro_month',
      transactionId: 'tx1',
    );
    final updates = <CustomerInfo>[];
    await configure();
    MyAmpixPurchases.addCustomerInfoUpdateListener(updates.add);

    final result = await MyAmpixPurchases.purchaseStoreProduct(
        storeProduct('com.myampix.pro_month'));

    expect(result.storeTransaction!.transactionId, 'tx1');
    expect(store.finishedTransactionIds.single, 'tx1');
    expect(updates, isNotEmpty);
  });

  test('purchasePackage runs the full flow through the facade', () async {
    store.purchaseResult = const StorePurchase(
      platform: 'PLAY_STORE',
      fetchToken: 'ptok',
      storeProductId: 'com.myampix.pro_month',
      transactionId: 'GPA.1',
    );
    await configure();

    final result = await MyAmpixPurchases.purchasePackage(
        packageFor('com.myampix.pro_month'));

    expect(result.storeTransaction!.transactionId, 'GPA.1');
  });

  test('a user cancel surfaces as a thrown PurchasesError(userCancelled)',
      () async {
    store.purchaseError = PlatformException(code: 'userCancelled');
    await configure();
    await expectLater(
      MyAmpixPurchases.purchaseStoreProduct(storeProduct('sku')),
      throwsA(isA<PurchasesError>()
          .having((e) => e.userCancelled, 'userCancelled', isTrue)),
    );
  });

  test('restorePurchases replays through the store channel and refetches '
      'CustomerInfo', () async {
    store.restoreEmissions = const [
      StoreTransactionEvent(
        platform: 'APP_STORE',
        fetchToken: 'r1',
        storeProductId: 'com.myampix.pro_month',
        transactionId: 'tx_r1',
        reason: 'restore',
      ),
    ];
    final updates = <CustomerInfo>[];
    await configure();
    MyAmpixPurchases.addCustomerInfoUpdateListener(updates.add);

    final info = await MyAmpixPurchases.restorePurchases();

    expect(store.restoreCalls, 1);
    expect(info, isNotNull);
    expect(updates, isNotEmpty);
  });

  test('an out-of-band renewal on the transactions stream posts a receipt '
      'and fires the listener without any explicit call', () async {
    final updates = <CustomerInfo>[];
    await configure();
    MyAmpixPurchases.addCustomerInfoUpdateListener(updates.add);

    store.emitTransaction(const StoreTransactionEvent(
      platform: 'APP_STORE',
      fetchToken: 'renewtok',
      storeProductId: 'com.myampix.pro_month',
      transactionId: 'tx_renew',
      reason: 'renewal',
    ));
    await pumpEventQueue();
    await pumpEventQueue();

    expect(updates, isNotEmpty);
    expect(store.finishedTransactionIds, contains('tx_renew'));
  });

  test('the same app-user-id sends the same appAccountToken to native',
      () async {
    store.purchaseResult = const StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 't',
      storeProductId: 'sku',
      transactionId: 'tx1',
    );
    await configure();

    await MyAmpixPurchases.purchaseStoreProduct(storeProduct('sku'));
    await MyAmpixPurchases.purchaseStoreProduct(storeProduct('sku'));

    expect(
      store.purchaseCallArgs.map((c) => c['appAccountToken']).toSet(),
      hasLength(1),
    );
  });

  test('a throwing method before configure throws PurchasesError(configuration)',
      () async {
    await expectLater(
      MyAmpixPurchases.getOfferings(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
    await expectLater(
      MyAmpixPurchases.purchaseStoreProduct(storeProduct('sku')),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
    await expectLater(
      MyAmpixPurchases.purchasePackage(packageFor('sku')),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
    await expectLater(
      MyAmpixPurchases.restorePurchases(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('store-dependent methods surface a typed PurchasesError (never a raw '
      'throwable) when the default real StoreChannel has no live platform '
      'binding (e.g. a unit test without one)', () async {
    // No storeChannel override → configure() defaults to the real
    // MethodChannelStoreChannel; under `flutter test` its platform calls fail,
    // and the facade must map that raw failure to a typed PurchasesError, not
    // leak it.
    await MyAmpixPurchases.configure(
      PurchasesConfiguration(
          apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        httpClient: mockClient(),
        keyValueStore: keyValueStore,
        uuidFactory: () => 'anon0001',
      ),
    );
    expect(await MyAmpixPurchases.isConfigured, isTrue);

    await expectLater(
      MyAmpixPurchases.getOfferings(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.unknownError)),
    );
    await expectLater(
      MyAmpixPurchases.restorePurchases(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.unknownError)),
    );
  });

  test('configure without an injected storeChannel still leaves the SDK '
      'configured (defaults to the real channel; never throws even with no '
      'platform binding wired for it)', () async {
    await MyAmpixPurchases.configure(
      PurchasesConfiguration(
          apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        httpClient: mockClient(),
        keyValueStore: keyValueStore,
        uuidFactory: () => 'anon0001',
      ),
    );
    expect(await MyAmpixPurchases.isConfigured, isTrue);
  });
}
