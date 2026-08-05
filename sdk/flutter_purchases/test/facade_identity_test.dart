import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/fake_store_channel.dart';
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

  Future<void> configure({
    required http.Client client,
    String? appUserID,
    String Function()? uuidFactory,
  }) =>
      MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
          appUserID: appUserID,
        ),
        overrides: SdkOverrides(
          httpClient: client,
          keyValueStore: keyValueStore,
          uuidFactory: uuidFactory ?? (() => 'anon0001'),
          storeChannel: FakeStoreChannel(),
        ),
      );

  MockClient serving(String body) =>
      MockClient((request) async => http.Response(body, 200));

  test('logIn switches the id, caches, and fires the listener', () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final result = await MyAmpixPurchases.logIn('user_alice');
    expect(await MyAmpixPurchases.appUserID, 'user_alice');
    expect(await MyAmpixPurchases.isAnonymous, isFalse);
    expect(result.customerInfo.originalAppUserId, 'user_alice');
    expect(result.created, isTrue); // no prior entitlements
    expect(received, hasLength(1));
    expect(received.single.originalAppUserId, 'user_alice');
  });

  test('logIn reports created=false when the customer already has entitlements',
      () async {
    await configure(client: serving(subscriberJsonActive));
    final result = await MyAmpixPurchases.logIn('user_returning');
    expect(result.created, isFalse);
  });

  test('logOut mints a fresh anonymous id and fires the listener', () async {
    var n = 0;
    await configure(
      client: serving(subscriberJsonEmpty),
      appUserID: 'user_alice',
      uuidFactory: () => 'fresh${n++}',
    );
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final info = await MyAmpixPurchases.logOut();
    expect(await MyAmpixPurchases.isAnonymous, isTrue);
    expect(
        (await MyAmpixPurchases.appUserID).startsWith(r'$RCAnonymousID:'),
        isTrue);
    expect(info.originalAppUserId.startsWith(r'$RCAnonymousID:'), isTrue);
    expect(received, hasLength(1));
  });

  test('removeCustomerInfoUpdateListener stops delivery', () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    void listener(CustomerInfo info) => received.add(info);
    MyAmpixPurchases.addCustomerInfoUpdateListener(listener);
    MyAmpixPurchases.removeCustomerInfoUpdateListener(listener);

    await MyAmpixPurchases.logIn('user_x');
    expect(received, isEmpty);
  });

  test('a throwing listener never crashes dispatch; others still fire',
      () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(
        (_) => throw StateError('boom'));
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final result = await MyAmpixPurchases.logIn('user_y');
    expect(result.customerInfo.originalAppUserId, 'user_y');
    expect(received, hasLength(1));
  });

  test('a listener added before configure survives and fires after login',
      () async {
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);
    await configure(client: serving(subscriberJsonEmpty));
    await MyAmpixPurchases.logIn('user_z');
    expect(received, hasLength(1));
  });

  test('logIn and logOut throw configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.logIn('x'),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
    await expectLater(
      MyAmpixPurchases.logOut(),
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });
}
