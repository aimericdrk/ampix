# myampix_purchases — Flutter purchases SDK

A RevenueCat-style Flutter client for the MyRevenueCat backend (`mobile_purchase`). Fetch offerings,
run a purchase, read entitlements, and identify users — with the familiar RevenueCat-shaped models.

- **Package:** `myampix_purchases` (not published to pub.dev)
- **Requires:** Flutter 3.32+ / Dart 3.8+
- **Backend:** `mobile_purchase` (port `8090`)
- **Repo-wide context:** root [`DOCUMENTATION.md`](../../DOCUMENTATION.md)

---

## Install

```yaml
dependencies:
  myampix_purchases:
    path: ../MyAmpix/sdk/flutter_purchases     # adjust to your app location
    # or git: { url: …, path: sdk/flutter_purchases }
```

```bash
flutter pub get
```

## Configure & use

```dart
import 'package:myampix_purchases/myampix_purchases.dart';

await MyAmpixPurchases.configure(
  const PurchasesConfiguration(
    apiKey: 'mp_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // public SDK key
    serverUrl: 'http://localhost:8090',               // mobile_purchase origin
    // appUserID: 'user_42',                            // optional; anonymous otherwise
    logLevel: MyAmpixLogLevel.warn,
  ),
);

final offerings = await MyAmpixPurchases.getOfferings();
final result    = await MyAmpixPurchases.purchasePackage(
  offerings.current!.availablePackages.first,
);
final info      = await MyAmpixPurchases.getCustomerInfo();   // entitlements
await MyAmpixPurchases.logIn('user_42');
await MyAmpixPurchases.restorePurchases();
MyAmpixPurchases.addCustomerInfoUpdateListener((info) {
  // react to entitlement changes
});
```

The static `MyAmpixPurchases` facade serializes calls internally. Read/purchase methods surface a
typed `PurchasesError`; internal machinery never throws into the host. Models mirror RevenueCat:
`CustomerInfo`, `EntitlementInfo`/`EntitlementInfos`, `Offering`/`Offerings`, `Package`,
`StoreProduct`, `PurchaseResult`/`StoreTransaction`, and the `Store`/`PackageType`/`PeriodType`
enums.

- **Android emulator:** use `http://10.0.2.2:8090`, not `localhost`.

## Example app

`example/` reads config from `--dart-define`, so it runs against a real deployment with no source edits:

```bash
cd sdk/flutter_purchases/example
flutter run \
  --dart-define=MP_API_KEY=mp_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --dart-define=MP_SERVER_URL=http://localhost:8090
```

It runs with placeholder values too — the backend just returns `401`, which the demo catches and
shows on screen.

## Develop / test

```bash
cd sdk/flutter_purchases
flutter pub get
flutter test
```
