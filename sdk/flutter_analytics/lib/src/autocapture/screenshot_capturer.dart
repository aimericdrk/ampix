import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:image/image.dart' as img;

import 'myampix_privacy.dart';
import 'screenshot_boundary_key.dart';

/// Longest-side cap for an uploaded screenshot (shared-contracts §18).
const int kMaxScreenshotEdge = 640;

/// JPEG quality for encoded screenshots (shared-contracts §18, q≈70).
const int kScreenshotJpegQuality = 70;

/// How many viewports a full-page capture will stitch before giving up and
/// keeping what it has. A bound on memory and upload size, not a judgement:
/// an infinite-scroll feed has no end, and a 20-screen JPEG helps nobody.
const int kMaxStitchedViewports = 6;

/// A captured, already-encoded screenshot ready to upload.
///
/// [bytes] are the final JPEG payload (what gets hashed + POSTed); [width]
/// and [height] are that JPEG's pixel dimensions (already downscaled to the
/// ≤ [kMaxScreenshotEdge] longest-side cap).
class CapturedScreenshot {
  const CapturedScreenshot({
    required this.bytes,
    required this.width,
    required this.height,
    this.contentHeight,
    this.viewportHeight,
    this.contentTop,
  });

  final Uint8List bytes;
  final int width;
  final int height;

  /// Total logical height this stitched image covers, when the screen was
  /// taller than one viewport: top chrome + captured scrollable content +
  /// (when the capture reached the page's bottom) bottom chrome. This is the
  /// denominator every tap is normalized against on the backend. Null on a
  /// screen that fits, where the image simply IS the whole screen.
  final double? contentHeight;

  /// Logical height of one viewport — how much the user saw at a time. Null
  /// for the same reason as [contentHeight].
  final double? viewportHeight;

  /// Where CONTENT space begins inside the image: the logical height of the
  /// fixed chrome above the scrollable (status bar, app bar with the exit
  /// button…), included once at the top of the stitch. A tap's `$content_y`
  /// is measured from the scrollable's top, so its row in this image is
  /// `contentTop + $content_y`. Null with [contentHeight].
  final double? contentTop;

  /// True when this image covers more than one viewport of a scrollable page.
  bool get isFullPage => contentHeight != null;
}

/// Test seam (`SdkOverrides.screenshotCapturer`) that produces the JPEG bytes
/// for the current frame. The production implementation renders a root
/// `RepaintBoundary`; tests inject a fake that returns canned bytes so the
/// capture→hash→throttle→upload mapping can be exercised with no real
/// rendering (shared-contracts §18 verification).
///
/// Never-throw contract (design §13): a capturer returns `null` on any
/// failure instead of throwing — the caller drops the frame silently.
abstract interface class ScreenshotCapturer {
  Future<CapturedScreenshot?> capture();
}

/// Production [ScreenshotCapturer]: renders a root `RenderRepaintBoundary`
/// (`toImage`), downscales to ≤ [kMaxScreenshotEdge] on the longest side by
/// choosing the capture `pixelRatio`, blacks out any mounted [MyAmpixPrivacy]
/// regions, then encodes JPEG q≈70 (shared-contracts §18).
///
/// This path needs a live widget tree + engine and is therefore NOT unit
/// tested (tests inject a fake capturer). Everything is wrapped so a failure
/// degrades to `null` (no screenshot), never a crash into the host app.
class RepaintBoundaryScreenshotCapturer implements ScreenshotCapturer {
  RepaintBoundaryScreenshotCapturer({
    GlobalKey? boundaryKey,
    Duration maxSettle = const Duration(milliseconds: 2500),
  }) : _boundaryKey = boundaryKey ?? myampixScreenshotBoundaryKey,
       _maxSettle = maxSettle;

  /// Key of the full-screen `RepaintBoundary` to capture. Defaults to
  /// [myampixScreenshotBoundaryKey], the boundary [MyAmpixTracker] wraps
  /// around the app subtree — so when the tracker is mounted this resolves to
  /// the whole screen. When that key isn't mounted, `_resolveBoundary` falls
  /// back to the LARGEST `RenderRepaintBoundary` on screen (the full-screen
  /// one), never the first/partial sub-boundary a depth-first walk would hit.
  final GlobalKey _boundaryKey;

  /// Upper bound on how long to wait for the UI to stop animating before
  /// capturing anyway (so a screen with a persistent animation still shoots).
  final Duration _maxSettle;

