import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../myampix.dart';
import '../util/clock.dart';
import 'myampix_observer.dart';
import 'screenshot_boundary_key.dart';

/// Tap slop (design §11): a pointer down/up pair within this many logical
/// pixels of each other counts as a tap, not a drag.
const double _tapSlopPx = 18;

/// Maximum down-to-up duration (design §11) for a pair to count as a tap.
const Duration _tapMaxDuration = Duration(milliseconds: 500);

/// Rage-tap detection window and radius (design §11).
const Duration _rageWindow = Duration(seconds: 1);
const double _rageRadiusPx = 32;
const int _rageMinCount = 3;

/// Widget types considered "interesting" tap targets even without an
/// explicit `Key` or `Semantics` label (design §11).
const Set<String> _interactiveWidgetTypes = {
  'InkWell',
  'InkResponse',
  'GestureDetector',
  'ListTile',
  'Switch',
  'Checkbox',
  'Radio',
};

/// Wraps the app to autocapture `$tap` (and `$rage_tap`) taps anywhere in
/// the subtree (shared-contracts §4, design §11, milestone M2):
///
/// ```dart
/// runApp(MyAmpixTracker(child: MyApp()))
/// ```
///
/// Implementation is a passive `Listener` (`onPointerDown`/`onPointerUp`)
/// with `HitTestBehavior.translucent` — it OBSERVES pointers alongside the
/// normal gesture arena and never absorbs or competes with the app's own
/// gesture handling (design §11: "never competes with app gestures").
///
/// Toggle via `MyAmpixConfig.autocaptureTaps`. Never throws: hit-testing
/// and tree-walking run inside a try/catch and a failure degrades to "no
/// event" (design §13).
class MyAmpixTracker extends StatefulWidget {
  const MyAmpixTracker({
    super.key,
    required this.child,
    @visibleForTesting this.clock,
    @visibleForTesting this.track,
  });

  final Widget child;

  @visibleForTesting
  final Clock? clock;

  @visibleForTesting
  final AutocaptureTrackFn? track;

  @override
  State<MyAmpixTracker> createState() => _MyAmpixTrackerState();
}

class _PointerDownInfo {
  _PointerDownInfo(this.position, this.time);
  final Offset position;
  final DateTime time;
}

class _RecentTap {
  _RecentTap(this.position, this.time);
  final Offset position;
  final DateTime time;
}

class _TapTarget {
  _TapTarget({
    this.widgetType,
    this.label,
    this.scrollY,
    this.contentY,
    this.contentHeight,
    this.viewportHeight,
  });
  final String? widgetType;
  final String? label;

  /// Scroll offset of the enclosing vertical scrollable when the tap happened.
  final double? scrollY;

  /// The tap's y in CONTENT space: how far down the scrollable's full content
  /// it landed, independent of where the user had scrolled to. This is the one
  /// a heatmap can place; `$pos_y` alone cannot, because it is measured against
  /// the visible viewport.
  final double? contentY;

  /// Total scrollable content height (`maxScrollExtent + viewportDimension`) —
  /// what [contentY] should be normalized against.
  final double? contentHeight;

  /// Height of the scrollable's viewport, i.e. how much of [contentHeight] was
  /// visible at once.
  final double? viewportHeight;
}

/// The scroll geometry of one tap, resolved from the tapped widget's nearest
/// enclosing VERTICAL scrollable. Null when the tap wasn't inside one (a fixed
/// screen), which is exactly when `$pos_y` is already sufficient.
class _ScrollGeometry {
  _ScrollGeometry({
    required this.scrollY,
    required this.contentY,
    required this.contentHeight,
    required this.viewportHeight,
  });
  final double scrollY;
  final double contentY;
  final double contentHeight;
  final double viewportHeight;
}

class _MyAmpixTrackerState extends State<MyAmpixTracker> {
  late final Clock _clock = widget.clock ?? const SystemClock();
  late final AutocaptureTrackFn _track = widget.track ?? _defaultTrack;

  final Map<int, _PointerDownInfo> _downByPointer = {};
  final List<_RecentTap> _recentTaps = [];

  static void _defaultTrack(String event, Map<String, Object?> properties) {
    if (!MyAmpix.instance.autocaptureTapsEnabled) return;
    MyAmpix.instance.track(event, properties: properties);
  }

  void _onPointerDown(PointerDownEvent event) {
    try {
      _downByPointer[event.pointer] = _PointerDownInfo(
        event.position,
        _clock.now(),
      );
    } on Object catch (_) {
      // Never-throw guarantee (design §13).
    }
  }

