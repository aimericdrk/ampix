/// RevenueCat-parity enums, populated from the `mobile_purchase` wire contract
/// (spec §3). Each carries the exact server `wire` string plus a defensive
/// `fromWire` that never throws (the SDK's never-crash guarantee).
library;

/// RevenueCat's `PackageType`; wire values are the server's Prisma enum.
enum PackageType {
  unknown('UNKNOWN'),
  custom('CUSTOM'),
  lifetime('LIFETIME'),
  annual('ANNUAL'),
  sixMonth('SIX_MONTH'),
  threeMonth('THREE_MONTH'),
  twoMonth('TWO_MONTH'),
  monthly('MONTHLY'),
  weekly('WEEKLY');

  const PackageType(this.wire);

  /// The server (Prisma enum) string this value serializes to.
  final String wire;

  static PackageType fromWire(String? v) => PackageType.values.firstWhere(
        (t) => t.wire == v,
        orElse: () => PackageType.unknown,
      );
}

/// RevenueCat's `ProductType`; wire values are the server's Prisma enum.
enum ProductType {
  autoRenewableSubscription('AUTO_RENEWABLE_SUBSCRIPTION'),
  nonRenewingSubscription('NON_RENEWING_SUBSCRIPTION'),
  consumable('CONSUMABLE'),
  nonConsumable('NON_CONSUMABLE');

  const ProductType(this.wire);

  final String wire;

  /// The server always emits one of the four; an unrecognized value defaults
  /// to [nonConsumable] rather than throwing (there is no RC "unknown" type).
  static ProductType fromWire(String? v) => ProductType.values.firstWhere(
        (t) => t.wire == v,
        orElse: () => ProductType.nonConsumable,
      );
}

/// RevenueCat's `PeriodType`. The server's `promo` collapses to [normal]
/// (spec §3): RC has no distinct promo period.
enum PeriodType {
  normal('normal'),
  intro('intro'),
  trial('trial');

  const PeriodType(this.wire);

  final String wire;

  static PeriodType fromWire(String? v) {
    switch (v) {
      case 'trial':
        return PeriodType.trial;
      case 'intro':
        return PeriodType.intro;
      case 'normal':
      case 'promo': // RC has no promo period — collapses to normal (spec §3).
      default:
        return PeriodType.normal;
    }
  }
}

/// RevenueCat's `Store` superset. We only ever emit [appStore]/[playStore];
/// the rest exist for RC parity so a future backend can populate them.
enum Store {
  appStore('app_store'),
  macAppStore('mac_app_store'),
  playStore('play_store'),
  stripe('stripe'),
  promotional('promotional'),
  amazon('amazon'),
  rcBilling('rc_billing'),
  external('external'),
  unknownStore('unknown_store');

  const Store(this.wire);

  final String wire;

  static Store fromWire(String? v) => Store.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => Store.unknownStore,
      );
}

/// RevenueCat's `OwnershipType`; wire values are Apple's `inAppOwnershipType`.
enum OwnershipType {
  purchased('PURCHASED'),
  familyShared('FAMILY_SHARED'),
  unknown('UNKNOWN');

  const OwnershipType(this.wire);

  final String wire;

  static OwnershipType fromWire(String? v) => OwnershipType.values.firstWhere(
        (o) => o.wire == v,
        orElse: () => OwnershipType.unknown,
      );
}
