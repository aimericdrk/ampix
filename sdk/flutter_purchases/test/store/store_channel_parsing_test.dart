import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/store/store_channel.dart';

/// Defensive parsing of the native platform-channel payloads (design §5)
/// into [StoreProductMetadata]/[StorePurchase]/[StoreTransactionEvent]. Ships
/// in P3.4 alongside the concrete [MethodChannelStoreChannel] that calls
/// these; P3.3 only defined the field shapes.
void main() {
  group('StoreProductMetadata.parse', () {
    test('parses a full native getProducts entry (platform-channel Map)', () {
      final m = StoreProductMetadata.parse(<Object?, Object?>{
        'storeProductId': 'com.myampix.pro_month',
        'priceString': r'$9.99',
        'price': 9.99,
        'currencyCode': 'USD',
        'title': 'Pro Monthly',
        'description': 'All the things',
        'subscriptionPeriodIso8601': 'P1M',
      });
      expect(m, isNotNull);
      expect(m!.storeProductId, 'com.myampix.pro_month');
      expect(m.priceString, r'$9.99');
      expect(m.price, 9.99);
      expect(m.currencyCode, 'USD');
      expect(m.title, 'Pro Monthly');
      expect(m.description, 'All the things');
      expect(m.subscriptionPeriodIso8601, 'P1M');
    });

    test('missing optional fields default (empty strings, null period, 0 price)',
        () {
      final m = StoreProductMetadata.parse(
          <Object?, Object?>{'storeProductId': 'sku_x'});
      expect(m, isNotNull);
      expect(m!.priceString, '');
      expect(m.price, 0);
      expect(m.currencyCode, '');
      expect(m.title, '');
      expect(m.description, '');
      expect(m.subscriptionPeriodIso8601, isNull);
    });

    test('int price is coerced to double', () {
      final m = StoreProductMetadata.parse(
          <Object?, Object?>{'storeProductId': 'sku_x', 'price': 5});
      expect(m!.price, 5.0);
    });

    test('malformed payloads return null and never throw', () {
      expect(StoreProductMetadata.parse(null), isNull);
      expect(StoreProductMetadata.parse('not a map'), isNull);
      expect(StoreProductMetadata.parse(<Object?, Object?>{}), isNull);
      expect(
          StoreProductMetadata.parse(<Object?, Object?>{'storeProductId': ''}),
          isNull);
      expect(
          StoreProductMetadata.parse(
              <Object?, Object?>{'storeProductId': 42}),
          isNull);
    });
  });

  group('StorePurchase.parse', () {
    test('parses a direct purchase result with a transactionId', () {
      final p = StorePurchase.parse(<Object?, Object?>{
        'platform': 'APP_STORE',
        'fetchToken': 'jws.header.payload',
        'storeProductId': 'com.myampix.pro_month',
        'transactionId': '2000000123456789',
      });
      expect(p, isNotNull);
      expect(p!.platform, 'APP_STORE');
      expect(p.fetchToken, 'jws.header.payload');
      expect(p.storeProductId, 'com.myampix.pro_month');
      expect(p.transactionId, '2000000123456789');
    });

    test('a missing/empty transactionId parses to null (nullable field)', () {
      final p = StorePurchase.parse(<Object?, Object?>{
        'platform': 'PLAY_STORE',
        'fetchToken': 'ptok',
        'storeProductId': 'sku',
      });
      expect(p, isNotNull);
      expect(p!.transactionId, isNull);

      final p2 = StorePurchase.parse(<Object?, Object?>{
        'platform': 'PLAY_STORE',
        'fetchToken': 'ptok',
        'storeProductId': 'sku',
        'transactionId': '',
      });
      expect(p2!.transactionId, isNull);
    });

    test('malformed payloads return null and never throw', () {
      expect(StorePurchase.parse(null), isNull);
      expect(StorePurchase.parse('nope'), isNull);
      expect(StorePurchase.parse(<Object?, Object?>{}), isNull);
      expect(
        StorePurchase.parse(<Object?, Object?>{
          'platform': 'WEB',
          'fetchToken': 't',
          'storeProductId': 's',
        }),
        isNull,
      );
      expect(
        StorePurchase.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': '',
          'storeProductId': 's',
        }),
        isNull,
      );
      expect(
        StorePurchase.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': 't',
          'storeProductId': '',
        }),
        isNull,
      );
    });
  });

  group('StoreTransactionEvent.parse', () {
    test('parses an out-of-band renewal / restore reason', () {
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'PLAY_STORE',
          'fetchToken': 'ptok',
          'storeProductId': 'sku',
          'transactionId': 'GPA.1',
          'reason': 'renewal',
        })!
            .reason,
        'renewal',
      );
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'PLAY_STORE',
          'fetchToken': 'ptok',
          'storeProductId': 'sku',
          'transactionId': 'GPA.2',
          'reason': 'restore',
        })!
            .reason,
        'restore',
      );
    });

    test('absent/unknown reason falls back to purchase', () {
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': 't',
          'storeProductId': 's',
          'transactionId': 'x',
        })!
            .reason,
        'purchase',
      );
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': 't',
          'storeProductId': 's',
          'transactionId': 'x',
          'reason': 'lol',
        })!
            .reason,
        'purchase',
      );
    });

    test('malformed payloads return null and never throw', () {
      expect(StoreTransactionEvent.parse(null), isNull);
      expect(StoreTransactionEvent.parse('nope'), isNull);
      expect(StoreTransactionEvent.parse(<Object?, Object?>{}), isNull);
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'WEB',
          'fetchToken': 't',
          'storeProductId': 's',
          'transactionId': 'x',
        }),
        isNull,
      );
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': '',
          'storeProductId': 's',
          'transactionId': 'x',
        }),
        isNull,
      );
      expect(
        StoreTransactionEvent.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': 't',
          'storeProductId': 's',
        }),
        isNull,
      );
    });

    test(
        'the restore_complete sentinel parses even with none of the other '
        'fields present (final-review I-1)', () {
      final event = StoreTransactionEvent.parse(
          <Object?, Object?>{'reason': 'restore_complete'});
      expect(event, isNotNull);
      expect(event!.isRestoreComplete, isTrue);
      expect(event.reason, StoreTransactionEvent.restoreCompleteReason);

      expect(
        const StoreTransactionEvent.restoreComplete().isRestoreComplete,
        isTrue,
      );
      expect(
        const StoreTransactionEvent(
          platform: 'APP_STORE',
          fetchToken: 't',
          storeProductId: 's',
          transactionId: 'x',
          reason: 'restore',
        ).isRestoreComplete,
        isFalse,
      );
    });
  });
}