  void _onPointerUp(PointerUpEvent event) {
    try {
      final down = _downByPointer.remove(event.pointer);
      if (down == null) return;
      final elapsed = _clock.now().difference(down.time);
      final distance = (event.position - down.position).distance;
      if (elapsed > _tapMaxDuration || distance > _tapSlopPx) return;
      _handleTap(down.position);
    } on Object catch (_) {
      // Never-throw guarantee (design §13).
    }
  }

  void _onPointerCancel(PointerCancelEvent event) {
    _downByPointer.remove(event.pointer);
  }

  void _handleTap(Offset position) {
    final target = _resolveTarget(position);
    final properties = <String, Object?>{
      if (target?.widgetType != null) r'$widget_type': target!.widgetType,
      if (target?.label != null) r'$widget_label': target!.label,
      if (MyAmpixObserver.currentScreenName != null)
        r'$screen_name': MyAmpixObserver.currentScreenName,
      r'$pos_x': position.dx,
      r'$pos_y': position.dy,
      // Scroll geometry, present only when the tap landed inside a vertical
      // scrollable that actually scrolls. `$content_y` is the placeable one:
      // `$pos_y` is measured against the visible viewport, so on a tall screen
      // it says nothing about where in the page the tap landed.
      if (target?.scrollY != null) r'$scroll_y': target!.scrollY,
      if (target?.contentY != null) r'$content_y': target!.contentY,
      if (target?.contentHeight != null) r'$content_height': target!.contentHeight,
      if (target?.viewportHeight != null)
        r'$viewport_height': target!.viewportHeight,
    };
    _track(r'$tap', properties);
    _checkRageTap(position, properties);
  }

  /// Sliding-window rage-tap detector (design §11): ≥3 taps within 1 s
  /// inside a 32-px radius of each other emit one `$rage_tap`, in addition
  /// to (never instead of) each tap's own `$tap` event.
  void _checkRageTap(Offset position, Map<String, Object?> tapProperties) {
    final now = _clock.now();
    _recentTaps
      ..add(_RecentTap(position, now))
      ..removeWhere((t) => now.difference(t.time) > _rageWindow);

    final clustered = _recentTaps
        .where((t) => (t.position - position).distance <= _rageRadiusPx)
        .length;

    if (clustered >= _rageMinCount) {
      _track(r'$rage_tap', {...tapProperties, r'$tap_count': clustered});
      // Reset the burst so a long rapid-tap streak emits one $rage_tap per
      // burst of _rageMinCount, not one per additional tap.
      _recentTaps.clear();
    }
  }

  /// Hit-tests [position] against the current frame and walks the widget
  /// `Element` tree from the root (works in release builds, unlike
  /// `debugCreator`) to find the deepest "interesting" matched element.
  _TapTarget? _resolveTarget(Offset position) {
    try {
      final view = View.maybeOf(context);
      final rootElement = WidgetsBinding.instance.rootElement;
      if (view == null || rootElement == null) return null;

      final result = HitTestResult();
      WidgetsBinding.instance.hitTestInView(result, position, view.viewId);
      final hitRenderObjects = result.path
          .map((entry) => entry.target)
          .whereType<RenderObject>()
          .toSet();
      if (hitRenderObjects.isEmpty) return null;

      final matches = <(Element, int)>[];
      void walk(Element element, int depth) {
        try {
          final renderObject = element.renderObject;
          if (renderObject != null && hitRenderObjects.contains(renderObject)) {
            matches.add((element, depth));
          }
        } on Object catch (_) {
          // Skip this element; keep walking the rest of the tree.
        }
        element.visitChildren((child) => walk(child, depth + 1));
      }

      walk(rootElement, 0);
      if (matches.isEmpty) return null;

      matches.sort((a, b) => b.$2.compareTo(a.$2)); // deepest first
      final chosen = matches
          .map((m) => m.$1)
          .firstWhere(_isInteresting, orElse: () => matches.first.$1);

      final scroll = _resolveScrollGeometry(chosen, position);
      return _TapTarget(
        widgetType: chosen.widget.runtimeType.toString(),
        label: _resolveLabel(chosen),
        scrollY: scroll?.scrollY,
        contentY: scroll?.contentY,
        contentHeight: scroll?.contentHeight,
        viewportHeight: scroll?.viewportHeight,
      );
    } on Object catch (_) {
      return null;
    }
  }

