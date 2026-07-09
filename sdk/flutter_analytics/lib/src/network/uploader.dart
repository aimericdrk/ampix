import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:http/http.dart' as http;

import '../storage/event_store.dart';
import '../storage/profile_op_store.dart';
import '../util/clock.dart';
import '../util/logger.dart';

enum _SendOutcome { delivered, invalid, retryLater }

/// Retry state for one queue. Each queue (events, profiles) backs off
/// independently so a healthy queue never clears a failing queue's deadline.
class _Backoff {
  int consecutiveFailures = 0;
  DateTime? nextAttemptAt;

  void reset() {
    consecutiveFailures = 0;
    nextAttemptAt = null;
  }
}

/// Drains the persistent queues to `/ingest/events` and `/ingest/profiles`
/// in gzip batches with exponential backoff + jitter (design §6).
class Uploader {
  Uploader({
    required http.Client client,
    required EventStore events,
    required ProfileOpStore profiles,
    required String serverUrl,
    required String token,
    required Clock clock,
    required int batchSize,
    required Duration flushInterval,
    this.baseRetryDelay = const Duration(seconds: 2),
    this.maxRetryDelay = const Duration(minutes: 5),
    math.Random? random,
    MamLogger logger = const MamLogger(),
  }) : _client = client,
       _events = events,
       _profiles = profiles,
       // A trailing slash would produce `//ingest/events` → 404 → the 4xx
       // drop-list would silently delete every batch. Normalize here, the
       // single place serverUrl is consumed.
       _serverUrl = serverUrl.replaceFirst(RegExp(r'/+$'), ''),
       _token = token,
       _clock = clock,
       _batchSize = batchSize,
       _flushInterval = flushInterval,
       _random = random ?? math.Random(),
       _logger = logger;

  final http.Client _client;
  final EventStore _events;
  final ProfileOpStore _profiles;
  final String _serverUrl;
  final String _token;
  final Clock _clock;
  final int _batchSize;
  final Duration _flushInterval;
  final Duration baseRetryDelay;
  final Duration maxRetryDelay;
  final math.Random _random;
  final MamLogger _logger;

  Timer? _timer;
  bool _flushing = false;
  final _eventsBackoff = _Backoff();
  final _profilesBackoff = _Backoff();

  /// Starts the periodic flush timer (idempotent).
  void start() =>
      _timer ??= Timer.periodic(_flushInterval, (_) => unawaited(flush()));

  /// Size-based trigger, wired to EventPipeline.onEventQueued / People.onQueued.
  void maybeFlush(int queuedCount) {
    if (queuedCount >= _batchSize) unawaited(flush());
  }

  /// Drains both queues. Reentrancy-safe; each queue respects its own
  /// backoff deadline unless [force] (the public `MyAmpix.flush()`).
  ///
  /// Never throws: the timer- and size-triggered `unawaited(flush())` calls
  /// would otherwise leak storage exceptions (drift/sqlite errors, corrupt
  /// row FormatException) into the host app's zone as unhandled async
  /// errors. Containment only — corrupt-row eviction is a phase-2 ticket.
  Future<void> flush({bool force = false}) async {
    if (_flushing) return;
    _flushing = true;
    // Debug-only: marks each flush attempt (needs logLevel: debug / debug: true). `force: true`
    // bypasses the retry backoff (e.g. a manual MyAmpix.instance.flush()).
    _logger.log('flush(force: $force)');
    try {
      await _drainEvents(force: force);
      await _drainProfiles(force: force);
    } on Object catch (error, stackTrace) {
      _logger.log('flush failed', error, stackTrace);
    } finally {
      _flushing = false;
    }
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }

  bool _inBackoff(_Backoff backoff) {
    final deadline = backoff.nextAttemptAt;
    return deadline != null && _clock.now().isBefore(deadline);
  }

  Future<void> _drainEvents({required bool force}) async {
    if (!force && _inBackoff(_eventsBackoff)) return;
    while (true) {
      final batch = await _events.oldest(_batchSize);
      if (batch.isEmpty) return;
      final body = jsonEncode({
        'events': [for (final stored in batch) stored.event.toJson()],
      });
      // Debug-only: shows each event batch being sent, with the event names in it, so you can
      // watch e.g. `$app_open`/`track` events leave the device.
      _logger.log(
        'upload: POST /ingest/events (${batch.length} event(s): '
        '${[for (final stored in batch) stored.event.event].join(', ')})',
      );
      switch (await _post('/ingest/events', body, _eventsBackoff)) {
        case _SendOutcome.delivered:
        case _SendOutcome.invalid:
          // Delivered: server has the batch (202). Invalid: it never will.
          _logger.log(
            'upload: /ingest/events batch of ${batch.length} accepted/dropped '
            '→ removed from queue',
          );
          await _events.delete([for (final stored in batch) stored.id]);
        case _SendOutcome.retryLater:
          _logger.log(
            'upload: /ingest/events deferred (server busy/offline) '
            '→ ${batch.length} event(s) kept, will retry after backoff',
          );
          return;
      }
    }
  }

