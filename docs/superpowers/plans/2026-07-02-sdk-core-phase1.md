# Flutter SDK Core (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship milestone M1 of the `myampmix_analytics` Flutter package: manual event tracking with a persistent offline queue, identity, SDK-computed sessions, super properties, `timeEvent`, people/profile operations, persisted opt-out, automatic context, and a gzip batch uploader with exponential backoff — delivering the exact shared-contracts §4 JSON through the exact §8 public API.

**Architecture:** A guarded `MyAmpMix` singleton facade feeds an `EventPipeline` that assembles contract-§4 events (identity + session + super properties + timed durations + context) and persists them to a drift/SQLite queue *before* any network I/O. An `Uploader` drains the queue in gzip batches (20 events or every 10 s) to `/ingest/events` and `/ingest/profiles`, deleting rows only after a server `202` and backing off with jitter otherwise. Every collaborator (clock, HTTP client, stores, platform context) is constructor-injected so tests run on fakes.

**Tech Stack:** Flutter ≥ 3.32 / Dart ≥ 3.8 · drift (SQLite queue) · http · uuid (v7 ids) · package_info_plus · device_info_plus · connectivity_plus · shared_preferences · path_provider + path + sqlite3_flutter_libs (drift companions) · flutter_lints · dev: flutter_test, fake_async, drift_dev, build_runner.

**Not in this phase (later milestones — do not implement):** autocapture widgets (`MyAmpMixObserver` `$screen_view`, `MyAmpMixTracker` `$tap`/`$rage_tap`) are milestone M2; attribution (Android Install Referrer, `app_links` UTM capture, `$campaign_touch`, first/last-touch persistence) is milestone M3. The `utm_*`, `first_utm_*`, and `install_referrer` context fields stay absent from M1 payloads (they are optional in contract §4). See `docs/superpowers/specs/2026-07-02-sdk-flutter-design.md` §11–§12.

## Global Constraints

- Package directory: `sdk/flutter_analytics/` (package name `myampmix_analytics`). All paths below are relative to the repo root.
- Flutter 3.32+ / Dart 3.8+, fully null-safe.
- **No codegen required for consumers** — drift codegen (`database.g.dart`) is internal dev-time only and its output is committed to the repo.
- **The SDK never throws into the host app.** Every public entry point is guarded; internal errors are logged only when `config.debug` in debug builds.
- Event/profile JSON must match shared-contracts §4 byte-for-byte in field names and types; the public API must match §8 exactly.
- TDD: every task writes a failing test first, then the minimal implementation. `flutter test` and `flutter analyze` must pass at every commit.
- Coverage floor: **85 % lines** (CI-enforced; verified in Task 14).
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- All commands run from `sdk/flutter_analytics/`.

---

### Task 1: Package scaffold

**Files:**
- Create: `sdk/flutter_analytics/pubspec.yaml`
- Create: `sdk/flutter_analytics/analysis_options.yaml`
- Create: `sdk/flutter_analytics/.gitignore`
- Create: `sdk/flutter_analytics/lib/myampmix_analytics.dart`
- Create: `sdk/flutter_analytics/lib/src/version.dart`
- Test: `sdk/flutter_analytics/test/version_test.dart`

**Interfaces:**
- Produces: `const String mamSdkVersion` — the value every later task reports as `context.sdk_version`.

**Steps:**

- [ ] Create `pubspec.yaml`:

```yaml
name: myampmix_analytics
description: MyAmpMix Flutter analytics SDK — offline-first event tracking for the self-hosted MyAmpMix platform.
version: 0.1.0
publish_to: none

environment:
  sdk: ">=3.8.0 <4.0.0"
  flutter: ">=3.32.0"

dependencies:
  flutter:
    sdk: flutter
  connectivity_plus: ^6.1.0
  device_info_plus: ^11.3.0
  drift: ^2.26.0
  http: ^1.3.0
  package_info_plus: ^8.3.0
  path: ^1.9.0
  path_provider: ^2.1.5
  shared_preferences: ^2.5.0
  sqlite3_flutter_libs: ^0.5.30
  uuid: ^4.5.0

dev_dependencies:
  build_runner: ^2.4.13
  drift_dev: ^2.26.0
  fake_async: ^1.3.1
  flutter_lints: ^6.0.0
  flutter_test:
    sdk: flutter
```

- [ ] Create `analysis_options.yaml`:

```yaml
include: package:flutter_lints/flutter.yaml

analyzer:
  exclude:
    - "**/*.g.dart"

linter:
  rules:
    - unawaited_futures
    - prefer_final_locals
```

- [ ] Create `.gitignore`:

```
.dart_tool/
build/
coverage/
pubspec.lock
```

- [ ] Run `flutter pub get` — expect success.
- [ ] Write the failing test `test/version_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

void main() {
  test('sdk version constant matches pubspec', () {
    expect(mamSdkVersion, '0.1.0');
  });
}
```

- [ ] Run `flutter test test/version_test.dart` — expect **FAIL** (compile error: `mamSdkVersion` undefined).
- [ ] Create `lib/src/version.dart`:

```dart
/// SDK version reported in the `context.sdk_version` field of every event
/// (shared-contracts §4). Keep in sync with pubspec.yaml.
const String mamSdkVersion = '0.1.0';
```

- [ ] Create `lib/myampmix_analytics.dart`:

```dart
/// MyAmpMix Flutter analytics SDK.
library;

export 'src/version.dart';
```

- [ ] Run `flutter test test/version_test.dart` — expect **PASS**.
- [ ] Commit: `chore(sdk): scaffold myampmix_analytics package`

---

### Task 2: Config, injectable clock, debug logger

**Files:**
- Create: `sdk/flutter_analytics/lib/src/config.dart`
- Create: `sdk/flutter_analytics/lib/src/util/clock.dart`
- Create: `sdk/flutter_analytics/lib/src/util/logger.dart`
- Test: `sdk/flutter_analytics/test/config_and_clock_test.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/fake_clock.dart`

**Interfaces:**
- Produces: `abstract interface class Clock { DateTime now(); int nowMs(); }`, `class SystemClock implements Clock` (const), `class FakeClock implements Clock { void advance(Duration) }` (test helper), `class MyAmpMixConfig` (const, fields `serverUrl, flushAt, flushInterval, maxQueueSize, sessionTimeout, maxRetryDelay, debug`), `class MamLogger { const MamLogger({required bool enabled}); void log(String, [Object?, StackTrace?]) }`.
- Consumed by: every later task.

**Steps:**

- [ ] Write the failing test `test/config_and_clock_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/config.dart';

import 'helpers/fake_clock.dart';

void main() {
  test('config defaults match the design spec', () {
    const config = MyAmpMixConfig(serverUrl: 'http://localhost:8080');
    expect(config.serverUrl, 'http://localhost:8080');
    expect(config.flushAt, 20);
    expect(config.flushInterval, const Duration(seconds: 10));
    expect(config.maxQueueSize, 10000);
    expect(config.sessionTimeout, const Duration(minutes: 30));
    expect(config.maxRetryDelay, const Duration(minutes: 5));
    expect(config.debug, isFalse);
  });

  test('fake clock advances deterministically', () {
    final clock = FakeClock(DateTime.utc(2026, 7, 2));
    final startMs = clock.nowMs();
    clock.advance(const Duration(minutes: 30));
    expect(clock.nowMs() - startMs, 30 * 60 * 1000);
    expect(clock.now(), DateTime.utc(2026, 7, 2, 0, 30));
  });
}
```

- [ ] Write the test helper `test/helpers/fake_clock.dart`:

```dart
import 'package:myampmix_analytics/src/util/clock.dart';

/// Deterministic clock driven by tests.
class FakeClock implements Clock {
  FakeClock([DateTime? start]) : _now = start ?? DateTime.utc(2026, 7, 2, 12);

  DateTime _now;

  void advance(Duration duration) => _now = _now.add(duration);

  @override
  DateTime now() => _now;

  @override
  int nowMs() => _now.millisecondsSinceEpoch;
}
```

- [ ] Run `flutter test test/config_and_clock_test.dart` — expect **FAIL** (missing `config.dart` / `clock.dart`).
- [ ] Create `lib/src/util/clock.dart`:

```dart
/// Injectable time source. Every time read in the SDK goes through this
/// interface so tests can substitute a fake clock.
abstract interface class Clock {
  DateTime now();
  int nowMs();
}

/// Production clock.
class SystemClock implements Clock {
  const SystemClock();

  @override
  DateTime now() => DateTime.now();

  @override
  int nowMs() => DateTime.now().millisecondsSinceEpoch;
}
```

- [ ] Create `lib/src/util/logger.dart`:

```dart
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
```

- [ ] Create `lib/src/config.dart`:

```dart
/// Immutable SDK configuration passed to `MyAmpMix.init`.
class MyAmpMixConfig {
  const MyAmpMixConfig({
    required this.serverUrl,
    this.flushAt = 20,
    this.flushInterval = const Duration(seconds: 10),
    this.maxQueueSize = 10000,
    this.sessionTimeout = const Duration(minutes: 30),
    this.maxRetryDelay = const Duration(minutes: 5),
    this.debug = false,
  })  : assert(flushAt > 0 && flushAt <= 100,
            'flushAt must be 1..100 (server INGEST_MAX_BATCH is 100)'),
        assert(maxQueueSize > 0, 'maxQueueSize must be positive');

  /// Base URL of the MyAmpMix backend, e.g. `https://analytics.example.com`.
  final String serverUrl;

  /// Batch size that triggers an immediate flush (and the upload batch size).
  final int flushAt;

  /// Interval of the periodic flush timer.
  final Duration flushInterval;

  /// Maximum queued events/profile ops; oldest are evicted beyond this.
  final int maxQueueSize;

  /// Background time after which the session rotates.
  final Duration sessionTimeout;

  /// Upper bound for the exponential retry backoff.
  final Duration maxRetryDelay;

  /// Enables internal logging in debug builds.
  final bool debug;
}
```

- [ ] Run `flutter test test/config_and_clock_test.dart` — expect **PASS**.
- [ ] Commit: `feat(sdk): add config, injectable clock and debug logger`

---

### Task 3: Event & profile-operation models (contract §4 JSON)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/model/event.dart`
- Create: `sdk/flutter_analytics/lib/src/model/profile_operation.dart`
- Test: `sdk/flutter_analytics/test/model/event_test.dart`
- Test: `sdk/flutter_analytics/test/model/profile_operation_test.dart`

**Interfaces:**
- Produces: `class EventContext` (const; 20 optional fields; `toJson()` omitting nulls; `fromJson`), `class AnalyticsEvent { insertId, event, distinctId, anonId, sessionId, timestamp(int ms), properties, context; toJson(); fromJson() }`, `class ProfileOperation { distinctId, op, properties, timestamp; toJson(); fromJson() }`.
- Consumed by: storage (payload round-trip), pipeline, uploader, people.

**Steps:**

- [ ] Write the failing test `test/model/event_test.dart`:

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/event.dart';

void main() {
  test('serializes exactly to the ingest contract shape (shared-contracts §4)', () {
    const event = AnalyticsEvent(
      insertId: '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
      event: 'checkout_completed',
      distinctId: 'u_42',
      anonId: '018f6b2e-aaaa-7bbb-8ccc-1a2b3c4d5e6f',
      sessionId: '018f6b2e-dddd-7eee-8fff-1a2b3c4d5e6f',
      timestamp: 1751462400123,
      properties: {'plan': 'pro', 'value': 9.99},
      context: EventContext(
        appVersion: '1.4.2',
        appBuild: '142',
        os: 'ios',
        osVersion: '18.5',
        deviceModel: 'iPhone16,2',
        deviceManufacturer: 'Apple',
        locale: 'fr_FR',
        timezone: 'Europe/Paris',
        screenWidth: 393,
        screenHeight: 852,
        network: 'wifi',
        sdkVersion: '0.1.0',
      ),
    );

    expect(event.toJson(), {
      'insert_id': '018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f',
      'event': 'checkout_completed',
      'distinct_id': 'u_42',
      'anon_id': '018f6b2e-aaaa-7bbb-8ccc-1a2b3c4d5e6f',
      'session_id': '018f6b2e-dddd-7eee-8fff-1a2b3c4d5e6f',
      'timestamp': 1751462400123,
      'properties': {'plan': 'pro', 'value': 9.99},
      'context': {
        'app_version': '1.4.2',
        'app_build': '142',
        'os': 'ios',
        'os_version': '18.5',
        'device_model': 'iPhone16,2',
        'device_manufacturer': 'Apple',
        'locale': 'fr_FR',
        'timezone': 'Europe/Paris',
        'screen_width': 393,
        'screen_height': 852,
        'network': 'wifi',
        'sdk_version': '0.1.0',
      },
    });
  });

  test('omits null context fields', () {
    const context = EventContext(os: 'android');
    expect(context.toJson(), {'os': 'android'});
  });

  test('round-trips through json encode/decode (queue persistence)', () {
    const event = AnalyticsEvent(
      insertId: 'a',
      event: 'e',
      distinctId: 'd',
      anonId: 'an',
      sessionId: 's',
      timestamp: 1,
      properties: {'k': 'v'},
      context: EventContext(os: 'ios', screenWidth: 393),
    );
    final decoded = AnalyticsEvent.fromJson(
        jsonDecode(jsonEncode(event.toJson())) as Map<String, dynamic>);
    expect(decoded.toJson(), event.toJson());
  });
}
```

- [ ] Write the failing test `test/model/profile_operation_test.dart`:

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';

void main() {
  test('serializes to the /ingest/profiles operation shape', () {
    const op = ProfileOperation(
      distinctId: 'u_42',
      op: 'set',
      properties: {'plan': 'pro'},
      timestamp: 1751462400123,
    );
    expect(op.toJson(), {
      'distinct_id': 'u_42',
      'op': 'set',
      'properties': {'plan': 'pro'},
      'timestamp': 1751462400123,
    });
  });

  test('round-trips through json encode/decode', () {
    const op = ProfileOperation(
      distinctId: 'u_1',
      op: 'unset',
      properties: {'plan': null},
      timestamp: 7,
    );
    final decoded = ProfileOperation.fromJson(
        jsonDecode(jsonEncode(op.toJson())) as Map<String, dynamic>);
    expect(decoded.toJson(), op.toJson());
  });
}
```