  /// Resolves the scroll geometry of [chosen] — the widget the tap hit — by
  /// walking up to its nearest enclosing VERTICAL scrollable.
  ///
  /// Why this exists: `$pos_x`/`$pos_y` are the raw pointer position, i.e.
  /// VIEWPORT coordinates. On a screen taller than the viewport the same
  /// content sits at a different `$pos_y` depending on where the user had
  /// scrolled to, so every scroll position collapses onto the same band of a
  /// heatmap and none of them can be placed against a reference screenshot.
  /// `contentY` restores that: it is the tap's position in the scrollable's
  /// full content, which is stable no matter how far the user had scrolled.
  ///
  /// The nearest scrollable is deliberately filtered to the vertical axis: a
  /// tap inside a horizontal carousel nested in a vertical list would otherwise
  /// report the carousel's offset, which says nothing about how far down the
  /// page the tap landed.
  ///
  /// Never throws — a failure here degrades to "no scroll geometry", i.e. the
  /// tap is still recorded, exactly as before this existed.
  _ScrollGeometry? _resolveScrollGeometry(Element chosen, Offset globalPosition) {
    try {
      ScrollableState? scrollable;
      // The chosen element itself may BE the scrollable's descendant chain
      // start; visitAncestorElements walks strictly upwards from it.
      chosen.visitAncestorElements((ancestor) {
        try {
          if (ancestor is StatefulElement && ancestor.state is ScrollableState) {
            final candidate = ancestor.state as ScrollableState;
            // `position` throws when the scrollable has no attached controller
            // yet — skip that ancestor rather than abandoning the whole walk,
            // or one not-yet-attached list would hide the page's real scroller.
            if (candidate.position.axis == Axis.vertical) {
              scrollable = candidate;
              return false; // innermost vertical one wins; stop here.
            }
          }
        } on Object catch (_) {
          // Keep walking upwards.
        }
        return true;
      });

      final state = scrollable;
      if (state == null) return null;

      final position = state.position;
      // A position that hasn't been laid out yet has neither; reading either
      // would throw, and a half-known geometry is worse than none.
      if (!position.hasPixels || !position.hasContentDimensions) return null;

      final viewportHeight = position.viewportDimension;
      final contentHeight = position.maxScrollExtent + viewportHeight;
      // Not actually scrollable (content fits): `$pos_y` already places the tap
      // correctly, and emitting a content height equal to the viewport would
      // just add noise.
      if (viewportHeight <= 0 || position.maxScrollExtent <= 0) return null;

      // The viewport is rarely flush with the top of the screen (app bars,
      // safe areas), so the tap's offset INSIDE the viewport is what adds to
      // the scroll offset — not its raw screen y.
      final box = state.context.findRenderObject();
      if (box is! RenderBox || !box.hasSize) return null;
      final localY = box.globalToLocal(globalPosition).dy;

      return _ScrollGeometry(
        scrollY: position.pixels,
        contentY: position.pixels + localY,
        contentHeight: contentHeight,
        viewportHeight: viewportHeight,
      );
    } on Object catch (_) {
      return null;
    }
  }

  bool _isInteresting(Element element) {
    final widget = element.widget;
    if (widget.key != null) return true;
    if (widget is Semantics && widget.properties.label != null) return true;
    final typeName = widget.runtimeType.toString();
    return _interactiveWidgetTypes.contains(typeName) ||
        typeName.endsWith('Button');
  }

  /// Key value → Semantics label → nearest descendant `Text` data, first
  /// non-null (design §11).
  String? _resolveLabel(Element element) {
    final widget = element.widget;
    final key = widget.key;
    if (key is ValueKey<Object?>) return '${key.value}';
    if (key != null) return key.toString();
    if (widget is Semantics && widget.properties.label != null) {
      return widget.properties.label;
    }

    String? text;
    void search(Element e, int depth) {
      if (text != null || depth > 4) return;
      final w = e.widget;
      if (w is Text) {
        text = w.data;
        return;
      }
      e.visitChildren((child) => search(child, depth + 1));
    }

    search(element, 0);
    return text;
  }

  @override
  Widget build(BuildContext context) {
    // Wrap the app subtree in a keyed `RepaintBoundary` so the screenshot
    // capturer (shared-contracts §18) renders the WHOLE screen from a stable,
    // SDK-controlled boundary instead of the first/partial one a tree walk
    // would find — the same subtree we already observe for taps.
    return RepaintBoundary(
      key: myampixScreenshotBoundaryKey,
      child: Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: _onPointerDown,
        onPointerUp: _onPointerUp,
        onPointerCancel: _onPointerCancel,
        child: widget.child,
      ),
    );
  }
}
