import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/myampix_analytics.dart';

import '../helpers/fake_clock.dart';

/// Scroll geometry on autocaptured taps (heatmap fix): `$content_y` /
/// `$scroll_y` / `$content_height` / `$viewport_height` are emitted only when
/// the tap landed inside a VERTICAL scrollable that actually scrolls, and
/// place the tap in content space rather than viewport space.
class _Emitted {
  _Emitted(this.event, this.properties);
  final String event;
  final Map<String, Object?> properties;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(MyAmpixObserver.resetForTesting);
  tearDown(MyAmpixObserver.resetForTesting);

  late FakeClock clock;
  late List<_Emitted> emitted;

  setUp(() {
    clock = FakeClock(DateTime.utc(2026, 8, 28, 12));
    emitted = [];
  });

  void fakeTrack(String event, Map<String, Object?> properties) =>
      emitted.add(_Emitted(event, properties));

  testWidgets(
    r'a tap inside a scrolled ListView emits $content_y = scrollOffset + '
    r'tap y within the viewport, and $content_height = maxScrollExtent + '
    'viewportDimension',
    (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MyAmpixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: ListView.builder(
                controller: controller,
                itemCount: 50,
                itemBuilder: (context, i) => GestureDetector(
                  key: Key('item-$i'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(height: 100),
                ),
              ),
            ),
          ),
        ),
      );

      controller.jumpTo(250);
      await tester.pump();

      // Item 4 spans content y 400..500; with the list scrolled to 250 it is
      // fully visible at viewport y 150..250.
      final center = tester.getCenter(find.byKey(const Key('item-4')));
      await tester.tap(find.byKey(const Key('item-4')));
      await tester.pump();

      final scrollable = tester.state<ScrollableState>(
        find.byType(Scrollable),
      );
      final position = scrollable.position;
      final viewportTopY = (scrollable.context.findRenderObject()! as RenderBox)
          .localToGlobal(Offset.zero)
          .dy;

      final tap = emitted.singleWhere((e) => e.event == r'$tap');
      // Position stays exactly what it always was: raw viewport coordinates.
      expect(tap.properties[r'$pos_y'], center.dy);
      expect(tap.properties[r'$scroll_y'], closeTo(250, 0.001));
      expect(
        tap.properties[r'$content_y'] as double,
        closeTo(250 + (center.dy - viewportTopY), 0.001),
      );
      expect(
        tap.properties[r'$content_height'] as double,
        closeTo(position.maxScrollExtent + position.viewportDimension, 0.001),
      );
      // 50 items x 100px: the full content is 5000 logical pixels tall.
      expect(tap.properties[r'$content_height'] as double, closeTo(5000, 0.001));
      expect(
        tap.properties[r'$viewport_height'] as double,
        closeTo(position.viewportDimension, 0.001),
      );
    },
  );

  testWidgets(
    'a tap on a screen with no scrollable emits none of the four scroll '
    r'properties and still emits $pos_x/$pos_y exactly as before',
    (tester) async {
      await tester.pumpWidget(
        MyAmpixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: Center(
                child: GestureDetector(
                  key: const Key('fixed-btn'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: const SizedBox(width: 50, height: 50),
                ),
              ),
            ),
          ),
        ),
      );

      final center = tester.getCenter(find.byKey(const Key('fixed-btn')));
      await tester.tap(find.byKey(const Key('fixed-btn')));
      await tester.pump();

      final tap = emitted.singleWhere((e) => e.event == r'$tap');
      expect(tap.properties[r'$pos_x'], center.dx);
      expect(tap.properties[r'$pos_y'], center.dy);
      expect(tap.properties.containsKey(r'$scroll_y'), isFalse);
      expect(tap.properties.containsKey(r'$content_y'), isFalse);
      expect(tap.properties.containsKey(r'$content_height'), isFalse);
      expect(tap.properties.containsKey(r'$viewport_height'), isFalse);
    },
  );

  testWidgets(
    'a tap inside a horizontal carousel nested in a vertical page reports '
    "the VERTICAL page's offset, not the carousel's",
    (tester) async {
      final verticalController = ScrollController();
      final horizontalController = ScrollController(initialScrollOffset: 50);
      addTearDown(verticalController.dispose);
      addTearDown(horizontalController.dispose);
      await tester.pumpWidget(
        MyAmpixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: ListView(
                controller: verticalController,
                children: [
                  const SizedBox(height: 300),
                  SizedBox(
                    height: 100,
                    child: ListView.builder(
                      controller: horizontalController,
                      scrollDirection: Axis.horizontal,
                      itemCount: 30,
                      itemBuilder: (context, i) => GestureDetector(
                        key: Key('chip-$i'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () {},
                        child: const SizedBox(width: 80),
                      ),
                    ),
                  ),
                  // Enough below the carousel that the page really scrolls.
                  const SizedBox(height: 2000),
                ],
              ),
            ),
          ),
        ),
      );

      verticalController.jumpTo(200);
      await tester.pump();

      // Chip 1 spans horizontal content x 80..160; with the carousel scrolled
      // to 50 it is visible at viewport x 30..110.
      await tester.tap(find.byKey(const Key('chip-1')));
      await tester.pump();

      final tap = emitted.singleWhere((e) => e.event == r'$tap');
      expect(
        tap.properties[r'$scroll_y'] as double,
        closeTo(200, 0.001),
        reason: "the vertical page's offset, never the carousel's 50",
      );
    },
  );

  testWidgets(
    'a scrollable whose content fits (maxScrollExtent == 0) emits none of '
    'the four scroll properties',
    (tester) async {
      await tester.pumpWidget(
        MyAmpixTracker(
          clock: clock,
          track: fakeTrack,
          child: MaterialApp(
            home: Scaffold(
              body: ListView(
                children: [
                  GestureDetector(
                    key: const Key('short-item'),
                    behavior: HitTestBehavior.opaque,
                    onTap: () {},
                    child: const SizedBox(height: 50),
                  ),
                  const SizedBox(height: 50),
                ],
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('short-item')));
      await tester.pump();

      final tap = emitted.singleWhere((e) => e.event == r'$tap');
      // $pos_y already places the tap on a screen that does not scroll.
      expect(tap.properties[r'$pos_y'], isNotNull);
      expect(tap.properties.containsKey(r'$scroll_y'), isFalse);
      expect(tap.properties.containsKey(r'$content_y'), isFalse);
      expect(tap.properties.containsKey(r'$content_height'), isFalse);
      expect(tap.properties.containsKey(r'$viewport_height'), isFalse);
    },
  );
}