  Future<void> _drainProfiles({required bool force}) async {
    if (!force && _inBackoff(_profilesBackoff)) return;
    while (true) {
      final batch = await _profiles.oldest(_batchSize);
      if (batch.isEmpty) return;
      final body = jsonEncode({
        'operations': [for (final stored in batch) stored.op.toJson()],
      });
      // Debug-only: shows each profile-operation batch (people.set/increment/etc.) being sent —
      // these are the ops that write onto the USER PROFILE (distinct from event super properties).
      _logger.log(
        'upload: POST /ingest/profiles (${batch.length} operation(s))',
      );
      switch (await _post('/ingest/profiles', body, _profilesBackoff)) {
        case _SendOutcome.delivered:
        case _SendOutcome.invalid:
          _logger.log(
            'upload: /ingest/profiles batch of ${batch.length} accepted/dropped '
            '→ removed from queue',
          );
          await _profiles.delete([for (final stored in batch) stored.id]);
        case _SendOutcome.retryLater:
          _logger.log(
            'upload: /ingest/profiles deferred (server busy/offline) '
            '→ ${batch.length} operation(s) kept, will retry after backoff',
          );
          return;
      }
    }
  }

  Future<_SendOutcome> _post(String path, String body, _Backoff backoff) async {
    try {
      final response = await _client.post(
        Uri.parse('$_serverUrl$path'),
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Authorization': 'Bearer $_token',
        },
        body: gzip.encode(utf8.encode(body)),
      );
      // Debug-only: the raw HTTP status for every upload — 202 = accepted, 4xx = rejected/dropped,
      // 429/5xx = will retry. The single most useful line when uploads silently "don't work".
      _logger.log('upload: $path → HTTP ${response.statusCode}');
      if (response.statusCode == 202) {
        backoff.reset();
        _logRejections(response.body);
        return _SendOutcome.delivered;
      }
      if (response.statusCode >= 400 &&
          response.statusCode < 500 &&
          response.statusCode != 429) {
        // 4xx (except 429): the batch can never succeed as-is; drop it
        // rather than retry forever (contract §4: rejection is permanent).
        _logger.log('Batch dropped (${response.statusCode}): ${response.body}');
        backoff.reset();
        return _SendOutcome.invalid;
      }
      // 429 and 5xx: keep events, back off.
      _recordFailure(backoff, 'HTTP ${response.statusCode}');
      return _SendOutcome.retryLater;
    } on Object catch (error) {
      _recordFailure(backoff, '$error');
      return _SendOutcome.retryLater;
    }
  }

  void _logRejections(String responseBody) {
    try {
      final rejected =
          (jsonDecode(responseBody) as Map<String, dynamic>)['rejected']
              as List<dynamic>?;
      if (rejected != null && rejected.isNotEmpty) {
        _logger.log('Server rejected ${rejected.length} item(s): $rejected');
      }
    } on Object {
      // The response body is informational only; ignore parse failures.
    }
  }

  void _recordFailure(_Backoff backoff, String reason) {
    backoff.consecutiveFailures += 1;
    final exponent = math.min(backoff.consecutiveFailures - 1, 16);
    final rawMs =
        baseRetryDelay.inMilliseconds * math.pow(2, exponent).toDouble();
    final jitterFactor = 0.5 + _random.nextDouble(); // uniform in [0.5, 1.5)
    // Jitter applies before the cap so maxRetryDelay is a true upper bound.
    final delayMs = math.min(
      rawMs * jitterFactor,
      maxRetryDelay.inMilliseconds.toDouble(),
    );
    backoff.nextAttemptAt = _clock.now().add(
      Duration(milliseconds: delayMs.round()),
    );
    _logger.log(
      'Flush failed ($reason); retry #${backoff.consecutiveFailures} '
      'after ${backoff.nextAttemptAt}',
    );
  }
}
