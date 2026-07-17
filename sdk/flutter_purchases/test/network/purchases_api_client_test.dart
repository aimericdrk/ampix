import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';

const _offeringsBody = '''
{
  "current": {
    "identifier": "default",
    "metadata": {"headline": "Go Pro"},
    "packages": [
      {
        "identifier": "\$rc_monthly",
        "packageType": "monthly",
        "product": {
          "storeProductId": "com.myampix.pro.monthly",
          "type": "autoRenewableSubscription",
          "priceCents": 999,
          "currency": "USD",
          "durationIso8601": "P1M",
          "entitlements": ["pro"]
        }
      }
    ]
  }
}
''';

const _entitlement = '''
{
  "isActive": true,
  "willRenew": true,
  "periodType": "normal",
  "latestPurchaseDate": "2026-07-01T00:00:00.000Z",
  "originalPurchaseDate": "2026-06-01T00:00:00.000Z",
  "expirationDate": "2026-08-01T00:00:00.000Z",
  "store": "app_store",
  "productIdentifier": "com.myampix.pro.monthly",
  "unsubscribeDetectedAt": null,
  "billingIssueDetectedAt": null,
  "ownershipType": "PURCHASED"
}
''';

final _subscriberBody = '''
{
  "customerInfo": {
    "entitlements": {"active": {"pro": $_entitlement}, "all": {"pro": $_entitlement}},
    "subscriptions": [
      {
        "storeProductId": "com.myampix.pro.monthly",
        "store": "app_store",
        "isActive": true,
        "willRenew": true,
        "expirationDate": "2026-08-01T00:00:00.000Z",
        "periodType": "normal"
      }
    ],
    "firstSeen": "2026-06-01T00:00:00.000Z",
    "lastSeen": "2026-07-10T00:00:00.000Z"
  }
}
''';

const _receiptBody = '''
{
  "customerInfo": {
    "entitlements": {"active": {}, "all": {}},
    "subscriptions": [],
    "firstSeen": "2026-06-01T00:00:00.000Z",
    "lastSeen": "2026-06-01T00:00:00.000Z"
  }
}
''';

void main() {
  late List<http.Request> requests;

  setUp(() => requests = []);

  PurchasesApiClient build(
    MockClient client, {
    String serverUrl = 'https://api.myampix.test',
  }) =>
      PurchasesApiClient(
        client: client,
        serverUrl: serverUrl,
        apiKey: 'mp_pub_test123',
        nowIso8601: () => '2026-07-17T09:00:00.000Z',
      );

  MockClient responder(String body) => MockClient((request) async {
        requests.add(request);
        return http.Response(
          body,
          200,
          headers: {'content-type': 'application/json'},
        );
      });

  test('getOfferings GETs /v1/offerings with the Bearer key and parses current',
      () async {
    final offerings = await build(responder(_offeringsBody)).getOfferings();

    expect(requests.single.method, 'GET');
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/offerings',
    );
    expect(requests.single.headers['Authorization'], 'Bearer mp_pub_test123');
    expect(offerings.current?.identifier, 'default');
    expect(offerings.all.keys, contains('default'));
  });

  test('getOfferings maps {"current": null} to an empty Offerings', () async {
    final offerings =
        await build(responder('{"current": null}')).getOfferings();
    expect(offerings.current, isNull);
    expect(offerings.all, isEmpty);
  });

  test(
      'getSubscriber URL-encodes the id and injects originalAppUserId + '
      'requestDate', () async {
    final info = await build(responder(_subscriberBody))
        .getSubscriber(r'$RCAnonymousID:abc123');

    expect(requests.single.method, 'GET');
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/subscribers/%24RCAnonymousID%3Aabc123',
    );
    expect(info.originalAppUserId, r'$RCAnonymousID:abc123');
    expect(info.requestDate, '2026-07-17T09:00:00.000Z');
    expect(info.firstSeen, '2026-06-01T00:00:00.000Z');
    expect(info.entitlements.active.keys, contains('pro'));
    expect(info.activeSubscriptions, contains('com.myampix.pro.monthly'));
  });

  test(
      'postReceipt POSTs the snake_case receipt body and omits product_id '
      'when null', () async {
    final info = await build(responder(_receiptBody)).postReceipt(
      appUserId: 'user_42',
      platform: 'APP_STORE',
      fetchToken: 'jws-token',
    );

    final request = requests.single;
    expect(request.method, 'POST');
    expect(request.url.toString(), 'https://api.myampix.test/v1/receipts');
    expect(request.headers['Authorization'], 'Bearer mp_pub_test123');
    expect(request.headers['Content-Type'], contains('application/json'));
    expect(jsonDecode(request.body), {
      'app_user_id': 'user_42',
      'platform': 'APP_STORE',
      'fetch_token': 'jws-token',
    });
    expect(info.originalAppUserId, 'user_42');
    expect(info.entitlements.active, isEmpty);
  });

  test('postReceipt includes product_id when provided', () async {
    await build(responder(_receiptBody)).postReceipt(
      appUserId: 'user_42',
      platform: 'PLAY_STORE',
      fetchToken: 'purchase-token',
      productId: 'com.myampix.pro.monthly',
    );

    expect(jsonDecode(requests.single.body), {
      'app_user_id': 'user_42',
      'platform': 'PLAY_STORE',
      'fetch_token': 'purchase-token',
      'product_id': 'com.myampix.pro.monthly',
    });
  });

  test('strips a trailing slash from serverUrl (no //v1)', () async {
    await build(
      responder(_offeringsBody),
      serverUrl: 'https://api.myampix.test/',
    ).getOfferings();
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/offerings',
    );
  });
}