- [ ] Run `flutter test test/model/` — expect **FAIL** (missing model files).
- [ ] Create `lib/src/model/event.dart`:

```dart
/// Automatic context block, serialized as the `context` object of the ingest
/// contract (shared-contracts §4). Null fields are omitted from the JSON.
class EventContext {
  const EventContext({
    this.appVersion,
    this.appBuild,
    this.os,
    this.osVersion,
    this.deviceModel,
    this.deviceManufacturer,
    this.locale,
    this.timezone,
    this.screenWidth,
    this.screenHeight,
    this.network,
    this.sdkVersion,
    this.utmSource,
    this.utmMedium,
    this.utmCampaign,
    this.utmContent,
    this.utmTerm,
    this.firstUtmSource,
    this.firstUtmCampaign,
    this.installReferrer,
  });

  factory EventContext.fromJson(Map<String, dynamic> json) => EventContext(
        appVersion: json['app_version'] as String?,
        appBuild: json['app_build'] as String?,
        os: json['os'] as String?,
        osVersion: json['os_version'] as String?,
        deviceModel: json['device_model'] as String?,
        deviceManufacturer: json['device_manufacturer'] as String?,
        locale: json['locale'] as String?,
        timezone: json['timezone'] as String?,
        screenWidth: json['screen_width'] as int?,
        screenHeight: json['screen_height'] as int?,
        network: json['network'] as String?,
        sdkVersion: json['sdk_version'] as String?,
        utmSource: json['utm_source'] as String?,
        utmMedium: json['utm_medium'] as String?,
        utmCampaign: json['utm_campaign'] as String?,
        utmContent: json['utm_content'] as String?,
        utmTerm: json['utm_term'] as String?,
        firstUtmSource: json['first_utm_source'] as String?,
        firstUtmCampaign: json['first_utm_campaign'] as String?,
        installReferrer: json['install_referrer'] as String?,
      );

  final String? appVersion;
  final String? appBuild;
  final String? os;
  final String? osVersion;
  final String? deviceModel;
  final String? deviceManufacturer;
  final String? locale;
  final String? timezone;
  final int? screenWidth;
  final int? screenHeight;
  final String? network;
  final String? sdkVersion;
  final String? utmSource;
  final String? utmMedium;
  final String? utmCampaign;
  final String? utmContent;
  final String? utmTerm;
  final String? firstUtmSource;
  final String? firstUtmCampaign;
  final String? installReferrer;

  Map<String, Object?> toJson() => <String, Object?>{
        'app_version': appVersion,
        'app_build': appBuild,
        'os': os,
        'os_version': osVersion,
        'device_model': deviceModel,
        'device_manufacturer': deviceManufacturer,
        'locale': locale,
        'timezone': timezone,
        'screen_width': screenWidth,
        'screen_height': screenHeight,
        'network': network,
        'sdk_version': sdkVersion,
        'utm_source': utmSource,
        'utm_medium': utmMedium,
        'utm_campaign': utmCampaign,
        'utm_content': utmContent,
        'utm_term': utmTerm,
        'first_utm_source': firstUtmSource,
        'first_utm_campaign': firstUtmCampaign,
        'install_referrer': installReferrer,
      }..removeWhere((_, value) => value == null);
}

/// One event, exactly as sent in the `events` array of `POST /ingest/events`
/// (shared-contracts §4).
class AnalyticsEvent {
  const AnalyticsEvent({
    required this.insertId,
    required this.event,
    required this.distinctId,
    required this.anonId,
    required this.sessionId,
    required this.timestamp,
    this.properties = const {},
    this.context = const EventContext(),
  });

  factory AnalyticsEvent.fromJson(Map<String, dynamic> json) => AnalyticsEvent(
        insertId: json['insert_id'] as String,
        event: json['event'] as String,
        distinctId: json['distinct_id'] as String,
        anonId: json['anon_id'] as String,
        sessionId: json['session_id'] as String,
        timestamp: json['timestamp'] as int,
        properties: (json['properties'] as Map<String, dynamic>?) ?? const {},
        context: EventContext.fromJson(
            (json['context'] as Map<String, dynamic>?) ?? const {}),
      );

  /// UUID v7, dedup key for idempotent retries (design §5).
  final String insertId;
  final String event;
  final String distinctId;
  final String anonId;
  final String sessionId;

  /// Milliseconds since epoch, client clock.
  final int timestamp;
  final Map<String, Object?> properties;
  final EventContext context;

  Map<String, Object?> toJson() => {
        'insert_id': insertId,
        'event': event,
        'distinct_id': distinctId,
        'anon_id': anonId,
        'session_id': sessionId,
        'timestamp': timestamp,
        'properties': properties,
        'context': context.toJson(),
      };
}
```

- [ ] Create `lib/src/model/profile_operation.dart`:

```dart
/// One operation, exactly as sent in the `operations` array of
/// `POST /ingest/profiles` (shared-contracts §4).
class ProfileOperation {
  const ProfileOperation({
    required this.distinctId,
    required this.op,
    required this.properties,
    required this.timestamp,
  });

  factory ProfileOperation.fromJson(Map<String, dynamic> json) =>
      ProfileOperation(
        distinctId: json['distinct_id'] as String,
        op: json['op'] as String,
        properties: (json['properties'] as Map<String, dynamic>?) ?? const {},
        timestamp: json['timestamp'] as int,
      );

  final String distinctId;

  /// `set | set_once | increment | append | unset | delete`.
  final String op;
  final Map<String, Object?> properties;
  final int timestamp;

  Map<String, Object?> toJson() => {
        'distinct_id': distinctId,
        'op': op,
        'properties': properties,
        'timestamp': timestamp,
      };
}
```

- [ ] Run `flutter test test/model/` — expect **PASS**.
- [ ] Commit: `feat(sdk): event and profile-operation models matching ingest contract`

---

### Task 4: Storage layer — drift queues + key-value store

**Files:**
- Create: `sdk/flutter_analytics/lib/src/storage/key_value_store.dart`
- Create: `sdk/flutter_analytics/lib/src/storage/database.dart`
- Create: `sdk/flutter_analytics/lib/src/storage/database.g.dart` (generated by build_runner; **committed**)
- Create: `sdk/flutter_analytics/lib/src/storage/event_store.dart`
- Create: `sdk/flutter_analytics/lib/src/storage/profile_op_store.dart`
- Test: `sdk/flutter_analytics/test/storage/event_store_test.dart`
- Test: `sdk/flutter_analytics/test/storage/profile_op_store_test.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/in_memory_key_value_store.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/builders.dart`

**Interfaces:**
- Consumes: `AnalyticsEvent`, `ProfileOperation` (Task 3).
- Produces:
  - `abstract interface class KeyValueStore { Future<String?> getString(String key); Future<void> setString(String key, String value); Future<void> remove(String key); }` + `SharedPrefsKeyValueStore` (`static Future<SharedPrefsKeyValueStore> open()`).
  - `class AnalyticsDatabase` (drift; `static AnalyticsDatabase open()`, tables `pending_events`, `pending_profile_ops`).
  - `class StoredEvent { int id; AnalyticsEvent event; }`, `abstract interface class EventStore { Future<void> add(AnalyticsEvent event, {required int maxQueueSize}); Future<List<StoredEvent>> oldest(int limit); Future<void> delete(List<int> ids); Future<int> count(); Future<void> clear(); }` + `DriftEventStore`.
  - `class StoredProfileOp { int id; ProfileOperation op; }`, `abstract interface class ProfileOpStore` (same five methods over `ProfileOperation`) + `DriftProfileOpStore`.

**Steps:**

- [ ] Create `lib/src/storage/database.dart`:

```dart
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'database.g.dart';

/// Events queued for `/ingest/events`, serialized contract JSON per row.
class PendingEvents extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get payload => text()();
}

/// Profile operations queued for `/ingest/profiles`.
class PendingProfileOps extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get payload => text()();
}

@DriftDatabase(tables: [PendingEvents, PendingProfileOps])
class AnalyticsDatabase extends _$AnalyticsDatabase {
  AnalyticsDatabase(super.e);

  /// Opens the on-device database under the application support directory.
  static AnalyticsDatabase open() => AnalyticsDatabase(LazyDatabase(() async {
        final directory = await getApplicationSupportDirectory();
        return NativeDatabase.createInBackground(
            File(p.join(directory.path, 'myampmix_analytics.sqlite')));
      }));

  @override
  int get schemaVersion => 1;
}
```

- [ ] Run `dart run build_runner build --delete-conflicting-outputs` — expect success; commit-tracked `database.g.dart` is produced (consumers never run codegen).
- [ ] Write the test helper `test/helpers/builders.dart`:

```dart
import 'package:myampmix_analytics/src/model/event.dart';

AnalyticsEvent buildEvent({String name = 'test_event', String insertId = 'insert-1'}) =>
    AnalyticsEvent(
      insertId: insertId,
      event: name,
      distinctId: 'user-1',
      anonId: 'anon-1',
      sessionId: 'session-1',
      timestamp: 1751462400123,
      properties: const {'k': 'v'},
      context: const EventContext(os: 'ios', sdkVersion: '0.1.0'),
    );
```

- [ ] Write the test helper `test/helpers/in_memory_key_value_store.dart`:

```dart
import 'package:myampmix_analytics/src/storage/key_value_store.dart';

class InMemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> getString(String key) async => values[key];

  @override
  Future<void> setString(String key, String value) async => values[key] = value;

  @override
  Future<void> remove(String key) async => values.remove(key);
}
```

- [ ] Write the failing test `test/storage/event_store_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/builders.dart';

void main() {
  late AnalyticsDatabase db;
  late DriftEventStore store;

  setUp(() {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftEventStore(db);
  });

  tearDown(() => db.close());

  test('persists events and returns them oldest-first with full payload', () async {
    await store.add(buildEvent(name: 'first', insertId: 'i-1'), maxQueueSize: 100);
    await store.add(buildEvent(name: 'second', insertId: 'i-2'), maxQueueSize: 100);

    final stored = await store.oldest(10);
    expect(stored.map((s) => s.event.event).toList(), ['first', 'second']);
    expect(stored.first.event.toJson(),
        buildEvent(name: 'first', insertId: 'i-1').toJson());
  });

  test('oldest() does not delete; delete() removes only the given ids', () async {
    await store.add(buildEvent(insertId: 'i-1'), maxQueueSize: 100);
    await store.add(buildEvent(insertId: 'i-2'), maxQueueSize: 100);

    final batch = await store.oldest(1);
    expect(await store.count(), 2);

    await store.delete([batch.single.id]);
    expect(await store.count(), 1);
    expect((await store.oldest(10)).single.event.insertId, 'i-2');
  });

  test('evicts the oldest rows beyond maxQueueSize', () async {
    for (var i = 0; i < 5; i++) {
      await store.add(buildEvent(name: 'e$i', insertId: 'i-$i'), maxQueueSize: 3);
    }
    final remaining = await store.oldest(10);
    expect(remaining.map((s) => s.event.event).toList(), ['e2', 'e3', 'e4']);
  });

  test('clear() empties the queue', () async {
    await store.add(buildEvent(), maxQueueSize: 10);
    await store.clear();
    expect(await store.count(), 0);
  });
}
```

- [ ] Write the failing test `test/storage/profile_op_store_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/profile_op_store.dart';

void main() {
  ProfileOperation buildOp(String op) => ProfileOperation(
      distinctId: 'u_1', op: op, properties: const {'plan': 'pro'}, timestamp: 1);

  late AnalyticsDatabase db;
  late DriftProfileOpStore store;

  setUp(() {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftProfileOpStore(db);
  });

  tearDown(() => db.close());

  test('persists, peeks oldest-first, deletes and evicts', () async {
    for (var i = 0; i < 4; i++) {
      await store.add(buildOp('set_$i'), maxQueueSize: 3);
    }
    final rows = await store.oldest(10);
    expect(rows.map((r) => r.op.op).toList(), ['set_1', 'set_2', 'set_3']);
    expect(rows.first.op.toJson(), buildOp('set_1').toJson());

    await store.delete([rows.first.id]);
    expect(await store.count(), 2);

    await store.clear();
    expect(await store.count(), 0);
  });
}
```

