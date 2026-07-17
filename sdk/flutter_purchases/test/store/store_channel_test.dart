import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/store/store_channel.dart';

import '../helpers/fake_store_channel.dart';

void main() {
  test('carrier types hold their fields', () {
    const meta = StoreProductMetadata(
      storeProductId: 'premium_monthly',
      priceString: r'$9.99',
      price: 9.99,
      currencyCode: 'USD',
      title: 'Premium',
      description: 'Premium monthly',
      subscriptionPeriodIso8601: 'P1M',
    );
    expect(meta.storeProductId, 'premium_monthly');
    expect(meta.price, 9.99);
    expect(meta.subscriptionPeriodIso8601, 'P1M');

    const purchase = StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws-token',
      storeProductId: 'premium_monthly',
    );
    expect(purchase.platform, 'APP_STORE');
    expect(purchase.transactionId, isNull);

    const txn = StoreTransactionEvent(
      platform: 'PLAY_STORE',
      fetchToken: 'purchase-token',
      storeProductId: 'premium_monthly',
      transactionId: 'gpa.123',
      reason: 'renewal',
    );
    expect(txn.reason, 'renewal');
  });

  test('FakeStoreChannel conforms to StoreChannel and records calls', () async {
    final channel = FakeStoreChannel();
    final StoreChannel typed = channel;

    expect(await typed.canMakePayments(), isTrue);
    final purchase =
        await typed.purchase(storeProductId: 'p', appAccountToken: 'token');
    expect(purchase.storeProductId, 'p');
    expect(purchase.platform, 'APP_STORE');
    await typed.finishTransaction('tx1');
    await typed.restore();
    expect(await typed.getProducts(const ['p']), isEmpty);

    expect(channel.canMakePaymentsCalls, 1);
    expect(channel.purchaseCalls, 1);
    expect(channel.finishCalls, 1);
    expect(channel.restoreCalls, 1);
    expect(channel.getProductsCalls, 1);
  });

  test('FakeStoreChannel broadcasts emitted transactions', () async {
    final channel = FakeStoreChannel();
    final received = <StoreTransactionEvent>[];
    final sub = channel.transactions.listen(received.add);
    channel.emitTransaction(
      const StoreTransactionEvent(
        platform: 'APP_STORE',
        fetchToken: 'jws',
        storeProductId: 'p',
        transactionId: 'tx',
        reason: 'purchase',
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(received, hasLength(1));
    expect(received.single.reason, 'purchase');
    await sub.cancel();
    await channel.dispose();
  });
}
