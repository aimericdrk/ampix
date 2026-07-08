import 'package:flutter/foundation.dart';

import '../config.dart';

/// Internal debug-only logger. The SDK never surfaces errors to the host app:
/// it logs them here, and only when the configured [level] permits and the
/// build is a debug build (`kDebugMode`) — the SDK never prints in release.
///
/// Filtering is by the effective [MyAmpixLogLevel]:
/// - internal diagnostics — `log(message)` with no `error` — emit only at
///   [MyAmpixLogLevel.debug] (the most verbose level);
/// - error-carrying diagnostics — `log(message, error, ...)` — emit at
///   [MyAmpixLogLevel.error] and above.
class MamLogger {
  const MamLogger({this.level = MyAmpixLogLevel.none});

  /// Builds a logger from a config's reconciled [MyAmpixConfig.effectiveLogLevel].
  factory MamLogger.fromConfig(MyAmpixConfig config) =>
      MamLogger(level: config.effectiveLogLevel);

  /// The effective verbosity threshold this logger filters against.
  final MyAmpixLogLevel level;

  void log(String message, [Object? error, StackTrace? stackTrace]) {
    if (!kDebugMode) return;
    // Internal diagnostics (no error) are the most verbose and require the
    // full `debug` level; error-carrying diagnostics surface from `error` up.
    final required = error == null
        ? MyAmpixLogLevel.debug
        : MyAmpixLogLevel.error;
    if (level.index < required.index) return;
    debugPrint('[MyAmpix] $message${error == null ? '' : ' | $error'}');
    if (stackTrace != null) {
      debugPrint('$stackTrace');
    }
  }
}
