import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/model/event.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  late FakeClock clock;
  late InMemoryKeyValueStore keyValueStore;
  late AnalyticsDatabase database;
  late DriftEventStore store;
  late StreamController<dynamic> attributionController;

  setUp(() {
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    keyValueStore = InMemoryKeyValueStore();
    database = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftEventStore(database);
    attributionController = StreamController<dynamic>.broadcast();
  });

  tearDown(() async {
    await MyAmpMix.shutdownForTesting();
    await attributionController.close();
  });

  Future<void> initSdk({bool autocaptureAttribution = true}) => MyAmpMix.init(
    'mam_0123456789abcdef0123456789abcdef',
    config: MyAmpMixConfig(
      serverUrl: 'http://localhost:8080',
      // Screen/tap capturers are pure-Dart observers; disabling them keeps
      // the queue focused on lifecycle + attribution events. Purchase is
      // disabled so no unrelated real channel is opened.
      autocapturePurchases: false,
      autocaptureAttribution: autocaptureAttribution,
    ),
    overrides: SdkOverrides(
      clock: clock,
      database: database,
      keyValueStore: keyValueStore,
      contextDataSource: FakeContextDataSource(),
      random: FixedRandom(0.5),
      attributionStream: attributionController.stream,
    ),
  );

  Future<List<AnalyticsEvent>> queuedEvents() async => [
    for (final row in await store.oldest(1000)) row.event,
  ];

  Future<AnalyticsEvent> firstWhereName(String name) async =>
      (await queuedEvents()).firstWhere((e) => e.event == name);

  group('trackDeepLink', () {
    test(r'a utm link records a touch and emits $campaign_touch with the '
        r'parsed $utm_* props and $attribution_source "deep_link"', () async {
      await initSdk();
      MyAmpMix.instance.trackDeepLink(
        Uri.parse(
          'https://app.example.com/promo'
          '?utm_source=meta&utm_medium=cpc&utm_campaign=summer'
          '&utm_content=hero&utm_term=shoes',
        ),
      );
      await pumpEventQueue();

      final touch = await firstWhereName(r'$campaign_touch');
      expect(touch.event.startsWith(r'$'), isTrue); // reserved/automatic
      expect(touch.properties[r'$utm_source'], 'meta');
      expect(touch.properties[r'$utm_medium'], 'cpc');
      expect(touch.properties[r'$utm_campaign'], 'summer');
      expect(touch.properties[r'$utm_content'], 'hero');
      expect(touch.properties[r'$utm_term'], 'shoes');
      expect(touch.properties[r'$attribution_source'], 'deep_link');
    });

    test('only the present utm_* params become properties', () async {
      await initSdk();
      MyAmpMix.instance.trackDeepLink(
        Uri.parse('myapp://open?utm_source=tiktok&utm_campaign=fall'),
      );
      await pumpEventQueue();

      final touch = await firstWhereName(r'$campaign_touch');
      expect(touch.properties[r'$utm_source'], 'tiktok');
      expect(touch.properties[r'$utm_campaign'], 'fall');
      expect(touch.properties.containsKey(r'$utm_medium'), isFalse);
      expect(touch.properties.containsKey(r'$utm_content'), isFalse);
      expect(touch.properties.containsKey(r'$utm_term'), isFalse);
    });

    test('a link with no utm_* records nothing and emits nothing', () async {
      await initSdk();
      MyAmpMix.instance.trackDeepLink(
        Uri.parse('https://app.example.com/home'),
      );
      MyAmpMix.instance.track('after_bare_link');
      await pumpEventQueue();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'after_bare_link'), isTrue);
      expect(events.where((e) => e.event == r'$campaign_touch'), isEmpty);
      // No touch => no utm on the later event's context.
      final after = events.firstWhere((e) => e.event == 'after_bare_link');
      expect(after.context.utmSource, isNull);
    });

    test('a malformed URI never throws and emits nothing', () async {
      await initSdk();
      // A Uri whose query carries invalid percent-encoding (%FF is not valid
      // UTF-8): .queryParameters throws when decoded, so trackDeepLink must
      // swallow it (design §13).
      expect(
        () => MyAmpMix.instance.trackDeepLink(
          Uri.parse('https://app.example.com/?utm_source=%FF'),
        ),
        returnsNormally,
      );
      MyAmpMix.instance.track('after_malformed_link');
      await pumpEventQueue();

      final events = await queuedEvents();
      expect(events.any((e) => e.event == 'after_malformed_link'), isTrue);
      expect(events.where((e) => e.event == r'$campaign_touch'), isEmpty);
    });

    test(
      'after a touch, a subsequently tracked event carries utm_*/first_utm_* '
      'in its context',
      () async {
        await initSdk();
        MyAmpMix.instance.trackDeepLink(
          Uri.parse('myapp://o?utm_source=meta&utm_campaign=spring'),
        );
        await pumpEventQueue();
        MyAmpMix.instance.track('purchase_started');
        await pumpEventQueue();

        final event = await firstWhereName('purchase_started');
        expect(event.context.utmSource, 'meta');
        expect(event.context.utmCampaign, 'spring');
        expect(event.context.firstUtmSource, 'meta');
        expect(event.context.firstUtmCampaign, 'spring');
      },
    );

    test(
      'last touch overwrites context utm_* while first_utm_* stays put',
      () async {
        await initSdk();
        MyAmpMix.instance.trackDeepLink(
          Uri.parse('myapp://o?utm_source=meta&utm_campaign=spring'),
        );
        MyAmpMix.instance.trackDeepLink(
          Uri.parse('myapp://o?utm_source=tiktok&utm_campaign=summer'),
        );
        await pumpEventQueue();
        MyAmpMix.instance.track('checkout');
        await pumpEventQueue();

        final event = await firstWhereName('checkout');
        expect(event.context.utmSource, 'tiktok'); // last touch
        expect(event.context.utmCampaign, 'summer');
        expect(event.context.firstUtmSource, 'meta'); // write-once
        expect(event.context.firstUtmCampaign, 'spring');
      },
    );

    test(
      'trackDeepLink works even when autocaptureAttribution is false',
      () async {
        await initSdk(autocaptureAttribution: false);
        MyAmpMix.instance.trackDeepLink(
          Uri.parse('myapp://o?utm_source=email&utm_campaign=newsletter'),
        );
        await pumpEventQueue();

        final touch = await firstWhereName(r'$campaign_touch');
        expect(touch.properties[r'$utm_source'], 'email');
        expect(touch.properties[r'$attribution_source'], 'deep_link');
      },
    );
  });

  group('install-referrer autocapture (injected native stream)', () {
    test(
      r'a native install referrer emits $campaign_touch with '
      r'$attribution_source "install_referrer" and attaches to context',
      () async {
        await initSdk();
        attributionController.add(
          'utm_source=google-play&utm_medium=organic&utm_campaign=launch',
        );
        await pumpEventQueue();

        final touch = await firstWhereName(r'$campaign_touch');
        expect(touch.properties[r'$utm_source'], 'google-play');
        expect(touch.properties[r'$utm_medium'], 'organic');
        expect(touch.properties[r'$utm_campaign'], 'launch');
        expect(touch.properties[r'$attribution_source'], 'install_referrer');
        // The referrer is the FIRST touch => also lands as first_utm_*.
        expect(touch.context.firstUtmSource, 'google-play');
      },
    );

    test('autocaptureAttribution: false suppresses install-referrer capture '
        'while the pipeline stays alive', () async {
      await initSdk(autocaptureAttribution: false);
      attributionController.add('utm_source=google-play&utm_campaign=x');
      await pumpEventQueue();

      final events = await queuedEvents();
      // Pipeline alive (lifecycle events reached the queue)...
      expect(events.any((e) => e.event == r'$app_open'), isTrue);
      // ...but the native referrer was never subscribed to.
      expect(events.where((e) => e.event == r'$campaign_touch'), isEmpty);
    });

    test(
      'a malformed native referrer payload never throws and is dropped',
      () async {
        await initSdk();
        attributionController.add(<String, Object?>{'unexpected': 'shape'});
        MyAmpMix.instance.track('after_bad_referrer');
        await pumpEventQueue();

        final events = await queuedEvents();
        expect(events.any((e) => e.event == 'after_bad_referrer'), isTrue);
        expect(events.where((e) => e.event == r'$campaign_touch'), isEmpty);
      },
    );
  });
}