- [ ] Run `flutter test test/storage/` — expect **FAIL** (missing store classes).
- [ ] Create `lib/src/storage/key_value_store.dart`:

```dart
import 'package:shared_preferences/shared_preferences.dart';

/// Small persisted string map for identity, session, super properties and
/// opt-out state. Abstracted so tests use an in-memory fake.
abstract interface class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

class SharedPrefsKeyValueStore implements KeyValueStore {
  SharedPrefsKeyValueStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<SharedPrefsKeyValueStore> open() async =>
      SharedPrefsKeyValueStore(await SharedPreferences.getInstance());

  @override
  Future<String?> getString(String key) async => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) => _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}
```

- [ ] Create `lib/src/storage/event_store.dart`:

```dart
import 'dart:convert';

import 'package:drift/drift.dart';

import '../model/event.dart';
import 'database.dart';

/// A queued event together with its queue row id.
class StoredEvent {
  const StoredEvent({required this.id, required this.event});

  final int id;
  final AnalyticsEvent event;
}

/// Persistent write-before-send event queue (design §5).
abstract interface class EventStore {
  /// Persists [event]; evicts the oldest rows beyond [maxQueueSize].
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize});

  /// Oldest-first peek. Rows stay queued until [delete] confirms delivery.
  Future<List<StoredEvent>> oldest(int limit);

  /// Called only after the server acknowledged the batch with 202.
  Future<void> delete(List<int> ids);

  Future<int> count();

  /// Opt-out purge.
  Future<void> clear();
}

class DriftEventStore implements EventStore {
  DriftEventStore(this._db);

  final AnalyticsDatabase _db;

  @override
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}) =>
      _db.transaction(() async {
        await _db.into(_db.pendingEvents).insert(
            PendingEventsCompanion.insert(payload: jsonEncode(event.toJson())));
        final excess = await count() - maxQueueSize;
        if (excess > 0) {
          await _db.customStatement(
            'DELETE FROM pending_events WHERE id IN '
            '(SELECT id FROM pending_events ORDER BY id ASC LIMIT ?)',
            [excess],
          );
        }
      });

  @override
  Future<List<StoredEvent>> oldest(int limit) async {
    final rows = await (_db.select(_db.pendingEvents)
          ..orderBy([(t) => OrderingTerm.asc(t.id)])
          ..limit(limit))
        .get();
    return [
      for (final row in rows)
        StoredEvent(
          id: row.id,
          event: AnalyticsEvent.fromJson(
              jsonDecode(row.payload) as Map<String, dynamic>),
        ),
    ];
  }

  @override
  Future<void> delete(List<int> ids) =>
      (_db.delete(_db.pendingEvents)..where((t) => t.id.isIn(ids))).go();

  @override
  Future<int> count() => _db.pendingEvents.count().getSingle();

  @override
  Future<void> clear() => _db.delete(_db.pendingEvents).go();
}
```

- [ ] Create `lib/src/storage/profile_op_store.dart`:

```dart
import 'dart:convert';

import 'package:drift/drift.dart';

import '../model/profile_operation.dart';
import 'database.dart';

class StoredProfileOp {
  const StoredProfileOp({required this.id, required this.op});

  final int id;
  final ProfileOperation op;
}

/// Persistent queue for `/ingest/profiles` operations.
abstract interface class ProfileOpStore {
  Future<void> add(ProfileOperation op, {required int maxQueueSize});
  Future<List<StoredProfileOp>> oldest(int limit);
  Future<void> delete(List<int> ids);
  Future<int> count();
  Future<void> clear();
}

class DriftProfileOpStore implements ProfileOpStore {
  DriftProfileOpStore(this._db);

  final AnalyticsDatabase _db;

  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) =>
      _db.transaction(() async {
        await _db.into(_db.pendingProfileOps).insert(
            PendingProfileOpsCompanion.insert(payload: jsonEncode(op.toJson())));
        final excess = await count() - maxQueueSize;
        if (excess > 0) {
          await _db.customStatement(
            'DELETE FROM pending_profile_ops WHERE id IN '
            '(SELECT id FROM pending_profile_ops ORDER BY id ASC LIMIT ?)',
            [excess],
          );
        }
      });

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async {
    final rows = await (_db.select(_db.pendingProfileOps)
          ..orderBy([(t) => OrderingTerm.asc(t.id)])
          ..limit(limit))
        .get();
    return [
      for (final row in rows)
        StoredProfileOp(
          id: row.id,
          op: ProfileOperation.fromJson(
              jsonDecode(row.payload) as Map<String, dynamic>),
        ),
    ];
  }

  @override
  Future<void> delete(List<int> ids) =>
      (_db.delete(_db.pendingProfileOps)..where((t) => t.id.isIn(ids))).go();

  @override
  Future<int> count() => _db.pendingProfileOps.count().getSingle();

  @override
  Future<void> clear() => _db.delete(_db.pendingProfileOps).go();
}
```

- [ ] Run `flutter test test/storage/` — expect **PASS**.
- [ ] Commit: `feat(sdk): drift-backed persistent event and profile queues`

---

### Task 5: Identity manager

**Files:**
- Create: `sdk/flutter_analytics/lib/src/identity/identity_manager.dart`
- Test: `sdk/flutter_analytics/test/identity/identity_manager_test.dart`

**Interfaces:**
- Consumes: `KeyValueStore` (Task 4).
- Produces: `class IdentityManager { IdentityManager({required KeyValueStore store, String Function()? idFactory}); Future<void> load(); String get anonId; String get distinctId; Future<bool> identify(String userId); Future<void> reset(); }`. Note: `identify` sets `_distinctId` **synchronously before its first await** so a `track` call issued immediately after uses the new id.

**Steps:**

- [ ] Write the failing test `test/identity/identity_manager_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/identity/identity_manager.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('generates and persists a UUID v7 anon id on first launch', () async {
    final store = InMemoryKeyValueStore();
    final identity = IdentityManager(store: store);
    await identity.load();

    expect(identity.anonId, isNotEmpty);
    expect(identity.anonId[14], '7'); // UUID version nibble
    expect(identity.distinctId, identity.anonId);
    expect(store.values[IdentityManager.anonIdKey], identity.anonId);
  });

  test('reuses the persisted anon id on later launches', () async {
    final store = InMemoryKeyValueStore();
    final first = IdentityManager(store: store, idFactory: () => 'anon-1');
    await first.load();

    final second = IdentityManager(store: store, idFactory: () => 'anon-2');
    await second.load();
    expect(second.anonId, 'anon-1');
  });

  test('identify switches distinct id, keeps anon id, persists across relaunch', () async {
    final store = InMemoryKeyValueStore();
    final identity = IdentityManager(store: store, idFactory: () => 'anon-1');
    await identity.load();

    expect(await identity.identify('u_42'), isTrue);
    expect(await identity.identify('u_42'), isFalse); // repeat is a no-op
    expect(identity.distinctId, 'u_42');
    expect(identity.anonId, 'anon-1');

    final relaunched = IdentityManager(store: store, idFactory: () => 'anon-2');
    await relaunched.load();
    expect(relaunched.distinctId, 'u_42');
    expect(relaunched.anonId, 'anon-1');
  });

  test('reset generates a fresh anonymous identity', () async {
    final store = InMemoryKeyValueStore();
    var calls = 0;
    final identity =
        IdentityManager(store: store, idFactory: () => 'anon-${++calls}');
    await identity.load();
    await identity.identify('u_42');

    await identity.reset();
    expect(identity.anonId, 'anon-2');
    expect(identity.distinctId, 'anon-2');
    expect(store.values[IdentityManager.distinctIdKey], isNull);
  });
}
```

- [ ] Run `flutter test test/identity/` — expect **FAIL**.
- [ ] Create `lib/src/identity/identity_manager.dart`:

```dart
import 'package:uuid/uuid.dart';

import '../storage/key_value_store.dart';

/// Owns `anon_id` and `distinct_id` as defined by the ingest contract §4 and
/// design §3: anon_id is a stable per-install UUID v7; distinct_id starts
/// equal to it and switches on identify().
class IdentityManager {
  IdentityManager({required KeyValueStore store, String Function()? idFactory})
      : _store = store,
        _idFactory = idFactory ?? (() => const Uuid().v7());

  static const anonIdKey = 'mam_anon_id';
  static const distinctIdKey = 'mam_distinct_id';

  final KeyValueStore _store;
  final String Function() _idFactory;

  late String _anonId;
  late String _distinctId;

  String get anonId => _anonId;
  String get distinctId => _distinctId;

  /// Loads persisted identity, generating a first-launch anonymous id.
  Future<void> load() async {
    final storedAnon = await _store.getString(anonIdKey);
    if (storedAnon == null) {
      _anonId = _idFactory();
      await _store.setString(anonIdKey, _anonId);
    } else {
      _anonId = storedAnon;
    }
    _distinctId = await _store.getString(distinctIdKey) ?? _anonId;
  }

  /// Returns true when the distinct id actually changed. The in-memory id is
  /// updated synchronously so immediately following events use it.
  Future<bool> identify(String userId) async {
    if (userId == _distinctId) return false;
    _distinctId = userId;
    await _store.setString(distinctIdKey, userId);
    return true;
  }

  /// Logout: fresh anonymous identity (design §3).
  Future<void> reset() async {
    _anonId = _idFactory();
    _distinctId = _anonId;
    await _store.setString(anonIdKey, _anonId);
    await _store.remove(distinctIdKey);
  }
}
```

- [ ] Run `flutter test test/identity/` — expect **PASS**.
- [ ] Commit: `feat(sdk): identity manager with persisted anon id, identify and reset`

---

### Task 6: Super properties & timeEvent tracker

**Files:**
- Create: `sdk/flutter_analytics/lib/src/properties/super_properties_store.dart`
- Create: `sdk/flutter_analytics/lib/src/properties/timed_event_tracker.dart`
- Test: `sdk/flutter_analytics/test/properties/super_properties_store_test.dart`
- Test: `sdk/flutter_analytics/test/properties/timed_event_tracker_test.dart`

**Interfaces:**
- Consumes: `KeyValueStore` (Task 4), `Clock` (Task 2).
- Produces: `class SuperPropertiesStore { SuperPropertiesStore(KeyValueStore store); Future<void> load(); Map<String, Object?> get current; Future<void> register(Map<String, Object?> properties); Future<void> clear(); }` and `class TimedEventTracker { TimedEventTracker(Clock clock); void start(String event); int? popDurationMs(String event); void clear(); }`.

**Steps:**

- [ ] Write the failing test `test/properties/super_properties_store_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/properties/super_properties_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('register merges and persists across relaunch', () async {
    final kv = InMemoryKeyValueStore();
    final store = SuperPropertiesStore(kv);
    await store.load();

    await store.register({'plan': 'free', 'ab_group': 'a'});
    await store.register({'plan': 'pro'}); // later value wins
    expect(store.current, {'plan': 'pro', 'ab_group': 'a'});

    final relaunched = SuperPropertiesStore(kv);
    await relaunched.load();
    expect(relaunched.current, {'plan': 'pro', 'ab_group': 'a'});
  });

  test('clear empties memory and persistence', () async {
    final kv = InMemoryKeyValueStore();
    final store = SuperPropertiesStore(kv);
    await store.load();
    await store.register({'plan': 'pro'});

    await store.clear();
    expect(store.current, isEmpty);
    expect(kv.values[SuperPropertiesStore.storageKey], isNull);
  });

  test('current is an unmodifiable snapshot', () async {
    final store = SuperPropertiesStore(InMemoryKeyValueStore());
    await store.load();
    await store.register({'plan': 'pro'});
    expect(() => store.current['plan'] = 'hacked', throwsUnsupportedError);
  });
}
```

- [ ] Write the failing test `test/properties/timed_event_tracker_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/properties/timed_event_tracker.dart';

import '../helpers/fake_clock.dart';

void main() {
  test('popDurationMs returns elapsed time once, then null', () {
    final clock = FakeClock();
    final tracker = TimedEventTracker(clock);

    tracker.start('level_completed');
    clock.advance(const Duration(seconds: 42));

    expect(tracker.popDurationMs('level_completed'), 42000);
    expect(tracker.popDurationMs('level_completed'), isNull); // consumed
  });

  test('returns null for events never started and after clear', () {
    final clock = FakeClock();
    final tracker = TimedEventTracker(clock);

    expect(tracker.popDurationMs('unknown'), isNull);

    tracker.start('a');
    tracker.clear();
    expect(tracker.popDurationMs('a'), isNull);
  });
}
```

- [ ] Run `flutter test test/properties/` — expect **FAIL**.
- [ ] Create `lib/src/properties/super_properties_store.dart`:

```dart
import 'dart:convert';

import '../storage/key_value_store.dart';

/// Persisted properties merged into every tracked event (design §7).
class SuperPropertiesStore {
  SuperPropertiesStore(this._store);

  static const storageKey = 'mam_super_properties';

  final KeyValueStore _store;
  Map<String, Object?> _properties = <String, Object?>{};

  Future<void> load() async {
    final raw = await _store.getString(storageKey);
    if (raw != null) {
      _properties =
          Map<String, Object?>.from(jsonDecode(raw) as Map<String, dynamic>);
    }
  }

  Map<String, Object?> get current => Map.unmodifiable(_properties);

  Future<void> register(Map<String, Object?> properties) async {
    _properties = {..._properties, ...properties};
    await _store.setString(storageKey, jsonEncode(_properties));
  }

  Future<void> clear() async {
    _properties = <String, Object?>{};
    await _store.remove(storageKey);
  }
}
```

