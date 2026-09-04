# TASK: apply the scroll-geometry fix to the MyAmpix Flutter SDK

You are applying a prepared change to `sdk/flutter_analytics` in the MyAmpix repo
(`atclub_analytics`). The change is written and reviewed but **has never been compiled** — it was
authored on a machine with no Dart/Flutter toolchain. Your job is to apply it, make it compile, make
the tests pass, and report anything you had to change.

## What you are doing and why

The click heatmap overlays tap positions on a reference screenshot. On any screen taller than the
viewport it is wrong:

- Taps record `$pos_x`/`$pos_y` — the raw pointer position, i.e. **viewport** coordinates. No scroll
  offset was recorded anywhere in the SDK (grep for `scroll`: no matches before this change). The
  same content therefore reports a different `$pos_y` depending on where the user had scrolled, so
  every scroll position collapses onto one band of the heatmap.
- The reference screenshot captures the full-screen `RepaintBoundary` — **one viewport** — so there
  is no background for anything below the first fold.

This change fixes both halves in the SDK: taps gain content-space geometry, and reference captures
stitch the whole scrollable page.

## Step 1 — apply the patch

The unified diff is at the end of this document. From the repo root:

```bash
git apply --3way path/to/sdk-scroll-geometry.patch     # or paste the diff below into a file
```

If it does not apply cleanly, apply it by hand — the diff is small and self-describing, and §"What
the change does" below states the intent of every hunk so you can reproduce it against a drifted
tree rather than forcing it.

**Do not** commit anything else along with it. Check `git status` first: if the working tree has
unrelated modifications, stage only these two files.

Files touched, and nothing else:

- `sdk/flutter_analytics/lib/src/autocapture/myampix_tracker.dart`
- `sdk/flutter_analytics/lib/src/autocapture/screenshot_capturer.dart`
- `sdk/flutter_analytics/lib/src/autocapture/screenshot_autocapture.dart`
- `sdk/flutter_analytics/test/autocapture/screenshot_autocapture_test.dart`

## Step 2 — make it compile and pass

```bash
cd sdk/flutter_analytics
flutter analyze
flutter test
```

**Expect to fix errors.** One was already caught by review (`num.clamp()` returns `num`, not
`double`, so the result needed `.toDouble()`); assume others of that class survive. Pay particular
attention to these, none of which are covered by an existing test:

- `img.compositeImage(canvas, frame, dstY: …)` against the `image: ^4.3.0` API.
- `ScrollableState.position.axis`, `.hasPixels`, `.hasContentDimensions`.
- The `ancestor is StatefulElement && ancestor.state is ScrollableState` cast inside
  `visitAncestorElements`.

When you fix something, fix it in the spirit of the surrounding code: this SDK has a hard
**never-throw-into-the-host-app** rule (design §13). Every new code path is already wrapped so a
failure degrades to "no data" rather than crashing. Keep that. Do not "simplify" a try/catch away.

## Step 3 — add the tests that are missing

The change ships with none, because they could not be run where it was written. Add widget tests
under `test/autocapture/` covering at least:

1. A tap inside a scrolled `ListView` emits `$content_y == scrollOffset + tapYWithinViewport`, and
   `$content_height == maxScrollExtent + viewportDimension`.
2. A tap on a screen with **no** scrollable emits none of the four new properties — and still emits
   `$pos_x`/`$pos_y` exactly as before.
3. A tap inside a **horizontal** scrollable nested in a vertical page reports the VERTICAL page's
   offset, not the carousel's.
4. A scrollable whose content fits (`maxScrollExtent == 0`) emits none of the four.

The existing `test/autocapture/` files show the harness conventions (there is a `track` seam on
`MyAmpixTracker` for injecting a fake tracker function — use it rather than a real pipeline).

The stitching path in `screenshot_capturer.dart` is deliberately not unit-tested upstream (it needs
a live engine; tests inject a fake `ScreenshotCapturer`). Do not invent a fragile test for it —
verify it by hand instead, per step 4.

## Step 4 — verify the capture by hand

In a **debug** build with `autocaptureScreenshots: true`, open a screen taller than one viewport and
confirm the uploaded reference image covers the whole page.

