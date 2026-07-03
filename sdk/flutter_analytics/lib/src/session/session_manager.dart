import 'dart:ui' show AppLifecycleState;

import '../storage/key_value_store.dart';
import '../util/clock.dart';

/// SDK-side session engine (design §4): the session id rotates after
/// [timeout] in background; emits the reserved lifecycle events
/// $session_start / $session_end ($duration_ms) / $first_open /
/// $app_open / $app_background (shared-contracts §4).
class SessionManager {
  SessionManager({
    required Clock clock,
    required KeyValueStore store,
    required Duration timeout,
    required String Function() idFactory,
    required Future<void> Function(
      String event,
      Map<String, Object?> properties,
    )
    emit,
  }) : _clock = clock,
       _store = store,
       _timeout = timeout,
       _idFactory = idFactory,
       _emit = emit;

  static const sessionIdKey = 'mam_session_id';
  static const sessionStartKey = 'mam_session_start_ms';
  static const lastActivityKey = 'mam_last_activity_ms';
  static const hasLaunchedKey = 'mam_has_launched';

  final Clock _clock;
  final KeyValueStore _store;
  final Duration _timeout;
  final String Function() _idFactory;
  final Future<void> Function(String event, Map<String, Object?> properties)
  _emit;

  late String _sessionId;
  late int _sessionStartMs;
  bool _inBackground = false;

  String get sessionId => _sessionId;

  /// Cold start: resume a fresh-enough persisted session, or finalize the
  /// stale one (app killed mid-session) and begin a new session.
  Future<void> start() async {
    final firstLaunch = await _store.getString(hasLaunchedKey) == null;
    if (firstLaunch) await _store.setString(hasLaunchedKey, '1');

    final persistedId = await _store.getString(sessionIdKey);
    final persistedStartMs = int.tryParse(
      await _store.getString(sessionStartKey) ?? '',
    );
    final lastActivityMs = int.tryParse(
      await _store.getString(lastActivityKey) ?? '',
    );

    final resumable =
        persistedId != null &&
        persistedStartMs != null &&
        lastActivityMs != null &&
        _clock.nowMs() - lastActivityMs < _timeout.inMilliseconds;

    if (resumable) {
      _sessionId = persistedId;
      _sessionStartMs = persistedStartMs;
    } else {
      if (persistedId != null && persistedStartMs != null) {
        // Finalize the stale session under its OLD id before rotating.
        _sessionId = persistedId;
        _sessionStartMs = persistedStartMs;
        await _finalizeSession(lastActivityMs ?? persistedStartMs);
      }
      await _beginSession();
    }
    if (firstLaunch) await _emit(r'$first_open', const {});
    await _emit(r'$app_open', const {});
    await _touch();
  }

  /// Forwarded by the facade's WidgetsBindingObserver.
  Future<void> handleLifecycleState(AppLifecycleState state) async {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        if (_inBackground) return;
        _inBackground = true;
        await _emit(r'$app_background', const {});
        await _touch();
      case AppLifecycleState.resumed:
        if (!_inBackground) return;
        _inBackground = false;
        final lastActivityMs =
            int.tryParse(await _store.getString(lastActivityKey) ?? '') ??
            _clock.nowMs();
        if (_clock.nowMs() - lastActivityMs >= _timeout.inMilliseconds) {
          // Duration runs to the moment the app left the foreground.
          await _finalizeSession(lastActivityMs);
          await _beginSession();
        }
        await _emit(r'$app_open', const {});
        await _touch();
      case AppLifecycleState.inactive:
        break;
    }
  }

  /// Emits $session_end under the current (old) session id with
  /// $duration_ms measured from session start to [endedAtMs].
  Future<void> _finalizeSession(int endedAtMs) =>
      _emit(r'$session_end', {r'$duration_ms': endedAtMs - _sessionStartMs});

  Future<void> _beginSession() async {
    _sessionId = _idFactory();
    _sessionStartMs = _clock.nowMs();
    await _store.setString(sessionIdKey, _sessionId);
    await _store.setString(sessionStartKey, '$_sessionStartMs');
    await _emit(r'$session_start', const {});
  }

  /// Persists "now" as the last-activity timestamp. Last-activity is only
  /// touched on lifecycle transitions, so a hard kill while foregrounded
  /// leaves the persisted duration measured to the last transition — the
  /// backend's session finalizer (BullMQ job, master design) reconciles
  /// such sessions from their last event timestamp.
  Future<void> _touch() =>
      _store.setString(lastActivityKey, '${_clock.nowMs()}');
}
