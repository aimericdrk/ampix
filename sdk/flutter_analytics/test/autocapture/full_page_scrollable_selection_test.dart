import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_analytics/src/autocapture/screenshot_capturer.dart';

/// Which scrollable a full-page capture scrolls (`_primaryVerticalScrollable`
/// via its test seam). The element tree still contains everything the user is
/// NOT looking at — routes under the top one, offstage subtrees — all with
/// live scroll positions. Scrolling one of those renders the same visible
/// frame at every offset and stitches the first fold repeatedly, so the
/// filter must reject anything that isn't actually on screen.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final capturer = RepaintBoundaryScreenshotCapturer();

  Widget tallList(Key key, {int itemCount = 50}) => ListView.builder(
    key: key,
    itemCount: itemCount,
    itemBuilder: (context, i) => SizedBox(height: 100, child: Text('row $i')),
  );

  ScrollableState scrollableOf(WidgetTester tester, Key listKey) =>
      tester.state<ScrollableState>(
        find.descendant(
          of: find.byKey(listKey),
          matching: find.byType(Scrollable),
        ),
      );

  testWidgets('picks the visible page scroller on a plain screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: tallList(const Key('page')))),
    );

    final selected = capturer.debugPrimaryVerticalScrollable();
    expect(selected, same(scrollableOf(tester, const Key('page'))));
  });

  testWidgets(
    'ignores a LARGER offstage scrollable in favour of the smaller visible '
    'one (hidden tab / kept-alive subtree)',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                // Offstage lays its child out (live viewport, bigger than the
                // visible list) but never paints or hit-tests it — exactly the
                // shape of a hidden IndexedStack tab or a kept-alive page.
                Offstage(
                  offstage: true,
                  child: SizedBox(
                    height: 550,
                    child: tallList(const Key('hidden')),
                  ),
                ),
                SizedBox(height: 400, child: tallList(const Key('visible'))),
              ],
            ),
          ),
        ),
      );

      final selected = capturer.debugPrimaryVerticalScrollable();
      expect(selected, same(scrollableOf(tester, const Key('visible'))));
    },
  );

  testWidgets(
    'a route pushed over a scrollable page: the covered page is never '
    'selected — null when the top route has nothing to scroll',
    (tester) async {
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigatorKey,
          home: Scaffold(body: tallList(const Key('under'))),
        ),
      );

      unawaited(
        navigatorKey.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Center(child: Text('fixed'))),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(capturer.debugPrimaryVerticalScrollable(), isNull);
    },
  );

  testWidgets(
    "a route pushed over a scrollable page: the TOP route's own (smaller) "
    'scroller wins over the covered larger one',
    (tester) async {
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigatorKey,
          home: Scaffold(body: tallList(const Key('under'))),
        ),
      );
      // Scroll the covered page first so its position is unmistakably live.
      scrollableOf(tester, const Key('under')).position.jumpTo(300);
      await tester.pump();

      unawaited(
        navigatorKey.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              body: Center(
                child: SizedBox(height: 400, child: tallList(const Key('top'))),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final selected = capturer.debugPrimaryVerticalScrollable();
      expect(selected, same(scrollableOf(tester, const Key('top'))));
    },
  );
}
