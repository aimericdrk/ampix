# sdk/flutter_purchases — RevenueCat-style Flutter Purchases SDK — Design

**Date:** 2026-07-17
**Status:** Draft design, pending review
**Package:** `myampix_purchases` (a Flutter plugin under `sdk/flutter_purchases`, sibling of `myampix_analytics`)
**Program context:** Roadmap item **P3 (Flutter purchasing SDK)** of `2026-07-16-revenuecat-parity-program-roadmap.md`. It is the client for the now-complete `mobile_purchase` server (webhook subsystem M1–M5): the app-facing half of the RevenueCat clone.
**Anchor:** RevenueCat's real `purchases_flutter` package — same developer-facing Dart API and models. RevenueCat's own Flutter SDK is a thin channel shim over its native `purchases-ios` (Swift) / `purchases-android` (Kotlin) SDKs, which drive StoreKit / Google Play Billing and post receipts to the RevenueCat backend. We replicate that shape, with `mobile_purchase` as the backend and our own hand-written native layer.

---

## 0. Scope, non-goals, gates

**In scope (this sub-project):**
- A Flutter plugin exposing RevenueCat's core public API: `configure`, `getOfferings`, `getCustomerInfo`, `purchasePackage`/`purchaseStoreProduct`, `restorePurchases`, `logIn`/`logOut`, `addCustomerInfoUpdateListener`/`removeCustomerInfoUpdateListener`, `canMakePayments`, `appUserID`/`isAnonymous`/`isConfigured`, `setLogLevel`.
- The RevenueCat model classes (`Offerings`/`Offering`/`Package`/`StoreProduct`, `CustomerInfo`/`EntitlementInfos`/`EntitlementInfo`, `PurchaseResult`, `LogInResult`, enums `PackageType`/`PeriodType`/`Store`/`OwnershipType`, typed `PurchasesError`).
- Networking to the three `mobile_purchase` public endpoints (`GET /v1/offerings`, `GET /v1/subscribers/:appUserId`, `POST /v1/receipts`), keyed by the `mp_pub_` public SDK key.
- App-user identity: anonymous `$RCAnonymousID:<hex>` generation + persistence, `logIn`/`logOut`.
- Native iOS StoreKit 2 + Android Google Play Billing layers that fetch products, run purchases (with `appAccountToken`/`obfuscatedAccountId` self-attribution), stream transaction updates, and finish/acknowledge after server grant.
- An `example/` runnable app.

**Explicit non-goals (deferred — named so they are not mistaken for gaps):**
- Subscriber attributes + integration setters (`setEmail`, `setAdjustID`, …) — later P-item; the endpoints don't exist server-side yet.
- Promotional / introductory / win-back / discounted-offer purchase variants, Google base-plan/offer selection (`purchaseSubscriptionOption`) — v2; v1 does the plain package purchase.
- Placements/targeting (`getCurrentOfferingForPlacement`), virtual currencies, web checkout, `presentCodeRedemptionSheet`, promoted products.
- Trusted entitlements / entitlement verification (`VerificationResult`), `isSandbox`, `productPlanIdentifier` on `EntitlementInfo` — the server doesn't emit these yet; the Dart fields are present but default/omitted, flagged for a server enhancement.
- **Server-side identity aliasing/merge.** RevenueCat's `logIn` merges an anonymous customer into the identified one on the backend; our identity graph is the server's roadmap **P5**, not built. Our `logIn` switches the active app-user-id and refetches `CustomerInfo`; `LogInResult.created` is derived from whether the fetched customer was new. **Documented divergence.**

**Hard gates (procurement / device — cannot be verified here):**
- A **real purchase** (StoreKit 2 `Product.purchase()` / Play `launchBillingFlow`) needs physical iOS/Android devices, App Store Connect + Play sandbox testers, and signed builds. Same class of gate as the server's Apple/Google store credentials.
- **Compilation** of the native Swift/Kotlin needs Xcode + the Android SDK/Gradle. If the local toolchain lacks them, the native code ships written-but-not-compiled-here and is flagged; the Dart layer is always fully analyzable + testable.

---

## 1. Architecture — three layers (RevenueCat's shape)

