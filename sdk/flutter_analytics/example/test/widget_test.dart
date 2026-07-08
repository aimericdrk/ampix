import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/myampix_analytics.dart';
import 'package:myampix_analytics_example/demo_config.dart';
import 'package:myampix_analytics_example/main.dart';
import 'package:myampix_analytics_example/state/cart_state.dart';
import 'package:myampix_analytics_example/state/event_log.dart';

/// Advances the widget tree by a fixed, bounded number of frames instead of
/// `pumpAndSettle()`. Under `flutter test` the SDK's platform plugins
/// (shared_preferences / path_provider) are unavailable, and we never want
/// the test to depend on — or wait indefinitely for — a perpetual animation
/// or a plugin round-trip. A couple of fixed pumps is enough to run any
/// route/snackbar transition to completion for our assertions.
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    await MyAmpix.shutdownForTesting();
    CartState.instance.clear();
    EventLog.instance.clear();
  });

  testWidgets('tapping Add to cart tracks add_to_cart and updates the '
      'on-screen event log', (tester) async {
    // Harmless config. MyAmpix.init never throws into the host app even
    // when its platform plugins are missing under `flutter test` — it just
    // leaves the SDK disabled and every facade call becomes a logged no-op.
    //
    // Init is driven through `tester.runAsync` so it executes in the REAL
    // async zone: a `testWidgets` body otherwise runs under a fake-async
    // clock where `Future.timeout`'s timer would never fire without a pump
    // and a missing-plugin channel reply would never be delivered, which
    // would deadlock this line before the first pump. In the real zone the
    // missing plugins surface as caught exceptions (SDK left disabled) and
    // the timeout is a belt-and-braces cap so a channel that simply never
    // replies still can't hang the test. The on-screen event log is
    // app-side bookkeeping, independent of whether the SDK is enabled, so
    // the assertions below hold either way.
    await tester.runAsync(
      () => MyAmpix.init(
        demoToken,
        config: const MyAmpixConfig(serverUrl: demoServerUrl),
      ).timeout(const Duration(seconds: 3), onTimeout: () {}),
    );

    await tester.pumpWidget(const ShopApp());
    await settle(tester);

    // Catalog screen loaded and tracked its own view (via the event log).
    expect(find.text('Wireless Headphones'), findsOneWidget);
    expect(
      EventLog.instance.entries.any((e) => e.contains('catalog_viewed')),
      isTrue,
    );

    // Open the product detail screen.
    await tester.tap(find.text('Wireless Headphones'));
    await settle(tester);
    expect(find.widgetWithText(FilledButton, 'Add to cart'), findsOneWidget);

    // Tap the tracked "Add to cart" button.
    await tester.tap(find.widgetWithText(FilledButton, 'Add to cart'));
    await settle(tester);

    // The tracked action was recorded and the cart updated.
    expect(
      EventLog.instance.entries.any((e) => e.contains('add_to_cart')),
      isTrue,
    );
    expect(CartState.instance.itemCount, 1);

    // Back to the tabs, then confirm the Event Log tab reflects it on screen.
    await tester.pageBack();
    await settle(tester);
    await tester.tap(find.byIcon(Icons.list_alt));
    await settle(tester);
    expect(find.textContaining('add_to_cart'), findsOneWidget);
  });
}
