import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/in_memory_key_value_store.dart';
import 'helpers/subscriber_fixtures.dart';

void main() {
  late InMemoryKeyValueStore keyValueStore;

  setUp(() {
    keyValueStore = InMemoryKeyValueStore();
    MyAmpixPurchases.resetForTesting();
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  Future<void> configureWith(http.Client client) => MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
        ),
        overrides: SdkOverrides(
          httpClient: client,
          keyValueStore: keyValueStore,
          uuidFactory: () => 'anon0001',
        ),
      );

  test('getCustomerInfo throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.getCustomerInfo(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('getCustomerInfo fetches once then serves from cache', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.url.path, contains('/v1/subscribers/'));
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    final first = await MyAmpixPurchases.getCustomerInfo();
    expect(first.originalAppUserId, r'$RCAnonymousID:anon0001');
    expect(calls, 1);

    final second = await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 1); // served from cache — no second request
    expect(identical(first, second), isTrue);
  });

  test('invalidateCustomerInfoCache forces the next getCustomerInfo to refetch',
      () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 1);
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 2);
  });

  test('invalidateCustomerInfoCache is a no-op before configure (never throws)',
      () async {
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });

  test(
      'a raw non-PurchasesError throwable from deep in a fetch is mapped to '
      'PurchasesError(unknownError), never leaked', () async {
    // Valid JSON, 200 status, but the wrong shape for CustomerInfo:
    // `entitlements` must be a Map, so CustomerInfo.fromJson throws a raw
    // TypeError while casting it — a failure PurchasesApiClient's own
    // try/catch (which only guards jsonDecode) does not intercept.
    final client = MockClient((request) async => http.Response(
          '{"customerInfo":{"entitlements":"not-an-object"}}',
          200,
        ));
    await configureWith(client);

    await expectLater(
      MyAmpixPurchases.getCustomerInfo(),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.unknownError)),
    );
  });

  test(
      'getCustomerInfo cannot return the previous user\'s info after logIn '
      'switches identity', () async {
    final requestedIds = <String>[];
    final client = MockClient((request) async {
      requestedIds.add(request.url.pathSegments.last);
      if (request.url.path.contains('/v1/subscribers/user-b')) {
        return http.Response(subscriberJsonActive, 200);
      }
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    final a = await MyAmpixPurchases.getCustomerInfo();
    expect(a.entitlements.all, isEmpty);
    expect(a.firstSeen, '2026-07-17T10:00:00Z');

    requestedIds.clear();
    await MyAmpixPurchases.logIn('user-b');
    expect(requestedIds, ['user-b']); // logIn already refreshed the cache

    requestedIds.clear();
    final b = await MyAmpixPurchases.getCustomerInfo();
    expect(requestedIds, isEmpty); // served from cache — no extra fetch
    expect(b.entitlements.all.keys, contains('premium'));
    expect(b.firstSeen, '2026-01-01T00:00:00Z');
  });
}
