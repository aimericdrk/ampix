import 'enums.dart';

/// One entitlement's status (spec §3). RevenueCat parity: the `identifier` is
/// the map key of the parent [EntitlementInfos], not a JSON field. `isSandbox`
/// is a deferred field (the server does not emit it) defaulting to `false`.
/// All dates are ISO-8601 strings.
class EntitlementInfo {
  const EntitlementInfo({
    required this.identifier,
    required this.isActive,
    required this.willRenew,
    required this.periodType,
    required this.latestPurchaseDate,
    required this.originalPurchaseDate,
    required this.expirationDate,
    required this.store,
    required this.productIdentifier,
    required this.unsubscribeDetectedAt,
    required this.billingIssueDetectedAt,
    required this.ownershipType,
    this.isSandbox = false,
  });

  factory EntitlementInfo.fromJson(String identifier, Map<String, dynamic> json) =>
      EntitlementInfo(
        identifier: identifier,
        isActive: json['isActive'] as bool? ?? false,
        willRenew: json['willRenew'] as bool? ?? false,
        periodType: PeriodType.fromWire(json['periodType'] as String?),
        latestPurchaseDate: json['latestPurchaseDate'] as String,
        originalPurchaseDate: json['originalPurchaseDate'] as String,
        expirationDate: json['expirationDate'] as String?,
        store: Store.fromWire(json['store'] as String?),
        productIdentifier: json['productIdentifier'] as String,
        unsubscribeDetectedAt: json['unsubscribeDetectedAt'] as String?,
        billingIssueDetectedAt: json['billingIssueDetectedAt'] as String?,
        ownershipType: OwnershipType.fromWire(json['ownershipType'] as String?),
        isSandbox: json['isSandbox'] as bool? ?? false,
      );

  final String identifier;
  final bool isActive;
  final bool willRenew;
  final PeriodType periodType;
  final String latestPurchaseDate;
  final String originalPurchaseDate;
  final String? expirationDate;
  final Store store;
  final String productIdentifier;
  final String? unsubscribeDetectedAt;
  final String? billingIssueDetectedAt;
  final OwnershipType ownershipType;
  final bool isSandbox;

  /// The wire value shape (identifier excluded — it is the parent map key).
  Map<String, Object?> toJson() => {
        'isActive': isActive,
        'willRenew': willRenew,
        'periodType': periodType.wire,
        'latestPurchaseDate': latestPurchaseDate,
        'originalPurchaseDate': originalPurchaseDate,
        'expirationDate': expirationDate,
        'store': store.wire,
        'productIdentifier': productIdentifier,
        'unsubscribeDetectedAt': unsubscribeDetectedAt,
        'billingIssueDetectedAt': billingIssueDetectedAt,
        'ownershipType': ownershipType.wire,
        'isSandbox': isSandbox,
      };
}

/// The `active` (subset) and `all` entitlement maps (spec §3), each keyed by
/// entitlement identifier.
class EntitlementInfos {
  const EntitlementInfos({this.all = const {}, this.active = const {}});

  factory EntitlementInfos.fromJson(Map<String, dynamic> json) {
    Map<String, EntitlementInfo> parse(String key) {
      final raw = (json[key] as Map<String, dynamic>?) ?? const {};
      return {
        for (final entry in raw.entries)
          entry.key: EntitlementInfo.fromJson(
            entry.key,
            entry.value as Map<String, dynamic>,
          ),
      };
    }

    return EntitlementInfos(all: parse('all'), active: parse('active'));
  }

  final Map<String, EntitlementInfo> all;
  final Map<String, EntitlementInfo> active;

  Map<String, Object?> toJson() => {
        'all': all.map((k, v) => MapEntry(k, v.toJson())),
        'active': active.map((k, v) => MapEntry(k, v.toJson())),
      };
}
