import 'package:flutter/widgets.dart';

import '../myampmix.dart';
import '../util/clock.dart';

/// Signature used to forward autocaptured events into the SDK's public
/// `track()` path so identity/session/context/sanitization all apply the
/// same way they do for a manual `MyAmpMix.instance.track(...)` call.
typedef AutocaptureTrackFn =
    void Function(String event, Map<String, Object?> properties);

/// `NavigatorObserver` that autocaptures `$screen_view` (shared-contracts
/// §4, design §11, milestone M2). Attach it once:
///
/// ```dart
/// MaterialApp(navigatorObservers: [MyAmpMixObserver()])
/// ```
///
/// Only `PageRoute`s count as screens; dialogs/bottom sheets are ignored.
/// Toggle via `MyAmpMixConfig.autocaptureScreens`. Never throws: every
/// callback is wrapped so a failure degrades to "no event", never a crash
/// (design §13).
class MyAmpMixObserver extends NavigatorObserver {
  MyAmpMixObserver({
    this.screenNameExtractor,
    @visibleForTesting Clock? clock,
    @visibleForTesting AutocaptureTrackFn? track,
  }) : _clock = clock ?? const SystemClock(),
       _track = track ?? _defaultTrack;

  /// Optional: derive a human-readable screen name from a route. Return `null`
  /// to fall back to the default (`route.settings.name`, then the route's
  /// runtime type). Use this when your routes are unnamed so screen names
  /// aren't the useless `MaterialPageRoute<...>` — e.g.
  /// `MyAmpMixObserver(screenNameExtractor: (r) => r.settings.name ?? myNameFor(r))`.
  final String? Function(Route<dynamic> route)? screenNameExtractor;

  final Clock _clock;
  final AutocaptureTrackFn _track;

  int? _screenEnteredAtMs;

  /// The name of the currently visible screen, updated by this observer and
  /// read by `MyAmpMixTracker` so `$tap`/`$rage_tap` can carry `$screen_name`
  /// even though the tracker sits above the `Navigator` (design §11: "The
  /// current screen name is shared with the tap capturer."). Not part of
  /// the public API.
  static String? currentScreenName;

  /// Resets shared static autocapture screen state between tests.
  @visibleForTesting
  static void resetForTesting() => currentScreenName = null;

  static void _defaultTrack(String event, Map<String, Object?> properties) {
    if (!MyAmpMix.instance.autocaptureScreensEnabled) return;
    MyAmpMix.instance.track(event, properties: properties);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _handleRouteChange(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    _handleRouteChange(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    // Only a real screen pop (popping a PageRoute) reveals a "new" screen.
    // Dismissing a dialog/bottom sheet (a non-PageRoute) pops back to the
    // SAME screen that was already current, so it must not re-emit
    // $screen_view — mirrors the didPush guard, which checks the route
    // being pushed rather than the one left behind.
    if (route is PageRoute) _handleRouteChange(previousRoute);
  }

  /// Resolves the now-visible route's screen name and emits `$screen_view`.
  /// Bookkeeping (`currentScreenName`/entry timestamp) is updated even when
  /// [MyAmpMix.autocaptureScreensEnabled] is false, so tap autocapture (an
  /// independently toggleable feature) still has an accurate `$screen_name`
  /// to stamp on its own events.
  void _handleRouteChange(Route<dynamic>? route) {
    try {
      if (route == null || route is! PageRoute) return;
      final screenName =
          screenNameExtractor?.call(route) ??
          route.settings.name ??
          route.runtimeType.toString();
      final nowMs = _clock.nowMs();
      final previousScreen = currentScreenName;
      final enteredAtMs = _screenEnteredAtMs;

      currentScreenName = screenName;
      _screenEnteredAtMs = nowMs;

      final properties = <String, Object?>{r'$screen_name': screenName};
      if (previousScreen != null) {
        properties[r'$previous_screen'] = previousScreen;
      }
      if (enteredAtMs != null) {
        properties[r'$time_on_previous_ms'] = nowMs - enteredAtMs;
      }
      _track(r'$screen_view', properties);
    } on Object catch (_) {
      // Never-throw guarantee (design §13): a hostile route/settings object
      // must not crash Navigator's observer dispatch.
    }
  }
}