  @override
  Future<CapturedScreenshot?> capture() async {
    try {
      // Wait for the navigation transition (or any in-flight animation) to
      // FINISH before grabbing the frame — otherwise we capture a mid-animation,
      // off-centre/half-painted frame. Bounded by [_maxSettle].
      await _awaitUiSettled();
      final boundary = _resolveBoundary();
      if (boundary == null || !boundary.hasSize) return null;

      // A screen taller than its viewport cannot be represented by one frame:
      // the reference image would show the first fold, and every tap recorded
      // further down the page would have nothing to sit on. Stitch it instead.
      final scrollable = _primaryVerticalScrollable();
      if (scrollable != null) {
        final stitched = await _captureFullPage(boundary, scrollable);
        // A stitch that fails falls through to the single-frame path below —
        // one fold of the page beats no screenshot at all.
        if (stitched != null) return stitched;
      }

      final logicalLongest = boundary.size.longestSide;
      if (logicalLongest <= 0) return null;
      // Render straight to the target scale so no second resize is needed.
      final pixelRatio = logicalLongest > kMaxScreenshotEdge
          ? kMaxScreenshotEdge / logicalLongest
          : 1.0;
      final uiImage = await boundary.toImage(pixelRatio: pixelRatio);
      try {
        final rgba = await uiImage.toByteData(
          format: ui.ImageByteFormat.rawRgba,
        );
        if (rgba == null) return null;
        // Use the EXACT bytes the ByteData views (honour its offset/length),
        // copied into a fresh, tightly-packed buffer at offset 0 — passing
        // `rgba.buffer` alone would hand over the whole underlying ByteBuffer
        // and misread every row, mis-framing the image. `toByteData(rawRgba)`
        // is RGBA, so declare the channel order explicitly.
        final bytes = rgba.buffer.asUint8List(
          rgba.offsetInBytes,
          rgba.lengthInBytes,
        );
        final image = img.Image.fromBytes(
          width: uiImage.width,
          height: uiImage.height,
          bytes: Uint8List.fromList(bytes).buffer,
          numChannels: 4,
          order: img.ChannelOrder.rgba,
        );
        _applyPrivacyMasks(image, pixelRatio);
        final jpeg = img.encodeJpg(image, quality: kScreenshotJpegQuality);
        return CapturedScreenshot(
          bytes: jpeg,
          width: uiImage.width,
          height: uiImage.height,
        );
      } finally {
        uiImage.dispose();
      }
    } on Object {
      // Never-throw guarantee (design §13): any rendering/encoding failure
      // degrades to "no screenshot", never a crash.
      return null;
    }
  }

  /// The screen's main vertical scrollable: the one with the largest viewport
  /// that actually scrolls AND is actually visible. Largest, not first, for
  /// the same reason [_largestBoundary] picks the largest boundary — a
  /// depth-first walk hits small nested lists (a chip row, a comment thread)
  /// long before the page's own scroller.
  ///
  /// Visible, because the element tree still contains everything the user is
  /// NOT looking at: the Navigator keeps the routes underneath the top one
  /// mounted (offstage), and an `IndexedStack` keeps every tab alive — all
  /// laid out with real viewport dimensions. Picking one of those made
  /// `_captureFullPage` scroll a page nobody can see: every rendered frame
  /// showed the same visible content, and the stitch came out as the first
  /// fold repeated with an offset. [_isOnScreen] hit-tests the candidate to
  /// keep only scrollables that are actually painted and reachable.
  ///
  /// Returns null when nothing visible scrolls, which is the ordinary case and
  /// means the existing single-frame capture is already correct.
  ScrollableState? _primaryVerticalScrollable() {
    try {
      final root = WidgetsBinding.instance.rootElement;
      if (root == null) return null;
      ScrollableState? best;
      var bestViewport = 0.0;
      void visit(Element element) {
        try {
          if (element is StatefulElement && element.state is ScrollableState) {
            final candidate = element.state as ScrollableState;
            final position = candidate.position;
            if (position.axis == Axis.vertical &&
                position.hasPixels &&
                position.hasContentDimensions &&
                position.maxScrollExtent > 0 &&
                position.viewportDimension > bestViewport &&
                _isOnScreen(candidate)) {
              bestViewport = position.viewportDimension;
              best = candidate;
            }
          }
        } on Object {
          // Skip a scrollable we can't measure; keep scanning the rest.
        }
        element.visitChildren(visit);
      }

      visit(root);
      return best;
    } on Object {
      return null;
    }
  }