- [ ] Create `lib/src/properties/timed_event_tracker.dart`:

```dart
import '../util/clock.dart';

/// Implements `timeEvent(name)`: the next `track(name)` gets `$duration_ms`
/// attached (design §7). Timers are in-memory only.
class TimedEventTracker {
  TimedEventTracker(this._clock);

  final Clock _clock;
  final Map<String, int> _startsMs = {};

  void start(String event) => _startsMs[event] = _clock.nowMs();

  /// Returns elapsed ms and forgets the timer, or null if none was started.
  int? popDurationMs(String event) {
    final startMs = _startsMs.remove(event);
    return startMs == null ? null : _clock.nowMs() - startMs;
  }

  /// Called by reset().
  void clear() => _startsMs.clear();
}
```

- [ ] Run `flutter test test/properties/` — expect **PASS**.
- [ ] Commit: `feat(sdk): persisted super properties and timeEvent tracker`

---

### Task 7: Context collector (contract §4 `context` block)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/context/context_collector.dart`
- Create: `sdk/flutter_analytics/lib/src/context/platform_context_data_source.dart`
- Test: `sdk/flutter_analytics/test/context/context_collector_test.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/fake_context_data_source.dart`

**Interfaces:**
- Consumes: `EventContext` (Task 3), `mamSdkVersion` (Task 1).
- Produces: `class AppInfo { String version; String build; }`, `class DeviceInfo { String os; String osVersion; String model; String manufacturer; }`, `class ScreenSize { int width; int height; }`, `abstract interface class ContextDataSource { Future<AppInfo> appInfo(); Future<DeviceInfo> deviceInfo(); String locale(); String timezone(); ScreenSize screenSize(); Future<String> network(); }`, `class ContextCollector { ContextCollector(ContextDataSource source); Future<EventContext> collect(); }` (static parts cached, `network` fresh per call), `class PlatformContextDataSource implements ContextDataSource` (production impl).

**Steps:**

- [ ] Write the test helper `test/helpers/fake_context_data_source.dart`:

```dart
import 'package:myampmix_analytics/src/context/context_collector.dart';

class FakeContextDataSource implements ContextDataSource {
  int appInfoCalls = 0;
  String networkValue = 'wifi';

  @override
  Future<AppInfo> appInfo() async {
    appInfoCalls++;
    return const AppInfo(version: '1.4.2', build: '142');
  }

  @override
  Future<DeviceInfo> deviceInfo() async => const DeviceInfo(
      os: 'ios',
      osVersion: '18.5',
      model: 'iPhone16,2',
      manufacturer: 'Apple');

  @override
  String locale() => 'fr_FR';

  @override
  String timezone() => 'Europe/Paris';

  @override
  ScreenSize screenSize() => const ScreenSize(width: 393, height: 852);

  @override
  Future<String> network() async => networkValue;
}
```

- [ ] Write the failing test `test/context/context_collector_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/context/context_collector.dart';

import '../helpers/fake_context_data_source.dart';

void main() {
  test('collect() fills every M1 context field per contract §4', () async {
    final collector = ContextCollector(FakeContextDataSource());
    final context = await collector.collect();

    expect(context.toJson(), {
      'app_version': '1.4.2',
      'app_build': '142',
      'os': 'ios',
      'os_version': '18.5',
      'device_model': 'iPhone16,2',
      'device_manufacturer': 'Apple',
      'locale': 'fr_FR',
      'timezone': 'Europe/Paris',
      'screen_width': 393,
      'screen_height': 852,
      'network': 'wifi',
      'sdk_version': '0.1.0',
    });
  });

  test('caches static parts but refreshes network per call', () async {
    final source = FakeContextDataSource();
    final collector = ContextCollector(source);

    await collector.collect();
    source.networkValue = 'offline';
    final second = await collector.collect();

    expect(source.appInfoCalls, 1); // static info fetched once
    expect(second.network, 'offline'); // network is fresh
  });
}
```

- [ ] Run `flutter test test/context/` — expect **FAIL**.
- [ ] Create `lib/src/context/context_collector.dart`:

```dart
import '../model/event.dart';
import '../version.dart';

class AppInfo {
  const AppInfo({required this.version, required this.build});

  final String version;
  final String build;
}

class DeviceInfo {
  const DeviceInfo({
    required this.os,
    required this.osVersion,
    required this.model,
    required this.manufacturer,
  });

  final String os;
  final String osVersion;
  final String model;
  final String manufacturer;
}

class ScreenSize {
  const ScreenSize({required this.width, required this.height});

  final int width;
  final int height;
}

/// Platform data behind an interface so tests inject fakes (design §10).
abstract interface class ContextDataSource {
  Future<AppInfo> appInfo();
  Future<DeviceInfo> deviceInfo();
  String locale();
  String timezone();
  ScreenSize screenSize();

  /// `'wifi' | 'cellular' | 'offline'` per contract §4.
  Future<String> network();
}

/// Builds the contract-§4 `context` block for every event. App and device
/// info are fetched once and cached; network state is fresh per event.
class ContextCollector {
  ContextCollector(this._source);

  final ContextDataSource _source;
  AppInfo? _appInfo;
  DeviceInfo? _deviceInfo;

  Future<EventContext> collect() async {
    final appInfo = _appInfo ??= await _source.appInfo();
    final deviceInfo = _deviceInfo ??= await _source.deviceInfo();
    final screen = _source.screenSize();
    return EventContext(
      appVersion: appInfo.version,
      appBuild: appInfo.build,
      os: deviceInfo.os,
      osVersion: deviceInfo.osVersion,
      deviceModel: deviceInfo.model,
      deviceManufacturer: deviceInfo.manufacturer,
      locale: _source.locale(),
      timezone: _source.timezone(),
      screenWidth: screen.width,
      screenHeight: screen.height,
      network: await _source.network(),
      sdkVersion: mamSdkVersion,
    );
  }
}
```

- [ ] Create `lib/src/context/platform_context_data_source.dart`:

```dart
import 'dart:io';
import 'dart:ui' as ui;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'context_collector.dart';

/// Production [ContextDataSource] backed by the platform plugins
/// (design §10 table: field-by-field iOS/Android sources).
class PlatformContextDataSource implements ContextDataSource {
  PlatformContextDataSource({
    DeviceInfoPlugin? deviceInfoPlugin,
    Connectivity? connectivity,
  })  : _deviceInfoPlugin = deviceInfoPlugin ?? DeviceInfoPlugin(),
        _connectivity = connectivity ?? Connectivity();

  final DeviceInfoPlugin _deviceInfoPlugin;
  final Connectivity _connectivity;

  @override
  Future<AppInfo> appInfo() async {
    final info = await PackageInfo.fromPlatform();
    return AppInfo(version: info.version, build: info.buildNumber);
  }

  @override
  Future<DeviceInfo> deviceInfo() async {
    if (Platform.isIOS) {
      final ios = await _deviceInfoPlugin.iosInfo;
      return DeviceInfo(
        os: 'ios',
        osVersion: ios.systemVersion,
        model: ios.utsname.machine,
        manufacturer: 'Apple',
      );
    }
    if (Platform.isAndroid) {
      final android = await _deviceInfoPlugin.androidInfo;
      return DeviceInfo(
        os: 'android',
        osVersion: android.version.release,
        model: android.model,
        manufacturer: android.manufacturer,
      );
    }
    return DeviceInfo(
      os: Platform.operatingSystem,
      osVersion: Platform.operatingSystemVersion,
      model: 'unknown',
      manufacturer: 'unknown',
    );
  }

  @override
  String locale() => ui.PlatformDispatcher.instance.locale.toString();

  // M1 limitation (design §16): may be an abbreviation (e.g. CEST) rather
  // than an IANA name. The field is optional in contract §4.
  @override
  String timezone() => DateTime.now().timeZoneName;

  @override
  ScreenSize screenSize() {
    final views = ui.PlatformDispatcher.instance.views;
    if (views.isEmpty) return const ScreenSize(width: 0, height: 0);
    final view = views.first;
    return ScreenSize(
      width: (view.physicalSize.width / view.devicePixelRatio).round(),
      height: (view.physicalSize.height / view.devicePixelRatio).round(),
    );
  }

  @override
  Future<String> network() async {
    final results = await _connectivity.checkConnectivity();
    if (results.contains(ConnectivityResult.wifi) ||
        results.contains(ConnectivityResult.ethernet)) {
      return 'wifi';
    }
    if (results.contains(ConnectivityResult.mobile)) return 'cellular';
    return 'offline';
  }
}
```

- [ ] Run `flutter test test/context/` — expect **PASS**.
- [ ] Commit: `feat(sdk): automatic context collection with platform data source`

---

### Task 8: Session manager (30-minute background rotation)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/session/session_manager.dart`
- Test: `sdk/flutter_analytics/test/session/session_manager_test.dart`

**Interfaces:**
- Consumes: `Clock` (Task 2), `KeyValueStore` (Task 4).
- Produces: `class SessionManager { SessionManager({required Clock clock, required KeyValueStore store, required Duration timeout, required String Function() idFactory, required Future<void> Function(String event, Map<String, Object?> properties) emit}); String get sessionId; Future<void> start(); Future<void> handleLifecycleState(AppLifecycleState state); }`. The facade (Task 13) wires `emit` to `EventPipeline.track` and forwards lifecycle states from a `WidgetsBindingObserver`. `$session_end` is emitted **before** rotating so it carries the old session id.

**Steps:**

- [ ] Write the failing test `test/session/session_manager_test.dart`:

```dart
import 'dart:ui' show AppLifecycleState;

import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/session/session_manager.dart';

import '../helpers/fake_clock.dart';
import '../helpers/in_memory_key_value_store.dart';

class Emitted {
  Emitted(this.event, this.properties, this.sessionId);

  final String event;
  final Map<String, Object?> properties;
  final String sessionId;
}

void main() {
  late FakeClock clock;
  late InMemoryKeyValueStore store;
  late List<Emitted> emitted;
  var idCounter = 0;

  setUp(() {
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    store = InMemoryKeyValueStore();
    emitted = [];
    idCounter = 0;
  });

  SessionManager build() {
    late SessionManager manager;
    manager = SessionManager(
      clock: clock,
      store: store,
      timeout: const Duration(minutes: 30),
      idFactory: () => 'session-${++idCounter}',
      emit: (event, properties) async =>
          emitted.add(Emitted(event, properties, manager.sessionId)),
    );
    return manager;
  }

  test(r'first launch emits $session_start, $first_open, $app_open', () async {
    final session = build();
    await session.start();

    expect(emitted.map((e) => e.event).toList(),
        [r'$session_start', r'$first_open', r'$app_open']);
    expect(session.sessionId, 'session-1');
  });

  test('short background keeps the session', () async {
    final session = build();
    await session.start();
    emitted.clear();

    await session.handleLifecycleState(AppLifecycleState.paused);
    clock.advance(const Duration(minutes: 10));
    await session.handleLifecycleState(AppLifecycleState.resumed);

    expect(emitted.map((e) => e.event).toList(),
        [r'$app_background', r'$app_open']);
    expect(session.sessionId, 'session-1');
  });

  test(r'30 min background rotates: $session_end has $duration_ms and old id',
      () async {
    final session = build();
    await session.start();
    clock.advance(const Duration(minutes: 5)); // 5 min of foreground use
    await session.handleLifecycleState(AppLifecycleState.paused);
    emitted.clear();

    clock.advance(const Duration(minutes: 31));
    await session.handleLifecycleState(AppLifecycleState.resumed);

    expect(emitted.map((e) => e.event).toList(),
        [r'$session_end', r'$session_start', r'$app_open']);
    final end = emitted.first;
    expect(end.properties[r'$duration_ms'], 5 * 60 * 1000);
    expect(end.sessionId, 'session-1'); // emitted under the OLD session id
    expect(session.sessionId, 'session-2');
  });

  test('duplicate background states are ignored', () async {
    final session = build();
    await session.start();
    emitted.clear();

    await session.handleLifecycleState(AppLifecycleState.inactive);
    await session.handleLifecycleState(AppLifecycleState.hidden);
    await session.handleLifecycleState(AppLifecycleState.paused);

    expect(emitted.map((e) => e.event).toList(), [r'$app_background']);
  });

  test('relaunch after kill finalizes the stale session', () async {
    final first = build();
    await first.start();
    clock.advance(const Duration(minutes: 3));
    await first.handleLifecycleState(AppLifecycleState.paused);
    emitted.clear();

    clock.advance(const Duration(hours: 2)); // app was killed meanwhile
    final second = build(); // fresh instance, same persisted store
    await second.start();

    expect(emitted.map((e) => e.event).toList(),
        [r'$session_end', r'$session_start', r'$app_open']); // no $first_open
    expect(emitted.first.properties[r'$duration_ms'], 3 * 60 * 1000);
    expect(second.sessionId, 'session-2');
  });

  test('relaunch shortly after background resumes the same session', () async {
    final first = build();
    await first.start();
    await first.handleLifecycleState(AppLifecycleState.paused);
    emitted.clear();

    clock.advance(const Duration(minutes: 5));
    final second = build();
    await second.start();

    expect(emitted.map((e) => e.event).toList(), [r'$app_open']);
    expect(second.sessionId, 'session-1');
  });
}
```

