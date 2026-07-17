import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/fake_store_channel.dart';
import 'helpers/in_memory_key_value_store.dart';

void main() {
  late InMemoryKeyValueStore keyValueStore;

  MockClient neverCalled() => MockClient(
      (request) async => fail('unexpected HTTP request to ${request.url}'));

  setUp(() {
    keyValueStore = InMemoryKeyValueStore();
    MyAmpixPurchases.resetForTesting();
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  Future<void> configure({
    String? appUserID,
    http.Client? client,
    FakeStoreChannel? storeChannel,
    String Function()? uuidFactory,
  }) =>
      MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
          appUserID: appUserID,
        ),
        overrides: SdkOverrides(
          httpClient: client ?? neverCalled(),
          keyValueStore: keyValueStore,
          uuidFactory: uuidFactory ?? (() => 'anon0001'),
          // Default to a fake so configure() never wires the real
          // MethodChannelStoreChannel (no platform binding under `flutter test`).
          storeChannel: storeChannel ?? FakeStoreChannel(),
        ),
      );

  test('isConfigured is false before configure', () async {
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });

  test('appUserID throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.appUserID,
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('isAnonymous throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.isAnonymous,
      throwsA(isA<PurchasesError>().having(
          (e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('configure mints an anonymous app-user-id', () async {
    await configure();
    expect(await MyAmpixPurchases.isConfigured, isTrue);
    expect(await MyAmpixPurchases.appUserID, r'$RCAnonymousID:anon0001');
    expect(await MyAmpixPurchases.isAnonymous, isTrue);
  });

  test('configure adopts an explicit app-user-id', () async {
    await configure(appUserID: 'user_bob');
    expect(await MyAmpixPurchases.appUserID, 'user_bob');
    expect(await MyAmpixPurchases.isAnonymous, isFalse);
  });

  test('configure never touches an injected store channel on the read path',
      () async {
    final channel = FakeStoreChannel();
    await configure(storeChannel: channel);
    await MyAmpixPurchases.appUserID;
    await MyAmpixPurchases.isAnonymous;
    expect(channel.getProductsCalls, 0);
    expect(channel.purchaseCalls, 0);
    expect(channel.canMakePaymentsCalls, 0);
    await channel.dispose();
  });

  test('setLogLevel takes effect immediately, even before configure (M-1)',
      () async {
    final messages = <String>[];
    final original = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) messages.add(message);
    };
    addTearDown(() => debugPrint = original);

    // Default level (warn) suppresses this debug-level internal log.
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    expect(messages, isEmpty);

    // Never throws pre-configure, and takes effect for the very next log.
    MyAmpixPurchases.setLogLevel(MyAmpixLogLevel.debug);
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    expect(messages, isNotEmpty);
  });

  test('a failed configure leaves the SDK unconfigured (never throws)',
      () async {
    // A throwing key-value store must degrade to "not configured", not throw.
    await MyAmpixPurchases.configure(
      PurchasesConfiguration(
          apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        httpClient: neverCalled(),
        keyValueStore: _ThrowingKeyValueStore(),
        uuidFactory: () => 'anon0001',
      ),
    );
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });
}

class _ThrowingKeyValueStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => throw StateError('boom');
  @override
  Future<void> setString(String key, String value) async =>
      throw StateError('boom');
  @override
  Future<void> remove(String key) async => throw StateError('boom');
}
