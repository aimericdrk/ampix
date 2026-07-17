import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';
import 'package:myampix_purchases/src/offerings_service.dart';
import 'package:myampix_purchases/src/store/store_channel.dart';

import 'helpers/fake_store_channel.dart';
import 'helpers/purchase_fixtures.dart';

void main() {
  late FakeStoreChannel store;
  late List<http.Request> requests;

  setUp(() {
    store = FakeStoreChannel();
    requests = [];
  });
  tearDown(() => store.dispose());

  PurchasesApiClient apiWith(Map<String, dynamic> body) => PurchasesApiClient(
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(jsonEncode(body), 200,
              headers: {'content-type': 'application/json'});
        }),
        serverUrl: 'http://localhost:8080',
        apiKey: 'mp_pub_test',
      );

  OfferingsService build(PurchasesApiClient api) =>
      OfferingsService(apiClient: api, store: store);

  test(
      'enriches each StoreProduct with native price/title after asking '
      'getProducts for the collected ids', () async {
    store.productsResult = const [
      StoreProductMetadata(
        storeProductId: 'com.myampix.pro_month',
        priceString: r'$9.99',
        price: 9.99,
        currencyCode: 'USD',
        title: 'Pro Monthly',
        description: 'Everything',
        subscriptionPeriodIso8601: 'P1M',
      ),
    ];

    final offerings = await build(apiWith(offeringsWire())).getOfferings();

    expect(store.getProductsCallArgs.single, ['com.myampix.pro_month']);
    final product = offerings.current!.availablePackages.single.storeProduct;
    expect(product.identifier, 'com.myampix.pro_month');
    expect(product.priceString, r'$9.99');
    expect(product.price, 9.99);
    expect(product.title, 'Pro Monthly');
    expect(product.description, 'Everything');
    expect(product.subscriptionPeriod, 'P1M');
    // The rebuilt Offerings.all still points at the same enriched Offering.
    expect(identical(offerings.all['default'], offerings.current), isTrue);
  });

  test('when native returns nothing, StoreProduct falls back to server price',
      () async {
    store.productsResult = const []; // native unavailable

    final offerings = await build(apiWith(offeringsWire())).getOfferings();

    final product = offerings.current!.availablePackages.single.storeProduct;
    // Server fallback (StoreProduct.fromJson: priceCents 999 / currency USD).
    expect(product.currencyCode, 'USD');
    expect(product.price, 9.99);
    expect(product.title, ''); // native-only field, empty without native
  });

  test('caches after first fetch (second call issues no new HTTP nor '
      'getProducts)', () async {
    store.productsResult = const [];
    final service = build(apiWith(offeringsWire()));

    await service.getOfferings();
    await service.getOfferings();

    expect(requests, hasLength(1));
    expect(store.getProductsCalls, 1);
  });

  test('a null current yields empty offerings and never touches native',
      () async {
    final offerings = await build(apiWith({'current': null})).getOfferings();
    expect(offerings.current, isNull);
    expect(store.getProductsCalls, 0);
  });

  test('only the metadata matching a package storeProductId is applied',
      () async {
    store.productsResult = const [
      StoreProductMetadata(
        storeProductId: 'some.other.sku',
        priceString: r'$1.00',
        price: 1,
        currencyCode: 'USD',
        title: 'Unrelated',
        description: '',
      ),
    ];

    final offerings = await build(apiWith(offeringsWire())).getOfferings();

    final product = offerings.current!.availablePackages.single.storeProduct;
    expect(product.title, ''); // unmatched — untouched server fallback
    expect(product.price, 9.99);
  });
}