- [ ] Run `flutter test test/session/` — expect **FAIL**.
- [ ] Create `lib/src/session/session_manager.dart`:

```dart
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
    required Future<void> Function(String event, Map<String, Object?> properties)
        emit,
  })  : _clock = clock,
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
    final persistedStartMs =
        int.tryParse(await _store.getString(sessionStartKey) ?? '');
    final lastActivityMs =
        int.tryParse(await _store.getString(lastActivityKey) ?? '');

    final resumable = persistedId != null &&
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
        await _emit(r'$session_end', {
          r'$duration_ms': (lastActivityMs ?? persistedStartMs) - persistedStartMs,
        });
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
          await _emit(r'$session_end',
              {r'$duration_ms': lastActivityMs - _sessionStartMs});
          await _beginSession();
        }
        await _emit(r'$app_open', const {});
        await _touch();
      case AppLifecycleState.inactive:
        break;
    }
  }

  Future<void> _beginSession() async {
    _sessionId = _idFactory();
    _sessionStartMs = _clock.nowMs();
    await _store.setString(sessionIdKey, _sessionId);
    await _store.setString(sessionStartKey, '$_sessionStartMs');
    await _emit(r'$session_start', const {});
  }

  Future<void> _touch() => _store.setString(lastActivityKey, '${_clock.nowMs()}');
}
```

- [ ] Run `flutter test test/session/` — expect **PASS**.
- [ ] Commit: `feat(sdk): session manager with 30-minute background rotation`

---

### Task 9: Event pipeline (track → assembled contract event → queue)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/pipeline/event_pipeline.dart`
- Test: `sdk/flutter_analytics/test/pipeline/event_pipeline_test.dart`

**Interfaces:**
- Consumes: `Clock`, `EventStore`, `IdentityManager`, `SuperPropertiesStore`, `TimedEventTracker`, `ContextCollector` (Tasks 2–8).
- Produces: `class EventPipeline { EventPipeline({required Clock clock, required EventStore store, required IdentityManager identity, required String Function() sessionId, required SuperPropertiesStore superProperties, required TimedEventTracker timedEvents, required ContextCollector contextCollector, required int maxQueueSize, required bool Function() isOptedOut, String Function()? idFactory, void Function(int queuedCount)? onEventQueued}); Future<void> track(String event, [Map<String, Object?>? properties]); }`. `sessionId` is a provider function (not the manager) to break the facade's construction cycle; `onEventQueued` lets the uploader trigger size-based flushes.

**Steps:**

- [ ] Write the failing test `test/pipeline/event_pipeline_test.dart`:

```dart
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/context/context_collector.dart';
import 'package:myampmix_analytics/src/identity/identity_manager.dart';
import 'package:myampmix_analytics/src/pipeline/event_pipeline.dart';
import 'package:myampmix_analytics/src/properties/super_properties_store.dart';
import 'package:myampmix_analytics/src/properties/timed_event_tracker.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/fake_clock.dart';
import '../helpers/fake_context_data_source.dart';
import '../helpers/in_memory_key_value_store.dart';

void main() {
  late AnalyticsDatabase db;
  late DriftEventStore store;
  late FakeClock clock;
  late IdentityManager identity;
  late SuperPropertiesStore superProps;
  late TimedEventTracker timedEvents;
  var optedOut = false;

  setUp(() async {
    db = AnalyticsDatabase(NativeDatabase.memory());
    store = DriftEventStore(db);
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    final kv = InMemoryKeyValueStore();
    identity = IdentityManager(store: kv, idFactory: () => 'anon-1');
    await identity.load();
    superProps = SuperPropertiesStore(kv);
    await superProps.load();
    timedEvents = TimedEventTracker(clock);
    optedOut = false;
  });

  tearDown(() => db.close());

  EventPipeline build({void Function(int)? onQueued}) => EventPipeline(
        clock: clock,
        store: store,
        identity: identity,
        sessionId: () => 'session-1',
        superProperties: superProps,
        timedEvents: timedEvents,
        contextCollector: ContextCollector(FakeContextDataSource()),
        maxQueueSize: 100,
        isOptedOut: () => optedOut,
        idFactory: () => 'insert-1',
        onEventQueued: onQueued,
      );

  test('persists a fully assembled contract event', () async {
    await superProps.register({'plan': 'pro'});
    await build().track('checkout_completed', {'value': 9.99});

    final stored = (await store.oldest(1)).single.event;
    expect(stored.toJson(), {
      'insert_id': 'insert-1',
      'event': 'checkout_completed',
      'distinct_id': 'anon-1',
      'anon_id': 'anon-1',
      'session_id': 'session-1',
      'timestamp': clock.nowMs(),
      'properties': {'plan': 'pro', 'value': 9.99},
      'context': {
        'app_version': '1.4.2',
        'app_build': '142',
        'os': 'ios',
        'os_version': '18.5',
        'device_model': 'iPhone16,2',
        'device_manufacturer': 'Apple',
        'locale': 'fr_FR',
        'timezone': 'Europe/Paris',
        'screen_width': 393,
        'screen_height': 852,
        'network': 'wifi',
        'sdk_version': '0.1.0',
      },
    });
  });

  test('explicit properties win over super properties', () async {
    await superProps.register({'plan': 'free'});
    await build().track('e', {'plan': 'pro'});
    expect((await store.oldest(1)).single.event.properties['plan'], 'pro');
  });

  test(r'attaches $duration_ms from a pending timeEvent', () async {
    timedEvents.start('level_completed');
    clock.advance(const Duration(seconds: 42));
    await build().track('level_completed');
    expect((await store.oldest(1)).single.event.properties[r'$duration_ms'],
        42000);
  });

  test('drops events while opted out', () async {
    optedOut = true;
    await build().track('e');
    expect(await store.count(), 0);
  });

  test('reports queue size after each insert', () async {
    int? reported;
    await build(onQueued: (count) => reported = count).track('e');
    expect(reported, 1);
  });
}
```

- [ ] Run `flutter test test/pipeline/` — expect **FAIL**.
- [ ] Create `lib/src/pipeline/event_pipeline.dart`:

```dart
import 'package:uuid/uuid.dart';

import '../context/context_collector.dart';
import '../identity/identity_manager.dart';
import '../model/event.dart';
import '../properties/super_properties_store.dart';
import '../properties/timed_event_tracker.dart';
import '../storage/event_store.dart';
import '../util/clock.dart';

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
  })  : _clock = clock,
        _store = store,
        _identity = identity,
        _sessionId = sessionId,
        _superProperties = superProperties,
        _timedEvents = timedEvents,
        _contextCollector = contextCollector,
        _maxQueueSize = maxQueueSize,
        _isOptedOut = isOptedOut,
        _idFactory = idFactory ?? (() => const Uuid().v7());

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

  /// Wired by the facade so the uploader can trigger size-based flushes.
  void Function(int queuedCount)? onEventQueued;

  Future<void> track(String event, [Map<String, Object?>? properties]) async {
    if (_isOptedOut()) return;
    final durationMs = _timedEvents.popDurationMs(event);
    final analyticsEvent = AnalyticsEvent(
      insertId: _idFactory(),
      event: event,
      distinctId: _identity.distinctId,
      anonId: _identity.anonId,
      sessionId: _sessionId(),
      timestamp: _clock.nowMs(),
      properties: <String, Object?>{
        ..._superProperties.current,
        ...?properties,
        if (durationMs != null) r'$duration_ms': durationMs,
      },
      context: await _contextCollector.collect(),
    );
    await _store.add(analyticsEvent, maxQueueSize: _maxQueueSize);
    onEventQueued?.call(await _store.count());
  }
}
```

- [ ] Run `flutter test test/pipeline/` — expect **PASS**.
- [ ] Commit: `feat(sdk): event pipeline assembling and queueing contract events`

---

### Task 10: Uploader (gzip batches, backoff + jitter, 202 handling)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/network/uploader.dart`
- Test: `sdk/flutter_analytics/test/network/uploader_test.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/in_memory_stores.dart`
- Test helper: `sdk/flutter_analytics/test/helpers/fixed_random.dart`

**Interfaces:**
- Consumes: `EventStore`, `ProfileOpStore` (Task 4), `Clock` (Task 2), `MamLogger` (Task 2).
- Produces: `class Uploader { Uploader({required http.Client client, required EventStore events, required ProfileOpStore profiles, required String serverUrl, required String token, required Clock clock, required int batchSize, required Duration flushInterval, Duration baseRetryDelay = const Duration(seconds: 2), Duration maxRetryDelay = const Duration(minutes: 5), math.Random? random, MamLogger logger = const MamLogger(enabled: false)}); void start(); void maybeFlush(int queuedCount); Future<void> flush({bool force = false}); void dispose(); }`.
- Behavior contract: gzip `POST {serverUrl}/ingest/events` / `/ingest/profiles` with `Authorization: Bearer <token>`; rows are deleted **only** after a `202` (rejected items in a 202 are permanently invalid and are dropped with a debug log); `400/413` drops the batch; `401/429/5xx/network` retains and backs off `min(2s × 2^(n−1), maxRetryDelay) × U(0.5, 1.5)`; timer flushes respect the backoff deadline; `flush(force: true)` overrides it.

**Steps:**

- [ ] Write the test helper `test/helpers/in_memory_stores.dart`:

```dart
import 'package:myampmix_analytics/src/model/event.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';
import 'package:myampmix_analytics/src/storage/profile_op_store.dart';

class InMemoryEventStore implements EventStore {
  final List<StoredEvent> rows = [];
  int _nextId = 1;

  @override
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}) async {
    rows.add(StoredEvent(id: _nextId++, event: event));
    while (rows.length > maxQueueSize) {
      rows.removeAt(0);
    }
  }

  @override
  Future<List<StoredEvent>> oldest(int limit) async => rows.take(limit).toList();

  @override
  Future<void> delete(List<int> ids) async =>
      rows.removeWhere((row) => ids.contains(row.id));

  @override
  Future<int> count() async => rows.length;

  @override
  Future<void> clear() async => rows.clear();
}

class InMemoryProfileOpStore implements ProfileOpStore {
  final List<StoredProfileOp> rows = [];
  int _nextId = 1;

  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) async {
    rows.add(StoredProfileOp(id: _nextId++, op: op));
    while (rows.length > maxQueueSize) {
      rows.removeAt(0);
    }
  }

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async =>
      rows.take(limit).toList();

  @override
  Future<void> delete(List<int> ids) async =>
      rows.removeWhere((row) => ids.contains(row.id));

  @override
  Future<int> count() async => rows.length;

  @override
  Future<void> clear() async => rows.clear();
}
```

- [ ] Write the test helper `test/helpers/fixed_random.dart`:

```dart
import 'dart:math';

/// Deterministic Random: nextDouble() always returns [value], making the
/// backoff jitter factor exactly `0.5 + value`.
class FixedRandom implements Random {
  FixedRandom(this.value);

  final double value;

  @override
  double nextDouble() => value;

  @override
  int nextInt(int max) => 0;

  @override
  bool nextBool() => false;
}
```

