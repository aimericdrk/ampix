import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/myampix_purchases.dart';
import 'package:myampix_purchases_example/demo_config.dart';
import 'package:myampix_purchases_example/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The store product the fixtures + [FakeStoreChannel] agree on.
const String _productId = 'com.myampix.pro.monthly';

/// A minimal local fake of the SDK's public [StoreChannel] seam (design §5).
/// The SDK's own hand-rolled fake lives under its `test/` directory, which is
/// not importable from this sibling package (only `lib/` is), so this mirrors
/// it just enough to drive one buy through the real facade with no real store
/// and no platform channel involved at all.
class FakeStoreChannel implements StoreChannel {
  FakeStoreChannel({required this.productsResult, this.purchaseResult});

  final List<StoreProductMetadata> productsResult;
  final StorePurchase? purchaseResult;

  final List<String> finishedTransactionIds = [];
  final StreamController<StoreTransactionEvent> _transactions =
      StreamController<StoreTransactionEvent>.broadcast();

  @override
  Future<List<StoreProductMetadata>> getProducts(List<String> productIds) async =>
      productsResult;

  @override
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  }) async {
    final purchase = purchaseResult;
    if (purchase == null) {
      throw StateError('FakeStoreChannel.purchaseResult was not configured.');
    }
    return purchase;
  }

  @override
  Future<void> finishTransaction(String transactionId) async {
    finishedTransactionIds.add(transactionId);
  }

  @override
  Future<void> restore() async {}

  @override
  Future<bool> canMakePayments() async => true;

  @override
  Stream<StoreTransactionEvent> get transactions => _transactions.stream;

  Future<void> dispose() => _transactions.close();
}

/// A current offering with a single monthly package, shaped per the
/// `mobile_purchase` `GET /v1/offerings` contract (`{ current: ResolvedOffering
/// | null }`); enum wire values are the server's Prisma enums (UPPER_SNAKE).
Map<String, Object?> _offeringsBody() => {
      'current': {
        'identifier': 'default',
        'metadata': <String, Object?>{},
        'packages': [
          {
            'identifier': r'$rc_monthly',
            'packageType': 'MONTHLY',
            'product': {
              'storeProductId': _productId,
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

/// A subscriber with no entitlements yet, wrapped in the `{ customerInfo }`
/// envelope both `GET /v1/subscribers/:id` and `POST /v1/receipts` share.
Map<String, Object?> _emptyCustomerBody() => {
      'customerInfo': {
        'firstSeen': '2026-07-01T00:00:00Z',
        'managementURL': null,
        'subscriptions': <Object?>[],
        'entitlements': {'all': <String, Object?>{}, 'active': <String, Object?>{}},
      },
    };

/// The granted customer returned by `POST /v1/receipts` after a successful buy.
Map<String, Object?> _grantedCustomerBody() {
  final proEntitlement = {
    'isActive': true,
    'willRenew': true,
    'periodType': 'normal',
    'latestPurchaseDate': '2026-07-17T00:00:00Z',
    'originalPurchaseDate': '2026-07-17T00:00:00Z',
    'expirationDate': '2026-08-17T00:00:00Z',
    'store': 'app_store',
    'productIdentifier': _productId,
    'unsubscribeDetectedAt': null,
    'billingIssueDetectedAt': null,
    'ownershipType': 'PURCHASED',
  };
  return {
    'customerInfo': {
      'firstSeen': '2026-07-01T00:00:00Z',
      'managementURL': null,
      'subscriptions': [
        {
          'storeProductId': _productId,
          'isActive': true,
          'expirationDate': '2026-08-17T00:00:00Z',
        },
      ],
      'entitlements': {
        'all': {'pro': proEntitlement},
        'active': {'pro': proEntitlement},
      },
    },
  };
}

/// The `mobile_purchase` server, faked over HTTP: no real network is touched.
http.Client _fakeBackend() {
  return MockClient((request) async {
    final path = request.url.path;
    if (request.method == 'GET' && path.endsWith('/v1/offerings')) {
      return http.Response(jsonEncode(_offeringsBody()), 200,
          headers: {'content-type': 'application/json'});
    }
    if (request.method == 'GET' && path.contains('/v1/subscribers/')) {
      return http.Response(jsonEncode(_emptyCustomerBody()), 200,
          headers: {'content-type': 'application/json'});
    }
    if (request.method == 'POST' && path.endsWith('/v1/receipts')) {
      return http.Response(jsonEncode(_grantedCustomerBody()), 200,
          headers: {'content-type': 'application/json'});
    }
    return http.Response('{}', 404);
  });
}

/// Advances the tree by a fixed, bounded number of frames — enough to run the
/// initState loads + a tap's async round-trip (MockClient + FakeStoreChannel)
/// to completion, without depending on a perpetual animation.
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  setUp(() {
    // Make the persisted app-user-id store (shared_preferences) work under
    // test with no real platform plugin.
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  testWidgets(
    'demo shows offerings, buys a package, and shows the granted '
    'entitlement — all against fakes, no real store and no real network',
    (tester) async {
      final store = FakeStoreChannel(
        productsResult: const [
          StoreProductMetadata(
            storeProductId: _productId,
            priceString: r'$9.99',
            price: 9.99,
            currencyCode: 'USD',
            title: 'Pro Monthly',
            description: 'Monthly pro subscription',
            subscriptionPeriodIso8601: 'P1M',
          ),
        ],
        purchaseResult: const StorePurchase(
          platform: 'APP_STORE',
          fetchToken: 'fake-jws-token',
          storeProductId: _productId,
          transactionId: 'txn-1',
        ),
      );
      addTearDown(store.dispose);

      // A plain (non-runAsync) await: `SharedPreferences.setMockInitialValues`
      // swaps in a pure in-memory fake with no real platform channel, so
      // `configure` resolves via ordinary microtasks that `pump()` flushes —
      // no real Timer/platform round-trip is involved. `tester.runAsync` is
      // deliberately NOT used here: it forks a real Zone, and the store
      // channel's out-of-band subscription started inside it ends up pinned
      // outside the FakeAsync zone `pump()` controls, which deadlocks every
      // later SDK call in this test (confirmed while authoring this test).
      await MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: demoApiKey,
          serverUrl: demoServerUrl,
          logLevel: MyAmpixLogLevel.debug,
        ),
        overrides: SdkOverrides(httpClient: _fakeBackend(), storeChannel: store),
      );

      await tester.pumpWidget(const PurchasesDemoApp());
      await _settle(tester);

      // Offerings rendered (native title + native priceString from the
      // FakeStoreChannel enrichment).
      expect(find.text('Pro Monthly'), findsOneWidget);
      expect(find.text(r'$9.99'), findsOneWidget);
      // No entitlements before buying.
      expect(find.text('No active entitlements.'), findsOneWidget);

      // Buy the package.
      await tester.tap(find.widgetWithText(FilledButton, 'Buy'));
      await _settle(tester);

      // Granted 'pro' entitlement is now shown and a success snackbar fired.
      expect(find.text('No active entitlements.'), findsNothing);
      expect(find.textContaining('pro'), findsWidgets);
      expect(find.textContaining('Purchased'), findsOneWidget);
      expect(store.finishedTransactionIds, contains('txn-1'));
    },
  );
}