Two behaviours are inherent, not bugs. Confirm they are acceptable rather than trying to remove them:

1. **The page visibly scrolls itself** during capture. It is the only way to reach content that is
   not laid out yet.
2. **Sticky headers, parallax and appear-on-scroll animations repeat** down the stitched image. If a
   specific screen looks bad, the right fix is an opt-out for that screen, not detection heuristics.

## What the change does (so you can reproduce it if the patch drifts)

### `myampix_tracker.dart`

A `$tap` gains four properties, emitted **only** when the tap landed inside a vertical scrollable
that actually scrolls:

| property | meaning |
| --- | --- |
| `$content_y` | the tap's y in the scrollable's FULL content — the placeable one |
| `$scroll_y` | scroll offset at tap time |
| `$content_height` | `maxScrollExtent + viewportDimension` |
| `$viewport_height` | how much of the content was visible at once |

Three decisions to preserve:

- The scrollable is found by walking **up from the tapped widget** (`visitAncestorElements`),
  filtered to `Axis.vertical`. A horizontal carousel nested in a vertical page must not report its
  own offset as the page position.
- `$content_y` is `position.pixels + box.globalToLocal(tapPosition).dy`, where `box` is the
  Scrollable's own `RenderBox`. Using the raw screen y would shift every tap by the height of any
  app bar or safe area.
- All four are **absent** on a screen that does not scroll — exactly the case where `$pos_y` was
  already correct. Fixed screens must behave identically to before.

### `screenshot_capturer.dart`

Reference captures stitch the whole page: find the primary vertical scrollable (largest viewport
that actually scrolls — largest, not first, or a depth-first walk finds a chip row before the page's
own scroller), then `jumpTo` each offset, render, and composite each frame **at its own scroll
offset** into one tall image. Compositing at the offset means the final overlapping frame overwrites
the pixels it shares with the previous one: no seam, no tail arithmetic.

- Bounded at `kMaxStitchedViewports = 6`; `contentHeight` then describes what was captured.
- Downscale is **width**-capped, not longest-side: the existing `kMaxScreenshotEdge = 640`
  longest-side rule would crush a 6-viewport stitch to 640px tall and destroy its width.
- Privacy masks are applied **per frame**, while their rects still describe what is on screen — they
  are viewport coordinates, so masking the finished stitch would black out the wrong rows.
- The scroll position is restored in a `finally`.
- A failed stitch falls through to the original single-frame path: one fold beats no screenshot.
- `CapturedScreenshot` gains optional `contentHeight`/`viewportHeight` — optional so the existing
  test fakes still compile.

### `screenshot_autocapture.dart` (+ its test)

The multipart upload sends `content_height` / `viewport_height` — but **only for a stitched
capture**, so a single-viewport upload's payload is byte-identical to before. The server reads an
absent field as "not a full-page capture" and stores NULL, which is exactly what makes its heatmap
fall back to viewport coordinates; sending 0 would instead claim a page of no height.

The existing upload test now also asserts the ABSENCE of both fields for a single-viewport shot, and
a new test covers the stitched case. Those two are the only tests shipped with this patch — the ones
listed in step 3 are still yours to write.

## Explicitly NOT in this patch

- **Nothing else.** The backend half is already done and deployed-ready on the server side: it
  stores `content_height`/`viewport_height` on a screen capture, normalizes a tap against page
  geometry when the event carries it, and falls back to viewport coordinates otherwise. This patch
  is the last piece.
- **Web.** The SDK cannot build for Flutter Web at all (`dart:io` imported in
  `context/platform_context_data_source.dart`, `network/uploader.dart`, `storage/database.dart`,
  plus `drift/native.dart` and `Platform.isIOS`). Do not attempt to make this patch web-compatible.

## Report back

State plainly: whether the patch applied cleanly, every compile error you fixed and how, the test
results, and anything you found that contradicts this document. If something here is wrong, say so
rather than working around it silently.

---

## The patch

