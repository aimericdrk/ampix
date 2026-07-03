import 'package:uuid/uuid.dart';

import '../context/context_collector.dart';
import '../identity/identity_manager.dart';
import '../model/event.dart';
import '../properties/super_properties_store.dart';
import '../properties/timed_event_tracker.dart';
import '../storage/event_store.dart';
import '../util/clock.dart';
import '../util/logger.dart';

/// Drops values the ingest contract's flat-properties rule forbids: only
/// String, num, bool, null and Lists of those are allowed. A nested Map
/// value, or a List containing a Map/List, is removed (never thrown) and
/// noted via [logger] so the drop is discoverable in debug builds.
Map<String, Object?> sanitizeProperties(
  Map<String, Object?> input,
  MamLogger logger,
) {
  bool isScalar(Object? value) =>
      value == null || value is String || value is num || value is bool;

  bool isAllowedListElement(Object? value) => isScalar(value);

  final sanitized = <String, Object?>{};
  input.forEach((key, value) {
    if (isScalar(value)) {
      sanitized[key] = value;
    } else if (value is List && value.every(isAllowedListElement)) {
      sanitized[key] = value;
    } else {
      logger.log(
        'Dropping property "$key": nested Map/List values are not allowed '
        'by the flat-properties contract rule.',
      );
    }
  });
  return sanitized;
}

/// Assembles contract-§4 events and persists them to the queue BEFORE any
/// network I/O (write-before-send, design §5). Identity, session id and
/// timestamp are read synchronously at call time so caller ordering holds.
class EventPipeline {
  EventPipeline({
    required Clock clock,
    required EventStore store,
    required IdentityManager identity,
    required String Function() sessionId,
    required SuperPropertiesStore superProperties,
    required TimedEventTracker timedEvents,
    required ContextCollector contextCollector,
    required int maxQueueSize,
    required bool Function() isOptedOut,
    String Function()? idFactory,
    this.onEventQueued,
    MamLogger? logger,
  }) : _clock = clock,
       _store = store,
       _identity = identity,
       _sessionId = sessionId,
       _superProperties = superProperties,
       _timedEvents = timedEvents,
       _contextCollector = contextCollector,
       _maxQueueSize = maxQueueSize,
       _isOptedOut = isOptedOut,
       _idFactory = idFactory ?? (() => const Uuid().v7()),
       _logger = logger ?? const MamLogger(enabled: false);

  final Clock _clock;
  final EventStore _store;
  final IdentityManager _identity;
  final String Function() _sessionId;
  final SuperPropertiesStore _superProperties;
  final TimedEventTracker _timedEvents;
  final ContextCollector _contextCollector;
  final int _maxQueueSize;
  final bool Function() _isOptedOut;
  final String Function() _idFactory;
  final MamLogger _logger;

  /// Wired by the facade so the uploader can trigger size-based flushes.
  void Function(int queuedCount)? onEventQueued;

  Future<void> track(String event, [Map<String, Object?>? properties]) async {
    if (_isOptedOut()) return;
    final durationMs = _timedEvents.popDurationMs(event);
    final mergedProperties = sanitizeProperties(<String, Object?>{
      ..._superProperties.current,
      ...?properties,
      r'$duration_ms': ?durationMs,
    }, _logger);
    final analyticsEvent = AnalyticsEvent(
      insertId: _idFactory(),
      event: event,
      distinctId: _identity.distinctId,
      anonId: _identity.anonId,
      sessionId: _sessionId(),
      timestamp: _clock.nowMs(),
      properties: mergedProperties,
      context: await _contextCollector.collect(),
    );
    await _store.add(analyticsEvent, maxQueueSize: _maxQueueSize);
    onEventQueued?.call(await _store.count());
  }
}
