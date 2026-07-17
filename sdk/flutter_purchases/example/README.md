# MyAmpix purchases SDK — Flutter example

A minimal demo that drives the `myampix_purchases` SDK end-to-end: it
`configure`s the SDK, lists the current offering's **packages** via
`getOfferings()`, **buys** a package via `purchasePackage`, shows the active
**entitlements** from `getCustomerInfo()`, and **restores** purchases via
`restorePurchases()`.

## Run it

```sh
cd sdk/flutter_purchases/example
command flutter pub get
command flutter run
```

(If the `flutter` shell alias is broken in your setup, prefix commands with
`command`, e.g. `command flutter run`.)

The SDK never throws its internal machinery into the host app. The throwing
read/purchase methods (`getOfferings`, `getCustomerInfo`, `purchasePackage`,
`restorePurchases`) surface a typed `PurchasesError` — the demo catches it and
shows the message on screen, so the app stays usable even with no backend.

## Env you must supply

Configuration is read via `--dart-define` (falling back to placeholders so the
app still runs out of the box):

```sh
command flutter run \
  --dart-define=MP_API_KEY=mp_pub_your_real_key \
  --dart-define=MP_SERVER_URL=https://your-mobile-purchase-host
```

| What | `--dart-define` | Notes |
| --- | --- | --- |
| `mp_pub_` public SDK key | `MP_API_KEY` | PUBLIC key only — never a secret server key. The placeholder (`mp_pub_` + 32 zeros) is rejected (401) by a real backend. |
| `mobile_purchase` base URL | `MP_SERVER_URL` | Defaults to `http://localhost:8088`. On the **Android emulator** use `http://10.0.2.2:8088`. |
| App Store Connect app + IAP products | App Store Connect | Each `storeProductId` must exist as an IAP and be registered as a catalog `Product` mapped to an `Entitlement` on the server. |
| Google Play app + subscription products | Play Console | Same mapping requirement as iOS. |
| Sandbox / license testers | App Store Connect / Play Console | A sandbox Apple ID and a Play license tester are required to run a real purchase. |
| Physical iOS + Android devices, signed builds | — | A real `Product.purchase()` / `launchBillingFlow` cannot run on plain CI. |

## Store wiring

`MyAmpixPurchases.configure()` wires the real native `StoreChannel`
(`MethodChannelStoreChannel`, backed by the iOS StoreKit 2 / Android Play
Billing plugins) automatically in production — this demo's `configureDemo()`
just calls `configure()` normally. On a real device with the store products
set up, `getOfferings`, `purchasePackage`, and `restorePurchases` drive the
native store; any failure surfaces as a typed `PurchasesError` (shown via the
`_ErrorView`/**Retry** flow, never a crash). The widget test below runs
without a device by injecting a fake `StoreChannel` through the
`@visibleForTesting SdkOverrides.storeChannel` seam (the same approach the
SDK's own unit tests use — test code only).

## Manual device / sandbox test steps (cannot be automated here)

A **real** purchase is device + sandbox gated. To verify the full loop by hand:

1. Deploy `mobile_purchase` with a public HTTPS URL and real Apple/Google store
   credentials; point `MP_SERVER_URL` at it and set a real `mp_pub_` key via
   `MP_API_KEY`.
2. Register each `storeProductId` as an IAP/subscription in App Store Connect /
   Play Console, and as a catalog `Product` → `Entitlement` on the server.
3. Build a signed app and install it on a **physical device**; sign the device
   into a **sandbox / license tester** account.
4. Launch the demo — the current offering's packages appear (localized price +
   title come from the store).
5. Tap **Buy** and complete the store sheet with the sandbox account. Expect: the
   receipt is posted to `POST /v1/receipts`, the server grants the entitlement,
   and the entitlement appears under **Entitlements** (via the update listener).
6. Reinstall the app (or sign in on a second device) and tap **Restore** — the
   entitlement should reappear via `restorePurchases()`.
7. Leave a subscription to auto-renew in the sandbox and confirm the renewal
   reaches the server out-of-band (transaction stream → `POST /v1/receipts`)
   without any in-app action.

## Tests

```sh
cd sdk/flutter_purchases/example
command flutter analyze
command flutter test
```

`test/widget_test.dart` pumps the app against injected fakes — a `MockClient`
serving the three `mobile_purchase` endpoints and a local `FakeStoreChannel`
implementing the SDK's public `StoreChannel` seam — so the offerings → buy →
entitlement flow is exercised with **no real store and no real network**.
`test/demo_config_test.dart` checks the demo config shape (a public `mp_pub_`
key, a normalized server URL).
