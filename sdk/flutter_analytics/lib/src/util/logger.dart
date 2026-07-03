import 'package:flutter/foundation.dart';

/// Internal debug-only logger. The SDK never surfaces errors to the host app:
/// it logs them here, and only when [enabled] (config.debug) in debug builds.
class MamLogger {
  const MamLogger({required this.enabled});

  final bool enabled;

  void log(String message, [Object? error, StackTrace? stackTrace]) {
    if (!enabled || !kDebugMode) return;
    debugPrint('[MyAmpMix] $message${error == null ? '' : ' | $error'}');
    if (stackTrace != null) {
      debugPrint('$stackTrace');
    }
  }
}