```
┌─────────────────────────────────────────────────────────────┐
│ Dart facade + orchestration  (lib/, the RevenueCat surface)  │
│  · static Purchases facade + PurchasesConfiguration          │
│  · models (Offerings/CustomerInfo/…), never-crash guard      │
│  · networking → mobile_purchase (/v1/offerings|subscribers|  │
│    receipts), Bearer mp_pub_ key                             │
│  · identity ($RCAnonymousID:, logIn/logOut), CustomerInfo    │
│    cache, update-listener dispatch, purchase orchestration   │
└───────────────▲──────────────────────────┬──────────────────┘
     EventChannel│ (native → Dart:          │ MethodChannel
     txn updates)│  transactions, restored) │ (Dart → native:
                 │                          ▼  getProducts, purchase,
┌────────────────┴──────────────┐  ┌────────┴────────────────────┐
│ iOS native (Swift, StoreKit 2)│  │ Android native (Kotlin,     │
│  Product.products / .purchase │  │ Play Billing: queryProduct- │
│  Transaction.updates → JWS    │  │ Details / launchBillingFlow │
│  finish() after server grant  │  │ → purchaseToken; acknowledge│
└───────────────────────────────┘  └─────────────────────────────┘
```

**The native/networking split (decision, approved):** the native layer does **store operations only** — fetch store products (localized price/title/subscription period), execute the purchase, surface the platform receipt (iOS StoreKit 2 `jwsRepresentation`, Android `purchaseToken`), stream out-of-band transactions, and finish/acknowledge after the server grants. **All networking to `mobile_purchase`, the `CustomerInfo` model + cache, identity, and orchestration live in Dart.** RevenueCat duplicates networking in Swift *and* Kotlin because its native SDKs are standalone products; ours only serves Flutter, so one Dart HTTP/model/cache layer avoids maintaining the client + `CustomerInfo` twice in two languages, for zero developer-facing difference. It remains a fully hand-written StoreKit 2 + Billing layer.

