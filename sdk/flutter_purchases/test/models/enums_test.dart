import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/enums.dart';

void main() {
  group('PackageType', () {
    test('maps every server wire value', () {
      expect(PackageType.fromWire('UNKNOWN'), PackageType.unknown);
      expect(PackageType.fromWire('CUSTOM'), PackageType.custom);
      expect(PackageType.fromWire('LIFETIME'), PackageType.lifetime);
      expect(PackageType.fromWire('ANNUAL'), PackageType.annual);
      expect(PackageType.fromWire('SIX_MONTH'), PackageType.sixMonth);
      expect(PackageType.fromWire('THREE_MONTH'), PackageType.threeMonth);
      expect(PackageType.fromWire('TWO_MONTH'), PackageType.twoMonth);
      expect(PackageType.fromWire('MONTHLY'), PackageType.monthly);
      expect(PackageType.fromWire('WEEKLY'), PackageType.weekly);
    });
    test('unrecognized and null fall back to unknown', () {
      expect(PackageType.fromWire('WHATEVER'), PackageType.unknown);
      expect(PackageType.fromWire(null), PackageType.unknown);
    });
    test('wire round-trips', () {
      for (final t in PackageType.values) {
        expect(PackageType.fromWire(t.wire), t);
      }
    });
  });

  group('ProductType', () {
    test('maps every server wire value', () {
      expect(ProductType.fromWire('AUTO_RENEWABLE_SUBSCRIPTION'),
          ProductType.autoRenewableSubscription);
      expect(ProductType.fromWire('NON_RENEWING_SUBSCRIPTION'),
          ProductType.nonRenewingSubscription);
      expect(ProductType.fromWire('CONSUMABLE'), ProductType.consumable);
      expect(ProductType.fromWire('NON_CONSUMABLE'), ProductType.nonConsumable);
    });
    test('unrecognized falls back to nonConsumable (defensive)', () {
      expect(ProductType.fromWire('???'), ProductType.nonConsumable);
      expect(ProductType.fromWire(null), ProductType.nonConsumable);
    });
    test('wire round-trips', () {
      for (final t in ProductType.values) {
        expect(ProductType.fromWire(t.wire), t);
      }
    });
  });

  group('PeriodType', () {
    test('maps server values with promo collapsing to normal', () {
      expect(PeriodType.fromWire('normal'), PeriodType.normal);
      expect(PeriodType.fromWire('intro'), PeriodType.intro);
      expect(PeriodType.fromWire('trial'), PeriodType.trial);
      expect(PeriodType.fromWire('promo'), PeriodType.normal);
    });
    test('unrecognized and null fall back to normal', () {
      expect(PeriodType.fromWire('x'), PeriodType.normal);
      expect(PeriodType.fromWire(null), PeriodType.normal);
    });
    test('wire values', () {
      expect(PeriodType.normal.wire, 'normal');
      expect(PeriodType.intro.wire, 'intro');
      expect(PeriodType.trial.wire, 'trial');
    });
  });

  group('Store', () {
    test('maps the two emitted server values', () {
      expect(Store.fromWire('app_store'), Store.appStore);
      expect(Store.fromWire('play_store'), Store.playStore);
    });
    test('unrecognized and null fall back to unknownStore', () {
      expect(Store.fromWire('web'), Store.unknownStore);
      expect(Store.fromWire(null), Store.unknownStore);
    });
    test('wire round-trips across the RC superset', () {
      for (final s in Store.values) {
        expect(Store.fromWire(s.wire), s);
      }
    });
  });

  group('OwnershipType', () {
    test('maps server values', () {
      expect(OwnershipType.fromWire('PURCHASED'), OwnershipType.purchased);
      expect(OwnershipType.fromWire('FAMILY_SHARED'), OwnershipType.familyShared);
    });
    test('unrecognized and null fall back to unknown', () {
      expect(OwnershipType.fromWire('OTHER'), OwnershipType.unknown);
      expect(OwnershipType.fromWire(null), OwnershipType.unknown);
    });
    test('wire round-trips', () {
      for (final o in OwnershipType.values) {
        expect(OwnershipType.fromWire(o.wire), o);
      }
    });
  });
}
