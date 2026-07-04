# MyAmpMix Flutter SDK — How To Use

## 1. What it is

MyAmpMix is a self-hosted, Mixpanel-style product-analytics SDK for Flutter. You call `track()`/`identify()`/`people.*` in your app; the SDK writes every call to a local offline queue first, then batches and gzip-uploads it to your own MyAmpMix backend (`/ingest/events`, `/ingest/profiles`), which lands the data in ClickHouse. **Phase 1 scope:** instrumentation is fully manual — there is no autocapture of taps or screen views yet (the `MyAmpMixObserver`/`MyAmpMixTracker` widgets ship in a later milestone, M2), and there is no analytics dashboard UI yet to browse the data — querying comes in a later phase, so for now you confirm events arrived by querying ClickHouse directly (§12).

## 2. Install

The package isn't published to pub.dev yet. Point at it via `path:` (working inside this monorepo) or `git:` (consuming the repo from elsewhere):

```yaml
# pubspec.yaml
dependencies:
  myampmix_analytics:
    path: ../MyAmpMix/sdk/flutter_analytics # adjust to your app's location relative to this repo

  # or, from another repo:
  myampmix_analytics:
    git:
      url: https://github.com/<your-org>/MyAmpMix.git
      path: sdk/flutter_analytics
```

```bash
flutter pub get   # if `flutter` is aliased oddly in your shell, use: command flutter pub get
```

## 3. Initialize

```dart
import 'package:flutter/widgets.dart';
import 'package:myampmix_analytics/myampmix_analytics.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await MyAmpMix.init(
    'mam_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // your project's ingest token
    config: const MyAmpMixConfig(
      serverUrl: 'http://localhost:8080', // required — see Android note below
      // Everything else is optional; defaults shown:
      flushAt: 20,                                 // batch size that triggers an immediate flush (1..100)
      flushInterval: Duration(seconds: 10),        // periodic flush timer
      maxQueueSize: 10000,                         // oldest events/ops evicted beyond this
      sessionTimeout: Duration(minutes: 30),       // background time before a session rotates
      maxRetryDelay: Duration(minutes: 5),         // cap on exponential retry backoff
      debug: false,                                // enable internal SDK logging (debug builds only)
    ),
  );

  runApp(const MyApp());
}
```

`MyAmpMix.init` is idempotent (a second call is a logged no-op keeping the first instance) and never throws — if it fails, the SDK stays disabled and every subsequent call becomes a silent no-op instead of crashing your app.

**Where the token comes from:** the fastest path is the one-command dev stack, which seeds a ready-to-use demo token automatically:

```bash
pnpm dev   # from the repo root: starts DBs + backend (:8080) + dashboard (:5173),
           # applies migrations, and seeds a demo project + ingest token.
```

