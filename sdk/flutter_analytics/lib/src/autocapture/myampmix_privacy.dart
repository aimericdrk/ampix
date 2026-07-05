import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Tracks the currently-mounted [MyAmpMixPrivacy] regions so the screenshot
/// capturer can black them out in captured frames (shared-contracts §18).
///
/// A process-wide registry (not per-SDK-instance) because the capturer needs
/// to enumerate privacy regions anywhere in the tree regardless of which
/// facade instance is active. Entries self-remove when the widget unmounts.
class MyAmpMixPrivacyRegistry {
  MyAmpMixPrivacyRegistry._();

  static final Set<RenderBox> _regions = <RenderBox>{};

  static void register(RenderBox region) => _regions.add(region);

  static void unregister(RenderBox region) => _regions.remove(region);

  /// Global-coordinate rectangles of every attached, laid-out privacy region.
  /// Un-laid-out or detached regions are skipped; never throws.
  static List<Rect> globalRects() {
    final rects = <Rect>[];
    for (final region in _regions) {
      try {
        if (!region.attached || !region.hasSize) continue;
        final topLeft = region.localToGlobal(Offset.zero);
        rects.add(topLeft & region.size);
      } on Object {
        // Skip a region we can't localize; keep collecting the rest.
      }
    }
    return rects;
  }

  /// Clears registered regions between tests.
  @visibleForTesting
  static void resetForTesting() => _regions.clear();
}

/// Masks its subtree (a solid black block) in automatic screenshots
/// (shared-contracts §18). Wrap PII / input fields:
///
/// ```dart
/// MyAmpMixPrivacy(child: TextField(controller: emailController))
/// ```
///
/// MVP behavior: the subtree renders normally on screen and is blacked out
/// only in the captured/uploaded image. The SDK does NOT auto-mask arbitrary
/// text — developers opt in per region (documented in HOW-TO-USE.md).
class MyAmpMixPrivacy extends SingleChildRenderObjectWidget {
  const MyAmpMixPrivacy({super.key, required Widget child})
    : super(child: child);

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderPrivacyRegion();
}

/// A transparent proxy that renders its child unchanged but registers itself
/// so the capturer can locate and black out this region.
class _RenderPrivacyRegion extends RenderProxyBox {
  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    MyAmpMixPrivacyRegistry.register(this);
  }

  @override
  void detach() {
    MyAmpMixPrivacyRegistry.unregister(this);
    super.detach();
  }
}
