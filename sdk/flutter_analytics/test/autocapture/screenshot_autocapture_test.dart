import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/autocapture/screenshot_autocapture.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/key_value_store.dart';
import 'package:myampmix_analytics/src/util/logger.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_key_value_store.dart';

/// Fake [ScreenshotCapturer] (the `SdkOverrides.screenshotCapturer` seam):
/// returns canned JPEG bytes so the capture→hash→throttle→upload mapping is
/// exercised with no real rendering (shared-contracts §18 verification).
class FakeScreenshotCapturer implements ScreenshotCapturer {
  FakeScreenshotCapturer({this.result, this.throwError = false});

  CapturedScreenshot? result;
  bool throwError;
  int captureCount = 0;

  @override
  Future<CapturedScreenshot?> capture() async {
    captureCount++;
    if (throwError) throw StateError('capture boom');
    return result;
  }
}

CapturedScreenshot shot(List<int> bytes, {int width = 480, int height = 640}) =>
    CapturedScreenshot(
      bytes: Uint8List.fromList(bytes),
      width: width,
      height: height,
    );

/// Minimal `multipart/form-data` parser: text fields → values, file parts →
/// their field names. Enough to assert the §18 upload shape without a real
/// server.
({Map<String, String> fields, Set<String> files, String raw}) parseMultipart(
  http.Request request,
) {
  final contentType = request.headers['content-type'] ?? '';
  final boundary =
      RegExp(r'boundary=(.+)$').firstMatch(contentType)?.group(1) ?? '';
  // latin1 preserves the raw file bytes verbatim (utf8 would choke on them).
  final raw = latin1.decode(request.bodyBytes);
  final fields = <String, String>{};
  final files = <String>{};
  for (final segment in raw.split('--$boundary')) {
    final nameMatch = RegExp(r'name="([^"]+)"').firstMatch(segment);
    if (nameMatch == null) continue;
    final name = nameMatch.group(1)!;
    if (segment.contains('filename=')) {
      files.add(name);
      continue;
    }
    final sep = segment.indexOf('\r\n\r\n');
    if (sep == -1) continue;
    fields[name] = segment
        .substring(sep + 4)
        .replaceAll(RegExp(r'\r\n$'), '');
  }
  return (fields: fields, files: files, raw: raw);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  const token = 'mam_0123456789abcdef0123456789abcdef';

  group('ScreenshotAutocapture (direct, injected capturer/http/store)', () {
    late List<http.Request> requests;
    late InMemoryKeyValueStore store;

    setUp(() {
      requests = [];
      store = InMemoryKeyValueStore();
    });

    MockClient recordingClient({int status = 202}) => MockClient((request) async {
      requests.add(request);
      return http.Response('{"stored": true}', status);
    });

    ScreenshotAutocapture build({
      required ScreenshotCapturer capturer,
      required http.Client client,
      KeyValueStore? kv,
      String appVersion = '1.4.2',
    }) => ScreenshotAutocapture(
      capturer: capturer,
      client: client,
      store: kv ?? store,
      serverUrl: 'http://localhost:8080',
      token: token,
      appVersion: () async => appVersion,
    );

    test(r'first $screen_view POSTs multipart /ingest/screenshots with the '
        '§18 fields', () async {
      final bytes = [1, 2, 3, 4, 5];
      final capturer = FakeScreenshotCapturer(
        result: shot(bytes, width: 480, height: 640),
      );
      await build(capturer: capturer, client: recordingClient()).onScreenView(
        'Home',
      );

      expect(requests, hasLength(1));
      final request = requests.single;
      expect(request.method, 'POST');
      expect(request.url.path, '/ingest/screenshots');
      expect(request.headers['authorization'], 'Bearer $token');
      expect(request.headers['content-type'], startsWith('multipart/form-data'));

      final parsed = parseMultipart(request);
      expect(parsed.fields['screen_name'], 'Home');
      expect(parsed.fields['app_version'], '1.4.2');
      expect(parsed.fields['width'], '480');
      expect(parsed.fields['height'], '640');
      expect(parsed.fields['image_hash'], sha256.convert(bytes).toString());
      expect(parsed.files, contains('image'));
      expect(parsed.raw.toLowerCase(), contains('filename="screenshot.jpg"'));
      expect(parsed.raw.toLowerCase(), contains('content-type: image/jpeg'));
    });

    test('captures a screen once per app_version and persists the skip across '
        'relaunches (same store, new instance)', () async {
      final client = recordingClient();
      final first = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      await build(capturer: first, client: client).onScreenView('Home');
      expect(requests, hasLength(1));
      expect(first.captureCount, 1);

      // Relaunch: a brand-new autocapture reading the SAME persisted store.
      final second = FakeScreenshotCapturer(result: shot([9, 9, 9]));
      await build(capturer: second, client: client).onScreenView('Home');

      // Persisted marker → skipped BEFORE capture; no new capture, no upload.
      expect(second.captureCount, 0);
      expect(requests, hasLength(1));
    });

    test('a new app_version re-captures each screen exactly once', () async {
      final client = recordingClient();
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
        appVersion: '1.4.2',
      ).onScreenView('Home');
      expect(requests, hasLength(1));

      final upgraded = FakeScreenshotCapturer(result: shot([4, 5, 6]));
      final auto = build(
        capturer: upgraded,
        client: client,
        appVersion: '2.0.0',
      );
      await auto.onScreenView('Home');
      expect(upgraded.captureCount, 1);
      expect(requests, hasLength(2));
      expect(parseMultipart(requests[1]).fields['app_version'], '2.0.0');

      // Second view under 2.0.0 → skipped (marked for the new version now).
      await auto.onScreenView('Home');
      expect(requests, hasLength(2));

      // Distinct persisted markers, one per version.
      expect(store.values.keys.any((k) => k.endsWith('1.4.2')), isTrue);
      expect(store.values.keys.any((k) => k.endsWith('2.0.0')), isTrue);
    });

    test('different screens each capture once under the same version', () async {
      final client = recordingClient();
      final capturer = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      final auto = build(capturer: capturer, client: client);
      await auto.onScreenView('Home');
      await auto.onScreenView('Checkout');

      expect(requests, hasLength(2));
      final names = requests
          .map((r) => parseMultipart(r).fields['screen_name'])
          .toSet();
      expect(names, {'Home', 'Checkout'});
    });

    test('a capturer failure never throws, uploads nothing, leaves the pair '
        'unmarked, and retries next launch', () async {
      final client = recordingClient();
      await build(
        capturer: FakeScreenshotCapturer(throwError: true),
        client: client,
      ).onScreenView('Home'); // must not throw
      expect(requests, isEmpty);
      expect(store.values, isEmpty); // nothing marked → will retry

      final ok = FakeScreenshotCapturer(result: shot([7, 7, 7]));
      await build(capturer: ok, client: client).onScreenView('Home');
      expect(requests, hasLength(1));
    });

    test('a null capture (encode failed) uploads nothing and marks nothing',
        () async {
      final client = recordingClient();
      await build(
        capturer: FakeScreenshotCapturer(result: null),
        client: client,
      ).onScreenView('Home');
      expect(requests, isEmpty);
      expect(store.values, isEmpty);
    });

    test('a failed upload (non-202) never throws, leaves the pair unmarked, '
        'and retries next launch', () async {
      var callIndex = 0;
      final client = MockClient((request) async {
        requests.add(request);
        final status = callIndex == 0 ? 500 : 202;
        callIndex++;
        return http.Response('', status);
      });

      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
      ).onScreenView('Home'); // 500
      expect(requests, hasLength(1));
      expect(store.values, isEmpty); // NOT marked

      // Relaunch retries; now 202 → marked.
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
      ).onScreenView('Home'); // 202
      expect(requests, hasLength(2));
      expect(store.values.keys.any((k) => k.endsWith('1.4.2')), isTrue);

      // Now that it is marked, a later view is skipped.
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
      ).onScreenView('Home');
      expect(requests, hasLength(2));
    });

    test('a network exception during upload never throws and marks nothing',
        () async {
      final client = MockClient((request) async {
        throw StateError('network down');
      });
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
      ).onScreenView('Home');
      expect(store.values, isEmpty);
    });

    test('an empty screen name is ignored', () async {
      final client = recordingClient();
      final capturer = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      await build(capturer: capturer, client: client).onScreenView('');
      expect(capturer.captureCount, 0);
      expect(requests, isEmpty);
    });
  });

  // Diagnosability (shared-contracts §20): the capture/upload path must be
  // observable via `logLevel`. Captures whatever the real MamLogger routes
  // through `debugPrint` (the same seam as logger_test), so these assertions
  // exercise the actual level gate — the test runner always runs in a debug
  // build (`kDebugMode == true`).
  group('ScreenshotAutocapture diagnostics via logLevel', () {
    late List<http.Request> requests;
    late InMemoryKeyValueStore store;
    late List<String> lines;
    late DebugPrintCallback originalDebugPrint;

    setUp(() {
      requests = [];
      store = InMemoryKeyValueStore();
      lines = <String>[];
      originalDebugPrint = debugPrint;
      debugPrint = (String? message, {int? wrapWidth}) {
        if (message != null) lines.add(message);
      };
    });

    tearDown(() => debugPrint = originalDebugPrint);

    ScreenshotAutocapture build({
      required ScreenshotCapturer capturer,
      required http.Client client,
      required MyAmpMixLogLevel logLevel,
      String appVersion = '1.4.2',
    }) => ScreenshotAutocapture(
      capturer: capturer,
      client: client,
      store: store,
      serverUrl: 'http://localhost:8080',
      token: token,
      appVersion: () async => appVersion,
      logger: MamLogger(level: logLevel),
    );

    test('a non-202 upload logs an error-level rejection with status + body '
        'snippet, and still leaves the pair unmarked', () async {
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response('invalid token', 401);
      });

      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
        // error level is enough for the rejection — it is error-carrying.
        logLevel: MyAmpMixLogLevel.error,
      ).onScreenView('Home');

      expect(requests, hasLength(1));
      expect(store.values, isEmpty); // NOT marked → retries next launch
      final rejection = lines.where(
        (l) => l.contains('screenshot upload rejected'),
      );
      expect(rejection, hasLength(1));
      expect(rejection.single, contains('status=401'));
      expect(rejection.single, contains('invalid token'));
    });

    test('the logged body snippet is capped at ~500 chars', () async {
      final hugeBody = 'x' * 2000;
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(hugeBody, 500);
      });

      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
        logLevel: MyAmpMixLogLevel.error,
      ).onScreenView('Home');

      final rejection = lines
          .firstWhere((l) => l.contains('screenshot upload rejected'));
      // The 500-char snippet is present verbatim, but the full 2000-char body
      // is not — capped, not dumped whole.
      expect(rejection, contains('x' * 500));
      expect(rejection, isNot(contains('x' * 501)));
    });

    test('at error level the debug lifecycle logs stay silent (only the '
        'rejection surfaces)', () async {
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response('boom', 500);
      });
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
        logLevel: MyAmpMixLogLevel.error,
      ).onScreenView('Home');

      expect(
        lines.any((l) => l.contains('screenshot upload rejected')),
        isTrue,
      );
      // No debug-level ("uploaded"/"skipped"/"returned null") noise at error.
      expect(lines.any((l) => l.contains('screenshot uploaded')), isFalse);
      expect(lines.any((l) => l.contains('screenshot skipped')), isFalse);
    });

    test('at debug level a successful upload and a subsequent skip both log',
        () async {
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response('{"stored": true}', 202);
      });

      // First view → captured + uploaded (status 202).
      await build(
        capturer: FakeScreenshotCapturer(result: shot([1, 2, 3])),
        client: client,
        logLevel: MyAmpMixLogLevel.debug,
      ).onScreenView('Home');
      expect(
        lines.any((l) => l.contains('screenshot uploaded: Home (status 202)')),
        isTrue,
      );

      lines.clear();

      // Relaunch, same store → persisted-skip is now visible.
      await build(
        capturer: FakeScreenshotCapturer(result: shot([9, 9, 9])),
        client: client,
        logLevel: MyAmpMixLogLevel.debug,
      ).onScreenView('Home');
      expect(
        lines.any(
          (l) => l.contains(
            'screenshot skipped (already captured this app_version): Home',
          ),
        ),
        isTrue,
      );
    });

    test('at debug level a null capture logs "capture returned null"',
        () async {
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response('', 202);
      });
      await build(
        capturer: FakeScreenshotCapturer(result: null),
        client: client,
        logLevel: MyAmpMixLogLevel.debug,
      ).onScreenView('Home');

      expect(requests, isEmpty);
      expect(
        lines.any(
          (l) => l.contains('screenshot capture returned null: Home'),
        ),
        isTrue,
      );
    });
  });

  group('ScreenshotAutocapture wired through the real facade', () {
    late FakeClock clock;
    late InMemoryKeyValueStore keyValueStore;
    late AnalyticsDatabase database;
    late List<http.Request> requests;

    setUp(() {
      clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
      keyValueStore = InMemoryKeyValueStore();
      database = AnalyticsDatabase(NativeDatabase.memory());
      requests = [];
    });

    tearDown(() => MyAmpMix.shutdownForTesting());

    MockClient client() => MockClient((request) async {
      requests.add(request);
      return http.Response('{"stored": true}', 202);
    });

    Future<void> initSdk({
      required bool autocaptureScreenshots,
      ScreenshotCapturer? capturer,
    }) => MyAmpMix.init(
      token,
      config: MyAmpMixConfig(
        serverUrl: 'http://localhost:8080',
        autocaptureScreenshots: autocaptureScreenshots,
        // Keep the real purchase/attribution channels out of this suite.
        autocapturePurchases: false,
        autocaptureAttribution: false,
      ),
      overrides: SdkOverrides(
        clock: clock,
        httpClient: client(),
        database: database,
        keyValueStore: keyValueStore,
        contextDataSource: FakeContextDataSource(),
        random: FixedRandom(0.5),
        screenshotCapturer: capturer,
      ),
    );

    List<http.Request> screenshotRequests() =>
        requests.where((r) => r.url.path == '/ingest/screenshots').toList();

    test(r'autocaptureScreenshots: true captures + uploads once on a '
        r'$screen_view routed through track()', () async {
      final capturer = FakeScreenshotCapturer(
        result: shot([1, 2, 3], width: 320, height: 640),
      );
      await initSdk(autocaptureScreenshots: true, capturer: capturer);

      MyAmpMix.instance.track(r'$screen_view', properties: {
        r'$screen_name': 'Home',
      });
      await pumpEventQueue();

      final shots = screenshotRequests();
      expect(shots, hasLength(1));
      final parsed = parseMultipart(shots.single);
      expect(parsed.fields['screen_name'], 'Home');
      expect(parsed.fields['app_version'], '1.4.2');
      expect(parsed.fields['width'], '320');
      expect(parsed.fields['height'], '640');
      expect(capturer.captureCount, 1);

      // Second identical view → persisted-skip, no re-upload.
      MyAmpMix.instance.track(r'$screen_view', properties: {
        r'$screen_name': 'Home',
      });
      await pumpEventQueue();
      expect(screenshotRequests(), hasLength(1));
      expect(capturer.captureCount, 1);
    });

    test('autocaptureScreenshots: false never captures or uploads', () async {
      final capturer = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      await initSdk(autocaptureScreenshots: false, capturer: capturer);

      MyAmpMix.instance.track(r'$screen_view', properties: {
        r'$screen_name': 'Home',
      });
      await pumpEventQueue();

      expect(screenshotRequests(), isEmpty);
      expect(capturer.captureCount, 0);
    });

    test('an opted-out user is never screenshotted', () async {
      final capturer = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      await initSdk(autocaptureScreenshots: true, capturer: capturer);

      MyAmpMix.instance.optOutTracking();
      await pumpEventQueue(); // let opt-out take effect

      MyAmpMix.instance.track(r'$screen_view', properties: {
        r'$screen_name': 'Home',
      });
      await pumpEventQueue();

      expect(screenshotRequests(), isEmpty);
      expect(capturer.captureCount, 0);
    });

    test(r'a non-$screen_view event never triggers a capture', () async {
      final capturer = FakeScreenshotCapturer(result: shot([1, 2, 3]));
      await initSdk(autocaptureScreenshots: true, capturer: capturer);

      MyAmpMix.instance.track('checkout_completed', properties: {'value': 9.99});
      await pumpEventQueue();

      expect(screenshotRequests(), isEmpty);
      expect(capturer.captureCount, 0);
    });
  });
}