The seed creates the fixed demo token `mam_00000000000000000000000000000000` (already used by the Flutter example in `sdk/flutter_analytics/example`, so that app works with no edits). Phase 1 has no token-management UI yet (later phase); to mint additional/real tokens, use Prisma Studio against the backend's Postgres store — `pnpm --filter ./backend exec prisma studio`, then create one row each in `Organization` → `Project` (`orgId` = the org's id) → `SdkToken` (`projectId` = the project's id, `token` = `mam_` + 32 lowercase hex, e.g. `mam_$(openssl rand -hex 16)`, any `label`). The `token` you pass to `MyAmpMix.init` authenticates every ingest request as `Authorization: Bearer <token>` (shared-contracts §4) — an invalid or absent token gets `401`.

**Android emulator note:** the emulator's `localhost` refers to the emulator itself, not your host machine. Use `http://10.0.2.2:8080` as `serverUrl` instead. iOS simulator and desktop can use `http://localhost:8080` directly.

## 4. Tracking events

```dart
MyAmpMix.instance.track('checkout_completed', properties: {
  'plan': 'pro',
  'value': 9.99,
  'promo_applied': true,
});

MyAmpMix.instance.track('search_performed', properties: {
  'query': 'blue running shoes',
  'results_count': 12,
  'filters_applied': ['color', 'size'], // lists of scalars are fine
});
```

Flat-properties rule (shared-contracts §4): a property value may be a `String`, `num`, `bool`, `null`, or a `List` of those. A nested `Map` (or a `List` containing a `Map`/`List`) is silently dropped before it's queued — logged if `debug: true`, never thrown.

## 5. Identity

```dart
MyAmpMix.instance.identify('user_42');
MyAmpMix.instance.alias('user_42_new_account_id');
MyAmpMix.instance.reset(); // call this on logout
```

The SDK is anonymous by default: on first launch it generates `anon_id`, a stable UUID v7 persisted for the life of the install. `distinct_id` starts out equal to `anon_id` and switches to whatever you pass `identify()` — that also fires a `$identify` event carrying `{"$anon_id": ...}` so the backend can link the pre-login history to the real user (only if the id actually changed). `alias()` doesn't change the local identity; it sends a `$identify` event with `{"$alias": "<newId>"}` — there's no separate alias transport. `reset()` generates a fresh `anon_id`, clears `distinct_id` back to it, and clears super properties and any pending `timeEvent()` timers — call it on logout so the next user isn't attributed to the previous one.

## 6. User profiles

```dart
MyAmpMix.instance.people.set({'plan': 'pro', 'email': 'a@example.com'});
MyAmpMix.instance.people.setOnce({'first_seen_at': '2026-07-01'});
MyAmpMix.instance.people.increment({'login_count': 1});
MyAmpMix.instance.people.append({'devices': 'iPhone16,2'});
MyAmpMix.instance.people.unset(['trial_expires_at']);
MyAmpMix.instance.people.deleteUser();
```

These map 1:1 to `POST /ingest/profiles` operations (`set`/`set_once`/`increment`/`append`/`unset`/`delete`). The flat-properties rule from §4 applies to profile properties too. All calls are fire-and-forget and attributed to the current `distinct_id` at the time they run.

## 7. Timed events

```dart
MyAmpMix.instance.timeEvent('level_completed');
// ... gameplay happens ...
MyAmpMix.instance.track('level_completed'); // auto-attaches $duration_ms (elapsed ms)
```

## 8. Super properties

```dart
MyAmpMix.instance.registerSuperProperties({
  'app_flavor': 'production',
  'ab_test_group': 'B',
});
```

Merged into every `track()` call from then on. Per-call `properties` win over super properties on key collision; `reset()` clears super properties.

## 9. Sessions

Fully automatic — nothing to call. The SDK maintains a `session_id` and emits the reserved lifecycle events (`$first_open`, `$app_open`, `$app_background`, `$session_start`, `$session_end` with `$duration_ms`) on its own. A session rotates once the app has spent more than `sessionTimeout` (default 30 minutes) in the background.

## 10. Privacy

```dart
MyAmpMix.instance.optOutTracking(); // persisted across restarts; purges the local queue immediately
MyAmpMix.instance.optInTracking();
MyAmpMix.instance.flush();          // force an immediate upload attempt of whatever's queued
```

While opted out, `track()`/`people.*`/`timeEvent()` are no-ops.

## 11. Reliability

Every call writes to a local (drift/SQLite) queue before any network I/O happens (write-before-send), so events survive app kills and offline periods. A background uploader drains the queue in gzip-compressed batches (size = `flushAt`, default 20) to `/ingest/events` and `/ingest/profiles`, triggered either by queue size or by the `flushInterval` timer (default 10s). Failures back off exponentially with jitter (base 2s, capped at `maxRetryDelay`, default 5 minutes), tracked independently per queue (events vs. profiles). A batch rejected with 4xx (other than 429) is dropped for good — it can never succeed as-is; 429/5xx are retried. The SDK never throws into the host app: `init` failures disable it silently, and every public method is wrapped in a guard that catches and logs (only if `debug: true`) instead of propagating.

## 12. Verifying it works

There's no dashboard UI to browse events yet, so confirm delivery straight from ClickHouse (credentials/ports per shared-contracts §2 / `infra/docker-compose.yml`):

```bash
docker compose -f infra/docker-compose.yml exec clickhouse \
  clickhouse-client --user default --password myampmix_dev --database analytics \
  --query "SELECT event, count() FROM events GROUP BY event"
```

(`curl http://localhost:8123/ping` → `Ok.` confirms ClickHouse itself is reachable first.) Profile writes land in `analytics.user_profiles`, identity links in `analytics.identity_mappings`.

## 13. Troubleshooting

- **401 from ingest** — wrong, missing, or revoked token, or it doesn't match `mam_` + 32 hex chars.
- **Events never show up in ClickHouse** — check the token is real (the demo token from `pnpm dev`, or one created via Prisma Studio per §3), that the stack is up (`pnpm dev`), and that `serverUrl` is reachable from the device/emulator (`10.0.2.2` on the Android emulator, not `localhost`).
- Set `config.debug: true` to see internal SDK logs (dropped properties, rejected batches, retry scheduling) via `debugPrint`.
- By design, nothing the SDK does — including a failed `init` — crashes the host app.
