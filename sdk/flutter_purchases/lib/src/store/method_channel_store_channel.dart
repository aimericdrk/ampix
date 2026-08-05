import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/services.dart';

import 'store_channel.dart';

/// The production [StoreChannel]: a `MethodChannel` for Dart→native
/// request/response and an `EventChannel` broadcast for native→Dart
/// transaction pushes (design §5). Holds no server URL or key — it only
/// surfaces store products and receipts. Both channels have a
/// `@visibleForTesting` injection seam so this is driven with no real
/// platform in tests (a mocked method-call handler + a fake event stream).
class MethodChannelStoreChannel implements StoreChannel {
  MethodChannelStoreChannel({
    @visibleForTesting MethodChannel? methodChannel,
    @visibleForTesting Stream<dynamic>? transactionEvents,
  })  : _methods = methodChannel ?? const MethodChannel(methodsChannelName),
        _events = transactionEvents ??
            const EventChannel(transactionsChannelName)
                .receiveBroadcastStream();

  static const String methodsChannelName = 'myampix_purchases/methods';
  static const String transactionsChannelName =
      'myampix_purchases/transactions';

  final MethodChannel _methods;
  final Stream<dynamic> _events;

  @override
  Future<List<StoreProductMetadata>> getProducts(
      List<String> productIds) async {
    final result = await _methods.invokeMethod<List<Object?>>(
      'getProducts',
      <String, Object?>{'productIds': productIds},
    );
    if (result == null) return const <StoreProductMetadata>[];
    final products = <StoreProductMetadata>[];
    for (final entry in result) {
      final metadata = StoreProductMetadata.parse(entry);
      if (metadata != null) products.add(metadata);
    }
    return products;
  }

  @override
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  }) async {
    final result = await _methods.invokeMethod<Object?>(
      'purchase',
      <String, Object?>{
        'storeProductId': storeProductId,
        'appAccountToken': appAccountToken,
      },
    );
    final purchase = StorePurchase.parse(result);
    if (purchase == null) {
      throw PlatformException(
        code: 'storeProblem',
        message: 'The store returned a malformed purchase result.',
      );
    }
    return purchase;
  }

  @override
  Future<void> finishTransaction(String transactionId) => _methods
      .invokeMethod<void>('finishTransaction', <String, Object?>{
    'transactionId': transactionId,
  });

  @override
  Future<void> restore() => _methods.invokeMethod<void>('restore');

  @override
  Future<bool> canMakePayments() async =>
      (await _methods.invokeMethod<bool>('canMakePayments')) ?? false;

  @override
  Stream<StoreTransactionEvent> get transactions => _events.expand((event) {
        final parsed = StoreTransactionEvent.parse(event);
        return parsed == null
            ? const <StoreTransactionEvent>[]
            : <StoreTransactionEvent>[parsed];
      });
}