Channels are namespaced `myampix_purchases/<topic>` (mirroring analytics' `myampix_analytics/<topic>`): a `MethodChannel('myampix_purchases/methods')` for Dart→native request/response, and an `EventChannel('myampix_purchases/transactions')` for native→Dart pushes. Both have a `@visibleForTesting` injection seam so the Dart orchestration is tested against a fake channel with no real platform.

---

## 2. Public API surface (the facade)

Static facade `MyAmpixPurchases` (RevenueCat calls it `Purchases`; we keep the `MyAmpix`-prefixed convention of `myampix_analytics` and expose it as the barrel's public symbol). Signatures mirror RevenueCat:

```dart
// configuration & identity
static Future<void> configure(PurchasesConfiguration configuration);
static Future<bool>   get isConfigured;
static Future<String> get appUserID;          // anonymous or custom
static Future<bool>   get isAnonymous;

// offerings & products
static Future<Offerings>          getOfferings();
static Future<List<StoreProduct>> getProducts(List<String> productIds);

// customer info
static Future<CustomerInfo> getCustomerInfo();
static Future<void>         invalidateCustomerInfoCache();
static void addCustomerInfoUpdateListener(CustomerInfoUpdateListener listener);    // typedef void Function(CustomerInfo)
static void removeCustomerInfoUpdateListener(CustomerInfoUpdateListener listener);

// purchasing
static Future<PurchaseResult> purchasePackage(Package packageToPurchase);
static Future<PurchaseResult> purchaseStoreProduct(StoreProduct product);
static Future<CustomerInfo>   restorePurchases();

// account lifecycle
static Future<LogInResult>  logIn(String appUserID);      // {customerInfo, created}
static Future<CustomerInfo> logOut();                     // → fresh anonymous id

// misc
static Future<bool> canMakePayments();
static void setLogLevel(MyAmpixLogLevel level);
```

**Never-crash guarantee (from `myampix_analytics`):** internal machinery never throws into the host. Read/purchase methods that RevenueCat surfaces errors on (`getOfferings`, `getCustomerInfo`, `purchasePackage`, `restorePurchases`, `logIn`) throw a typed `PurchasesError` (see §6) — matching RevenueCat, where these are the throwing methods. Listener callbacks and out-of-band handling never throw. Pre-`configure` calls are logged no-ops (throwing `PurchasesError(configurationError)` for the throwing methods, matching RC's "SDK not configured").

---

## 3. Models (RevenueCat field names, populated from the `mobile_purchase` contract)

Hand-rolled immutable classes (`const` ctor, `factory X.fromJson`, `toJson`), no codegen — per repo convention. All date fields are **ISO-8601 `String`** (RevenueCat's Dart parity detail, and exactly what the server emits).

### Offerings (from `GET /v1/offerings` → `{ current: ResolvedOffering | null }`)
The server returns only the single current offering; RevenueCat's `Offerings` has `all` + `current`. We populate `current` from the response and `all = { current.identifier: current }` (one entry) — flagged: multi-offering support is a server enhancement (the catalog stores many; only `isCurrent` is exposed).

| class | field | type | source |
|---|---|---|---|
| `Offerings` | `all` | `Map<String, Offering>` | `{ current.identifier: current }` |
| | `current` | `Offering?` | response `current` |
| `Offering` | `identifier` | `String` | `current.identifier` |
| | `metadata` | `Map<String, Object?>` | `current.metadata` (passthrough JSON) |
| | `availablePackages` | `List<Package>` | `current.packages` (sorted server-side) |
| | `lifetime/annual/…/weekly` | `Package?` | convenience accessors, filtered by `packageType` |
| `Package` | `identifier` | `String` | package `identifier` |
| | `packageType` | `PackageType` | package `packageType` enum |
| | `storeProduct` | `StoreProduct` | built from package `product` + native enrichment (§4) |
| | `offeringIdentifier` | `String` | parent offering id |
| `StoreProduct` | `identifier` | `String` | `product.storeProductId` |
| | `productType` | `ProductType` | `product.type` |
| | `priceString`/`price`/`currencyCode` | `String`/`double`/`String` | native store metadata if available, else server `priceCents`/`currency` |
| | `subscriptionPeriod` | `String?` | server `durationIso8601` |
| | `title`/`description` | `String` | native store metadata (empty if native unavailable) |
| | `entitlementIdentifiers` | `List<String>` | server `product.entitlements` (our addition; RC infers server-side) |

`PackageType` enum (values verbatim from RevenueCat, matching the server's Prisma enum): `unknown, custom, lifetime, annual, sixMonth, threeMonth, twoMonth, monthly, weekly`. `ProductType`: `autoRenewableSubscription, nonRenewingSubscription, consumable, nonConsumable`.

### CustomerInfo (from `GET /v1/subscribers/:appUserId` and `POST /v1/receipts` → `{ customerInfo }`)

| class | field | type | source / note |
|---|---|---|---|
| `CustomerInfo` | `entitlements` | `EntitlementInfos` | response `entitlements` |
| | `activeSubscriptions` | `List<String>` | derived: `subscriptions[].storeProductId where isActive` |
| | `firstSeen` | `String` | response `firstSeen` |
| | `latestExpirationDate` | `String?` | derived: max `expirationDate` across active entitlements |
| | `originalAppUserId` | `String` | the app-user-id used for the request |
| | `managementURL` | `String?` | response `managementURL` (omitted → null) |
| | `requestDate` | `String` | client-stamped fetch time |
| `EntitlementInfos` | `all` | `Map<String, EntitlementInfo>` | response `entitlements.all` |
| | `active` | `Map<String, EntitlementInfo>` | response `entitlements.active` |
| `EntitlementInfo` | `identifier` | `String` | the map key |
| | `isActive`/`willRenew` | `bool` | response |
| | `periodType` | `PeriodType` | response (`normal/trial/intro/promo` → enum `normal/intro/trial`; `promo`→`normal` w/ note) |
| | `latestPurchaseDate`/`originalPurchaseDate`/`expirationDate` | `String`/`String`/`String?` | response |
| | `store` | `Store` | response (`app_store`→`appStore`, `play_store`→`playStore`) |
| | `productIdentifier` | `String` | response |
| | `unsubscribeDetectedAt`/`billingIssueDetectedAt` | `String?` | response |
| | `ownershipType` | `OwnershipType` | response (`PURCHASED`→`purchased`, `FAMILY_SHARED`→`familyShared`) |
| | `isSandbox` | `bool` | **deferred**: default `false` (server doesn't emit — flagged) |

`Store` enum superset (RC parity): `appStore, macAppStore, playStore, stripe, promotional, amazon, rcBilling, external, unknownStore` (we only ever emit `appStore`/`playStore`). `PeriodType`: `normal, intro, trial`. `OwnershipType`: `purchased, familyShared, unknown`.

`PurchaseResult { customerInfo, storeTransaction }`; `LogInResult { customerInfo, created }`.

---

## 4. Data flows

**`configure(config)`** — persist `apiKey`/`serverUrl`; resolve the app-user-id: if `config.appUserID != null` use it, else load a persisted `$RCAnonymousID:` id or mint one (`$RCAnonymousID:` + uuid-v4 hex, stored via `shared_preferences`). Attach the native transaction stream (guarded so widget tests don't touch a channel). Do NOT block on network.

**`getOfferings()`** — `GET /v1/offerings` → parse `current` → collect the packages' `storeProductId`s → ask native `getProducts(ids)` for localized price/title/subscriptionPeriod → merge into each `StoreProduct` (server `priceCents`/`currency`/`durationIso8601` are the fallback when native is unavailable) → build `Offerings`. Cached in memory after first fetch (RevenueCat pre-fetches; we fetch lazily + cache).

**`purchasePackage(pkg)` / `purchaseStoreProduct(product)`:**
1. Dart → `MethodChannel.invokeMethod('purchase', { storeProductId, appAccountToken: uuidFor(appUserId), … })`.
2. Native runs the store purchase (iOS `Product.purchase(options:[.appAccountToken(uuid)])`; Android `launchBillingFlow` with `setObfuscatedAccountId`), returns `{ platform, fetchToken /* JWS | purchaseToken */, storeProductId }` or a typed error (user-cancelled / pending / store-error).
3. Dart `POST /v1/receipts { app_user_id, platform, fetch_token, product_id }` → server validates + returns `{ customerInfo }`. 402/409 → `PurchasesError(invalidReceipt/…)`; 503 → `PurchasesError(storeProblem, retryable)`.
4. On 200: cache the `CustomerInfo`, fire the update listener, tell native to **finish** (iOS `transaction.finish()`) / **acknowledge** (Android) the transaction, return `PurchaseResult`.
   - If the server call fails after a successful store purchase, the transaction is left unfinished so it re-delivers via the transaction stream on next launch and is retried (no lost purchase).

**`getCustomerInfo()`** — return the in-memory cache if fresh, else `GET /v1/subscribers/:appUserId` → cache → return. `invalidateCustomerInfoCache()` forces the next call to refetch.

**Out-of-band transactions** — native pushes renewals/restores/interrupted purchases on the `EventChannel` (iOS `Transaction.updates`, Android `PurchasesUpdatedListener` + `queryPurchasesAsync` on connect). For each: Dart `POST /v1/receipts` → refresh `CustomerInfo` → fire listener → finish/acknowledge. This is how a renewal detected on-device (or a purchase completed out of band) reaches the server even without a store→server webhook.

**`restorePurchases()`** — native re-queries current entitlements/transactions (iOS `Transaction.currentEntitlements`, Android `queryPurchasesAsync`) → each posted to `/v1/receipts` (binding them to the current app-user-id) → refetch `CustomerInfo` → return it.

**`logIn(id)` / `logOut()`** — switch the persisted app-user-id (logOut mints a fresh `$RCAnonymousID:`), `GET /v1/subscribers/:newId`, cache, fire listener. `logIn` returns `{ customerInfo, created }` (`created` = the fetched customer had no prior activity — a client-side approximation until server aliasing/P5 exists).

---

## 5. Native layer contract (MethodChannel / EventChannel)

**Dart → native (`MethodChannel('myampix_purchases/methods')`):**
- `getProducts({ productIds: List<String> })` → `List<{ storeProductId, priceString, price (micros→double), currencyCode, title, description, subscriptionPeriodIso8601? }>` (products not found are omitted).
- `purchase({ storeProductId, appAccountToken (uuid) })` → `{ platform: "APP_STORE"|"PLAY_STORE", fetchToken, storeProductId }` OR a `PlatformException(code)` with code ∈ `userCancelled|paymentPending|productNotAvailable|storeProblem`.
- `finishTransaction({ transactionId })` — iOS `Transaction.finish()` / Android `acknowledge`/`consume`. Called by Dart after the server grants.
- `restore()` → emits the current entitlements/transactions onto the EventChannel (no direct return).
- `canMakePayments()` → `bool`.

**Native → Dart (`EventChannel('myampix_purchases/transactions')`):** a broadcast stream of `{ platform, fetchToken, storeProductId, transactionId, reason: "purchase"|"renewal"|"restore" }`. Dart validates each map defensively and drops malformed ones (never throws).

**iOS (Swift, StoreKit 2, `ios/Classes/MyampixPurchasesPlugin.swift` + podspec, deployment target iOS 15 for StoreKit 2):** `Product.products(for:)`, `Product.purchase(options:)` with `.appAccountToken(UUID)`, a long-lived `Transaction.updates` task feeding the EventChannel, `transaction.finish()` on command, `Transaction.currentEntitlements` for restore.

**Android (Kotlin, Play Billing v7+, `android/src/main/kotlin/com/myampix/purchases/MyampixPurchasesPlugin.kt` + gradle):** `BillingClient` with `PurchasesUpdatedListener`, `queryProductDetailsAsync`, `launchBillingFlow` with `setObfuscatedAccountId`, `acknowledgePurchase`/`consumeAsync`, `queryPurchasesAsync` on connect + for restore.

Native holds no server URL or key and does no HTTP; it only surfaces receipts.

---

## 6. Error handling

Typed `PurchasesError` (mirrors RevenueCat's `PurchasesErrorCode`), thrown only by the throwing public methods:

`purchaseCancelledError` (user cancelled — carries `userCancelled: true`), `paymentPendingError`, `productNotAvailableForPurchaseError`, `invalidReceiptError` (server 402), `productAlreadyPurchasedError` (server 409), `networkError`, `storeProblemError` (server 503 / store failure), `configurationError` (called before `configure`), `unknownError`. Each carries `code`, `message`, and `underlyingErrorMessage?`.

Mapping: store `PlatformException.code` → the matching code; server RFC-7807 status → 402→`invalidReceipt`, 409→`productAlreadyPurchased`, 503→`storeProblem`, 400→`configurationError`/`unknownError`, 401→`configurationError` (bad key), network failure→`networkError`. Everything else logs and, for non-throwing paths, no-ops.

---

## 7. Configuration

```dart
class PurchasesConfiguration {
  final String apiKey;              // the mp_pub_ public SDK key (required)
  final String serverUrl;          // mobile_purchase base URL (required; trailing slash normalized)
  final String? appUserID;         // null → anonymous $RCAnonymousID:
  final MyAmpixLogLevel logLevel;  // default warn
}
```
Constructor `assert`s non-empty `apiKey`/`serverUrl` (repo convention). No positional token here (RevenueCat uses a config object for `configure`; the analytics SDK's positional-token `init` is its own convention — we follow RevenueCat's config-object shape for the purchases facade, which is the closer parity).

---

## 8. Testing strategy + verification reality

- **Dart layer — fully unit-tested** (`flutter test`), the bulk of the logic: model `fromJson`/`toJson` round-trips against the exact server JSON; the HTTP client with `package:http/testing` `MockClient` (offerings/subscribers/receipts requests + 200/400/401/402/409/503 responses → correct models/`PurchasesError`); identity (anon mint/persist, logIn/logOut) with an in-memory KV fake; the facade orchestration (purchase → receipt POST → cache → listener → finish) driven against a **fake MethodChannel/EventChannel** via the `@visibleForTesting` injection seam; the never-crash guard; out-of-band stream handling.
- **Native Swift/Kotlin** — written faithfully to StoreKit 2 / Play Billing; **a real purchase is device+sandbox-gated** and cannot be exercised here. Verification of the native code is limited to: `dart analyze`/`flutter analyze`, and native compilation **iff** the local Xcode + Android SDK toolchain is present (checked at build time; flagged if absent). The Dart↔native contract is validated on the Dart side against the fake channel.
- Test conventions: `flutter_test`, `MockClient`, `fake_async`, hand-rolled fakes in `test/helpers/`, no mocktail/mockito; test tree mirrors `lib/src/`.

---

## 9. File structure (mirrors `myampix_analytics`)

```
sdk/flutter_purchases/
  pubspec.yaml               # name: myampix_purchases; http, uuid, shared_preferences; plugin block (ios/android)
  analysis_options.yaml      # flutter_lints + unawaited_futures, prefer_final_locals
  lib/
    myampix_purchases.dart   # barrel: export ... show (facade + models + enums + PurchasesError)
    src/
      myampix_purchases.dart # the facade (never-crash guard, _tail serialization, overrides seam)
      configuration.dart
      models/{offerings,offering,package,store_product,customer_info,entitlement_info,purchase_result,login_result,enums,purchases_error}.dart
      network/purchases_api_client.dart      # GET offerings/subscribers, POST receipts
      identity/app_user_id_store.dart        # $RCAnonymousID: mint/persist, logIn/logOut
      store/{store_channel.dart, store_product_metadata.dart, transaction_stream.dart}  # Dart side of the native channels
      customer_info_cache.dart
      util/{logger.dart, uuid.dart}
      version.dart
  ios/Classes/MyampixPurchasesPlugin.swift + ios/myampix_purchases.podspec
  android/src/main/kotlin/com/myampix/purchases/MyampixPurchasesPlugin.kt + build.gradle + AndroidManifest.xml
  test/                      # mirrors lib/src/, helpers/ with fakes (FakeStoreChannel, InMemoryKeyValueStore, MockClient closures)
  example/                   # runnable Flutter app, depends via path: ../
```

---

## 10. Decomposition — buildable increments (Dart-first; native last, device-gated)

Each is a spec-sized unit with its own acceptance; all Dart increments are fully unit-testable with no device.

**P3.1 · Package scaffold + models + enums** — the plugin skeleton (pubspec, analysis_options, barrel), all model classes + enums + `PurchasesError`, with `fromJson`/`toJson` unit-tested against the exact `mobile_purchase` JSON (offerings, CustomerInfo, EntitlementInfo). *Acceptance:* `flutter analyze` clean; model round-trip tests green; no native yet.

**P3.2 · API client + identity** — `PurchasesApiClient` (GET offerings/subscribers, POST receipts, Bearer key, RFC-7807→`PurchasesError` mapping) with `MockClient`; `AppUserIdStore` (anon `$RCAnonymousID:` mint/persist, logIn/logOut) with an in-memory KV fake. *Acceptance:* every endpoint + status code mapped and tested; identity transitions tested; no native.

**P3.3 · Facade + orchestration (no native)** — `MyAmpixPurchases` facade: `configure`, `getCustomerInfo` (+cache), `logIn`/`logOut`, listeners, never-crash guard, `_tail` serialization, the `@visibleForTesting` overrides seam. Store channel behind a **fake** (no real platform). *Acceptance:* configure→getCustomerInfo→cache→listener flows tested; pre-configure no-op/throw tested; the whole read/identity path works against fakes.

**P3.4 · Dart store-channel contract + purchase orchestration (fake native)** — the Dart side of the MethodChannel/EventChannel (`StoreChannel`, `TransactionStream`), `getOfferings` (server + native product enrichment via the fake), `purchasePackage`/`purchaseStoreProduct` (native purchase → POST receipt → cache → listener → finish), `restorePurchases`, out-of-band stream handling. *Acceptance:* full purchase + restore + out-of-band flows tested against a `FakeStoreChannel` (asserting the receipt POST, the finish call, the listener fire, error mapping); still no real native.

**P3.5 · iOS native (Swift, StoreKit 2)** — `MyampixPurchasesPlugin.swift` + podspec: `getProducts`, `purchase` (with `appAccountToken`), `Transaction.updates`→EventChannel, `finishTransaction`, restore. *Acceptance:* compiles under Xcode **if available locally** (else flagged); code reviewed against StoreKit 2 semantics; real purchase device-gated.

**P3.6 · Android native (Kotlin, Play Billing)** — `MyampixPurchasesPlugin.kt` + gradle: `getProducts`, `purchase` (with `obfuscatedAccountId`), `PurchasesUpdatedListener`→EventChannel, acknowledge/consume, restore. *Acceptance:* compiles under the Android SDK **if available locally** (else flagged); reviewed against Billing semantics; real purchase device-gated.

**P3.7 · Example app + wiring** — a minimal `example/` app: configure, show offerings, buy a package, show entitlements, restore. *Acceptance:* `flutter analyze` clean; documents the manual device test steps.

**Suggested order:** P3.1 → P3.2 → P3.3 → P3.4 (the entire testable SDK), then P3.5/P3.6 (native, device-gated), then P3.7.

---

## 11. Hard external gates (procurement — the user's, same as the server's)
- App Store Connect app + IAP products + a sandbox tester; Google Play app + subscription products + a license tester; both `storeProductId`s registered as catalog `Product`s on the server and mapped to `Entitlement`s.
- Physical iOS + Android devices (or the iOS simulator's limited StoreKit testing) and signed builds to run a real purchase end-to-end.
- The server deployed with public HTTPS (X1) + real Apple/Google store credentials for the full loop (webhook + receipt validation) to actually flip an entitlement.
Everything else — the whole Dart SDK, the native code, the contract — is built and (for Dart) unit-tested without these.
