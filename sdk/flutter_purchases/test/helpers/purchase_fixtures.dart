import 'package:myampix_purchases/myampix_purchases.dart';

/// The exact `GET /v1/offerings` wire body (spec §3): a single current
/// offering with one monthly package. Shared by [OfferingsService],
/// [PurchaseController], and facade purchase tests.
Map<String, dynamic> offeringsWire() => {
      'current': {
        'identifier': 'default',
        'metadata': {'hero': 'blue'},
        'packages': [
          {
            'identifier': r'$rc_monthly',
            'packageType': 'MONTHLY',
            'product': {
              'storeProductId': 'com.myampix.pro_month',
              'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
              'priceCents': 999,
              'currency': 'USD',
              'durationIso8601': 'P1M',
              'entitlements': ['pro'],
            },
          },
        ],
      },
    };

/// A minimal RFC-7807 body for a given status (the API client maps by
/// status, not by body).
Map<String, dynamic> rfc7807(int status) => {
      'type': 'about:blank',
      'title': 'error',
      'status': status,
    };

Map<String, dynamic> _entitlement() => {
      'isActive': true,
      'willRenew': true,
      'periodType': 'normal',
      'latestPurchaseDate': '2026-07-16T10:00:00Z',
      'originalPurchaseDate': '2026-07-16T10:00:00Z',
      'expirationDate': '2026-08-16T10:00:00Z',
      'store': 'app_store',
      'productIdentifier': 'com.myampix.pro_month',
      'ownershipType': 'PURCHASED',
    };

/// The exact §3 CustomerInfo JSON (also the `{customerInfo}` wrapped body of
/// `POST /v1/receipts` / `GET /v1/subscribers/:id`). Satisfies
/// `CustomerInfo.fromJson`'s inner `customerInfo` object shape.
Map<String, dynamic> customerInfoJson() => {
      'entitlements': {
        'all': {'pro': _entitlement()},
        'active': {'pro': _entitlement()},
      },
      'subscriptions': [
        {
          'storeProductId': 'com.myampix.pro_month',
          'isActive': true,
          'expirationDate': '2026-08-16T10:00:00Z',
        },
      ],
      'firstSeen': '2026-07-01T00:00:00Z',
      'managementURL': 'https://apps.apple.com/account/subscriptions',
    };

/// A StoreProduct with the given id (only `.identifier` matters to the
/// purchase path). Built from the server product JSON shape.
StoreProduct storeProduct(String id) => StoreProduct.fromJson({
      'storeProductId': id,
      'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
      'priceCents': 999,
      'currency': 'USD',
      'durationIso8601': 'P1M',
      'entitlements': ['pro'],
    });

/// A Package wrapping [storeProduct] for the given id.
Package packageFor(String id) => Package.fromJson(
      {
        'identifier': r'$rc_monthly',
        'packageType': 'MONTHLY',
        'product': {
          'storeProductId': id,
          'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
          'priceCents': 999,
          'currency': 'USD',
          'durationIso8601': 'P1M',
          'entitlements': ['pro'],
        },
      },
      offeringIdentifier: 'default',
    );
