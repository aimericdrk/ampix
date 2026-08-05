import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/entitlement_info.dart';
import 'package:myampix_purchases/src/models/enums.dart';

/// The exact inner `customerInfo` object of the `GET /v1/subscribers/:id` and
/// `POST /v1/receipts` envelope (spec §3). Two active entitlements (different
/// expirations) + one active and one inactive subscription.
Map<String, dynamic> customerInfoWire() => {
      'entitlements': {
        'active': {
          'premium': {
            'isActive': true,
            'willRenew': true,
            'periodType': 'normal',
            'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
            'expirationDate': '2026-07-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.pro.monthly',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'PURCHASED',
          },
          'pro': {
            'isActive': true,
            'willRenew': false,
            'periodType': 'trial',
            'latestPurchaseDate': '2026-06-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-06-01T00:00:00.000Z',
            'expirationDate': '2026-09-01T00:00:00.000Z',
            'store': 'play_store',
            'productIdentifier': 'com.myampix.pro.annual',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'FAMILY_SHARED',
          },
        },
        'all': {
          'premium': {
            'isActive': true,
            'willRenew': true,
            'periodType': 'normal',
            'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
            'expirationDate': '2026-07-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.pro.monthly',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'PURCHASED',
          },
          'pro': {
            'isActive': true,
            'willRenew': false,
            'periodType': 'trial',
            'latestPurchaseDate': '2026-06-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-06-01T00:00:00.000Z',
            'expirationDate': '2026-09-01T00:00:00.000Z',
            'store': 'play_store',
            'productIdentifier': 'com.myampix.pro.annual',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'FAMILY_SHARED',
          },
          'legacy': {
            'isActive': false,
            'willRenew': false,
            'periodType': 'normal',
            'latestPurchaseDate': '2024-01-01T00:00:00.000Z',
            'originalPurchaseDate': '2024-01-01T00:00:00.000Z',
            'expirationDate': '2025-01-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.legacy',
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
          'expirationDate': '2026-07-01T00:00:00.000Z',
          'periodType': 'normal',
        },
        {
          'storeProductId': 'com.myampix.legacy',
          'store': 'app_store',
          'isActive': false,
          'willRenew': false,
          'expirationDate': '2025-01-01T00:00:00.000Z',
          'periodType': 'normal',
        },
      ],
      'firstSeen': '2026-01-01T00:00:00.000Z',
      'lastSeen': '2026-07-16T00:00:00.000Z',
      'managementURL': 'https://apps.apple.com/account/subscriptions',
    };

void main() {
  group('EntitlementInfo.fromJson', () {
    test('takes the identifier from the map key and maps every field', () {
      final wire = customerInfoWire();
      final active =
          (wire['entitlements'] as Map)['active'] as Map<String, dynamic>;
      final e = EntitlementInfo.fromJson(
          'premium', active['premium'] as Map<String, dynamic>);
      expect(e.identifier, 'premium');
      expect(e.isActive, isTrue);
      expect(e.willRenew, isTrue);
      expect(e.periodType, PeriodType.normal);
      expect(e.latestPurchaseDate, '2026-05-01T00:00:00.000Z');
      expect(e.originalPurchaseDate, '2026-05-01T00:00:00.000Z');
      expect(e.expirationDate, '2026-07-01T00:00:00.000Z');
      expect(e.store, Store.appStore);
      expect(e.productIdentifier, 'com.myampix.pro.monthly');
      expect(e.unsubscribeDetectedAt, isNull);
      expect(e.billingIssueDetectedAt, isNull);
      expect(e.ownershipType, OwnershipType.purchased);
      expect(e.isSandbox, isFalse);
    });

    test('collapses server promo periodType to normal', () {
      final e = EntitlementInfo.fromJson('promoEnt', {
        'isActive': true,
        'willRenew': true,
        'periodType': 'promo',
        'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
        'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
        'expirationDate': null,
        'store': 'play_store',
        'productIdentifier': 'com.myampix.promo',
        'unsubscribeDetectedAt': null,
        'billingIssueDetectedAt': null,
        'ownershipType': 'PURCHASED',
      });
      expect(e.periodType, PeriodType.normal);
      expect(e.store, Store.playStore);
      expect(e.expirationDate, isNull);
    });

    test('toJson emits the wire value shape (no identifier)', () {
      final wire = customerInfoWire();
      final active =
          (wire['entitlements'] as Map)['active'] as Map<String, dynamic>;
      final e = EntitlementInfo.fromJson(
          'premium', active['premium'] as Map<String, dynamic>);
      expect(e.toJson(), {
        'isActive': true,
        'willRenew': true,
        'periodType': 'normal',
        'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
        'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
        'expirationDate': '2026-07-01T00:00:00.000Z',
        'store': 'app_store',
        'productIdentifier': 'com.myampix.pro.monthly',
        'unsubscribeDetectedAt': null,
        'billingIssueDetectedAt': null,
        'ownershipType': 'PURCHASED',
        'isSandbox': false,
      });
    });
  });

  group('EntitlementInfos', () {
    test('parses active + all keyed by identifier', () {
      final infos = EntitlementInfos.fromJson(
          (customerInfoWire()['entitlements']) as Map<String, dynamic>);
      expect(infos.active.keys.toSet(), {'premium', 'pro'});
      expect(infos.all.keys.toSet(), {'premium', 'pro', 'legacy'});
      expect(infos.active['pro']!.ownershipType, OwnershipType.familyShared);
      expect(infos.all['legacy']!.isActive, isFalse);
    });

    test('round-trips through toJson/fromJson', () {
      final infos = EntitlementInfos.fromJson(
          (customerInfoWire()['entitlements']) as Map<String, dynamic>);
      final round = EntitlementInfos.fromJson(
        jsonDecode(jsonEncode(infos.toJson())) as Map<String, dynamic>,
      );
      expect(round.toJson(), infos.toJson());
      expect(round.active['premium']!.identifier, 'premium');
    });

    test('defaults to empty maps when active/all are missing', () {
      const infos = EntitlementInfos();
      expect(infos.active, isEmpty);
      expect(infos.all, isEmpty);
      final parsed = EntitlementInfos.fromJson(const {});
      expect(parsed.active, isEmpty);
      expect(parsed.all, isEmpty);
    });
  });

  group('CustomerInfo.fromJson', () {
    test('derives activeSubscriptions, latestExpirationDate, and injects ids', () {
      final info = CustomerInfo.fromJson(
        customerInfoWire(),
        originalAppUserId: r'$RCAnonymousID:abc123',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      expect(info.entitlements.active.keys.toSet(), {'premium', 'pro'});
      // Only isActive subscriptions contribute their storeProductId.
      expect(info.activeSubscriptions, ['com.myampix.pro.monthly']);
      // Max expirationDate across ACTIVE entitlements (pro > premium).
      expect(info.latestExpirationDate, '2026-09-01T00:00:00.000Z');
      expect(info.firstSeen, '2026-01-01T00:00:00.000Z');
      expect(info.originalAppUserId, r'$RCAnonymousID:abc123');
      expect(info.managementURL, 'https://apps.apple.com/account/subscriptions');
      expect(info.requestDate, '2026-07-17T10:00:00.000Z');
    });

    test('empty customer yields empty entitlements and null derivations', () {
      final info = CustomerInfo.fromJson(
        {
          'entitlements': {'active': <String, dynamic>{}, 'all': <String, dynamic>{}},
          'subscriptions': <dynamic>[],
          'firstSeen': '2026-07-17T00:00:00.000Z',
          'lastSeen': '2026-07-17T00:00:00.000Z',
        },
        originalAppUserId: r'$RCAnonymousID:new',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      expect(info.entitlements.active, isEmpty);
      expect(info.activeSubscriptions, isEmpty);
      expect(info.latestExpirationDate, isNull);
      expect(info.managementURL, isNull);
    });

    test('toJson emits the RevenueCat CustomerInfo shape', () {
      final info = CustomerInfo.fromJson(
        customerInfoWire(),
        originalAppUserId: r'$RCAnonymousID:abc123',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      final json = info.toJson();
      expect(json['activeSubscriptions'], ['com.myampix.pro.monthly']);
      expect(json['firstSeen'], '2026-01-01T00:00:00.000Z');
      expect(json['latestExpirationDate'], '2026-09-01T00:00:00.000Z');
      expect(json['originalAppUserId'], r'$RCAnonymousID:abc123');
      expect(json['managementURL'], 'https://apps.apple.com/account/subscriptions');
      expect(json['requestDate'], '2026-07-17T10:00:00.000Z');
      expect((json['entitlements'] as Map).containsKey('active'), isTrue);
    });
  });
}
