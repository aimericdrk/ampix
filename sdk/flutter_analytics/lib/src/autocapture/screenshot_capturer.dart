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
  });

  final Uint8List bytes;
  final int width;
  final int height;
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
