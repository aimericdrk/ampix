import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/autocapture/myampmix_privacy.dart';

void main() {
  setUp(MyAmpMixPrivacyRegistry.resetForTesting);
  tearDown(MyAmpMixPrivacyRegistry.resetForTesting);

  testWidgets('MyAmpMixPrivacy renders its child unchanged on screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: MyAmpMixPrivacy(child: Text('secret-value'))),
      ),
    );

    expect(find.text('secret-value'), findsOneWidget);
  });

  testWidgets('registers its region while mounted and unregisters on unmount', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: MyAmpMixPrivacy(
              child: SizedBox(width: 120, height: 48),
            ),
          ),
        ),
      ),
    );

    final rects = MyAmpMixPrivacyRegistry.globalRects();
    expect(rects, hasLength(1));
    expect(rects.single.width, 120);
    expect(rects.single.height, 48);

    // Rebuild without the privacy region → it must self-remove.
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: SizedBox())),
    );
    expect(MyAmpMixPrivacyRegistry.globalRects(), isEmpty);
  });

  testWidgets('multiple privacy regions are all tracked', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              MyAmpMixPrivacy(child: SizedBox(width: 10, height: 10)),
              MyAmpMixPrivacy(child: SizedBox(width: 20, height: 20)),
            ],
          ),
        ),
      ),
    );

    expect(MyAmpMixPrivacyRegistry.globalRects(), hasLength(2));
  });
}