  /// Test-only view of [_primaryVerticalScrollable] so the visibility filter
  /// (offstage routes, hidden `IndexedStack` tabs, covered pages) can be
  /// regression-tested without a live engine render. The stitching itself
  /// stays untested by design — it needs real `toImage` frames.
  @visibleForTesting
  ScrollableState? debugPrimaryVerticalScrollable() =>
      _primaryVerticalScrollable();

  /// Whether [candidate] is the scrollable the user is actually looking at,
  /// established by hit-testing: a point inside a painted, reachable widget
  /// resolves through it; a point inside an offstage route or a hidden
  /// `IndexedStack` tab never does (offstage subtrees are laid out but not
  /// painted or hit-tested).
  ///
  /// Three sample points along the scrollable's vertical midline, because a
  /// single centre probe can land on a floating button or overlay that
  /// swallows the hit. Never throws; an unmeasurable candidate is "not
  /// visible".
  bool _isOnScreen(ScrollableState candidate) {
    try {
      final obj = candidate.context.findRenderObject();
      if (obj is! RenderBox || !obj.attached || !obj.hasSize) return false;
      final viewId = View.maybeOf(candidate.context)?.viewId;
      if (viewId == null) return false;
      final centerX = obj.size.width / 2;
      for (final fractionY in const [0.5, 0.25, 0.75]) {
        final point = obj.localToGlobal(
          Offset(centerX, obj.size.height * fractionY),
        );
        final result = HitTestResult();
        WidgetsBinding.instance.hitTestInView(result, point, viewId);
        for (final entry in result.path) {
          // The scrollable counts as hit when it — or anything inside it —
          // is on the hit path: its own outer render object defers to its
          // children, so the entries are usually the list's content.
          final target = entry.target;
          if (target is! RenderObject) continue;
          for (RenderObject? node = target; node != null; node = node.parent) {
            if (identical(node, obj)) return true;
          }
        }
      }
      return false;
    } on Object {
      return false;
    }
  }

