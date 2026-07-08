import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/myampix_analytics.dart';
import 'package:myampix_analytics/src/autocapture/purchase_autocapture.dart';
import 'package:myampix_analytics/src/model/event.dart';
import 'package:myampix_analytics/src/storage/database.dart';
import 'package:myampix_analytics/src/storage/event_store.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_key_value_store.dart';

class _Emitted {
  _Emitted(this.event, this.properties);
  final String event;
  final Map<String, Object?> properties;
}

/// Shape of the map the native plugin code (iOS StoreKit observer / Android
/// Play Billing `PurchasesUpdatedListener`) forwards over the
/// `myampix_analytics/purchases` channel.
Map<String, Object?> _nativePayload({
  Object? productId = 'com.myampix.pro_month',
  Object? price = 9.99,
  Object? currency = 'USD',
  Object? quantity = 1,
  Object? transactionId = 'tx_1000000123456789',
  Object? store = 'app_store',
}) => {
  'productId': productId,
  'price': price,
  'currency': currency,
  'quantity': quantity,
  'transactionId': transactionId,
  'store': store,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('PurchaseAutocapture (direct, injected stream/track)', () {
    late StreamController<dynamic> controller;
    late List<_Emitted> emitted;
    late PurchaseAutocapture autocapture;

    setUp(() {
      controller = StreamController<dynamic>.broadcast();
      emitted = [];
      autocapture = PurchaseAutocapture(
        purchaseStream: controller.stream,
        track: (event, properties) => emitted.add(_Emitted(event, properties)),
      );
      autocapture.start();
    });

    tearDown(() async {
      await autocapture.stop();
      await controller.close();
    });

    test(r'a native app_store payload emits $in_app_purchase with the §4 '
        r'properties mapped and $purchase_source "native"', () async {
      controller.add(_nativePayload());
      await pumpEventQueue();

      expect(emitted, hasLength(1));
      final event = emitted.single;
      expect(event.event, r'$in_app_purchase');
      expect(event.properties[r'$product_id'], 'com.myampix.pro_month');
      expect(event.properties[r'$price'], 9.99);
      expect(event.properties[r'$currency'], 'USD');
      expect(event.properties[r'$quantity'], 1);
      expect(event.properties[r'$transaction_id'], 'tx_1000000123456789');
      expect(event.properties[r'$store'], 'app_store');
      expect(event.properties[r'$purchase_source'], 'native');
    });

    test(
      r'a native play_store payload maps through to $store "play_store"',
      () async {
        controller.add(
          _nativePayload(
            productId: 'sku_pro_month',
            transactionId: 'GPA.1234-5678-9012-34567',
            store: 'play_store',
          ),
        );
        await pumpEventQueue();

        expect(emitted, hasLength(1));
        expect(emitted.single.properties[r'$store'], 'play_store');
        expect(
          emitted.single.properties[r'$transaction_id'],
          'GPA.1234-5678-9012-34567',
        );
      },
    );

    test(
      'missing price/currency map to null and missing quantity defaults to '
      '1 (native best-effort price lookup can legitimately come back empty)',
      () async {
        controller.add({
          'productId': 'sku_x',
          'transactionId': 'tx_x',
          'store': 'app_store',
        });
        await pumpEventQueue();

        expect(emitted, hasLength(1));
        final properties = emitted.single.properties;
        expect(properties[r'$price'], isNull);
        expect(properties[r'$currency'], isNull);
        expect(properties[r'$quantity'], 1);
      },
    );

    test('price/quantity sent as strings by native code are coerced', () async {
      controller.add({
        'productId': 'sku_x',
        'price': '4.99',
        'quantity': '2',
        'transactionId': 'tx_x',
        'store': 'app_store',
      });
      await pumpEventQueue();

      final properties = emitted.single.properties;
      expect(properties[r'$price'], 4.99);
      expect(properties[r'$quantity'], 2);
    });

    test('malformed native payloads never throw and emit nothing', () async {
      controller
        ..add('not a map')
        ..add(<String, Object?>{}) // missing everything
        ..add({'productId': '', 'transactionId': 'tx', 'store': 'app_store'})
        ..add({'productId': 'sku', 'transactionId': '', 'store': 'app_store'})
        ..add({'productId': 'sku', 'transactionId': 'tx', 'store': 'nope'})
        ..add({'productId': 'sku', 'transactionId': 'tx', 'store': null})
        ..add({'productId': null, 'transactionId': 'tx', 'store': 'app_store'})
        ..add(42)
        ..add(null);
      await pumpEventQueue();

      expect(emitted, isEmpty);
    });

    test('start() is idempotent and stop() is safe to call twice', () async {
      autocapture.start(); // second call must be a no-op (no double-listen)
      controller.add(_nativePayload());
      await pumpEventQueue();
      expect(emitted, hasLength(1));

      await autocapture.stop();
      await autocapture.stop(); // must not throw
    });

    test('a channel-level stream error never throws', () async {
      controller.addError(StateError('platform channel boom'));
      await pumpEventQueue();
      expect(emitted, isEmpty); // observing, no crash
    });
  });

  group('PurchaseAutocapture wired through the real facade', () {
    late FakeClock clock;
    late InMemoryKeyValueStore keyValueStore;
    late AnalyticsDatabase database;
    late DriftEventStore store;
    late StreamController<dynamic> purchaseController;

    setUp(() {
      clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
      keyValueStore = InMemoryKeyValueStore();
      database = AnalyticsDatabase(NativeDatabase.memory());
      store = DriftEventStore(database);
      purchaseController = StreamController<dynamic>.broadcast();
    });

    tearDown(() async {
      await MyAmpix.shutdownForTesting();
      await purchaseController.close();
    });

    Future<void> initSdk({required bool autocapturePurchases}) => MyAmpix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: MyAmpixConfig(
        serverUrl: 'http://localhost:8080',
        autocapturePurchases: autocapturePurchases,
      ),
      overrides: SdkOverrides(
        clock: clock,
        database: database,
        keyValueStore: keyValueStore,
        contextDataSource: FakeContextDataSource(),
        random: FixedRandom(0.5),
        purchaseStream: purchaseController.stream,
      ),
    );

    // Asserts against the injected local queue directly, exactly like
    // myampix_observer_test.dart's facade-wired group: no real network
    // flush to wait on, just the in-memory drift store after the facade's
    // guard chain has drained.
    Future<List<AnalyticsEvent>> queuedEvents() async => [
      for (final row in await store.oldest(1000)) row.event,
    ];

    test(r'autocapturePurchases: true delivers a full-context $in_app_purchase '
        'to the local queue via MyAmpix.instance.track', () async {
      await initSdk(autocapturePurchases: true);
      purchaseController.add(_nativePayload());
      await pumpEventQueue();

      final events = await queuedEvents();
      final purchase = events.firstWhere((e) => e.event == r'$in_app_purchase');
      expect(purchase.properties[r'$product_id'], 'com.myampix.pro_month');
      expect(purchase.properties[r'$price'], 9.99);
      expect(purchase.properties[r'$currency'], 'USD');
      expect(purchase.properties[r'$quantity'], 1);
      expect(purchase.properties[r'$transaction_id'], 'tx_1000000123456789');
      expect(purchase.properties[r'$store'], 'app_store');
      expect(purchase.properties[r'$purchase_source'], 'native');
      expect(purchase.distinctId, isNotEmpty);
      expect(purchase.sessionId, isNotEmpty);
      expect(purchase.context.sdkVersion, '0.1.0');
    });

    test(
      r'autocapturePurchases: false suppresses $in_app_purchase entirely',
      () async {
        await initSdk(autocapturePurchases: false);
        purchaseController.add(_nativePayload());
        await pumpEventQueue();

        final events = await queuedEvents();
        // The pipeline is alive (session-lifecycle events reached the
        // queue), yet no $in_app_purchase made it through.
        expect(events.any((e) => e.event == r'$app_open'), isTrue);
        expect(events.where((e) => e.event == r'$in_app_purchase'), isEmpty);
      },
    );

    test(r'opted-out $in_app_purchase is dropped by the pipeline', () async {
      await initSdk(autocapturePurchases: true);
      MyAmpix.instance.optOutTracking();
      purchaseController.add(_nativePayload());
      await pumpEventQueue();

      MyAmpix.instance.optInTracking();
      MyAmpix.instance.track('after_opt_in');
      await pumpEventQueue();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'after_opt_in'), isTrue);
      expect(events.where((e) => e.event == r'$in_app_purchase'), isEmpty);
    });

    test(
      r'native $in_app_purchase is distinct from a manually-tracked '
      r'purchase: automatic events are $-prefixed, manual ones are not',
      () async {
        await initSdk(autocapturePurchases: true);
        MyAmpix.instance.track('purchase', properties: {'value': 9.99});
        purchaseController.add(_nativePayload());
        await pumpEventQueue();

        final events = await queuedEvents();
        final manual = events.firstWhere((e) => e.event == 'purchase');
        final native = events.firstWhere((e) => e.event == r'$in_app_purchase');

        expect(manual.event.startsWith(r'$'), isFalse);
        expect(native.event.startsWith(r'$'), isTrue);
        expect(manual.event, isNot(native.event));
        expect(native.properties[r'$purchase_source'], 'native');
        expect(manual.properties.containsKey(r'$purchase_source'), isFalse);
        expect(manual.properties['value'], 9.99);
      },
    );

    test('a malformed native payload through the real facade never throws and '
        'is dropped, while an unrelated track() still goes through', () async {
      await initSdk(autocapturePurchases: true);
      purchaseController.add({'unexpected': 'shape'});
      MyAmpix.instance.track('after_malformed');
      await pumpEventQueue();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'after_malformed'), isTrue);
      expect(events.where((e) => e.event == r'$in_app_purchase'), isEmpty);
    });
  });
}
