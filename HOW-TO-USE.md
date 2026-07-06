# MyAmpMix Flutter SDK — How To Use

## 1. What it is

MyAmpMix is a self-hosted, Mixpanel-style product-analytics SDK for Flutter. You call `track()`/`identify()`/`people.*` in your app; the SDK writes every call to a local offline queue first, then batches and gzip-uploads it to your own MyAmpMix backend (`/ingest/events`, `/ingest/profiles`), which lands the data in ClickHouse. Beyond manual `track()`, the SDK also **autocaptures** — screen views, taps/rage-taps, native in-app purchases, marketing attribution, and (optionally) one screenshot per screen per app version — all `$`-prefixed and toggleable (§14 below). A React dashboard ships alongside for browsing/visualizing the data (insights, funnels, retention, user-path map, click heatmaps, cohorts, custom dashboards).

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
      // Autocapture toggles — see §14:
      autocaptureScreens: true,                    // default true — $screen_view via MyAmpMixObserver
      autocaptureTaps: true,                       // default true — $tap / $rage_tap via MyAmpMixTracker
      autocapturePurchases: true,                  // default true — native $in_app_purchase (StoreKit / Play Billing)
      autocaptureAttribution: true,                // default true — deep-link UTM + Android install referrer
      autocaptureScreenshots: false,               // default FALSE — dev/reference tool, debug-only (see §14)
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

## 14. Autocapture

All autocapture is `$`-prefixed and reserved (so it's always distinguishable from your own manual events, which are never `$`-prefixed) and each stream is independently toggleable via `MyAmpMixConfig` (§3, all default `true`).

**Screen views & taps** — wire the two widgets once:

```dart
MaterialApp(
  navigatorObservers: [MyAmpMixObserver()],   // → $screen_view (with $previous_screen, $time_on_previous_ms)
  builder: (context, child) =>
      MyAmpMixTracker(child: child!),          // → $tap / $rage_tap (widget type/label/position, non-blocking)
);
```

**Native in-app purchases** (`autocapturePurchases`) — no wiring needed: the SDK observes StoreKit (iOS) / Play Billing (Android) and emits `$in_app_purchase` (`$product_id`, `$price`, `$currency`, `$store`, `$purchase_source: "native"`) for the app's own store transactions, always distinct from a purchase you track manually.

**Attribution** (`autocaptureAttribution`) — the Android install referrer is captured automatically; for deep links, call `MyAmpMix.instance.trackDeepLink(uri)` from your link handler. UTM params are persisted (first- and last-touch) and attached to every event; a `$campaign_touch` is emitted on each new touch.

**Screenshots** (`autocaptureScreenshots`, default **false**) — a **developer/reference tool, not a per-user feature.** It is off by default and only ever runs in **debug builds** — a release/production build never captures or uploads, so your end users never send screenshots (bounded storage, no PII collected in the wild). These reference images power the dashboard's user-path map and click heatmaps.

**How to populate them:** in a DEBUG build, set `autocaptureScreenshots: true`, then walk through your app once — each screen is captured once per `(screen, app_version)` and uploaded to your backend (Firebase Storage) as the admin's reference image. Capture waits for the navigation animation to settle so it isn't grabbed mid-transition: at least `screenshotSettleDelay` (a `Duration`, default **~1s**) AND until the UI stops animating. Bump `screenshotSettleDelay` if your transitions are longer/heavier and captures still look mid-animation.

**Non-route navigation (bottom-nav tabs, IndexedStack, PageView):** these aren't Navigator pushes, so `MyAmpMixObserver` can't see them — every tab would collapse into one screen. Call `trackScreen` yourself when the visible screen changes:
```dart
NavigationBar(
  selectedIndex: _index,
  onDestinationSelected: (i) {
    setState(() => _index = i);
    MyAmpMix.instance.trackScreen(['catalog', 'cart', 'profile'][i]); // → $screen_view (+ reference screenshot)
  },
);
```
`trackScreen` emits `$screen_view` (with `$previous_screen` when it changed), keeps `$tap`/`$rage_tap` stamped with the right screen, and captures that screen's reference image — the same path a route push takes. It's a no-op on an empty name and never throws.

**Naming screens — use STABLE names per layout.** A screen name identifies a *layout*, not an *instance*: give each real screen/tab its own stable name, and group dynamic detail screens under ONE name (e.g. every product detail page is `product_detail`, not `product_42`) so they share a single reference screenshot. For per-item analytics, put the id in event properties (e.g. `track('product_viewed', properties: {'product_id': id})`), not in the screen name.

**Meaningful names:** screen names come from your routes. Give routes names so they aren't `MaterialPageRoute<void>`:
```dart
Navigator.push(context, MaterialPageRoute(
  settings: const RouteSettings(name: 'product_detail'),   // ← becomes the $screen_name
  builder: (_) => const ProductDetailScreen(),
));
// or a custom mapping without renaming routes:
MyAmpMixObserver(screenNameExtractor: (route) => route.settings.name ?? myNameFor(route))
```

**Retake / fix a bad capture:** delete it in the dashboard (Screens → Retake/Delete), then call `MyAmpMix.instance.retakeScreenshots()` and re-navigate in a debug build to re-capture. Wrap PII/payment fields to keep them out of captures:
```dart
MyAmpMixPrivacy(child: CreditCardForm())   // masked (solid block) in screenshots
```
> MVP masking is opt-in per widget; it does not auto-redact arbitrary text.

To disable any autocapture stream, set its flag to `false` (screens/taps/purchases/attribution default true; screenshots default false).
