import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases_example/demo_config.dart';

void main() {
  test('demo config is a public mp_pub_ SDK key against a normalized base URL', () {
    // The demo must use a PUBLIC SDK key (mp_pub_), never a secret server key.
    expect(demoApiKey, startsWith('mp_pub_'));
    expect(demoApiKey.length, greaterThan('mp_pub_'.length));

    // A usable http(s) base URL with no trailing slash (the SDK normalizes,
    // but the demo config is authored already-normalized).
    expect(demoServerUrl, anyOf(startsWith('http://'), startsWith('https://')));
    expect(demoServerUrl, isNot(endsWith('/')));
  });
}
