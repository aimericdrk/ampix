# MyAmpix Flutter SDK (`sdk/flutter_analytics`) — Design

**Date:** 2026-07-02
**Status:** Approved design
**Conforms to:**
- `docs/superpowers/specs/2026-07-02-analytics-platform-design.md` (§3 SDK, §2 deployment/idempotency)
- `docs/superpowers/specs/2026-07-02-shared-contracts.md` (§4 ingest contract, §8 frozen public API, §9 cross-cutting rules)

The shared-contracts document is the source of truth. Where this design elaborates behavior the contracts leave open, the choice is recorded in §16 (Contract conformance & interpretations).

## 1. Scope & milestones

| Milestone | Contents | Plan |
|---|---|---|
| **M1 — Core tracking** | Facade + config, event model, drift persistent queue, identity, sessions, super properties, timeEvent, people ops, opt-out, context collection, gzip batch uploader with backoff | `docs/superpowers/plans/2026-07-02-sdk-core-phase1.md` |
| **M2 — Autocapture** | `MyAmpixObserver` ($screen_view), `MyAmpixTracker` ($tap, $rage_tap) | later plan |
| **M3 — Attribution** | Android Install Referrer, `app_links` UTM capture, first/last-touch persistence, `$campaign_touch` | later plan |

Package: `myampix_analytics`, Flutter ≥ 3.32, Dart ≥ 3.8, null-safe, pub-publishable. Consumers never run codegen (drift's generated `database.g.dart` is committed; `drift_dev`/`build_runner` are dev-time only).

## 2. Architecture layers

```
┌───────────────────────────────────────────────────────────────┐
│ Public facade  MyAmpix (singleton)  +  People  + M2 widgets  │  contracts §8, guarded — never throws
├───────────────────────────────────────────────────────────────┤
│ Event pipeline  EventPipeline                                  │  assembles contract-§4 events:
│   identity ▸ session id ▸ super props ▸ timed durations ▸ ctx │  insert_id/timestamp stamped here
├───────────────────────────────────────────────────────────────┤
│ Persistent queue  EventStore / ProfileOpStore (drift/SQLite)   │  write-BEFORE-send, capped,
│                 + KeyValueStore (shared_preferences)           │  oldest-first eviction
├───────────────────────────────────────────────────────────────┤
│ Network uploader  Uploader                                     │  gzip batches → /ingest/events,
│   flush @ 20 events or 10 s · backoff+jitter · 202 handling   │  /ingest/profiles
└───────────────────────────────────────────────────────────────┘
Cross-cutting: Clock (injectable), MamLogger (debug-only), MyAmpixConfig
```

### Key interfaces (frozen for M1)

```dart
abstract interface class Clock { DateTime now(); int nowMs(); }

abstract interface class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

abstract interface class EventStore {
  Future<void> add(AnalyticsEvent event, {required int maxQueueSize}); // inserts + evicts oldest beyond cap
  Future<List<StoredEvent>> oldest(int limit);   // FIFO peek, does not delete
  Future<void> delete(List<int> ids);            // called only after server 202
  Future<int> count();
  Future<void> clear();                          // opt-out purge
}

abstract interface class ProfileOpStore {        // same shape for ProfileOperation
  Future<void> add(ProfileOperation op, {required int maxQueueSize});
  Future<List<StoredProfileOp>> oldest(int limit);
  Future<void> delete(List<int> ids);
  Future<int> count();
  Future<void> clear();
}

abstract interface class ContextDataSource {     // platform impl vs. test fake
  Future<AppInfo> appInfo();
  Future<DeviceInfo> deviceInfo();
  String locale(); String timezone(); ScreenSize screenSize();
  Future<String> network();                      // 'wifi' | 'cellular' | 'offline'
}
```

Every component receives its collaborators via constructor injection (`Clock`, `http.Client`, stores, `ContextDataSource`, `String Function() idFactory`, `Random`), so tests substitute fakes everywhere. There is no global mutable state other than the `MyAmpix` singleton facade itself.

## 3. Identity model

Per contract §4 every event carries **both** `distinct_id` and `anon_id`.

- **anon_id** — UUID **v7** generated on first launch, persisted in `KeyValueStore` (`mam_anon_id`), stable for the lifetime of the install. Never changes on `identify`; regenerated only by `reset()`.
- **distinct_id** — starts equal to `anon_id`. `identify(userId)` sets it to `userId` and persists it (`mam_distinct_id`); it survives relaunches.
- **identify(userId)** — if the id actually changed, the SDK emits a reserved `$identify` event (properties: `{"$anon_id": <anon>}`). The backend identity module writes `identity_mappings(anon_id → canonical_id)` from `$identify` events and from any event where `distinct_id != anon_id`.
- **alias(newId)** — emits `$identify` with `{"$alias": newId}` under the current `distinct_id`; server links `newId` to the current canonical id. (The reserved-name list has no `$alias`; `$identify` is the identity-link carrier — see §16.)
- **reset()** — logout: generates a fresh anon UUID v7, sets `distinct_id = anon_id`, clears super properties and pending `timeEvent` timers. The session is **not** rotated and queued events are not dropped (they were attributed correctly when queued).

`IdentityManager` is synchronous after an async `load()` in `init`, so the pipeline can stamp ids without awaiting.

## 4. Session engine

Sessions are computed SDK-side (master design §2); a BullMQ job finalizes sessions server-side for apps killed mid-session.

- `session_id` is a UUID v7. Current session id + start time + last-activity time persist in `KeyValueStore` (`mam_session_id`, `mam_session_start_ms`, `mam_last_activity_ms`).
- **Rotation rule:** a session ends when the app has been in background ≥ `sessionTimeout` (default **30 min**, configurable).
- **Lifecycle observer:** the facade registers a `WidgetsBindingObserver`; `paused|hidden|detached` → record `last_activity`, emit `$app_background`. `resumed` → if `now − last_activity ≥ timeout`, emit `$session_end` with `$duration_ms = last_activity − session_start` (duration measured to the moment the app left the foreground, not to resume time), rotate to a new session id, emit `$session_start`; always emit `$app_open`.
- **Cold start (`init`):** if a persisted session exists and `now − last_activity < timeout`, it is resumed. Otherwise the stale session gets a `$session_end` (duration from persisted timestamps) and a new session begins with `$session_start`. Very first launch additionally emits `$first_open`. Emission order on first launch: `$session_start`, `$first_open`, `$app_open`.
- `$session_end` events emitted at resume/relaunch carry the **old** session id (the manager emits before rotating). Their `timestamp` is emission time; the server clamps and can rely on `$duration_ms` + session_start for exactness.

All reserved names/properties come from contracts §4: `$first_open`, `$app_open`, `$app_background`, `$session_start`, `$session_end` (`$duration_ms`).

## 5. Persistent offline queue

- **Engine: drift** (SQLite). Chosen over isar/sqflite for type-safe queries, transactions, in-memory `NativeDatabase.memory()` for fast tests, and no consumer-side codegen.
- Tables: `pending_events(id INTEGER PK AUTOINCREMENT, payload TEXT)` and `pending_profile_ops(id ...)`. Payload is the JSON-encoded contract object — the queue stores exactly what will be sent, so serialization happens once and relaunch cannot change a queued event.
- **Write-before-send:** `track()` returns only after the row is durably inserted. Only a server `202` deletes rows. A crash/kill between send and ack causes a re-send, which is safe: every event carries a UUID v7 **`insert_id`** stamped at queue time, and ClickHouse dedups by `insert_id` (master design §2). Retries are therefore idempotent end-to-end.
- **Cap & eviction:** `maxQueueSize` (default 10 000 events) enforced inside the insert transaction; overflow deletes the **oldest** rows first (lowest `id`). Same policy for profile ops.
- DB file: `<application-support>/myampix_analytics.sqlite` via `path_provider`; background-isolate `NativeDatabase.createInBackground` keeps the UI thread free.

## 6. Network uploader

- **Batching:** flush is triggered when the queue reaches `flushAt` (default **20** events, ≤ server `INGEST_MAX_BATCH=100`), every `flushInterval` (default **10 s**, periodic timer), and on explicit `flush()`. One in-flight flush at a time (reentrancy guard); a flush drains the queue in successive batches while sends succeed.
- **Request:** `POST {serverUrl}/ingest/events` with headers `Authorization: Bearer <token>`, `Content-Type: application/json`, `Content-Encoding: gzip`; body = gzip of `{"events":[ ...contract §4 objects... ]}`. Profile ops: `POST {serverUrl}/ingest/profiles`, body `{"operations":[...]}`.
- **Response handling:**
  - `202` — parse `{"accepted", "rejected":[{index, reason}]}`. Accepted events were delivered; rejected events are permanently invalid → both are **deleted** from the queue (rejected ones are logged with reason in debug). Backoff resets.
  - `400` / `413` — batch can never succeed → drop it (debug log). No backoff.
  - `401`, `429`, `5xx`, network errors/timeouts — **retain** the batch and back off.
- **Backoff:** exponential with full jitter: `delay = min(2 s × 2^(failures−1), maxRetryDelay=5 min) × U(0.5, 1.5)`; the `Random` is injected for deterministic tests. Timer-driven flushes respect the backoff deadline; `flush()` (public API) forces an immediate attempt.
- Duplicate delivery on retry is harmless thanks to `insert_id` (see §5).

## 7. Super properties & timeEvent

- `registerSuperProperties(map)` merges into a persisted JSON map (`mam_super_properties`); attached to **every** event's `properties`. Merge precedence per event: super properties < explicit `track` properties; a pending `timeEvent` duration is added last as `$duration_ms`.
- `timeEvent(name)` records `clock.nowMs()` in memory; the next `track(name)` pops it and attaches `$duration_ms = now − start`. Timers are in-memory only (a relaunch discards them) and cleared by `reset()`.

## 8. People → `/ingest/profiles`

`MyAmpix.instance.people` maps 1:1 to contract §4 profile operations, queued in `pending_profile_ops` and flushed by the same uploader:

| Dart API | `op` | `properties` payload |
|---|---|---|
| `people.set({...})` | `set` | as given |
| `people.setOnce({...})` | `set_once` | as given |
| `people.increment({'runs': 1})` | `increment` | numeric deltas |
| `people.append({...})` | `append` | as given |
| `people.unset(['a','b'])` | `unset` | `{"a": null, "b": null}` (see §16) |
| `people.deleteUser()` | `delete` | `{}` |

Each operation carries the current `distinct_id` and `timestamp` (ms, injected clock) at enqueue time.

## 9. Opt-out

- `optOutTracking()` sets a persisted flag (`mam_opted_out`), **purges both queues**, and from then on `track`/session events/people ops are dropped at the pipeline entrance (checked via `bool Function() isOptedOut` injected into pipeline and People). `optInTracking()` clears the flag. State survives relaunch and is loaded during `init` before any event can be produced.

## 10. Automatic context block (contract §4 `context`)

Collected by `ContextCollector`; static parts cached after first collection, `network` refreshed per event.

| Field | iOS source | Android source |
|---|---|---|
| `app_version` / `app_build` | `package_info_plus` → `version` / `buildNumber` | same |
| `os` | constant `"ios"` | constant `"android"` |
| `os_version` | `device_info_plus` `IosDeviceInfo.systemVersion` | `AndroidDeviceInfo.version.release` |
| `device_model` | `IosDeviceInfo.utsname.machine` (e.g. `iPhone16,2`) | `AndroidDeviceInfo.model` |
| `device_manufacturer` | constant `"Apple"` | `AndroidDeviceInfo.manufacturer` |
| `locale` | `PlatformDispatcher.instance.locale.toString()` (e.g. `fr_FR`) | same |
| `timezone` | `DateTime.now().timeZoneName` (M1 limitation: abbreviation, not always IANA — see §16) | same (Android returns IANA-like ids more often) |
| `screen_width/height` | first `FlutterView`: `physicalSize / devicePixelRatio`, rounded logical px | same |
| `network` | `connectivity_plus`: wifi/ethernet→`wifi`, mobile→`cellular`, else `offline` | same |
| `sdk_version` | compile-time constant `mamSdkVersion` (`0.1.0`) | same |
| `utm_*`, `first_utm_*`, `install_referrer` | M3 attribution store (absent in M1 — fields are optional per contract) | same |

Null fields are omitted from the serialized `context` object.

## 11. Autocapture design — milestone M2

Both widgets are part of the frozen §8 surface; each capture type is independently toggleable in `MyAmpixConfig`.

### `$screen_view` — `MyAmpixObserver` (NavigatorObserver)
- Attach: `MaterialApp(navigatorObservers: [MyAmpixObserver()])`.
- On `didPush`/`didReplace`/`didPop`, resolve the now-visible route's name (`RouteSettings.name`, fallback `route.runtimeType`), and emit `$screen_view` with `$screen_name`, `$previous_screen`, and `$time_on_previous_ms` (injected-clock delta since the previous screen became visible). Only `PageRoute`s count as screens; dialogs/bottom-sheets are ignored. The current screen name is shared with the tap capturer.

### `$tap` — `MyAmpixTracker` root widget
- Attach: `MyAmpixTracker(child: MyApp())`. Implementation: a translucent `Listener` recording `onPointerDown/onPointerUp`; a pair within tap slop (18 logical px) and ≤ 500 ms is a tap.
- Target resolution: run `RendererBinding.hitTestInView` at the tap position, then walk the widget `Element` tree from the root collecting elements whose `RenderObject` is on the hit-test path (works in release builds, unlike `debugCreator`). Choose the deepest element whose widget is "interesting": has a `Key`, is a known interactive type (`*Button`, `InkWell`, `GestureDetector`, `ListTile`, `Switch`, `Checkbox`, …), or carries `Semantics` with a label. Emit `$tap` with `$widget_type` (runtimeType), `$widget_label` (Key value → semantics label → nearest `Text` data, first non-null), `$screen_name` (from the observer), `$pos_x`, `$pos_y` (logical).
- **Rage tap:** ≥ 3 taps within 1 s inside a 32-px radius → one `$rage_tap` (same target properties + `$tap_count`). Detection is a sliding window in the tracker; rage taps do not suppress the individual `$tap` events.
- All hit-testing runs inside a try/catch outside the gesture arena — it observes pointers, never competes with app gestures, and a failure degrades to "no event".

## 12. Attribution design — milestone M3

- **Android Install Referrer:** on first launch, query the Play Install Referrer API once (Play's `installreferrer` library via the SDK's Android plugin or the `android_play_install_referrer` package — decided in the M3 plan), persist the raw string as `install_referrer`, parse `utm_*` from it.
- **Deep/universal links:** `app_links` stream on every open; parse `utm_source/medium/campaign/content/term` from any incoming URI.
- **iOS:** UTM via universal links (above); Apple Search Ads `AAAttribution.attributionToken()` captured over a MethodChannel where available and forwarded as a property on `$campaign_touch` for server-side resolution (MMP-grade iOS paid attribution stays a non-goal, master §9).
- **Persistence — `AttributionStore` (KeyValueStore):** *first-touch* (`first_utm_source`, `first_utm_campaign`) written once, kept forever; *last-touch* (`utm_*`) overwritten on every campaign touch. Both are merged into the `context` block of **every** subsequent event by `ContextCollector`, and mirrored to the user profile via `people.setOnce` (first) / `people.set` (last).
- Every new capture (referrer or link) emits `$campaign_touch` with the parsed parameters and the touch source (`install_referrer` | `deep_link` | `apple_search_ads`).

## 13. Error-handling philosophy

**The SDK must never crash the host app.**

- Every public facade method is wrapped by a `_guard` that catches synchronous throws *and* attaches `catchError` to fire-and-forget futures. `init` failure disables the SDK (calls become no-ops) instead of throwing.
- Calling any method before/without `init` is a logged no-op (`People` included, via a no-op instance).
- The lifecycle observer, uploader timer callbacks, and M2 hit-testing are individually guarded.
- Internal errors are logged **only** when `config.debug && kDebugMode` (a `MamLogger`); release builds are silent. No error reporting to the host, no rethrow, ever.
- Corrupt queue payloads (failed JSON decode) are deleted, not propagated.

## 14. Testing strategy (85 % line coverage floor, CI-enforced)

- **Fake clock everywhere:** all time logic (timestamps, sessions, timeEvent, backoff deadlines) uses injected `Clock`; tests drive `FakeClock.advance()`. Uploader timer/backoff scheduling tested under `fakeAsync`.
- **Fake HTTP:** `package:http/testing` `MockClient` records requests (assert URL, Bearer header, gzip encoding, exact contract-§4 JSON after gunzip) and scripts responses (202 with partial rejections, 400, 401, 429, 500, thrown `SocketException`).
- **Queue persistence:** drift stores tested on `NativeDatabase.memory()`; round-trip (`AnalyticsEvent` → payload → `fromJson`), FIFO order, cap/oldest-first eviction, delete-only-after-202.
- **Retry/backoff:** injected `Random` fakes make jitter deterministic; assert exponential growth, cap, reset-on-success, no-send-before-deadline, forced `flush()` override.
- **Session tests:** cold start, resume < 30 min, rotation ≥ 30 min, relaunch-after-kill finalization, `$duration_ms` exactness, event ordering.
- **Widget tests:** lifecycle transitions via `tester.binding.handleAppLifecycleStateChanged`; M2 adds `MyAmpixObserver`/`MyAmpixTracker` widget tests (pump real routes, tap real widgets, assert `$screen_view`/`$tap` payloads).
- **Golden scenario (master §6):** offline (client throws) → track N events → simulated kill/relaunch (new facade over the same DB) → network restored → flush → server receives all N with their **original** `insert_id`s.
- **Never-throws suite:** every public method invoked before init, after failed init, and with a throwing collaborator — asserts no exception escapes.

## 15. Configuration reference (`MyAmpixConfig`)

| Option | Default | Notes |
|---|---|---|
| `serverUrl` | *(required)* | e.g. `http://localhost:8080` (contracts §2) |
| `flushAt` | 20 | events per batch trigger; ≤ 100 (server cap) |
| `flushInterval` | 10 s | periodic flush timer |
| `maxQueueSize` | 10 000 | per queue; oldest-first eviction |
| `sessionTimeout` | 30 min | background time before rotation |
| `maxRetryDelay` | 5 min | backoff cap |
| `debug` | false | debug-build-only internal logging |
| M2: `enableScreenAutocapture`, `enableTapAutocapture`, `enableRageTap` | true when widgets attached | per master §3 "each toggleable" |
| M3: `enableAttribution` | true | referrer + link capture |

## 16. Contract conformance & interpretations

- **Event JSON** — field names, types and requiredness exactly per contracts §4 (`insert_id`, `event`, `distinct_id`, `anon_id`, `session_id`, `timestamp` ms int, `properties`, `context`). Null context fields omitted (all context fields are optional).
- **Public API** — exactly contracts §8; no additions to the frozen surface besides an internal, testing-only `overrides` parameter on `init` (documented as such, ignored in production use).
- **IDs** — UUID v7 for `insert_id`, `anon_id` initial value, `session_id` (contracts §9).
- **Interpretations where the contract is silent:**
  - `alias()` is transported as a `$identify` event with `{"$alias": ...}` (no `$alias` reserved name exists).
  - `unset` profile op encodes names as `{name: null}`; `delete` sends `properties: {}`.
  - `timezone` in M1 is `DateTime.now().timeZoneName` (may be an abbreviation like `CEST` rather than `Europe/Paris`; the field is optional). A dedicated timezone plugin can upgrade this in a later milestone without contract change.
  - `$session_end` emitted after backgrounding/kill uses emission-time `timestamp` but exact `$duration_ms`; the server-side finalizer (master §2) remains the fallback for never-relaunched apps.