```diff
diff --git a/sdk/flutter_analytics/lib/src/autocapture/myampix_tracker.dart b/sdk/flutter_analytics/lib/src/autocapture/myampix_tracker.dart
index 00d1334..e654733 100644
--- a/sdk/flutter_analytics/lib/src/autocapture/myampix_tracker.dart
+++ b/sdk/flutter_analytics/lib/src/autocapture/myampix_tracker.dart
@@ -78,9 +78,49 @@ class _RecentTap {
 }
 
 class _TapTarget {
-  _TapTarget({this.widgetType, this.label});
+  _TapTarget({
+    this.widgetType,
+    this.label,
+    this.scrollY,
+    this.contentY,
+    this.contentHeight,
+    this.viewportHeight,
+  });
   final String? widgetType;
   final String? label;
+
+  /// Scroll offset of the enclosing vertical scrollable when the tap happened.
+  final double? scrollY;
+
+  /// The tap's y in CONTENT space: how far down the scrollable's full content
+  /// it landed, independent of where the user had scrolled to. This is the one
+  /// a heatmap can place; `$pos_y` alone cannot, because it is measured against
+  /// the visible viewport.
+  final double? contentY;
+
+  /// Total scrollable content height (`maxScrollExtent + viewportDimension`) —
+  /// what [contentY] should be normalized against.
+  final double? contentHeight;
+
+  /// Height of the scrollable's viewport, i.e. how much of [contentHeight] was
+  /// visible at once.
+  final double? viewportHeight;
+}
+
+/// The scroll geometry of one tap, resolved from the tapped widget's nearest
+/// enclosing VERTICAL scrollable. Null when the tap wasn't inside one (a fixed
+/// screen), which is exactly when `$pos_y` is already sufficient.
+class _ScrollGeometry {
+  _ScrollGeometry({
+    required this.scrollY,
+    required this.contentY,
+    required this.contentHeight,
+    required this.viewportHeight,
+  });
+  final double scrollY;
+  final double contentY;
+  final double contentHeight;
+  final double viewportHeight;
 }
 
 class _MyAmpixTrackerState extends State<MyAmpixTracker> {
@@ -132,6 +172,15 @@ class _MyAmpixTrackerState extends State<MyAmpixTracker> {
         r'$screen_name': MyAmpixObserver.currentScreenName,
       r'$pos_x': position.dx,
       r'$pos_y': position.dy,
+      // Scroll geometry, present only when the tap landed inside a vertical
+      // scrollable that actually scrolls. `$content_y` is the placeable one:
+      // `$pos_y` is measured against the visible viewport, so on a tall screen
+      // it says nothing about where in the page the tap landed.
+      if (target?.scrollY != null) r'$scroll_y': target!.scrollY,
+      if (target?.contentY != null) r'$content_y': target!.contentY,
+      if (target?.contentHeight != null) r'$content_height': target!.contentHeight,
+      if (target?.viewportHeight != null)
+        r'$viewport_height': target!.viewportHeight,
     };
     _track(r'$tap', properties);
     _checkRageTap(position, properties);
@@ -196,9 +245,88 @@ class _MyAmpixTrackerState extends State<MyAmpixTracker> {
           .map((m) => m.$1)
           .firstWhere(_isInteresting, orElse: () => matches.first.$1);
 
+      final scroll = _resolveScrollGeometry(chosen, position);
       return _TapTarget(
         widgetType: chosen.widget.runtimeType.toString(),
         label: _resolveLabel(chosen),
+        scrollY: scroll?.scrollY,
+        contentY: scroll?.contentY,
+        contentHeight: scroll?.contentHeight,
+        viewportHeight: scroll?.viewportHeight,
+      );
+    } on Object catch (_) {
+      return null;
+    }
+  }
+
+  /// Resolves the scroll geometry of [chosen] — the widget the tap hit — by
+  /// walking up to its nearest enclosing VERTICAL scrollable.
+  ///
+  /// Why this exists: `$pos_x`/`$pos_y` are the raw pointer position, i.e.
+  /// VIEWPORT coordinates. On a screen taller than the viewport the same
+  /// content sits at a different `$pos_y` depending on where the user had
+  /// scrolled to, so every scroll position collapses onto the same band of a
+  /// heatmap and none of them can be placed against a reference screenshot.
+  /// `contentY` restores that: it is the tap's position in the scrollable's
+  /// full content, which is stable no matter how far the user had scrolled.
+  ///
+  /// The nearest scrollable is deliberately filtered to the vertical axis: a
+  /// tap inside a horizontal carousel nested in a vertical list would otherwise
+  /// report the carousel's offset, which says nothing about how far down the
+  /// page the tap landed.
+  ///
+  /// Never throws — a failure here degrades to "no scroll geometry", i.e. the
+  /// tap is still recorded, exactly as before this existed.
+  _ScrollGeometry? _resolveScrollGeometry(Element chosen, Offset globalPosition) {
+    try {
+      ScrollableState? scrollable;
+      // The chosen element itself may BE the scrollable's descendant chain
+      // start; visitAncestorElements walks strictly upwards from it.
+      chosen.visitAncestorElements((ancestor) {
+        try {
+          if (ancestor is StatefulElement && ancestor.state is ScrollableState) {
+            final candidate = ancestor.state as ScrollableState;
+            // `position` throws when the scrollable has no attached controller
+            // yet — skip that ancestor rather than abandoning the whole walk,
+            // or one not-yet-attached list would hide the page's real scroller.
+            if (candidate.position.axis == Axis.vertical) {
+              scrollable = candidate;
+              return false; // innermost vertical one wins; stop here.
+            }
+          }
+        } on Object catch (_) {
+          // Keep walking upwards.
+        }
+        return true;
+      });
+
+      final state = scrollable;
+      if (state == null) return null;
+
+      final position = state.position;
+      // A position that hasn't been laid out yet has neither; reading either
+      // would throw, and a half-known geometry is worse than none.
+      if (!position.hasPixels || !position.hasContentDimensions) return null;
+
+      final viewportHeight = position.viewportDimension;
+      final contentHeight = position.maxScrollExtent + viewportHeight;
+      // Not actually scrollable (content fits): `$pos_y` already places the tap
+      // correctly, and emitting a content height equal to the viewport would
+      // just add noise.
+      if (viewportHeight <= 0 || position.maxScrollExtent <= 0) return null;
+
+      // The viewport is rarely flush with the top of the screen (app bars,
+      // safe areas), so the tap's offset INSIDE the viewport is what adds to
+      // the scroll offset — not its raw screen y.
+      final box = state.context.findRenderObject();
+      if (box is! RenderBox || !box.hasSize) return null;
+      final localY = box.globalToLocal(globalPosition).dy;
+
+      return _ScrollGeometry(
+        scrollY: position.pixels,
+        contentY: position.pixels + localY,
+        contentHeight: contentHeight,
+        viewportHeight: viewportHeight,
       );
     } on Object catch (_) {
       return null;
diff --git a/sdk/flutter_analytics/lib/src/autocapture/screenshot_autocapture.dart b/sdk/flutter_analytics/lib/src/autocapture/screenshot_autocapture.dart
index 26bc33f..376507a 100644
--- a/sdk/flutter_analytics/lib/src/autocapture/screenshot_autocapture.dart
+++ b/sdk/flutter_analytics/lib/src/autocapture/screenshot_autocapture.dart
@@ -157,6 +157,18 @@ class ScreenshotAutocapture {
                 contentType: MediaType('image', 'jpeg'),
               ),
             );
+      // Sent ONLY for a stitched full-page capture, so a single-viewport upload's payload stays
+      // byte-identical to before. The server reads an absent field as "not a full-page capture"
+      // and stores NULL, which is what its heatmap keys off to fall back to viewport geometry —
+      // sending 0 or "null" here would claim a page of no height instead.
+      final contentHeight = shot.contentHeight;
+      final viewportHeight = shot.viewportHeight;
+      if (contentHeight != null) {
+        request.fields['content_height'] = '$contentHeight';
+      }
+      if (viewportHeight != null) {
+        request.fields['viewport_height'] = '$viewportHeight';
+      }
       final response = await _client.send(request);
       // The backend answers 202 whether it stored or skipped a dup.
       if (response.statusCode == 202) {
diff --git a/sdk/flutter_analytics/lib/src/autocapture/screenshot_capturer.dart b/sdk/flutter_analytics/lib/src/autocapture/screenshot_capturer.dart
index 27b7f35..fe47d9f 100644
--- a/sdk/flutter_analytics/lib/src/autocapture/screenshot_capturer.dart
+++ b/sdk/flutter_analytics/lib/src/autocapture/screenshot_capturer.dart
@@ -14,6 +14,11 @@ const int kMaxScreenshotEdge = 640;
 /// JPEG quality for encoded screenshots (shared-contracts §18, q≈70).
 const int kScreenshotJpegQuality = 70;
 
+/// How many viewports a full-page capture will stitch before giving up and
+/// keeping what it has. A bound on memory and upload size, not a judgement:
+/// an infinite-scroll feed has no end, and a 20-screen JPEG helps nobody.
+const int kMaxStitchedViewports = 6;
+
 /// A captured, already-encoded screenshot ready to upload.
 ///
 /// [bytes] are the final JPEG payload (what gets hashed + POSTed); [width]
@@ -24,11 +29,29 @@ class CapturedScreenshot {
     required this.bytes,
     required this.width,
     required this.height,
+    this.contentHeight,
+    this.viewportHeight,
   });
 
   final Uint8List bytes;
   final int width;
   final int height;
+
+  /// Logical height of the scrollable content this image covers, when the
+  /// screen was taller than one viewport and the capture stitched it. Null on
+  /// a screen that fits, where the image simply IS the whole screen.
+  ///
+  /// A heatmap needs this to normalize a tap's `$content_y`: without it the
+  /// image's own pixel height says how tall the picture is, not how tall the
+  /// page was.
+  final double? contentHeight;
+
+  /// Logical height of one viewport — how much of [contentHeight] the user saw
+  /// at a time. Null for the same reason as [contentHeight].
+  final double? viewportHeight;
+
+  /// True when this image covers more than one viewport of a scrollable page.
+  bool get isFullPage => contentHeight != null;
 }
 
 /// Test seam (`SdkOverrides.screenshotCapturer`) that produces the JPEG bytes
@@ -79,6 +102,18 @@ class RepaintBoundaryScreenshotCapturer implements ScreenshotCapturer {
       await _awaitUiSettled();
       final boundary = _resolveBoundary();
       if (boundary == null || !boundary.hasSize) return null;
+
+      // A screen taller than its viewport cannot be represented by one frame:
+      // the reference image would show the first fold, and every tap recorded
+      // further down the page would have nothing to sit on. Stitch it instead.
+      final scrollable = _primaryVerticalScrollable();
+      if (scrollable != null) {
+        final stitched = await _captureFullPage(boundary, scrollable);
+        // A stitch that fails falls through to the single-frame path below —
+        // one fold of the page beats no screenshot at all.
+        if (stitched != null) return stitched;
+      }
+
       final logicalLongest = boundary.size.longestSide;
       if (logicalLongest <= 0) return null;
       // Render straight to the target scale so no second resize is needed.
@@ -124,6 +159,167 @@ class RepaintBoundaryScreenshotCapturer implements ScreenshotCapturer {
     }
   }
 
+  /// The screen's main vertical scrollable: the one with the largest viewport
+  /// that actually scrolls. Largest, not first, for the same reason
+  /// [_largestBoundary] picks the largest boundary — a depth-first walk hits
+  /// small nested lists (a chip row, a comment thread) long before the page's
+  /// own scroller.
+  ///
+  /// Returns null when nothing scrolls, which is the ordinary case and means
+  /// the existing single-frame capture is already correct.
+  ScrollableState? _primaryVerticalScrollable() {
+    try {
+      final root = WidgetsBinding.instance.rootElement;
+      if (root == null) return null;
+      ScrollableState? best;
+      var bestViewport = 0.0;
+      void visit(Element element) {
+        try {
+          if (element is StatefulElement && element.state is ScrollableState) {
+            final candidate = element.state as ScrollableState;
+            final position = candidate.position;
+            if (position.axis == Axis.vertical &&
+                position.hasPixels &&
+                position.hasContentDimensions &&
+                position.maxScrollExtent > 0 &&
+                position.viewportDimension > bestViewport) {
+              bestViewport = position.viewportDimension;
+              best = candidate;
+            }
+          }
+        } on Object {
+          // Skip a scrollable we can't measure; keep scanning the rest.
+        }
+        element.visitChildren(visit);
+      }
+
+      visit(root);
+      return best;
+    } on Object {
+      return null;
+    }
+  }
+
+  /// Scrolls the page from top to bottom, capturing each viewport, and
+  /// composites the frames into one tall image of the whole scrollable content.
+  ///
+  /// Each frame is drawn at its own scroll offset, so the final overlapping
+  /// frame (when the content isn't an exact multiple of the viewport) simply
+  /// overwrites the pixels it shares with the previous one — no tail arithmetic
+  /// and no seam. The scroll position is restored afterwards no matter what.
+  ///
+  /// Honest about its limits: content that reacts to scrolling rather than
+  /// moving with it — sticky headers, parallax, appear-on-scroll animations —
+  /// is captured once per frame and will repeat down the stitched image. This
+  /// runs only in debug builds as a developer's reference capture, so the cost
+  /// of an imperfect image is a slightly odd background, never a user-visible
+  /// effect.
+  Future<CapturedScreenshot?> _captureFullPage(
+    RenderRepaintBoundary boundary,
+    ScrollableState scrollable,
+  ) async {
+    final position = scrollable.position;
+    final originalOffset = position.pixels;
+    try {
+      final viewportHeight = position.viewportDimension;
+      final maxExtent = position.maxScrollExtent;
+      if (viewportHeight <= 0 || maxExtent <= 0) return null;
+
+      final viewportWidth = boundary.size.width;
+      if (viewportWidth <= 0) return null;
+
+      // Width, not longest side: a stitched page IS long, and the single-frame
+      // rule ([kMaxScreenshotEdge] on the longest side) would crush a
+      // 6-viewport capture to 640px tall and destroy its width with it.
+      final pixelRatio = viewportWidth > kMaxScreenshotEdge
+          ? kMaxScreenshotEdge / viewportWidth
+          : 1.0;
+
+      // Stop at the frame budget rather than at the bottom when a page is very
+      // long (or endless). `contentHeight` then describes what was CAPTURED,
+      // so a tap below it is simply outside the image rather than mis-placed.
+      final frames = <double>[];
+      for (var offset = 0.0; frames.length < kMaxStitchedViewports; ) {
+        frames.add(offset);
+        if (offset >= maxExtent) break;
+        // `clamp` is declared on num and returns num — .toDouble() keeps this
+        // assignable to the double it came from.
+        offset = (offset + viewportHeight).clamp(0.0, maxExtent).toDouble();
+      }
+
+      final capturedExtent = frames.last;
+      final contentHeight = capturedExtent + viewportHeight;
+      final canvasWidth = (viewportWidth * pixelRatio).round();
+      final canvasHeight = (contentHeight * pixelRatio).round();
+      if (canvasWidth <= 0 || canvasHeight <= 0) return null;
+
+      final canvas = img.Image(width: canvasWidth, height: canvasHeight);
+      for (final offset in frames) {
+        position.jumpTo(offset);
+        // Let the jump paint (and any scroll-triggered animation settle) before
+        // reading pixels, or the frame is the PREVIOUS offset's content.
+        await _awaitUiSettled();
+        final frame = await _renderFrame(boundary, pixelRatio);
+        if (frame == null) return null;
+        img.compositeImage(
+          canvas,
+          frame,
+          dstY: (offset * pixelRatio).round(),
+        );
+      }
+
+      final jpeg = img.encodeJpg(canvas, quality: kScreenshotJpegQuality);
+      return CapturedScreenshot(
+        bytes: jpeg,
+        width: canvas.width,
+        height: canvas.height,
+        contentHeight: contentHeight,
+        viewportHeight: viewportHeight,
+      );
+    } on Object {
+      return null;
+    } finally {
+      // Never leave the user's page parked where the capture left it.
+      try {
+        if (position.hasPixels && position.pixels != originalOffset) {
+          position.jumpTo(originalOffset);
+        }
+      } on Object {
+        // The scrollable may have been disposed mid-capture; nothing to restore.
+      }
+    }
+  }
+
+  /// Renders the boundary once at [pixelRatio], with privacy masks applied.
+  /// Masks are applied per frame, while their rects still describe what is on
+  /// screen — they are viewport coordinates, so applying them to the finished
+  /// stitch would black out the wrong rows.
+  Future<img.Image?> _renderFrame(
+    RenderRepaintBoundary boundary,
+    double pixelRatio,
+  ) async {
+    final uiImage = await boundary.toImage(pixelRatio: pixelRatio);
+    try {
+      final rgba = await uiImage.toByteData(format: ui.ImageByteFormat.rawRgba);
+      if (rgba == null) return null;
+      final bytes = rgba.buffer.asUint8List(
+        rgba.offsetInBytes,
+        rgba.lengthInBytes,
+      );
+      final image = img.Image.fromBytes(
+        width: uiImage.width,
+        height: uiImage.height,
+        bytes: Uint8List.fromList(bytes).buffer,
+        numChannels: 4,
+        order: img.ChannelOrder.rgba,
+      );
+      _applyPrivacyMasks(image, pixelRatio);
+      return image;
+    } finally {
+      uiImage.dispose();
+    }
+  }
+
   /// Waits for the UI to stop scheduling frames — i.e. the page transition (or
   /// any in-flight animation) has finished — so the captured frame is settled,
   /// not mid-animation. Polls `hasScheduledFrame` between frames, capped at
diff --git a/sdk/flutter_analytics/test/autocapture/screenshot_autocapture_test.dart b/sdk/flutter_analytics/test/autocapture/screenshot_autocapture_test.dart
index 27d2c02..905cbaf 100644
--- a/sdk/flutter_analytics/test/autocapture/screenshot_autocapture_test.dart
+++ b/sdk/flutter_analytics/test/autocapture/screenshot_autocapture_test.dart
@@ -36,12 +36,19 @@ class FakeScreenshotCapturer implements ScreenshotCapturer {
   }
 }
 
-CapturedScreenshot shot(List<int> bytes, {int width = 480, int height = 640}) =>
-    CapturedScreenshot(
-      bytes: Uint8List.fromList(bytes),
-      width: width,
-      height: height,
-    );
+CapturedScreenshot shot(
+  List<int> bytes, {
+  int width = 480,
+  int height = 640,
+  double? contentHeight,
+  double? viewportHeight,
+}) => CapturedScreenshot(
+  bytes: Uint8List.fromList(bytes),
+  width: width,
+  height: height,
+  contentHeight: contentHeight,
+  viewportHeight: viewportHeight,
+);
 
 /// Minimal `multipart/form-data` parser: text fields → values, file parts →
 /// their field names. Enough to assert the §18 upload shape without a real
@@ -134,6 +141,34 @@ void main() {
       expect(parsed.files, contains('image'));
       expect(parsed.raw.toLowerCase(), contains('filename="screenshot.jpg"'));
       expect(parsed.raw.toLowerCase(), contains('content-type: image/jpeg'));
+      // A single-viewport capture sends no page geometry at all: the server reads absent as
+      // "not a full-page capture" and stores NULL, which is what makes its heatmap fall back to
+      // viewport coordinates. Sending 0 here would claim a page of no height.
+      expect(parsed.fields.containsKey('content_height'), isFalse);
+      expect(parsed.fields.containsKey('viewport_height'), isFalse);
+    });
+
+    test('a stitched full-page capture reports what the image covers', () async {
+      final bytes = [9, 8, 7];
+      final capturer = FakeScreenshotCapturer(
+        result: shot(
+          bytes,
+          width: 390,
+          height: 2110,
+          contentHeight: 2110,
+          viewportHeight: 844,
+        ),
+      );
+      await build(capturer: capturer, client: recordingClient()).onScreenView(
+        'Feed',
+      );
+
+      final parsed = parseMultipart(requests.single);
+      expect(parsed.fields['content_height'], '2110.0');
+      expect(parsed.fields['viewport_height'], '844.0');
+      // The image's own pixel height says how tall the PICTURE is; content_height says how tall
+      // the PAGE was. They coincide here only because the fixture chose them to.
+      expect(parsed.fields['height'], '2110');
     });
 
     test('captures a screen once per app_version and persists the skip across '
```
