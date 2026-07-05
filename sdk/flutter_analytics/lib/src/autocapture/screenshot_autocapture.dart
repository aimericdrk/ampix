import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../storage/key_value_store.dart';
import '../util/logger.dart';
import 'screenshot_capturer.dart';

/// Captures + uploads one screenshot per `$screen_view` (shared-contracts
/// §18), throttled to **once per `(screen_name, app_version)`**: a screen is
/// captured only the first time it is viewed under the current `app_version`
/// and NEVER again for that version — persisted in the [KeyValueStore] so the
/// skip survives sessions and app relaunches. A new `app_version` re-captures
/// each screen exactly once (a screen's layout only changes between releases).
///
/// Never-throw (design §13): any capture/encode/upload failure is dropped
/// silently and does NOT mark the pair captured, so it retries next launch.
/// Gated at construction on `config.autocaptureScreenshots` and driven by the
/// injected [ScreenshotCapturer] + `http.Client` so it never touches real
/// rendering or the network in widget tests.
class ScreenshotAutocapture {
  ScreenshotAutocapture({
    required ScreenshotCapturer capturer,
    required http.Client client,
    required KeyValueStore store,
    required String serverUrl,
    required String token,
    required Future<String> Function() appVersion,
    MamLogger logger = const MamLogger(),
  }) : _capturer = capturer,
       _client = client,
       _store = store,
       // A trailing slash would produce `//ingest/screenshots`; normalize
       // here, the single place serverUrl is consumed (mirrors Uploader).
       _serverUrl = serverUrl.replaceFirst(RegExp(r'/+$'), ''),
       _token = token,
       _appVersion = appVersion,
       _logger = logger;

  /// KeyValueStore key prefix for the persisted captured-screen set. Suffixed
  /// with the `app_version` so upgrading to a new version starts a fresh,
  /// empty marker set (old markers become stale and unused).
  static const String _markerKeyPrefix = 'myampmix.screenshots.v1.';

  final ScreenshotCapturer _capturer;
  final http.Client _client;
  final KeyValueStore _store;
  final String _serverUrl;
  final String _token;
  final Future<String> Function() _appVersion;
  final MamLogger _logger;

  /// In-memory cache of the persisted captured-screen set, per app version.
  final Map<String, Set<String>> _capturedByVersion = {};

  /// Guards against a concurrent second capture of the same pair while the
  /// first upload is still in flight (rapid re-entry during a route push).
  final Set<String> _inFlight = {};

  /// Handles a `$screen_view`: capture + upload the screen unless it has
  /// already been captured for the current `app_version`. Fully guarded —
  /// never throws.
  Future<void> onScreenView(String screenName) async {
    if (screenName.isEmpty) return;
    try {
      final appVersion = await _appVersion();
      final captured = await _loadCaptured(appVersion);
      if (captured.contains(screenName)) {
        // persisted once-per-version — visible under `logLevel: debug`.
        _logger.log(
          'screenshot skipped (already captured this app_version): $screenName',
        );
        return;
      }

      final flightKey = '$appVersion|$screenName';
      if (_inFlight.contains(flightKey)) return;
      _inFlight.add(flightKey);
      try {
        final shot = await _capturer.capture();
        // No screenshot (capture/encode failed): drop silently and do NOT
        // mark, so the next launch retries this screen.
        if (shot == null || shot.bytes.isEmpty) {
          _logger.log('screenshot capture returned null: $screenName');
          return;
        }

        final hash = sha256.convert(shot.bytes).toString();
        final delivered = await _upload(screenName, appVersion, shot, hash);
        if (delivered) {
          captured.add(screenName);
          await _persist(appVersion, captured);
          _logger.log('screenshot uploaded: $screenName (status 202)');
        }
      } finally {
        _inFlight.remove(flightKey);
      }
    } on Object catch (error, stackTrace) {
      _logger.log('screenshot capture failed', error, stackTrace);
    }
  }

  Future<bool> _upload(
    String screenName,
    String appVersion,
    CapturedScreenshot shot,
    String hash,
  ) async {
    try {
      final request =
          http.MultipartRequest(
              'POST',
              Uri.parse('$_serverUrl/ingest/screenshots'),
            )
            ..headers['Authorization'] = 'Bearer $_token'
            ..fields['screen_name'] = screenName
            ..fields['app_version'] = appVersion
            ..fields['width'] = '${shot.width}'
            ..fields['height'] = '${shot.height}'
            ..fields['image_hash'] = hash
            ..files.add(
              http.MultipartFile.fromBytes(
                'image',
                shot.bytes,
                filename: 'screenshot.jpg',
                contentType: MediaType('image', 'jpeg'),
              ),
            );
      final response = await _client.send(request);
      // The backend answers 202 whether it stored or skipped a dup.
      if (response.statusCode == 202) {
        // Drain the body so the connection is released.
        await response.stream.drain<void>();
        return true;
      }
      // Non-202 (e.g. 401 bad token, 500 backend/Firebase failure): make the
      // rejection VISIBLE instead of silently dropping it. Read a bounded
      // snippet of the body (this also drains the stream, releasing the
      // connection) and log it at ERROR level. Still return false so the pair
      // is left unmarked and retried next launch.
      String bodySnippet;
      try {
        final body = await response.stream.bytesToString();
        bodySnippet = body.length > 500 ? body.substring(0, 500) : body;
      } on Object {
        // Body unreadable — still surface the status.
        bodySnippet = '';
      }
      _logger.log(
        'screenshot upload rejected: status=${response.statusCode} '
        'body=$bodySnippet',
        'HTTP ${response.statusCode}',
      );
      return false;
    } on Object catch (error, stackTrace) {
      // Never-throw + retry-next-launch: a failed upload returns false so the
      // pair is left unmarked.
      _logger.log('screenshot upload failed', error, stackTrace);
      return false;
    }
  }

  Future<Set<String>> _loadCaptured(String appVersion) async {
    final cached = _capturedByVersion[appVersion];
    if (cached != null) return cached;
    final set = <String>{};
    try {
      final raw = await _store.getString('$_markerKeyPrefix$appVersion');
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is List) {
          for (final entry in decoded) {
            if (entry is String) set.add(entry);
          }
        }
      }
    } on Object {
      // Corrupt marker → treat as empty. Re-capturing is harmless: the
      // backend upserts on (project_id, screen_name, app_version).
    }
    _capturedByVersion[appVersion] = set;
    return set;
  }

  Future<void> _persist(String appVersion, Set<String> captured) async {
    try {
      await _store.setString(
        '$_markerKeyPrefix$appVersion',
        jsonEncode(captured.toList()),
      );
    } on Object catch (error, stackTrace) {
      // A persist failure only means we may re-capture next launch (a
      // harmless upsert), never a crash.
      _logger.log('screenshot marker persist failed', error, stackTrace);
    }
  }
}
