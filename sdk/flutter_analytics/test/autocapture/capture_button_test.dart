import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_analytics/myampix_analytics.dart';
import 'package:myampix_analytics/src/storage/database.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_key_value_store.dart';

/// The MyAmpixTracker's manual capture button: shown only when reference
/// capture is wired, hides itself while the shot is taken, reappears after,
/// and never appears in the captured image (it lives outside the boundary).
class _GatedCapturer implements ScreenshotCapturer {
  int captureCount = 0;

  /// When set, capture() waits on it — lets a test observe the mid-capture
  /// (button hidden) state before letting the capture finish.
  Completer<void>? gate;

  @override
  Future<CapturedScreenshot?> capture() async {
    captureCount++;
    final g = gate;
    if (g != null) await g.future;
    return CapturedScreenshot(
      bytes: Uint8List.fromList(const [1, 2, 3]),
      width: 320,
      height: 640,
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  const token = 'mam_0123456789abcdef0123456789abcdef';

  late FakeClock clock;
  late List<http.Request> requests;
  late AnalyticsDatabase database;

  setUp(() {
    clock = FakeClock(DateTime.utc(2026, 8, 29, 12));
    requests = [];
    database = AnalyticsDatabase(NativeDatabase.memory());
    MyAmpixObserver.resetForTesting();
  });

  tearDown(() async {
    await MyAmpix.shutdownForTesting();
    MyAmpixObserver.resetForTesting();
  });

  Future<void> initSdk({
    required bool autocaptureScreenshots,
    ScreenshotCapturer? capturer,
  }) => MyAmpix.init(
    token,
    config: MyAmpixConfig(
      serverUrl: 'http://localhost:8080',
      autocaptureScreenshots: autocaptureScreenshots,
      autocapturePurchases: false,
      autocaptureAttribution: false,
    ),
    overrides: SdkOverrides(
      clock: clock,
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response('{"stored": true}', 202);
      }),
      database: database,
      keyValueStore: InMemoryKeyValueStore(),
      contextDataSource: FakeContextDataSource(),
      random: FixedRandom(0.5),
      screenshotCapturer: capturer,
      screenshotSettleDelay: Duration.zero,
    ),
  );

  Finder button() => find.bySemanticsLabel('myampix_capture_button');

  Widget app() => MyAmpixTracker(
    clock: clock,
    track: (event, properties) {},
    child: const MaterialApp(home: Scaffold(body: Center(child: Text('hi')))),
  );

  testWidgets('shown when capture is wired; tapping it captures the current '
      'screen and it reappears afterwards', (tester) async {
    final capturer = _GatedCapturer();
    await initSdk(autocaptureScreenshots: true, capturer: capturer);
    MyAmpix.instance.trackScreen('Home');

    await tester.pumpWidget(app());
    expect(button(), findsOneWidget);

    await tester.tap(button());
    await tester.pumpAndSettle();

    expect(capturer.captureCount, 1);
    expect(
      requests.where((r) => r.url.path == '/ingest/screenshots'),
      hasLength(1),
    );
    // The button is back after the capture completes.
    expect(button(), findsOneWidget);

    // Cancels the uploader's periodic flush timer BEFORE the widget tree is
    // torn down — testWidgets asserts no pending timers as soon as the body
    // returns, which runs before the group's tearDown (see the same note in
    // myampix_tracker_test.dart).
    await MyAmpix.shutdownForTesting();
  });

  testWidgets('hides while the capture is in flight and reappears when it '
      'finishes', (tester) async {
    final capturer = _GatedCapturer()..gate = Completer<void>();
    await initSdk(autocaptureScreenshots: true, capturer: capturer);
    MyAmpix.instance.trackScreen('Home');

    await tester.pumpWidget(app());
    await tester.tap(button());
    await tester.pump();
    await tester.pump(); // hide-frame + the endOfFrame the handler awaits

    // Mid-capture: the button has disappeared.
    expect(button(), findsNothing);
    expect(capturer.captureCount, 1);

    capturer.gate!.complete();
    await tester.pumpAndSettle();

    expect(button(), findsOneWidget);

    await MyAmpix.shutdownForTesting();
  });

  testWidgets('absent when reference capture is not wired', (tester) async {
    await initSdk(autocaptureScreenshots: false, capturer: _GatedCapturer());

    await tester.pumpWidget(app());

    expect(button(), findsNothing);

    await MyAmpix.shutdownForTesting();
  });

  testWidgets('absent before init — a plain tracker never shows it',
      (tester) async {
    // No MyAmpix.init at all: manualScreenshotAvailable is false.
    await tester.pumpWidget(app());
    expect(button(), findsNothing);
  });
}