- [ ] Write the failing test `test/network/uploader_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/src/model/profile_operation.dart';
import 'package:myampmix_analytics/src/network/uploader.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import '../helpers/builders.dart';
import '../helpers/fake_clock.dart';
import '../helpers/fixed_random.dart';
import '../helpers/in_memory_stores.dart';

void main() {
  late InMemoryEventStore events;
  late InMemoryProfileOpStore profiles;
  late FakeClock clock;
  late List<http.Request> requests;

  setUp(() {
    events = InMemoryEventStore();
    profiles = InMemoryProfileOpStore();
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    requests = [];
  });

  Uploader build(http.Client client, {double jitter = 0.5}) => Uploader(
        client: client,
        events: events,
        profiles: profiles,
        serverUrl: 'http://localhost:8080',
        token: 'mam_0123456789abcdef0123456789abcdef',
        clock: clock,
        batchSize: 20,
        flushInterval: const Duration(seconds: 10),
        random: FixedRandom(jitter), // jitter factor = 0.5 + jitter
      );

  MockClient acceptAll({String body = '{"accepted": 20, "rejected": []}'}) =>
      MockClient((request) async {
        requests.add(request);
        return http.Response(body, 202);
      });

  Map<String, dynamic> decodeBody(http.Request request) =>
      jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
          as Map<String, dynamic>;

  test('posts gzip batches of 20 with auth header; deletes only after 202',
      () async {
    for (var i = 0; i < 25; i++) {
      await events.add(buildEvent(name: 'e$i', insertId: 'i-$i'),
          maxQueueSize: 1000);
    }
    await build(acceptAll()).flush();

    expect(requests, hasLength(2)); // 20 + 5
    final first = requests.first;
    expect(first.url.toString(), 'http://localhost:8080/ingest/events');
    expect(first.headers['Authorization'],
        'Bearer mam_0123456789abcdef0123456789abcdef');
    expect(first.headers['Content-Encoding'], 'gzip');
    final payload = decodeBody(first);
    expect((payload['events'] as List).length, 20);
    expect(((payload['events'] as List).first as Map)['insert_id'], 'i-0');
    expect(await events.count(), 0);
  });

  test('keeps events and backs off after a 5xx; retries after the delay',
      () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('oops', 500);
    });
    final uploader = build(client); // jitter factor exactly 1.0

    await uploader.flush();
    expect(calls, 1);
    expect(await events.count(), 1); // retained

    clock.advance(const Duration(seconds: 1)); // inside 2 s backoff window
    await uploader.flush();
    expect(calls, 1); // no attempt

    clock.advance(const Duration(seconds: 1)); // 2 s elapsed
    await uploader.flush();
    expect(calls, 2);
  });

  test('backoff doubles per consecutive failure', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('oops', 500);
    });
    final uploader = build(client);

    await uploader.flush(); // failure 1 → next delay 2 s
    clock.advance(const Duration(seconds: 2));
    await uploader.flush(); // failure 2 → next delay 4 s
    expect(calls, 2);

    clock.advance(const Duration(seconds: 3)); // still inside 4 s window
    await uploader.flush();
    expect(calls, 2);

    clock.advance(const Duration(seconds: 1)); // 4 s elapsed
    await uploader.flush();
    expect(calls, 3);
  });

  test('flush(force: true) ignores the backoff window', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('oops', 500);
    });
    final uploader = build(client);

    await uploader.flush();
    await uploader.flush(force: true);
    expect(calls, 2);
  });

  test('drops the batch on 400 without retrying', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final client = MockClient((request) async => http.Response('bad', 400));
    await build(client).flush();
    expect(await events.count(), 0);
  });

  test('202 partial rejection: whole batch leaves the queue (rejected dropped)',
      () async {
    await events.add(buildEvent(insertId: 'ok'), maxQueueSize: 10);
    await events.add(buildEvent(insertId: 'bad'), maxQueueSize: 10);
    final client = acceptAll(
        body:
            '{"accepted": 1, "rejected": [{"index": 1, "reason": "missing insert_id"}]}');
    await build(client).flush();
    expect(await events.count(), 0);
  });

  test('keeps events when the network throws (offline)', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final client =
        MockClient((request) async => throw const SocketException('offline'));
    await build(client).flush();
    expect(await events.count(), 1);
  });

  test('drains profile operations to /ingest/profiles with contract payload',
      () async {
    await profiles.add(
      const ProfileOperation(
          distinctId: 'u_42',
          op: 'set',
          properties: {'plan': 'pro'},
          timestamp: 1751462400123),
      maxQueueSize: 10,
    );
    await build(acceptAll()).flush();

    expect(requests.single.url.path, '/ingest/profiles');
    expect(decodeBody(requests.single), {
      'operations': [
        {
          'distinct_id': 'u_42',
          'op': 'set',
          'properties': {'plan': 'pro'},
          'timestamp': 1751462400123,
        }
      ],
    });
  });

  test('maybeFlush triggers only at batchSize', () async {
    await events.add(buildEvent(), maxQueueSize: 10);
    final uploader = build(acceptAll());

    uploader.maybeFlush(19);
    await pumpEventQueue();
    expect(requests, isEmpty);

    uploader.maybeFlush(20);
    await pumpEventQueue();
    expect(requests, hasLength(1));
  });

  test('periodic timer flushes every flushInterval', () {
    fakeAsync((async) {
      events.rows.add(StoredEvent(id: 1, event: buildEvent()));
      final uploader = build(acceptAll());
      uploader.start();
      expect(requests, isEmpty);

      async.elapse(const Duration(seconds: 10));
      expect(requests, hasLength(1));

      uploader.dispose();
      async.elapse(const Duration(seconds: 30));
      expect(requests, hasLength(1)); // timer cancelled
    });
  });
}
```

- [ ] Run `flutter test test/network/` — expect **FAIL**.
- [ ] Create `lib/src/network/uploader.dart`:

```dart
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
  })  : _client = client,
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
      final rejected = (jsonDecode(responseBody)
          as Map<String, dynamic>)['rejected'] as List<dynamic>?;
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
    final rawMs = baseRetryDelay.inMilliseconds * math.pow(2, exponent).toDouble();
    final cappedMs = math.min(rawMs, maxRetryDelay.inMilliseconds.toDouble());
    final jitterFactor = 0.5 + _random.nextDouble(); // uniform in [0.5, 1.5)
    _nextAttemptAt =
        _clock.now().add(Duration(milliseconds: (cappedMs * jitterFactor).round()));
    _logger.log(
        'Flush failed ($reason); retry #$_consecutiveFailures after $_nextAttemptAt');
  }

  void _resetBackoff() {
    _consecutiveFailures = 0;
    _nextAttemptAt = null;
  }
}
```

- [ ] Run `flutter test test/network/` — expect **PASS**.
- [ ] Commit: `feat(sdk): gzip batch uploader with backoff, jitter and 202 handling`

---

### Task 11: People API (profile operations)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/people.dart`
- Test: `sdk/flutter_analytics/test/people_test.dart`

**Interfaces:**
- Consumes: `ProfileOpStore`, `ProfileOperation`, `Clock`, `MamLogger`.
- Produces: `class People { People({required ProfileOpStore store, required String Function() distinctId, required Clock clock, required bool Function() isOptedOut, required int maxQueueSize, void Function(int queuedCount)? onQueued, MamLogger logger}); factory People.noop(); void set(Map<String, Object?>); void setOnce(Map<String, Object?>); void increment(Map<String, num>); void append(Map<String, Object?>); void unset(List<String>); void deleteUser(); }`. Methods are synchronous fire-and-forget (frozen §8 surface) and never throw; `People.noop()` is the inert pre-init instance used by the facade.

**Steps:**

- [ ] Write the failing test `test/people_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/people.dart';

import 'helpers/fake_clock.dart';
import 'helpers/in_memory_stores.dart';

void main() {
  test('maps every api call to its contract §4 operation', () async {
    final store = InMemoryProfileOpStore();
    final clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: clock,
      isOptedOut: () => false,
      maxQueueSize: 100,
    );

    people.set({'plan': 'pro'});
    people.setOnce({'signup_source': 'organic'});
    people.increment({'sessions': 1});
    people.append({'badges': 'beta'});
    people.unset(['plan', 'badges']);
    people.deleteUser();
    await pumpEventQueue();

    final ops = [for (final row in store.rows) row.op.toJson()];
    expect(ops, [
      {'distinct_id': 'u_42', 'op': 'set', 'properties': {'plan': 'pro'}, 'timestamp': clock.nowMs()},
      {'distinct_id': 'u_42', 'op': 'set_once', 'properties': {'signup_source': 'organic'}, 'timestamp': clock.nowMs()},
      {'distinct_id': 'u_42', 'op': 'increment', 'properties': {'sessions': 1}, 'timestamp': clock.nowMs()},
      {'distinct_id': 'u_42', 'op': 'append', 'properties': {'badges': 'beta'}, 'timestamp': clock.nowMs()},
      {'distinct_id': 'u_42', 'op': 'unset', 'properties': {'plan': null, 'badges': null}, 'timestamp': clock.nowMs()},
      {'distinct_id': 'u_42', 'op': 'delete', 'properties': <String, Object?>{}, 'timestamp': clock.nowMs()},
    ]);
  });

  test('drops operations while opted out', () async {
    final store = InMemoryProfileOpStore();
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: FakeClock(),
      isOptedOut: () => true,
      maxQueueSize: 100,
    );
    people.set({'plan': 'pro'});
    await pumpEventQueue();
    expect(store.rows, isEmpty);
  });

  test('reports queue size after each enqueue', () async {
    final store = InMemoryProfileOpStore();
    final counts = <int>[];
    final people = People(
      store: store,
      distinctId: () => 'u_42',
      clock: FakeClock(),
      isOptedOut: () => false,
      maxQueueSize: 100,
      onQueued: counts.add,
    );
    people.set({'a': 1});
    people.set({'b': 2});
    await pumpEventQueue();
    expect(counts, [1, 2]);
  });

  test('noop instance never throws and stores nothing', () async {
    final people = People.noop();
    expect(() {
      people.set({'a': 1});
      people.increment({'n': 1});
      people.deleteUser();
    }, returnsNormally);
    await pumpEventQueue();
  });
}
```

- [ ] Run `flutter test test/people_test.dart` — expect **FAIL**.
- [ ] Create `lib/src/people.dart`:

```dart
import 'dart:async';

import 'model/profile_operation.dart';
import 'storage/profile_op_store.dart';
import 'util/clock.dart';
import 'util/logger.dart';

/// `MyAmpMix.instance.people` — maps 1:1 to `/ingest/profiles` operations
/// (shared-contracts §4 and §8). Methods are synchronous fire-and-forget
/// per the frozen surface and never throw into the host app.
class People {
  People({
    required ProfileOpStore store,
    required String Function() distinctId,
    required Clock clock,
    required bool Function() isOptedOut,
    required int maxQueueSize,
    void Function(int queuedCount)? onQueued,
    MamLogger logger = const MamLogger(enabled: false),
  })  : _store = store,
        _distinctId = distinctId,
        _clock = clock,
        _isOptedOut = isOptedOut,
        _maxQueueSize = maxQueueSize,
        _onQueued = onQueued,
        _logger = logger;

  /// Inert instance used before `MyAmpMix.init` completes (design §13).
  factory People.noop() => People(
        store: _NoopProfileOpStore(),
        distinctId: () => '',
        clock: const SystemClock(),
        isOptedOut: () => true,
        maxQueueSize: 0,
      );

  final ProfileOpStore _store;
  final String Function() _distinctId;
  final Clock _clock;
  final bool Function() _isOptedOut;
  final int _maxQueueSize;
  final void Function(int queuedCount)? _onQueued;
  final MamLogger _logger;

  void set(Map<String, Object?> properties) => _enqueue('set', properties);

  void setOnce(Map<String, Object?> properties) =>
      _enqueue('set_once', properties);

  void increment(Map<String, num> properties) =>
      _enqueue('increment', properties);

  void append(Map<String, Object?> properties) => _enqueue('append', properties);

  void unset(List<String> propertyNames) =>
      _enqueue('unset', {for (final name in propertyNames) name: null});

  void deleteUser() => _enqueue('delete', const {});

  void _enqueue(String op, Map<String, Object?> properties) {
    if (_isOptedOut()) return;
    final operation = ProfileOperation(
      distinctId: _distinctId(),
      op: op,
      properties: properties,
      timestamp: _clock.nowMs(),
    );
    unawaited(() async {
      try {
        await _store.add(operation, maxQueueSize: _maxQueueSize);
        _onQueued?.call(await _store.count());
      } on Object catch (error, stackTrace) {
        _logger.log('people.$op failed', error, stackTrace);
      }
    }());
  }
}

class _NoopProfileOpStore implements ProfileOpStore {
  @override
  Future<void> add(ProfileOperation op, {required int maxQueueSize}) async {}

  @override
  Future<List<StoredProfileOp>> oldest(int limit) async => const [];

  @override
  Future<void> delete(List<int> ids) async {}

  @override
  Future<int> count() async => 0;

  @override
  Future<void> clear() async {}
}
```

- [ ] Run `flutter test test/people_test.dart` — expect **PASS**.
- [ ] Commit: `feat(sdk): people api queueing profile operations`

---

### Task 12: Persisted opt-out

**Files:**
- Create: `sdk/flutter_analytics/lib/src/optout/opt_out_state.dart`
- Test: `sdk/flutter_analytics/test/optout/opt_out_state_test.dart`

**Interfaces:**
- Consumes: `KeyValueStore`, `EventStore`, `ProfileOpStore`.
- Produces: `class OptOutState { OptOutState({required KeyValueStore store, required EventStore events, required ProfileOpStore profiles}); Future<void> load(); bool get isOptedOut; Future<void> optOut(); Future<void> optIn(); }`. `isOptedOut` is what Task 9's pipeline and Task 11's People consume via `bool Function()`.

**Steps:**

- [ ] Write the failing test `test/optout/opt_out_state_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampmix_analytics/src/optout/opt_out_state.dart';

import '../helpers/builders.dart';
import '../helpers/in_memory_key_value_store.dart';
import '../helpers/in_memory_stores.dart';

void main() {
  test('optOut purges both queues and persists across relaunch', () async {
    final kv = InMemoryKeyValueStore();
    final events = InMemoryEventStore();
    final profiles = InMemoryProfileOpStore();
    await events.add(buildEvent(), maxQueueSize: 10);

    final state = OptOutState(store: kv, events: events, profiles: profiles);
    await state.load();
    expect(state.isOptedOut, isFalse);

    await state.optOut();
    expect(state.isOptedOut, isTrue);
    expect(await events.count(), 0);
    expect(await profiles.count(), 0);

    final relaunched =
        OptOutState(store: kv, events: events, profiles: profiles);
    await relaunched.load();
    expect(relaunched.isOptedOut, isTrue);
  });

  test('optIn re-enables tracking and persists', () async {
    final kv = InMemoryKeyValueStore();
    final state = OptOutState(
        store: kv,
        events: InMemoryEventStore(),
        profiles: InMemoryProfileOpStore());
    await state.load();

    await state.optOut();
    await state.optIn();
    expect(state.isOptedOut, isFalse);

    final relaunched = OptOutState(
        store: kv,
        events: InMemoryEventStore(),
        profiles: InMemoryProfileOpStore());
    await relaunched.load();
    expect(relaunched.isOptedOut, isFalse);
  });
}
```

