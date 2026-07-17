import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';

void main() {
  test('exposes all §6 error codes', () {
    expect(PurchasesErrorCode.values, containsAll(const [
      PurchasesErrorCode.purchaseCancelledError,
      PurchasesErrorCode.paymentPendingError,
      PurchasesErrorCode.productNotAvailableForPurchaseError,
      PurchasesErrorCode.invalidReceiptError,
      PurchasesErrorCode.productAlreadyPurchasedError,
      PurchasesErrorCode.networkError,
      PurchasesErrorCode.storeProblemError,
      PurchasesErrorCode.configurationError,
      PurchasesErrorCode.unknownError,
    ]));
  });

  test('is an Exception and can be thrown/caught by type', () {
    expect(
      () => throw const PurchasesError(
        PurchasesErrorCode.invalidReceiptError,
        'Receipt rejected by the store.',
      ),
      throwsA(isA<PurchasesError>().having(
        (e) => e.code,
        'code',
        PurchasesErrorCode.invalidReceiptError,
      )),
    );
  });

  test('userCancelled is true only for the cancelled code', () {
    const cancelled = PurchasesError(
      PurchasesErrorCode.purchaseCancelledError,
      'User cancelled.',
    );
    const network = PurchasesError(
      PurchasesErrorCode.networkError,
      'Offline.',
    );
    expect(cancelled.userCancelled, isTrue);
    expect(network.userCancelled, isFalse);
  });

  test('carries an optional underlying error message', () {
    const err = PurchasesError(
      PurchasesErrorCode.storeProblemError,
      'The store is unavailable.',
      underlyingErrorMessage: 'HTTP 503',
    );
    expect(err.underlyingErrorMessage, 'HTTP 503');
    expect(err.toJson(), {
      'code': 'storeProblemError',
      'message': 'The store is unavailable.',
      'underlyingErrorMessage': 'HTTP 503',
    });
  });

  test('has value equality and a readable toString', () {
    const a = PurchasesError(
      PurchasesErrorCode.configurationError,
      'Not configured.',
    );
    const b = PurchasesError(
      PurchasesErrorCode.configurationError,
      'Not configured.',
    );
    const c = PurchasesError(
      PurchasesErrorCode.networkError,
      'Not configured.',
    );
    expect(a, equals(b));
    expect(a.hashCode, b.hashCode);
    expect(a == c, isFalse);
    expect(a.toString(), 'PurchasesError(configurationError): Not configured.');
  });
}
