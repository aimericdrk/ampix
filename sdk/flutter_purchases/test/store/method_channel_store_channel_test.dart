import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/store/method_channel_store_channel.dart';
import 'package:myampix_purchases/src/store/store_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final channel = MethodChannel(MethodChannelStoreChannel.methodsChannelName);
  late List<MethodCall> calls;
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  void handle(Future<Object?>? Function(MethodCall call) handler) =>
      messenger.setMockMethodCallHandler(channel, handler);

  setUp(() => calls = []);
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('channel names match the design §5 contract', () {
    expect(MethodChannelStoreChannel.methodsChannelName,
        'myampix_purchases/methods');
    expect(MethodChannelStoreChannel.transactionsChannelName,
        'myampix_purchases/transactions');
  });

  test('getProducts sends {productIds} and parses the returned list of maps',
      () async {
    handle((call) async {
      calls.add(call);
      return <Object?>[
        <Object?, Object?>{
          'storeProductId': 'a',
          'priceString': r'$1.00',
          'price': 1.0,
          'currencyCode': 'USD',
          'title': 'A',
          'description': 'd',
        },
      ];
    });
    final store = MethodChannelStoreChannel();

    final result = await store.getProducts(['a', 'b']);

    expect(calls.single.method, 'getProducts');
    expect(calls.single.arguments, {
      'productIds': ['a', 'b'],
    });
    expect(result, hasLength(1));
    expect(result.single.storeProductId, 'a');
    expect(result.single.priceString, r'$1.00');
  });

  test('getProducts tolerates a null native return', () async {
    handle((call) async => null);
    expect(await MethodChannelStoreChannel().getProducts(['a']), isEmpty);
  });

  test('getProducts drops entries that fail defensive parsing', () async {
    handle((call) async => <Object?>[
          <Object?, Object?>{'storeProductId': 'a'},
          'garbage',
          <Object?, Object?>{}, // no storeProductId
        ]);
    final result = await MethodChannelStoreChannel().getProducts(['a']);
    expect(result, hasLength(1));
    expect(result.single.storeProductId, 'a');
  });

  test('purchase sends {storeProductId, appAccountToken} and parses the map',
      () async {
    handle((call) async {
      calls.add(call);
      return <Object?, Object?>{
        'platform': 'APP_STORE',
        'fetchToken': 'jws',
        'storeProductId': 'a',
        'transactionId': 'tx1',
      };
    });
    final store = MethodChannelStoreChannel();

    final result =
        await store.purchase(storeProductId: 'a', appAccountToken: 'uuid-1');

    expect(calls.single.method, 'purchase');
    expect(calls.single.arguments,
        {'storeProductId': 'a', 'appAccountToken': 'uuid-1'});
    expect(result.transactionId, 'tx1');
    expect(result.platform, 'APP_STORE');
  });

  test('purchase throws a storeProblem PlatformException on a malformed '
      'native result', () async {
    handle((call) async => <Object?, Object?>{'nonsense': true});
    expect(
      () => MethodChannelStoreChannel()
          .purchase(storeProductId: 'a', appAccountToken: 'u'),
      throwsA(isA<PlatformException>()
          .having((e) => e.code, 'code', 'storeProblem')),
    );
  });

  test('purchase propagates a PlatformException (e.g. userCancelled)',
      () async {
    handle((call) async => throw PlatformException(code: 'userCancelled'));
    expect(
      () => MethodChannelStoreChannel()
          .purchase(storeProductId: 'a', appAccountToken: 'u'),
      throwsA(
          isA<PlatformException>().having((e) => e.code, 'code', 'userCancelled')),
    );
  });

  test('finishTransaction sends {transactionId}', () async {
    handle((call) async {
      calls.add(call);
      return null;
    });
    await MethodChannelStoreChannel().finishTransaction('tx1');
    expect(calls.single.method, 'finishTransaction');
    expect(calls.single.arguments, {'transactionId': 'tx1'});
  });

  test('restore sends restore; canMakePayments returns the bool (null → false)',
      () async {
    handle((call) async {
      calls.add(call);
      return call.method == 'canMakePayments' ? true : null;
    });
    final store = MethodChannelStoreChannel();
    await store.restore();
    expect(await store.canMakePayments(), isTrue);
    expect(
      calls.map((c) => c.method),
      containsAll(<String>['restore', 'canMakePayments']),
    );
  });

  test('canMakePayments defaults false when native returns null', () async {
    handle((call) async => null);
    expect(await MethodChannelStoreChannel().canMakePayments(), isFalse);
  });

  test('transactions parses event maps and drops non-maps/malformed ones',
      () async {
    final controller = StreamController<dynamic>.broadcast();
    final store = MethodChannelStoreChannel(transactionEvents: controller.stream);
    final seen = <StoreTransactionEvent>[];
    final sub = store.transactions.listen(seen.add);

    controller
      ..add(<Object?, Object?>{
        'platform': 'APP_STORE',
        'fetchToken': 'jws',
        'storeProductId': 'sku',
        'transactionId': 'tx1',
        'reason': 'renewal',
      })
      ..add('garbage')
      ..add(42)
      ..add(<Object?, Object?>{'platform': 'WEB'}); // malformed
    await pumpEventQueue();

    expect(seen, hasLength(1));
    expect(seen.single.transactionId, 'tx1');
    expect(seen.single.reason, 'renewal');
    await sub.cancel();
    await controller.close();
  });

  test(
      'transactions surfaces the restore_complete sentinel native pushes '
      'after a restore replay (final-review I-1)', () async {
    final controller = StreamController<dynamic>.broadcast();
    final store = MethodChannelStoreChannel(transactionEvents: controller.stream);
    final seen = <StoreTransactionEvent>[];
    final sub = store.transactions.listen(seen.add);

    controller
      ..add(<Object?, Object?>{
        'platform': 'APP_STORE',
        'fetchToken': 'jws',
        'storeProductId': 'sku',
        'transactionId': 'tx1',
        'reason': 'restore',
      })
      ..add(<Object?, Object?>{'reason': 'restore_complete'});
    await pumpEventQueue();

    expect(seen, hasLength(2));
    expect(seen.first.reason, 'restore');
    expect(seen.first.isRestoreComplete, isFalse);
    expect(seen.last.isRestoreComplete, isTrue);
    await sub.cancel();
    await controller.close();
  });
}
