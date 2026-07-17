import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/enums.dart';
import 'package:myampix_purchases/src/models/offerings.dart';
import 'package:myampix_purchases/src/models/store_product.dart';

/// The exact `GET /v1/offerings` wire body (spec §3): `{ current: ResolvedOffering }`.
Map<String, dynamic> offeringsWire() => {
      'current': {
        'identifier': 'default',
        'metadata': {'badge': 'Most popular', 'sort': 1},
        'packages': [
          {
            'identifier': r'$rc_monthly',
            'packageType': 'MONTHLY',
            'product': {
              'storeProductId': 'com.myampix.pro.monthly',
              'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
              'priceCents': 999,
              'currency': 'USD',
              'durationIso8601': 'P1M',
              'entitlements': ['premium'],
            },
          },
          {
            'identifier': r'$rc_annual',
            'packageType': 'ANNUAL',
            'product': {
              'storeProductId': 'com.myampix.pro.annual',
              'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
              'priceCents': 7999,
              'currency': 'USD',
              'durationIso8601': 'P1Y',
              'entitlements': ['premium'],
            },
          },
        ],
      },
    };

void main() {
  group('StoreProduct.fromJson', () {
    test('parses the server product object with a price/100 fallback', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      expect(p.identifier, 'com.myampix.pro.monthly');
      expect(p.productType, ProductType.autoRenewableSubscription);
      expect(p.price, 9.99);
      expect(p.currencyCode, 'USD');
      expect(p.priceString, '9.99');
      expect(p.subscriptionPeriod, 'P1M');
      expect(p.title, '');
      expect(p.description, '');
      expect(p.entitlementIdentifiers, ['premium']);
    });

    test('tolerates null server price fields', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'coins.100',
        'type': 'CONSUMABLE',
        'priceCents': null,
        'currency': null,
        'durationIso8601': null,
        'entitlements': <String>[],
      });
      expect(p.price, 0.0);
      expect(p.currencyCode, '');
      expect(p.subscriptionPeriod, isNull);
      expect(p.productType, ProductType.consumable);
    });

    test('copyWith merges native metadata over the server fallback', () {
      final base = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      final enriched = base.copyWith(
        priceString: r'$9.99',
        price: 9.99,
        currencyCode: 'USD',
        title: 'Pro Monthly',
        description: 'Full access, billed monthly',
      );
      expect(enriched.priceString, r'$9.99');
      expect(enriched.title, 'Pro Monthly');
      expect(enriched.description, 'Full access, billed monthly');
      expect(enriched.identifier, 'com.myampix.pro.monthly');
      expect(enriched.entitlementIdentifiers, ['premium']);
    });

    test('toJson emits the RevenueCat model shape', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      expect(p.toJson(), {
        'identifier': 'com.myampix.pro.monthly',
        'productType': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceString': '9.99',
        'price': 9.99,
        'currencyCode': 'USD',
        'subscriptionPeriod': 'P1M',
        'title': '',
        'description': '',
        'entitlementIdentifiers': ['premium'],
      });
    });
  });

  group('Offerings.fromJson', () {
    test('parses the current offering, packages, and derived all-map', () {
      final offerings = Offerings.fromJson(offeringsWire());
      expect(offerings.current, isNotNull);
      expect(offerings.all.keys, ['default']);
      expect(identical(offerings.all['default'], offerings.current), isTrue);

      final current = offerings.current!;
      expect(current.identifier, 'default');
      expect(current.metadata, {'badge': 'Most popular', 'sort': 1});
      expect(current.availablePackages, hasLength(2));

      final monthly = current.availablePackages.first;
      expect(monthly.identifier, r'$rc_monthly');
      expect(monthly.packageType, PackageType.monthly);
      expect(monthly.offeringIdentifier, 'default');
      expect(monthly.storeProduct.identifier, 'com.myampix.pro.monthly');
      expect(monthly.storeProduct.price, 9.99);
    });

    test('exposes typed convenience accessors filtered by packageType', () {
      final current = Offerings.fromJson(offeringsWire()).current!;
      expect(current.monthly, isNotNull);
      expect(current.monthly!.packageType, PackageType.monthly);
      expect(current.annual, isNotNull);
      expect(current.annual!.storeProduct.identifier, 'com.myampix.pro.annual');
      expect(current.weekly, isNull);
      expect(current.lifetime, isNull);
    });

    test('null current yields empty all-map and null current', () {
      final offerings = Offerings.fromJson({'current': null});
      expect(offerings.current, isNull);
      expect(offerings.all, isEmpty);
    });

    test('toJson emits the model shape (all + current)', () {
      final offerings = Offerings.fromJson(offeringsWire());
      final json = offerings.toJson();
      expect((json['all'] as Map).keys, ['default']);
      final current = json['current'] as Map<String, Object?>;
      expect(current['identifier'], 'default');
      expect(current['metadata'], {'badge': 'Most popular', 'sort': 1});
      final packages = current['packages'] as List;
      expect(packages, hasLength(2));
      expect((packages.first as Map)['packageType'], 'MONTHLY');
      final product = (packages.first as Map)['product'] as Map;
      expect(product['identifier'], 'com.myampix.pro.monthly');
      expect(product['price'], 9.99);
    });
  });
}