- [ ] Run `flutter test test/optout/` — expect **FAIL**.
- [ ] Create `lib/src/optout/opt_out_state.dart`:

```dart
import '../storage/event_store.dart';
import '../storage/key_value_store.dart';
import '../storage/profile_op_store.dart';

/// Persisted opt-out (design §9): opting out purges both queues, and the
/// pipeline/People drop everything while `isOptedOut` is true.
class OptOutState {
  OptOutState({
    required KeyValueStore store,
    required EventStore events,
    required ProfileOpStore profiles,
  })  : _store = store,
        _events = events,
        _profiles = profiles;

  static const storageKey = 'mam_opted_out';

  final KeyValueStore _store;
  final EventStore _events;
  final ProfileOpStore _profiles;

  bool _optedOut = false;

  bool get isOptedOut => _optedOut;

  Future<void> load() async {
    _optedOut = await _store.getString(storageKey) == '1';
  }

  Future<void> optOut() async {
    _optedOut = true;
    await _store.setString(storageKey, '1');
    await _events.clear();
    await _profiles.clear();
  }

  Future<void> optIn() async {
    _optedOut = false;
    await _store.setString(storageKey, '0');
  }
}
```

- [ ] Run `flutter test test/optout/` — expect **PASS**.
- [ ] Commit: `feat(sdk): persisted opt-out purging queued data`

---

### Task 13: Public facade — `MyAmpMix` (frozen contracts §8 surface)

**Files:**
- Create: `sdk/flutter_analytics/lib/src/myampmix.dart`
- Modify: `sdk/flutter_analytics/lib/myampmix_analytics.dart` (final barrel exports)
- Test: `sdk/flutter_analytics/test/myampmix_test.dart`

**Interfaces:**
- Consumes: everything from Tasks 2–12.
- Produces the exact §8 surface:
  - `static Future<void> MyAmpMix.init(String token, {required MyAmpMixConfig config, SdkOverrides? overrides})` (`overrides` is `@visibleForTesting` only)
  - `static MyAmpMix get instance`
  - `void track(String event, {Map<String, Object?>? properties})`, `void identify(String userId)`, `void alias(String aliasId)`, `void reset()`, `void flush()`, `void timeEvent(String event)`, `void registerSuperProperties(Map<String, Object?> properties)`, `People people`, `void optOutTracking()`, `void optInTracking()`
  - `class SdkOverrides { Clock? clock; http.Client? httpClient; AnalyticsDatabase? database; KeyValueStore? keyValueStore; ContextDataSource? contextDataSource; String Function()? idFactory; math.Random? random; }`
  - `@visibleForTesting static Future<void> MyAmpMix.shutdownForTesting({bool closeDatabase = true})`
- Never-throw guard: every method routes through `_guard`, which catches sync throws and attaches `catchError` to fire-and-forget futures; pre-init calls are logged no-ops. `MyAmpMixObserver`/`MyAmpMixTracker` widgets from §8 are **milestone M2** — not implemented here.

**Steps:**

- [ ] Write the failing test `test/myampmix_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';
import 'dart:ui' show AppLifecycleState;

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/key_value_store.dart';

import 'helpers/fake_clock.dart';
import 'helpers/fake_context_data_source.dart';
import 'helpers/fixed_random.dart';
import 'helpers/in_memory_key_value_store.dart';

class ThrowingKeyValueStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => throw StateError('boom');

  @override
  Future<void> setString(String key, String value) async =>
      throw StateError('boom');

  @override
  Future<void> remove(String key) async => throw StateError('boom');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<http.Request> requests;
  late FakeClock clock;
  late InMemoryKeyValueStore keyValueStore;

  setUp(() {
    requests = [];
    clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    keyValueStore = InMemoryKeyValueStore();
  });

  tearDown(() => MyAmpMix.shutdownForTesting());

  MockClient acceptAll() => MockClient((request) async {
        requests.add(request);
        return http.Response('{"accepted": 100, "rejected": []}', 202);
      });

  Future<void> initSdk({http.Client? client}) => MyAmpMix.init(
        'mam_0123456789abcdef0123456789abcdef',
        config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
        overrides: SdkOverrides(
          clock: clock,
          httpClient: client ?? acceptAll(),
          database: AnalyticsDatabase(NativeDatabase.memory()),
          keyValueStore: keyValueStore,
          contextDataSource: FakeContextDataSource(),
          random: FixedRandom(0.5),
        ),
      );

  Future<void> waitFor(bool Function() condition) async {
    for (var i = 0; i < 200 && !condition(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(condition(), isTrue);
  }

  List<Map<String, dynamic>> sentEvents() => [
        for (final request
            in requests.where((r) => r.url.path == '/ingest/events'))
          ...((jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                  as Map<String, dynamic>)['events'] as List)
              .cast<Map<String, dynamic>>(),
      ];

  test('init + track + flush delivers a contract-shaped event', () async {
    await initSdk();
    MyAmpMix.instance.track('checkout_completed', properties: {'value': 9.99});
    MyAmpMix.instance.flush();
    await waitFor(
        () => sentEvents().any((e) => e['event'] == 'checkout_completed'));

    final event =
        sentEvents().firstWhere((e) => e['event'] == 'checkout_completed');
    expect(event['insert_id'], isNotEmpty);
    expect(event['distinct_id'], event['anon_id']); // anonymous user
    expect(event['session_id'], isNotEmpty);
    expect(event['timestamp'], clock.nowMs());
    expect(event['properties'], {'value': 9.99});
    expect((event['context'] as Map)['sdk_version'], '0.1.0');
  });

  test('first launch sends the session lifecycle events in order', () async {
    await initSdk();
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().length >= 3);
    expect(sentEvents().map((e) => e['event']).toList(),
        containsAllInOrder([r'$session_start', r'$first_open', r'$app_open']));
  });

  test(r'identify emits $identify and switches distinct_id', () async {
    await initSdk();
    MyAmpMix.instance.identify('u_42');
    MyAmpMix.instance.track('after_login');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == 'after_login'));

    final identifyEvent =
        sentEvents().firstWhere((e) => e['event'] == r'$identify');
    expect(identifyEvent['distinct_id'], 'u_42');
    expect((identifyEvent['properties'] as Map)[r'$anon_id'],
        identifyEvent['anon_id']);
    final after = sentEvents().firstWhere((e) => e['event'] == 'after_login');
    expect(after['distinct_id'], 'u_42');
  });

  test(r'alias emits $identify carrying $alias', () async {
    await initSdk();
    MyAmpMix.instance.alias('new-id');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) =>
        e['event'] == r'$identify' &&
        (e['properties'] as Map)[r'$alias'] == 'new-id'));
  });

  test('background >30 min rotates the session', () async {
    await initSdk();
    final binding = TestWidgetsFlutterBinding.instance;

    binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await pumpEventQueue();

    clock.advance(const Duration(minutes: 31));
    binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await pumpEventQueue();

    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == r'$session_end'));

    final names = sentEvents().map((e) => e['event']).toList();
    expect(names,
        containsAll([r'$app_background', r'$session_end', r'$app_open']));
    final sessionEnd =
        sentEvents().firstWhere((e) => e['event'] == r'$session_end');
    expect((sessionEnd['properties'] as Map)[r'$duration_ms'], isA<int>());
    final firstId = sentEvents().first['session_id'];
    final lastOpen = sentEvents().lastWhere((e) => e['event'] == r'$app_open');
    expect(lastOpen['session_id'], isNot(firstId));
  });

  test('people operations are delivered to /ingest/profiles', () async {
    await initSdk();
    MyAmpMix.instance.people.set({'plan': 'pro'});
    await pumpEventQueue();
    MyAmpMix.instance.flush();
    await waitFor(
        () => requests.any((r) => r.url.path == '/ingest/profiles'));

    final request =
        requests.firstWhere((r) => r.url.path == '/ingest/profiles');
    final ops = (jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
        as Map<String, dynamic>)['operations'] as List;
    expect((ops.single as Map)['op'], 'set');
    expect((ops.single as Map)['properties'], {'plan': 'pro'});
    expect((ops.single as Map)['distinct_id'], isNotEmpty);
  });

  test('opt-out drops events until opt-in', () async {
    await initSdk();
    MyAmpMix.instance.optOutTracking();
    await pumpEventQueue();

    MyAmpMix.instance.track('secret');
    MyAmpMix.instance.flush();
    await pumpEventQueue();
    expect(sentEvents().where((e) => e['event'] == 'secret'), isEmpty);

    MyAmpMix.instance.optInTracking();
    await pumpEventQueue();
    MyAmpMix.instance.track('visible');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == 'visible'));
  });

  test('registerSuperProperties and timeEvent flow through track', () async {
    await initSdk();
    MyAmpMix.instance.registerSuperProperties({'ab_group': 'b'});
    MyAmpMix.instance.timeEvent('level_completed');
    await pumpEventQueue();
    clock.advance(const Duration(seconds: 7));
    MyAmpMix.instance.track('level_completed');
    MyAmpMix.instance.flush();
    await waitFor(
        () => sentEvents().any((e) => e['event'] == 'level_completed'));

    final event =
        sentEvents().firstWhere((e) => e['event'] == 'level_completed');
    expect((event['properties'] as Map)['ab_group'], 'b');
    expect((event['properties'] as Map)[r'$duration_ms'], 7000);
  });

  test('reset issues a fresh anonymous identity and clears super properties',
      () async {
    await initSdk();
    MyAmpMix.instance.identify('u_42');
    MyAmpMix.instance.registerSuperProperties({'plan': 'pro'});
    await pumpEventQueue();
    MyAmpMix.instance.reset();
    await pumpEventQueue();
    MyAmpMix.instance.track('after_reset');
    MyAmpMix.instance.flush();
    await waitFor(() => sentEvents().any((e) => e['event'] == 'after_reset'));

    final event = sentEvents().firstWhere((e) => e['event'] == 'after_reset');
    expect(event['distinct_id'], isNot('u_42'));
    expect(event['distinct_id'], event['anon_id']);
    expect((event['properties'] as Map).containsKey('plan'), isFalse);
  });

  test('no public method throws before init', () async {
    await MyAmpMix.shutdownForTesting(); // pristine uninitialized instance
    final sdk = MyAmpMix.instance;
    expect(() {
      sdk.track('e');
      sdk.identify('u');
      sdk.alias('a');
      sdk.reset();
      sdk.flush();
      sdk.timeEvent('e');
      sdk.registerSuperProperties({'k': 'v'});
      sdk.people.set({'k': 'v'});
      sdk.optOutTracking();
      sdk.optInTracking();
    }, returnsNormally);
  });

  test('init failure disables the SDK instead of throwing', () async {
    final db = AnalyticsDatabase(NativeDatabase.memory());
    await MyAmpMix.init(
      'mam_0123456789abcdef0123456789abcdef',
      config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        clock: clock,
        httpClient: acceptAll(),
        database: db,
        keyValueStore: ThrowingKeyValueStore(),
        contextDataSource: FakeContextDataSource(),
      ),
    );
    expect(() => MyAmpMix.instance.track('e'), returnsNormally);
    await pumpEventQueue();
    await db.close();
  });
}
```

- [ ] Run `flutter test test/myampmix_test.dart` — expect **FAIL** (missing `myampmix.dart`).
- [ ] Create `lib/src/myampmix.dart`:

