import 'entitlement_info.dart';

/// The RevenueCat `CustomerInfo` (spec §3), assembled from the inner
/// `customerInfo` object of `GET /v1/subscribers/:id` / `POST /v1/receipts`.
/// `activeSubscriptions` and `latestExpirationDate` are derived; the caller
/// injects `originalAppUserId` (the id used for the request) and `requestDate`
/// (client fetch stamp). All dates are ISO-8601 strings.
class CustomerInfo {
  const CustomerInfo({
    required this.entitlements,
    required this.activeSubscriptions,
    required this.firstSeen,
    required this.latestExpirationDate,
    required this.originalAppUserId,
    required this.managementURL,
    required this.requestDate,
  });

  factory CustomerInfo.fromJson(
    Map<String, dynamic> json, {
    required String originalAppUserId,
    required String requestDate,
  }) {
    final entitlements = EntitlementInfos.fromJson(
      (json['entitlements'] as Map<String, dynamic>?) ?? const {},
    );

    final subscriptions =
        (json['subscriptions'] as List<dynamic>?) ?? const <dynamic>[];
    final activeSubscriptions = <String>[
      for (final sub in subscriptions.cast<Map<String, dynamic>>())
        if (sub['isActive'] == true) sub['storeProductId'] as String,
    ];

    // Max expiration across ACTIVE entitlements. ISO-8601 UTC strings from the
    // server share a fixed format, so lexical compare == chronological compare.
    String? latest;
    for (final e in entitlements.active.values) {
      final exp = e.expirationDate;
      if (exp != null && (latest == null || exp.compareTo(latest) > 0)) {
        latest = exp;
      }
    }

    return CustomerInfo(
      entitlements: entitlements,
      activeSubscriptions: activeSubscriptions,
      firstSeen: json['firstSeen'] as String,
      latestExpirationDate: latest,
      originalAppUserId: originalAppUserId,
      managementURL: json['managementURL'] as String?,
      requestDate: requestDate,
    );
  }

  final EntitlementInfos entitlements;
  final List<String> activeSubscriptions;
  final String firstSeen;
  final String? latestExpirationDate;
  final String originalAppUserId;
  final String? managementURL;
  final String requestDate;

  Map<String, Object?> toJson() => {
        'entitlements': entitlements.toJson(),
        'activeSubscriptions': activeSubscriptions,
        'firstSeen': firstSeen,
        'latestExpirationDate': latestExpirationDate,
        'originalAppUserId': originalAppUserId,
        'managementURL': managementURL,
        'requestDate': requestDate,
      };
}
