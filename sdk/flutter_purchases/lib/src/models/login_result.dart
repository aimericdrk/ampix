import 'customer_info.dart';

/// The result of `logIn` (spec §3/§4): the refreshed [CustomerInfo] and whether
/// the identified customer was new. `created` is a client-side approximation
/// (the fetched customer had no prior activity) until server-side identity
/// aliasing (roadmap P5) exists — a documented divergence from RevenueCat.
class LogInResult {
  const LogInResult({
    required this.customerInfo,
    required this.created,
  });

  final CustomerInfo customerInfo;
  final bool created;

  Map<String, Object?> toJson() => {
        'customerInfo': customerInfo.toJson(),
        'created': created,
      };
}