  /// Scrolls the page from top to bottom, capturing each viewport, and
  /// composites the frames into one tall image of the whole scrollable content.
  ///
  /// Each frame is drawn at its own scroll offset, so the final overlapping
  /// frame (when the content isn't an exact multiple of the viewport) simply
  /// overwrites the pixels it shares with the previous one — no tail arithmetic
  /// and no seam. The scroll position is restored afterwards no matter what.
  ///
  /// Honest about its limits: content that reacts to scrolling rather than
  /// moving with it — sticky headers, parallax, appear-on-scroll animations —
  /// is captured once per frame and will repeat down the stitched image. This
  /// runs only in debug builds as a developer's reference capture, so the cost
  /// of an imperfect image is a slightly odd background, never a user-visible
  /// effect.
  Future<CapturedScreenshot?> _captureFullPage(
    RenderRepaintBoundary boundary,
    ScrollableState scrollable,
  ) async {
    final position = scrollable.position;
    final originalOffset = position.pixels;
    try {
      final viewportHeight = position.viewportDimension;
      final maxExtent = position.maxScrollExtent;
      if (viewportHeight <= 0 || maxExtent <= 0) return null;

      // The render is the WHOLE screen; the scrolled content only occupies the
      // scrollable's viewport band. Naive full-frame compositing repeated the
      // fixed chrome once per frame; pure viewport-cropping (the previous fix)
      // amputated the chrome entirely — no app bar, no exit button, no navbar
      // anywhere in the image. The stitch now reads like a phone's own "long
      // screenshot": the FIRST frame keeps everything from the top of the
      // screen down to the viewport's bottom (top chrome appears once), middle
      // frames contribute only their viewport band, and — when the capture
      // actually reached the page's bottom — the LAST frame extends to the
      // bottom of the screen (bottom chrome appears once). `contentTop` tells
      // the backend where content space begins inside the image, keeping tap
      // placement exact.
      final scrollBox = scrollable.context.findRenderObject();
      if (scrollBox is! RenderBox || !scrollBox.hasSize) return null;
      // Throws when [boundary] isn't an ancestor of the scrollable (possible
      // under the largest-boundary fallback) — caught below, falling back to
      // the single-frame capture.
      final viewportTopLeft = scrollBox.localToGlobal(
        Offset.zero,
        ancestor: boundary,
      );
      final boundaryWidth = boundary.size.width;
      final boundaryHeight = boundary.size.height;
      final viewportBoxHeight = scrollBox.size.height;
      if (boundaryWidth <= 0 || viewportBoxHeight <= 0) return null;

      // Full boundary width — chrome spans it, and it keeps the backend's
      // `$pos_x / screen_width` mapping exact (a viewport-width crop skewed x
      // by the scrollable's horizontal inset).
      final chromeTop = viewportTopLeft.dy.clamp(0.0, boundaryHeight);
      final viewportBottomY = (chromeTop + viewportBoxHeight).clamp(
        0.0,
        boundaryHeight,
      );
      final chromeBottom = boundaryHeight - viewportBottomY;

      // Width, not longest side: a stitched page IS long, and the single-frame
      // rule ([kMaxScreenshotEdge] on the longest side) would crush a
      // 6-viewport capture to 640px tall and destroy its width with it.
      final pixelRatio = boundaryWidth > kMaxScreenshotEdge
          ? kMaxScreenshotEdge / boundaryWidth
          : 1.0;

      // Stop at the frame budget rather than at the bottom when a page is very
      // long (or endless). `contentHeight` then describes what was CAPTURED,
      // so a tap below it is simply outside the image rather than mis-placed.
      final frames = <double>[];
      for (var offset = 0.0; frames.length < kMaxStitchedViewports; ) {
        frames.add(offset);
        if (offset >= maxExtent) break;
        // `clamp` is declared on num and returns num — .toDouble() keeps this
        // assignable to the double it came from.
        offset = (offset + viewportHeight).clamp(0.0, maxExtent).toDouble();
      }

      final capturedExtent = frames.last;
      // Bottom chrome is only appended when the capture reached the page's
      // real bottom — gluing a navbar under a mid-content truncation would
      // fake a page end that does not exist.
      final reachedBottom = capturedExtent >= maxExtent;
      // Total logical height the image covers: top chrome + captured content
      // + (when complete) bottom chrome. This is what gets uploaded as
      // `content_height` — the denominator every tap is normalized against.
      final captureHeight =
          chromeTop +
          capturedExtent +
          viewportHeight +
          (reachedBottom ? chromeBottom : 0.0);
      final canvasWidth = (boundaryWidth * pixelRatio).round();
      final canvasHeight = (captureHeight * pixelRatio).round();
      if (canvasWidth <= 0 || canvasHeight <= 0) return null;

      final canvas = img.Image(width: canvasWidth, height: canvasHeight);
      for (var i = 0; i < frames.length; i++) {
        final offset = frames[i];
        position.jumpTo(offset);
        // Let the jump paint (and any scroll-triggered animation settle) before
        // reading pixels, or the frame is the PREVIOUS offset's content.
        await _awaitUiSettled();
        final frame = await _renderFrame(boundary, pixelRatio);
        if (frame == null) return null;
        // Frame slice in screen space (privacy masks were applied by
        // _renderFrame while the frame was still in screen space): the first
        // frame starts at the top of the screen, the last (on a completed
        // capture) runs to its bottom, everything else is the viewport band.
        final isFirst = i == 0;
        final isLast = i == frames.length - 1;
        final srcTop = isFirst ? 0.0 : chromeTop;
        final srcBottom = (isLast && reachedBottom)
            ? boundaryHeight
            : viewportBottomY;
        final dstTop = isFirst ? 0.0 : chromeTop + offset;
        final cropped = img.copyCrop(
          frame,
          x: 0,
          y: (srcTop * pixelRatio).round().clamp(0, frame.height - 1),
          width: frame.width,
          height: ((srcBottom - srcTop) * pixelRatio).round().clamp(
            1,
            frame.height,
          ),
        );
        img.compositeImage(
          canvas,
          cropped,
          dstY: (dstTop * pixelRatio).round(),
        );
      }

      final jpeg = img.encodeJpg(canvas, quality: kScreenshotJpegQuality);
      return CapturedScreenshot(
        bytes: jpeg,
        width: canvas.width,
        height: canvas.height,
        contentHeight: captureHeight,
        viewportHeight: viewportHeight,
        contentTop: chromeTop,
      );
    } on Object {
      return null;
    } finally {
      // Never leave the user's page parked where the capture left it.
      try {
        if (position.hasPixels && position.pixels != originalOffset) {
          position.jumpTo(originalOffset);
        }
      } on Object {
        // The scrollable may have been disposed mid-capture; nothing to restore.
      }
    }
  }

