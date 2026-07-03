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
    MamLogger logger = const MamLogger(enabled: false),
  }) : _client = client,
       _events = events,
       _profiles = profiles,
       _serverUrl = serverUrl,
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
  int _consecutiveFailures = 0;
  DateTime? _nextAttemptAt;

  /// Starts the periodic flush timer (idempotent).
  void start() =>
      _timer ??= Timer.periodic(_flushInterval, (_) => unawaited(flush()));

  /// Size-based trigger, wired to EventPipeline.onEventQueued / People.onQueued.
  void maybeFlush(int queuedCount) {
    if (queuedCount >= _batchSize) unawaited(flush());
  }

  /// Drains both queues. Reentrancy-safe; respects the backoff deadline
  /// unless [force] (the public `MyAmpMix.flush()`).
  Future<void> flush({bool force = false}) async {
    if (_flushing) return;
    final deadline = _nextAttemptAt;
    if (!force && deadline != null && _clock.now().isBefore(deadline)) return;
    _flushing = true;
    try {
      await _drainEvents();
      await _drainProfiles();
    } finally {
      _flushing = false;
    }
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _drainEvents() async {
    while (true) {
      final batch = await _events.oldest(_batchSize);
      if (batch.isEmpty) return;
      final body = jsonEncode({
        'events': [for (final stored in batch) stored.event.toJson()],
      });
      switch (await _post('/ingest/events', body)) {
        case _SendOutcome.delivered:
        case _SendOutcome.invalid:
          // Delivered: server has the batch (202). Invalid: it never will.
          await _events.delete([for (final stored in batch) stored.id]);
        case _SendOutcome.retryLater:
          return;
      }
    }
  }

  Future<void> _drainProfiles() async {
    while (true) {
      final batch = await _profiles.oldest(_batchSize);
      if (batch.isEmpty) return;
      final body = jsonEncode({
        'operations': [for (final stored in batch) stored.op.toJson()],
      });
      switch (await _post('/ingest/profiles', body)) {
        case _SendOutcome.delivered:
        case _SendOutcome.invalid:
          await _profiles.delete([for (final stored in batch) stored.id]);
        case _SendOutcome.retryLater:
          return;
      }
    }
  }

  Future<_SendOutcome> _post(String path, String body) async {
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
      if (response.statusCode == 202) {
        _resetBackoff();
        _logRejections(response.body);
        return _SendOutcome.delivered;
      }
      if (response.statusCode == 400 || response.statusCode == 413) {
        // The batch can never succeed: drop it rather than retry forever.
        _logger.log('Batch dropped (${response.statusCode}): ${response.body}');
        _resetBackoff();
        return _SendOutcome.invalid;
      }
      // 401 (token misconfiguration), 429 and 5xx: keep events, back off.
      _recordFailure('HTTP ${response.statusCode}');
      return _SendOutcome.retryLater;
    } on Object catch (error) {
      _recordFailure('$error');
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

  void _recordFailure(String reason) {
    _consecutiveFailures += 1;
    final exponent = math.min(_consecutiveFailures - 1, 16);
    final rawMs =
        baseRetryDelay.inMilliseconds * math.pow(2, exponent).toDouble();
    final cappedMs = math.min(rawMs, maxRetryDelay.inMilliseconds.toDouble());
    final jitterFactor = 0.5 + _random.nextDouble(); // uniform in [0.5, 1.5)
    _nextAttemptAt = _clock.now().add(
      Duration(milliseconds: (cappedMs * jitterFactor).round()),
    );
    _logger.log(
      'Flush failed ($reason); retry #$_consecutiveFailures after $_nextAttemptAt',
    );
  }

  void _resetBackoff() {
    _consecutiveFailures = 0;
    _nextAttemptAt = null;
  }
}
