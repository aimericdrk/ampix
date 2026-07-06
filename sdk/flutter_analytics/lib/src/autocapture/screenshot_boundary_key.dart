import 'package:flutter/widgets.dart';

/// Library-internal [GlobalKey] for the full-screen `RepaintBoundary` that
/// [MyAmpMixTracker] wraps around the app subtree (shared-contracts §18).
///
/// `RepaintBoundaryScreenshotCapturer` defaults to this key so it renders the
/// WHOLE screen the developer already wrapped for tap autocapture — not the
/// first/partial sub-boundary a depth-first walk would otherwise return
/// (a list item, an overlay entry), which produces mis-framed captures.
final GlobalKey myAmpMixScreenshotBoundaryKey = GlobalKey(
  debugLabel: 'myampmix.screenshot',
);