```dart
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import 'config.dart';
import 'context/context_collector.dart';
import 'context/platform_context_data_source.dart';
import 'identity/identity_manager.dart';
import 'network/uploader.dart';
import 'optout/opt_out_state.dart';
import 'people.dart';
import 'pipeline/event_pipeline.dart';
import 'properties/super_properties_store.dart';
import 'properties/timed_event_tracker.dart';
import 'session/session_manager.dart';
import 'storage/database.dart';
import 'storage/event_store.dart';
import 'storage/key_value_store.dart';
import 'storage/profile_op_store.dart';
import 'util/clock.dart';
import 'util/logger.dart';

/// Testing-only dependency overrides for [MyAmpMix.init]. Production code
/// must not pass this parameter.
@visibleForTesting
class SdkOverrides {
  const SdkOverrides({
    this.clock,
    this.httpClient,
    this.database,
    this.keyValueStore,
    this.contextDataSource,
    this.idFactory,
    this.random,
  });

  final Clock? clock;
  final http.Client? httpClient;
  final AnalyticsDatabase? database;
  final KeyValueStore? keyValueStore;
  final ContextDataSource? contextDataSource;
  final String Function()? idFactory;
  final math.Random? random;
}

/// Public facade — the exact shared-contracts §8 surface. Every method is
/// guarded: the SDK never throws into the host app (design §13). The M2
/// widgets (MyAmpMixObserver, MyAmpMixTracker) ship in the autocapture
/// milestone, not in phase 1.
class MyAmpMix {
  MyAmpMix._();

  static MyAmpMix _instance = MyAmpMix._();

  static MyAmpMix get instance => _instance;

  bool _initialized = false;
  MamLogger _logger = const MamLogger(enabled: false);

  late final AnalyticsDatabase _database;
  late final IdentityManager _identity;
  late final SuperPropertiesStore _superProperties;
  late final TimedEventTracker _timedEvents;
  late final OptOutState _optOut;
  late final EventPipeline _pipeline;
  late final SessionManager _session;
  late final Uploader _uploader;
  _SdkLifecycleObserver? _observer;

  /// Profile operations (`people.set/setOnce/increment/append/unset/deleteUser`).
  People people = People.noop();

  /// Initializes the SDK. Never throws: on failure the SDK stays disabled
  /// and every call becomes a logged no-op.
  static Future<void> init(
    String token, {
    required MyAmpMixConfig config,
    @visibleForTesting SdkOverrides? overrides,
  }) async {
    final sdk = MyAmpMix._();
    try {
      await sdk._start(token, config, overrides);
      _instance = sdk;
    } on Object catch (error, stackTrace) {
      MamLogger(enabled: config.debug)
          .log('init failed; SDK disabled', error, stackTrace);
    }
  }

  Future<void> _start(
      String token, MyAmpMixConfig config, SdkOverrides? overrides) async {
    WidgetsFlutterBinding.ensureInitialized();
    _logger = MamLogger(enabled: config.debug);
    final clock = overrides?.clock ?? const SystemClock();
    final idFactory = overrides?.idFactory ?? (() => const Uuid().v7());
    final keyValueStore =
        overrides?.keyValueStore ?? await SharedPrefsKeyValueStore.open();
    _database = overrides?.database ?? AnalyticsDatabase.open();
    final events = DriftEventStore(_database);
    final profiles = DriftProfileOpStore(_database);

    _identity = IdentityManager(store: keyValueStore, idFactory: idFactory);
    await _identity.load();
    _superProperties = SuperPropertiesStore(keyValueStore);
    await _superProperties.load();
    _timedEvents = TimedEventTracker(clock);
    _optOut =
        OptOutState(store: keyValueStore, events: events, profiles: profiles);
    await _optOut.load();

    _uploader = Uploader(
      client: overrides?.httpClient ?? http.Client(),
      events: events,
      profiles: profiles,
      serverUrl: config.serverUrl,
      token: token,
      clock: clock,
      batchSize: config.flushAt,
      flushInterval: config.flushInterval,
      maxRetryDelay: config.maxRetryDelay,
      random: overrides?.random,
      logger: _logger,
    );

    _pipeline = EventPipeline(
      clock: clock,
      store: events,
      identity: _identity,
      sessionId: () => _session.sessionId,
      superProperties: _superProperties,
      timedEvents: _timedEvents,
      contextCollector: ContextCollector(
          overrides?.contextDataSource ?? PlatformContextDataSource()),
      maxQueueSize: config.maxQueueSize,
      isOptedOut: () => _optOut.isOptedOut,
      idFactory: idFactory,
      onEventQueued: (queuedCount) => _uploader.maybeFlush(queuedCount),
    );

    _session = SessionManager(
      clock: clock,
      store: keyValueStore,
      timeout: config.sessionTimeout,
      idFactory: idFactory,
      emit: (event, properties) => _pipeline.track(event, properties),
    );

    people = People(
      store: profiles,
      distinctId: () => _identity.distinctId,
      clock: clock,
      isOptedOut: () => _optOut.isOptedOut,
      maxQueueSize: config.maxQueueSize,
      onQueued: (queuedCount) => _uploader.maybeFlush(queuedCount),
      logger: _logger,
    );

    _initialized = true;
    _observer = _SdkLifecycleObserver(_session, _logger);
    WidgetsBinding.instance.addObserver(_observer!);
    await _session.start();
    _uploader.start();
  }

  void track(String event, {Map<String, Object?>? properties}) =>
      _guard('track', () => _pipeline.track(event, properties));

  void identify(String userId) => _guard('identify', () async {
        final changed = await _identity.identify(userId);
        if (changed) {
          await _pipeline
              .track(r'$identify', {r'$anon_id': _identity.anonId});
        }
      });

  void alias(String aliasId) =>
      _guard('alias', () => _pipeline.track(r'$identify', {r'$alias': aliasId}));

  void reset() => _guard('reset', () async {
        await _identity.reset();
        await _superProperties.clear();
        _timedEvents.clear();
      });

  void timeEvent(String event) =>
      _guard('timeEvent', () => _timedEvents.start(event));

  void registerSuperProperties(Map<String, Object?> properties) =>
      _guard('registerSuperProperties',
          () => _superProperties.register(properties));

  void optOutTracking() => _guard('optOutTracking', () => _optOut.optOut());

  void optInTracking() => _guard('optInTracking', () => _optOut.optIn());

  void flush() => _guard('flush', () => _uploader.flush(force: true));

  void _guard(String operation, FutureOr<void> Function() body) {
    if (!_initialized) {
      _logger.log('$operation ignored: MyAmpMix.init has not completed.');
      return;
    }
    try {
      final result = body();
      if (result is Future) {
        unawaited(result.catchError((Object error, StackTrace stackTrace) {
          _logger.log('$operation failed', error, stackTrace);
        }));
      }
    } on Object catch (error, stackTrace) {
      _logger.log('$operation failed', error, stackTrace);
    }
  }

  /// Tears down timers/observers between tests.
  @visibleForTesting
  static Future<void> shutdownForTesting({bool closeDatabase = true}) async {
    final sdk = _instance;
    if (sdk._initialized) {
      sdk._uploader.dispose();
      final observer = sdk._observer;
      if (observer != null) WidgetsBinding.instance.removeObserver(observer);
      if (closeDatabase) await sdk._database.close();
    }
    _instance = MyAmpMix._();
  }
}

class _SdkLifecycleObserver with WidgetsBindingObserver {
  _SdkLifecycleObserver(this._session, this._logger);

  final SessionManager _session;
  final MamLogger _logger;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    unawaited(_session.handleLifecycleState(state).catchError(
        (Object error, StackTrace stackTrace) =>
            _logger.log('lifecycle handling failed', error, stackTrace)));
  }
}
```

- [ ] Replace `lib/myampmix_analytics.dart` with the final barrel:

```dart
/// MyAmpMix Flutter analytics SDK.
///
/// Public surface per shared-contracts §8. The autocapture widgets
/// (MyAmpMixObserver, MyAmpMixTracker) ship in milestone M2.
library;

export 'src/config.dart';
export 'src/myampmix.dart' show MyAmpMix, SdkOverrides;
export 'src/people.dart' show People;
export 'src/version.dart';
```

- [ ] Run `flutter test test/myampmix_test.dart` — expect **PASS**.
- [ ] Run `flutter test` (full suite) — expect **PASS** (no regressions).
- [ ] Commit: `feat(sdk): MyAmpMix facade wiring the frozen contracts §8 surface`

---

### Task 14: Golden offline scenario & quality gates

**Files:**
- Test: `sdk/flutter_analytics/test/offline_golden_test.dart`

**Interfaces:**
- Consumes: the full public facade (Task 13) plus `DriftEventStore` to snapshot queued `insert_id`s.
- Produces: the master-design §6 golden scenario as an executable regression test, and the phase's verification gates (analyze + coverage).

**Steps:**

- [ ] Write the failing test `test/offline_golden_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';
import 'package:myampmix_analytics/src/storage/database.dart';
import 'package:myampmix_analytics/src/storage/event_store.dart';

import 'helpers/fake_clock.dart';
import 'helpers/fake_context_data_source.dart';
import 'helpers/fixed_random.dart';
import 'helpers/in_memory_key_value_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('golden: offline → kill → relaunch → flush delivers everything once',
      () async {
    final database = AnalyticsDatabase(NativeDatabase.memory());
    final keyValueStore = InMemoryKeyValueStore();
    final clock = FakeClock(DateTime.utc(2026, 7, 2, 12));
    var online = false;
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      if (!online) throw const SocketException('offline');
      requests.add(request);
      return http.Response('{"accepted": 100, "rejected": []}', 202);
    });

    Future<void> boot() => MyAmpMix.init(
          'mam_0123456789abcdef0123456789abcdef',
          config: const MyAmpMixConfig(serverUrl: 'http://localhost:8080'),
          overrides: SdkOverrides(
            clock: clock,
            httpClient: client,
            database: database,
            keyValueStore: keyValueStore,
            contextDataSource: FakeContextDataSource(),
            random: FixedRandom(0.5),
          ),
        );

    // ── Run 1: offline. Events must persist, nothing must be sent. ──
    await boot();
    MyAmpMix.instance.track('offline_1');
    MyAmpMix.instance.track('offline_2');
    MyAmpMix.instance.flush();
    await pumpEventQueue(times: 50);
    expect(requests, isEmpty);

    // Snapshot the insert_ids stamped at queue time.
    final queued = await DriftEventStore(database).oldest(100);
    final queuedIds = {for (final stored in queued) stored.event.insertId};
    expect(
        {for (final stored in queued) stored.event.event}
            .containsAll({'offline_1', 'offline_2'}),
        isTrue);

    // ── "Kill": tear down without closing the shared in-memory DB. ──
    await MyAmpMix.shutdownForTesting(closeDatabase: false);

    // ── Run 2: relaunch hours later with network restored. ──
    clock.advance(const Duration(hours: 2));
    online = true;
    await boot();
    MyAmpMix.instance.flush();
    for (var i = 0; i < 200 && requests.isEmpty; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    await pumpEventQueue(times: 50);

    final delivered = [
      for (final request
          in requests.where((r) => r.url.path == '/ingest/events'))
        ...((jsonDecode(utf8.decode(gzip.decode(request.bodyBytes)))
                as Map<String, dynamic>)['events'] as List)
            .cast<Map<String, dynamic>>(),
    ];
    final deliveredNames = delivered.map((e) => e['event']).toSet();
    final deliveredIds = delivered.map((e) => e['insert_id']).toSet();

    // All offline events arrive, with the ORIGINAL insert_ids (idempotency),
    // and the stale session was finalized on relaunch.
    expect(deliveredNames.containsAll({'offline_1', 'offline_2'}), isTrue);
    expect(deliveredIds.containsAll(queuedIds), isTrue);
    expect(deliveredNames, contains(r'$session_end'));

    await MyAmpMix.shutdownForTesting();
  });
}
```

- [ ] Run `flutter test test/offline_golden_test.dart` — expect **FAIL** only if any prior task's behavior is wrong (this test exercises Tasks 4–13 end-to-end); with Tasks 1–13 correctly implemented it should **PASS**. If it fails, fix the offending component — do not weaken the test.
- [ ] Run `flutter analyze` — expect **No issues found**.
- [ ] Run `flutter test --coverage` — expect all tests **PASS**.
- [ ] Verify the coverage floor (≥ 85 % lines, excluding generated code) using a pure awk filter (no `lcov` dependency):

```bash
awk '/^SF:.*\.g\.dart$/{skip=1} !skip{print} /^end_of_record$/{skip=0}' coverage/lcov.info > coverage/lcov.filtered.info
awk -F: '/^LF/{lf+=$2} /^LH/{lh+=$2} END{printf "line coverage: %.1f%%\n", 100*lh/lf}' \
  coverage/lcov.filtered.info
```

Expected output: `line coverage: ` ≥ `85.0%`. If below, add targeted unit tests for the uncovered branches (typically `PlatformContextDataSource` fallbacks and `MamLogger`) before proceeding.
- [ ] Commit: `test(sdk): offline relaunch golden scenario and coverage gate`

---

## Success criteria (phase 1 done when all hold)

1. `flutter test` passes with **all 14 tasks'** suites green; `flutter analyze` reports no issues; line coverage ≥ **85 %** (excluding `*.g.dart`).
2. The wire format is exactly shared-contracts §4: gzip `POST /ingest/events` with `{"events":[{insert_id, event, distinct_id, anon_id, session_id, timestamp(ms int), properties, context}]}` and `POST /ingest/profiles` with `{"operations":[{distinct_id, op, properties, timestamp}]}`, both with `Authorization: Bearer <token>` — verified byte-for-byte by the Task 3/9/10/13 assertions.
3. The public API is exactly shared-contracts §8 (init/track/identify/alias/reset/flush/timeEvent/registerSuperProperties/people.*/optOutTracking/optInTracking); the M2 widgets are documented as pending, and no extra public surface exists beyond the testing-only `SdkOverrides`/`shutdownForTesting`.
4. Reliability invariants hold under test: write-before-send (events survive offline + kill + relaunch with original `insert_id`s — Task 14 golden test); deletes only after `202`; `400/413` drops; `401/429/5xx`/network backoff doubles with jitter and caps at `maxRetryDelay`; queue caps evict oldest-first.
5. Sessions rotate after 30 min in background with `$session_start`/`$session_end` (`$duration_ms` exact via injected clock), stale sessions are finalized on relaunch, and `$first_open`/`$app_open`/`$app_background` fire per contract §4 reserved names.
6. No code path can throw into the host app: the pre-init, failed-init, and throwing-collaborator tests (Tasks 11 and 13) all pass.
7. Every commit follows Conventional Commits, and consumers never run codegen (`database.g.dart` committed).

