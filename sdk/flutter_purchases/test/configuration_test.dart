import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/configuration.dart';

void main() {
  test('holds the supplied fields with warn as the default log level', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com',
      appUserID: 'user_bob',
    );
    expect(config.apiKey, 'mp_pub_abc');
    expect(config.serverUrl, 'https://purchases.example.com');
    expect(config.appUserID, 'user_bob');
    expect(config.logLevel, MyAmpixLogLevel.warn);
  });

  test('appUserID defaults to null and logLevel is overridable', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com',
      logLevel: MyAmpixLogLevel.debug,
    );
    expect(config.appUserID, isNull);
    expect(config.logLevel, MyAmpixLogLevel.debug);
  });

  test('normalizes a single trailing slash off serverUrl', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com/',
    );
    expect(config.serverUrl, 'https://purchases.example.com');
  });

  test('asserts on empty apiKey and empty serverUrl', () {
    expect(
      () => PurchasesConfiguration(apiKey: '', serverUrl: 'https://x.example'),
      throwsA(isA<AssertionError>()),
    );
    expect(
      () => PurchasesConfiguration(apiKey: 'mp_pub_abc', serverUrl: ''),
      throwsA(isA<AssertionError>()),
    );
  });
}
