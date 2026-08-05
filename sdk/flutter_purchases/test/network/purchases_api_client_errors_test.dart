import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';

void main() {
  PurchasesApiClient build(MockClient client) => PurchasesApiClient(
        client: client,
        serverUrl: 'https://api.myampix.test',
        apiKey: 'mp_pub_test123',
        nowIso8601: () => '2026-07-17T09:00:00.000Z',
      );

  MockClient problem(int status) => MockClient(
        (request) async => http.Response(
          '{"type":"about:blank","title":"error","detail":"boom","status":$status}',
          status,
          headers: {'content-type': 'application/problem+json'},
        ),
      );

  final mappings = <int, PurchasesErrorCode>{
    401: PurchasesErrorCode.configurationError,
    402: PurchasesErrorCode.invalidReceiptError,
    409: PurchasesErrorCode.productAlreadyPurchasedError,
    503: PurchasesErrorCode.storeProblemError,
    500: PurchasesErrorCode.unknownError,
  };

  mappings.forEach((status, expected) {
    test('maps HTTP $status → $expected carrying the RFC-7807 detail', () async {
      await expectLater(
        build(problem(status)).postReceipt(
          appUserId: 'user_42',
          platform: 'APP_STORE',
          fetchToken: 'jws-token',
        ),
        throwsA(
          isA<PurchasesError>()
              .having((e) => e.code, 'code', expected)
              .having(
                (e) => e.underlyingErrorMessage,
                'underlyingErrorMessage',
                'boom',
              ),
        ),
      );
    });
  });

  test('maps a transport failure (offline) → networkError', () async {
    final client = MockClient(
      (request) async => throw const SocketException('offline'),
    );
    await expectLater(
      build(client).getOfferings(),
      throwsA(
        isA<PurchasesError>()
            .having((e) => e.code, 'code', PurchasesErrorCode.networkError),
      ),
    );
  });

  test('401 on getSubscriber also maps to configurationError', () async {
    await expectLater(
      build(problem(401)).getSubscriber('user_42'),
      throwsA(
        isA<PurchasesError>().having(
          (e) => e.code,
          'code',
          PurchasesErrorCode.configurationError,
        ),
      ),
    );
  });

  test(
      'a 200 with a non-JSON body surfaces as a typed PurchasesError '
      '(not a raw FormatException)', () async {
    final client = MockClient(
      (request) async => http.Response('not json', 200),
    );
    await expectLater(
      build(client).getOfferings(),
      throwsA(
        isA<PurchasesError>()
            .having((e) => e.code, 'code', PurchasesErrorCode.unknownError),
      ),
    );
  });

  test(
      'a 200 with a JSON body that is not an object surfaces as a typed '
      'PurchasesError (not a raw TypeError)', () async {
    final client = MockClient(
      (request) async => http.Response('[]', 200),
    );
    await expectLater(
      build(client).getOfferings(),
      throwsA(
        isA<PurchasesError>()
            .having((e) => e.code, 'code', PurchasesErrorCode.unknownError),
      ),
    );
  });
}
