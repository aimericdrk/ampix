import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/attribution/attribution_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  group('utmFromUri', () {
    test('parses every whitelisted utm_* param from a deep link', () {
      final utm = utmFromUri(
        Uri.parse(
          'https://app.example.com/promo'
          '?utm_source=meta&utm_medium=cpc&utm_campaign=summer'
          '&utm_content=hero&utm_term=running+shoes',
        ),
      );
      expect(utm, {
        'utm_source': 'meta',
        'utm_medium': 'cpc',
        'utm_campaign': 'summer',
        'utm_content': 'hero',
        'utm_term': 'running shoes',
      });
    });

    test('keeps only present, non-empty utm_* and ignores everything else', () {
      final utm = utmFromUri(
        Uri.parse(
          'myapp://open?utm_source=tiktok&utm_medium=&gclid=abc123&ref=friend',
        ),
      );
      expect(utm, {'utm_source': 'tiktok'});
    });

    test('a link with no utm_* yields an empty map', () {
      expect(utmFromUri(Uri.parse('https://app.example.com/home')), isEmpty);
    });

    test('malformed / odd URIs never throw', () {
      expect(utmFromUri(Uri.parse('')), isEmpty);
      // Invalid percent-encoding (%FF is not valid UTF-8) makes
      // Uri.queryParameters throw when it lazily decodes — utmFromUri must
      // swallow it.
      expect(
        utmFromUri(Uri.parse('https://x.example/?utm_source=%FF')),
        isEmpty,
      );
      // Opaque (query-less) URIs must not throw either.
      expect(utmFromUri(Uri.parse('mailto:x@y.z')), isEmpty);
    });
  });

  group('utmFromReferrer', () {
    test('parses the Play install-referrer query string', () {
      final utm = utmFromReferrer(
        'utm_source=google-play&utm_medium=organic&utm_campaign=launch',
      );
      expect(utm, {
        'utm_source': 'google-play',
        'utm_medium': 'organic',
        'utm_campaign': 'launch',
      });
    });

    test(
      'an empty / non-utm referrer yields an empty map and never throws',
      () {
        expect(utmFromReferrer(''), isEmpty);
        expect(utmFromReferrer('not_utm=1&foo=bar'), isEmpty);
      },
    );
  });

  group('AttributionStore', () {
    late InMemoryKeyValueStore kv;
    late AttributionStore store;

    setUp(() async {
      kv = InMemoryKeyValueStore();
      store = AttributionStore(kv);
      await store.load();
    });

    test('record() from an empty utm map is a no-op returning false', () async {
      expect(await store.record(const {}), isFalse);
      expect(store.utmSource, isNull);
      expect(store.firstUtmSource, isNull);
    });

    test('a first touch sets both first_utm_* and utm_*', () async {
      expect(
        await store.record({'utm_source': 'meta', 'utm_campaign': 'spring'}),
        isTrue,
      );
      expect(store.utmSource, 'meta');
      expect(store.utmCampaign, 'spring');
      expect(store.firstUtmSource, 'meta');
      expect(store.firstUtmCampaign, 'spring');
    });

    test('last touch overwrites utm_* but first touch is write-once', () async {
      await store.record({'utm_source': 'meta', 'utm_campaign': 'spring'});
      await store.record({
        'utm_source': 'tiktok',
        'utm_medium': 'cpc',
        'utm_campaign': 'summer',
      });

      // Last touch = most recent.
      expect(store.utmSource, 'tiktok');
      expect(store.utmMedium, 'cpc');
      expect(store.utmCampaign, 'summer');
      // First touch = never overwritten.
      expect(store.firstUtmSource, 'meta');
      expect(store.firstUtmCampaign, 'spring');
    });

    test(
      'a newer touch replaces the WHOLE last-touch set (no stale keys)',
      () async {
        await store.record({
          'utm_source': 'meta',
          'utm_medium': 'cpc',
          'utm_term': 'shoes',
        });
        await store.record({'utm_source': 'email'});
        expect(store.utmSource, 'email');
        expect(store.utmMedium, isNull); // dropped with the previous touch
        expect(store.utmTerm, isNull);
      },
    );

    test(
      'both touches persist and round-trip through a reopened store',
      () async {
        await store.record({'utm_source': 'meta', 'utm_campaign': 'spring'});
        await store.record({'utm_source': 'tiktok', 'utm_campaign': 'summer'});

        final reopened = AttributionStore(kv);
        await reopened.load();

        expect(reopened.utmSource, 'tiktok');
        expect(reopened.utmCampaign, 'summer');
        expect(reopened.firstUtmSource, 'meta');
        expect(reopened.firstUtmCampaign, 'spring');
      },
    );

    test(
      'corrupt persisted attribution degrades to no touch, never throws',
      () async {
        kv.values[AttributionStore.firstTouchKey] = 'not-json{{{';
        kv.values[AttributionStore.lastTouchKey] = '[1,2,3]';

        final corrupt = AttributionStore(kv);
        await corrupt.load();

        expect(corrupt.utmSource, isNull);
        expect(corrupt.firstUtmSource, isNull);
        // Still usable after a corrupt load.
        expect(await corrupt.record({'utm_source': 'x'}), isTrue);
        expect(corrupt.utmSource, 'x');
      },
    );
  });
}
