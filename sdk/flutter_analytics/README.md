# myampix_analytics — Flutter analytics SDK

The MyAmplitude Flutter SDK: call `track()`/`identify()`/`people.*` and the SDK writes every call to
a local offline queue first, then batches and gzip-uploads to your MyAmpix `mobile_analytics`
backend. It also **autocaptures** screen views, taps, native purchases, attribution, and (debug-only)
reference screenshots.

- **Package:** `myampix_analytics` (not published to pub.dev)
- **Requires:** Flutter 3.32+ / Dart 3.8+
- **Backend:** `mobile_analytics` (port `8088`)
- **Full guide:** [`../../HOW-TO-USE.md`](../../HOW-TO-USE.md) — this README is the short version
- **Repo-wide context:** root [`DOCUMENTATION.md`](../../DOCUMENTATION.md)

---

## Install

Consume via `path:` (inside this monorepo) or `git:` (from another repo):

```yaml
dependencies:
  myampix_analytics:
    path: ../MyAmpix/sdk/flutter_analytics    # adjust to your app location
    # or:
    # git:
    #   url: https://github.com/<your-org>/MyAmpix.git
    #   path: sdk/flutter_analytics
```

```bash
flutter pub get
```

## Initialize & use

```dart
import 'package:myampix_analytics/myampix_analytics.dart';

await MyAmpix.init(
  'mam_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',              // project ingest token
  config: const MyAmpixConfig(serverUrl: 'http://localhost:8088'),
);

MyAmpix.instance.track('checkout_completed', properties: {'plan': 'pro', 'value': 9.99});
MyAmpix.instance.identify('user_42');
MyAmpix.instance.people.set({'plan': 'pro'});
```

- `MyAmpix.init` is idempotent and **never throws** — a failed init disables the SDK; every method becomes a silent no-op instead of crashing the host.
- **Token:** `pnpm dev` at the repo root seeds the demo token `mam_00000000000000000000000000000000`. Mint more via Prisma Studio (`Organization` → `Project` → `SdkToken`; token = `mam_` + 32 hex).
- **Android emulator:** use `http://10.0.2.2:8088`, not `localhost`.

## Device context (declare what the SDK can't see)

```dart
MyAmpix.instance.setTheme(MyAmpixTheme.dark); // context.theme; null = follow platform brightness
MyAmpix.instance.setDeviceToken(fcmToken);    // context.device_token (call again on every refresh)
MyAmpix.instance.setUniqueId(myDeviceId);     // context.unique_id — your own join key
```

Only needed for those three: the rest of the `context` block (OS, model, locale, screen, network,
plus a stable per-install `device_id`) is automatic. The token and unique id are persisted and
device-scoped, so they survive relaunches and `reset()`. Details in
[`../../HOW-TO-USE.md`](../../HOW-TO-USE.md) §8.2.

## Autocapture (wire once)

```dart
MaterialApp(
  navigatorObservers: [MyAmpixObserver()],                 // $screen_view
  builder: (context, child) => MyAmpixTracker(child: child!), // $tap / $rage_tap + screenshot boundary
);
```

Native purchases and attribution are automatic. Screenshots are **off by default** and **debug-build
only** (a reference/dev tool for the user-path map + heatmaps). Give each screen a **stable** name
(`RouteSettings(name: …)`, or `trackScreen(...)` for non-route tabs) so detail pages share one
reference image — put per-item IDs in event properties, not the screen name. Full details, privacy
masking, and retake flow are in [`../../HOW-TO-USE.md`](../../HOW-TO-USE.md).

## Develop / test

```bash
cd sdk/flutter_analytics
flutter pub get
flutter test          # coverage floor 85%
flutter run           # in example/ to try it end-to-end
```
