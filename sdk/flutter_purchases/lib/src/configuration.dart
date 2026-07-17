/// Verbosity of the SDK's internal debug-only logging (design §7). Mirrors
/// RevenueCat's `LogLevel`. Entries below the configured level are dropped
/// before ever reaching `debugPrint` — the level never affects control flow.
enum MyAmpixLogLevel { verbose, debug, info, warn, error }

/// Immutable configuration passed to [MyAmpixPurchases.configure] (design §7).
///
/// Mirrors RevenueCat's `PurchasesConfiguration` object shape (not the
/// analytics SDK's positional-token `init`). [serverUrl] is the mobile_purchase
/// base URL with any single trailing slash normalized off so the API client can
/// join paths unconditionally.
class PurchasesConfiguration {
  PurchasesConfiguration({
    required this.apiKey,
    required String serverUrl,
    this.appUserID,
    this.logLevel = MyAmpixLogLevel.warn,
  })  : assert(apiKey.isNotEmpty, 'apiKey must not be empty'),
        assert(serverUrl.isNotEmpty, 'serverUrl must not be empty'),
        serverUrl = serverUrl.endsWith('/')
            ? serverUrl.substring(0, serverUrl.length - 1)
            : serverUrl;

  /// The `mp_pub_` public SDK key (required).
  final String apiKey;

  /// mobile_purchase base URL, trailing slash normalized (required).
  final String serverUrl;

  /// Explicit app-user-id; `null` → anonymous `$RCAnonymousID:`.
  final String? appUserID;

  /// Verbosity of the SDK's internal, debug-only logging. Defaults to warn.
  final MyAmpixLogLevel logLevel;
}
