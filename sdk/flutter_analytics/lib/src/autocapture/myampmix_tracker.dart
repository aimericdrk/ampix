import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../myampmix.dart';
import '../util/clock.dart';
import 'myampmix_observer.dart';
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
/// runApp(MyAmpMixTracker(child: MyApp()))
/// ```
///
/// Implementation is a passive `Listener` (`onPointerDown`/`onPointerUp`)
/// with `HitTestBehavior.translucent` — it OBSERVES pointers alongside the
/// normal gesture arena and never absorbs or competes with the app's own
/// gesture handling (design §11: "never competes with app gestures").
///
/// Toggle via `MyAmpMixConfig.autocaptureTaps`. Never throws: hit-testing
/// and tree-walking run inside a try/catch and a failure degrades to "no
/// event" (design §13).
class MyAmpMixTracker extends StatefulWidget {
  const MyAmpMixTracker({
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
  State<MyAmpMixTracker> createState() => _MyAmpMixTrackerState();
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
  _TapTarget({this.widgetType, this.label});
  final String? widgetType;
  final String? label;
}

class _MyAmpMixTrackerState extends State<MyAmpMixTracker> {
  late final Clock _clock = widget.clock ?? const SystemClock();
  late final AutocaptureTrackFn _track = widget.track ?? _defaultTrack;

  final Map<int, _PointerDownInfo> _downByPointer = {};
  final List<_RecentTap> _recentTaps = [];

  static void _defaultTrack(String event, Map<String, Object?> properties) {
    if (!MyAmpMix.instance.autocaptureTapsEnabled) return;
    MyAmpMix.instance.track(event, properties: properties);
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
      if (MyAmpMixObserver.currentScreenName != null)
        r'$screen_name': MyAmpMixObserver.currentScreenName,
      r'$pos_x': position.dx,
      r'$pos_y': position.dy,
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

      return _TapTarget(
        widgetType: chosen.widget.runtimeType.toString(),
        label: _resolveLabel(chosen),
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
      key: myAmpMixScreenshotBoundaryKey,
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