  /// Renders the boundary once at [pixelRatio], with privacy masks applied.
  /// Masks are applied per frame, while their rects still describe what is on
  /// screen — they are viewport coordinates, so applying them to the finished
  /// stitch would black out the wrong rows.
  Future<img.Image?> _renderFrame(
    RenderRepaintBoundary boundary,
    double pixelRatio,
  ) async {
    final uiImage = await boundary.toImage(pixelRatio: pixelRatio);
    try {
      final rgba = await uiImage.toByteData(format: ui.ImageByteFormat.rawRgba);
      if (rgba == null) return null;
      final bytes = rgba.buffer.asUint8List(
        rgba.offsetInBytes,
        rgba.lengthInBytes,
      );
      final image = img.Image.fromBytes(
        width: uiImage.width,
        height: uiImage.height,
        bytes: Uint8List.fromList(bytes).buffer,
        numChannels: 4,
        order: img.ChannelOrder.rgba,
      );
      _applyPrivacyMasks(image, pixelRatio);
      return image;
    } finally {
      uiImage.dispose();
    }
  }

  /// Waits for the UI to stop scheduling frames — i.e. the page transition (or
  /// any in-flight animation) has finished — so the captured frame is settled,
  /// not mid-animation. Polls `hasScheduledFrame` between frames, capped at
  /// [_maxSettle] so a screen with a persistent animation still captures.
  /// Best-effort: any failure just proceeds to capture.
  Future<void> _awaitUiSettled() async {
    try {
      final binding = WidgetsBinding.instance;
      final stopwatch = Stopwatch()..start();
      // Await one frame first so a just-started transition has scheduled its
      // driving frames before we begin polling.
      await binding.endOfFrame;
      while (binding.hasScheduledFrame && stopwatch.elapsed < _maxSettle) {
        await binding.endOfFrame;
      }
    } on Object {
      // Never block/throw: fall through and capture whatever's on screen.
    }
  }

  RenderRepaintBoundary? _resolveBoundary() {
    final object = _boundaryKey.currentContext?.findRenderObject();
    if (object is RenderRepaintBoundary) return object;
    return _largestBoundary(WidgetsBinding.instance.rootElement?.renderObject);
  }

  /// Fallback when [_boundaryKey] isn't mounted: walk the render tree and
  /// return the LARGEST-area `RenderRepaintBoundary` — the full-screen one —
  /// instead of the first match a depth-first walk hits (often a partial
  /// sub-boundary like a list item or overlay entry → mis-framed capture).
  /// Never throws; returns `null` if nothing sized is found.
  RenderRepaintBoundary? _largestBoundary(RenderObject? root) {
    if (root == null) return null;
    RenderRepaintBoundary? best;
    var bestArea = -1.0;
    void visit(RenderObject node) {
      try {
        if (node is RenderRepaintBoundary && node.hasSize) {
          final area = node.size.width * node.size.height;
          if (area > bestArea) {
            bestArea = area;
            best = node;
          }
        }
        node.visitChildren(visit);
      } on Object {
        // Skip a node we can't measure/traverse; keep scanning the rest.
      }
    }

    visit(root);
    return best;
  }

  /// Paints a solid black rectangle over every mounted [MyAmpixPrivacy]
  /// region so PII the developer wrapped never reaches the uploaded image.
  void _applyPrivacyMasks(img.Image image, double pixelRatio) {
    final black = img.ColorRgb8(0, 0, 0);
    for (final rect in MyAmpixPrivacyRegistry.globalRects()) {
      try {
        final x0 = (rect.left * pixelRatio).floor().clamp(0, image.width - 1);
        final y0 = (rect.top * pixelRatio).floor().clamp(0, image.height - 1);
        final x1 = (rect.right * pixelRatio).ceil().clamp(0, image.width - 1);
        final y1 = (rect.bottom * pixelRatio).ceil().clamp(0, image.height - 1);
        if (x1 < x0 || y1 < y0) continue;
        img.fillRect(image, x1: x0, y1: y0, x2: x1, y2: y1, color: black);
      } on Object {
        // Skip an un-maskable region; keep masking the rest.
      }
    }
  }
}
