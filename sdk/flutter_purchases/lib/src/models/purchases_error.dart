/// RevenueCat-parity error codes (spec §6), thrown only by the throwing public
/// methods (`getOfferings`, `getCustomerInfo`, `purchasePackage`,
/// `restorePurchases`, `logIn`).
enum PurchasesErrorCode {
  purchaseCancelledError,
  paymentPendingError,
  productNotAvailableForPurchaseError,
  invalidReceiptError,
  productAlreadyPurchasedError,
  networkError,
  storeProblemError,
  configurationError,
  unknownError,
}

/// The typed error surfaced by the throwing facade methods (spec §6). Internal
/// machinery never throws this into non-throwing paths (the never-crash
/// guarantee) — it is mapped from store `PlatformException` codes and the
/// server's RFC-7807 responses by the P3.2 network layer.
class PurchasesError implements Exception {
  const PurchasesError(
    this.code,
    this.message, {
    this.underlyingErrorMessage,
  });

  final PurchasesErrorCode code;
  final String message;
  final String? underlyingErrorMessage;

  /// True only for [PurchasesErrorCode.purchaseCancelledError] — the RC
  /// convention for "the user cancelled" (spec §6).
  bool get userCancelled => code == PurchasesErrorCode.purchaseCancelledError;

  Map<String, Object?> toJson() => {
        'code': code.name,
        'message': message,
        'underlyingErrorMessage': underlyingErrorMessage,
      };

  @override
  bool operator ==(Object other) =>
      other is PurchasesError &&
      other.code == code &&
      other.message == message &&
      other.underlyingErrorMessage == underlyingErrorMessage;

  @override
  int get hashCode => Object.hash(code, message, underlyingErrorMessage);

  @override
  String toString() => 'PurchasesError(${code.name}): $message';
}
