# MyAmpMix analytics SDK — Flutter example

A small, real multi-screen shopping demo that exercises the
`myampmix_analytics` Flutter SDK through **manual** instrumentation only.
Phase-1 of the SDK has no autocapture widgets, so every event in this app is
triggered by an explicit call to the `MyAmpMix` facade from a genuine user
action (tapping a product, adding to cart, checking out, logging in/out,
opting out, flushing).

## Run it

```sh
cd sdk/flutter_analytics/example
command flutter pub get
command flutter run
```

(The `flutter` shell alias in this environment is broken for some setups —
if `flutter run` doesn't behave, prefix every command with `command`, e.g.
`command flutter run`.)

No backend is required to explore the UI: the SDK never throws into the
host app, so even if the ingest server is unreachable or the token is
rejected, the demo keeps working and the on-screen **Event Log** tab shows
exactly what was tracked, in order, as you use the app.

## Talking to a real backend

Edit `lib/demo_config.dart`:

- `demoServerUrl` defaults to `http://localhost:8080`. If you're running on
  the **Android emulator**, change it to `http://10.0.2.2:8080` (the
  emulator's alias for the host machine's loopback interface) — `localhost`
  inside the emulator refers to the emulator itself, not your host.
- `demoToken` is a placeholder (`mam_` + 32 hex zeros) and will be rejected
  (401) by a real backend. Replace it with the token printed by `pnpm dev`'s
  demo seed script (run from the repo root) to see events actually accepted
  by your local MyAmpMix backend. Until then the app still runs fine and the
  Event Log still shows everything that was tracked locally — it just won't
  reach a server.

## What's instrumented

| Screen | SDK calls |
| --- | --- |
| Catalog | `track('catalog_viewed')` on load; `track('product_clicked', ...)` on tap |
| Product detail | `track('product_viewed')` on load; `track('add_to_cart')` + `people.increment({'cart_items': 1})` on "Add to cart" |
| Cart / Checkout | `timeEvent('checkout_completed')` on entering the tab; `track('checkout_completed', ...)` + `people.set({'last_purchase_value': ...})` on "Complete purchase" |
| Profile | `identify(userId)` + `people.set({'email', 'name'})` on "Log in"; `reset()` on "Log out" |
| Settings | `optOutTracking()` / `optInTracking()` on the toggle; `flush()` on "Flush now" |
| Event Log | Read-only view of every SDK call made above, appended live |

`main()` also calls `registerSuperProperties` once at startup to demonstrate
that call as well.

## Tests

```sh
cd sdk/flutter_analytics/example
command flutter analyze
command flutter test
```

`test/widget_test.dart` pumps the app, taps through Catalog → product detail
→ "Add to cart", and asserts both the SDK call fired (via the in-app event
log) and that the Event Log tab reflects it on screen.
