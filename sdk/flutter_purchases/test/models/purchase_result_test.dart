import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/login_result.dart';
import 'package:myampix_purchases/src/models/purchase_result.dart';

CustomerInfo sampleCustomerInfo() => CustomerInfo.fromJson(
      {
        'entitlements': {
          'active': {
            'premium': {
              'isActive': true,
              'willRenew': true,
              'periodType': 'normal',
              'latestPurchaseDate': '2026-07-17T09:00:00.000Z',
              'originalPurchaseDate': '2026-07-17T09:00:00.000Z',
              'expirationDate': '2026-08-17T09:00:00.000Z',
              'store': 'app_store',
              'productIdentifier': 'com.myampix.pro.monthly',
              'unsubscribeDetectedAt': null,
              'billingIssueDetectedAt': null,
              'ownershipType': 'PURCHASED',
            },
          },
          'all': {
            'premium': {
              'isActive': true,
              'willRenew': true,
              'periodType': 'normal',
              'latestPurchaseDate': '2026-07-17T09:00:00.000Z',
              'originalPurchaseDate': '2026-07-17T09:00:00.000Z',
              'expirationDate': '2026-08-17T09:00:00.000Z',
              'store': 'app_store',
              'productIdentifier': 'com.myampix.pro.monthly',
              'unsubscribeDetectedAt': null,
              'billingIssueDetectedAt': null,
              'ownershipType': 'PURCHASED',
            },
          },
        },
        'subscriptions': [
          {
            'storeProductId': 'com.myampix.pro.monthly',
            'store': 'app_store',
            'isActive': true,
            'willRenew': true,
            'expirationDate': '2026-08-17T09:00:00.000Z',
            'periodType': 'normal',
          },
        ],
        'firstSeen': '2026-07-17T09:00:00.000Z',
        'lastSeen': '2026-07-17T09:00:00.000Z',
      },
      originalAppUserId: r'$RCAnonymousID:buyer',
      requestDate: '2026-07-17T09:00:01.000Z',
    );

void main() {
  group('StoreTransaction', () {
    test('parses the native purchase result map', () {
      final txn = StoreTransaction.fromJson({
        'platform': 'APP_STORE',
        'fetchToken': 'jws.header.payload',
        'storeProductId': 'com.myampix.pro.monthly',
        'transactionId': '2000000123456789',
      });
      expect(txn.transactionId, '2000000123456789');
      expect(txn.productId, 'com.myampix.pro.monthly');
      expect(txn.toJson(), {
        'transactionId': '2000000123456789',
        'productId': 'com.myampix.pro.monthly',
      });
    });
  });

  group('PurchaseResult', () {
    test('carries the customerInfo and store transaction', () {
      final result = PurchaseResult(
        customerInfo: sampleCustomerInfo(),
        storeTransaction: const StoreTransaction(
          transactionId: '2000000123456789',
          productId: 'com.myampix.pro.monthly',
        ),
      );
      expect(result.customerInfo.activeSubscriptions,
          ['com.myampix.pro.monthly']);
      expect(result.storeTransaction!.transactionId, '2000000123456789');
      final json = result.toJson();
      expect((json['customerInfo'] as Map)['activeSubscriptions'],
          ['com.myampix.pro.monthly']);
      expect((json['storeTransaction'] as Map)['productId'],
          'com.myampix.pro.monthly');
    });

    test('tolerates a null store transaction (restore / out-of-band)', () {
      final result = PurchaseResult(
        customerInfo: sampleCustomerInfo(),
        storeTransaction: null,
      );
      expect(result.storeTransaction, isNull);
      expect(result.toJson()['storeTransaction'], isNull);
    });
  });

  group('LogInResult', () {
    test('carries customerInfo and the created flag', () {
      final created = LogInResult(
        customerInfo: sampleCustomerInfo(),
        created: true,
      );
      expect(created.created, isTrue);
      expect(created.toJson()['created'], true);

      final existing = LogInResult(
        customerInfo: sampleCustomerInfo(),
        created: false,
      );
      expect(existing.created, isFalse);
      expect((existing.toJson()['customerInfo'] as Map)['originalAppUserId'],
          r'$RCAnonymousID:buyer');
    });
  });
}
