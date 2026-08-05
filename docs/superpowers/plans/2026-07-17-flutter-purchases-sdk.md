# sdk/flutter_purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sdk/flutter_purchases` — a RevenueCat-style Flutter SDK (`myampix_purchases`) that is the app-facing client for the completed `mobile_purchase` server.

**Architecture:** Three layers mirroring RevenueCat: a Dart facade + orchestration (the RevenueCat public API + models, networking to `mobile_purchase`, identity, `CustomerInfo` cache, purchase orchestration), and hand-written native iOS (Swift, StoreKit 2) + Android (Kotlin, Play Billing) plugins that own store operations only (fetch products, run the purchase, surface the receipt, stream transactions). The native/networking split keeps the HTTP client + `CustomerInfo` model + cache in Dart (single source of truth), unlike RevenueCat's fully-duplicated native SDKs.

**Tech Stack:** Dart/Flutter plugin; `package:http`; `shared_preferences`; `uuid`; StoreKit 2 (Swift); Google Play Billing (Kotlin); `MethodChannel` + `EventChannel`. Tests: `flutter_test`, `package:http/testing` `MockClient`, `fake_async`, hand-rolled fakes.

**Design spec:** `docs/superpowers/specs/2026-07-17-flutter-purchases-sdk-design.md` — the binding source for the API surface (§2), model→server-contract mapping (§3), data flows (§4), native channel contract (§5), errors (§6), config (§7).

## Global Constraints

- **Package:** `myampix_purchases`; facade class `MyAmpixPurchases`; single public barrel `lib/myampix_purchases.dart` (explicit `export ... show`); everything else under `lib/src/`.
- **SDK floors:** Dart `>=3.8.0 <4.0.0`, Flutter `>=3.32.0`. Deps: `http: ^1.3.0`, `uuid: ^4.5.0`, `shared_preferences: ^2.5.0`. Dev: `flutter_test` (sdk), `flutter_lints: ^6.0.0`, `fake_async: ^1.3.1`. **No `json_serializable`/`freezed`/`mocktail`/`mockito`/`dio`.**
- **Models:** hand-rolled immutable classes (`const` ctor, `factory X.fromJson`, `Map<String,Object?> toJson()`); JSON is snake_case, Dart camelCase; **all date fields are ISO-8601 `String`** (RevenueCat + server parity).
- **HTTP:** injected `http.Client` (defaults to `http.Client()`, overridden in tests via `MockClient`). Base URL trailing slash normalized once. Header `Authorization: Bearer <mp_pub_ key>`.
- **Endpoints (mobile_purchase public API):** `GET /v1/offerings` → `{current: ResolvedOffering|null}`; `GET /v1/subscribers/:appUserId` → `{customerInfo}`; `POST /v1/receipts {app_user_id, platform, fetch_token, product_id?}` → `{customerInfo}`.
- **Error mapping (server RFC-7807 status → `PurchasesError`):** 401→`configurationError`, 402→`invalidReceiptError`, 409→`productAlreadyPurchasedError`, 503→`storeProblemError`, network failure→`networkError`, else→`unknownError`. Native purchase errors→`purchaseCancelledError`(userCancelled)/`paymentPendingError`/`productNotAvailableForPurchaseError`/`storeProblemError`.
- **Facade discipline (from `myampix_analytics`):** never-crash `_guard` (internal machinery never throws into the host); public calls serialized on a single `_tail` Future chain; test-only injection via one `@visibleForTesting SdkOverrides` (httpClient, keyValueStore, storeChannel, clock, uuidFactory); `shutdownForTesting`/`resetForTesting`. Throwing methods (`getOfferings`/`getCustomerInfo`/`purchasePackage`/`restorePurchases`/`logIn`) surface `PurchasesError`; everything else logs + no-ops.
- **Native split:** native code does store ops ONLY (no HTTP, no server URL/key). Channels `myampix_purchases/methods` (MethodChannel) + `myampix_purchases/transactions` (EventChannel). iOS min deployment **15.0** (StoreKit 2), swift 5. Android `minSdk 24`, `compileSdk 36`, JVM 17, `namespace com.myampix.purchases`.
- **Hygiene:** files <500 lines; `flutter_lints` + `unawaited_futures` + `prefer_final_locals`; fire-and-forget futures explicitly `unawaited(...)`; test tree mirrors `lib/src/`.
- **Identity:** anonymous id format `$RCAnonymousID:<uuid-v4-hex>`, persisted via `shared_preferences` key `mp_app_user_id`. `logIn` switches the id + refetches (NO server-side alias merge — that is the server's P5; documented divergence). `appAccountToken` passed to the store MUST be a UUID.
- **Verification reality:** the Dart layer (P3.1–P3.4, P3.7) is fully unit-testable with no device. Native (P3.5/P3.6) is written faithfully; real purchase is device+sandbox-gated; native compilation is toolchain-gated (check `xcodebuild`/Gradle presence, flag if absent).

## File Structure

```
sdk/flutter_purchases/
  pubspec.yaml · analysis_options.yaml · .gitignore
  lib/
    myampix_purchases.dart                      # barrel (export ... show)
    src/
      myampix_purchases.dart                    # MyAmpixPurchases facade (guard, _tail, SdkOverrides)
      configuration.dart                        # PurchasesConfiguration, MyAmpixLogLevel
      models/{enums,offerings,offering,package,store_product,customer_info,
              entitlement_info,purchase_result,login_result,purchases_error}.dart
      network/purchases_api_client.dart         # GET offerings/subscribers, POST receipts
      identity/app_user_id_store.dart           # $RCAnonymousID: mint/persist, logIn/logOut, KeyValueStore
      store/{store_channel.dart,fake_store_channel.dart,transaction_event.dart}
      customer_info_cache.dart
      util/{logger.dart,uuid.dart}
      version.dart
  ios/Classes/MyampixPurchasesPlugin.swift · ios/myampix_purchases.podspec
  android/src/main/kotlin/com/myampix/purchases/MyampixPurchasesPlugin.kt · android/build.gradle · android/src/main/AndroidManifest.xml
  test/                                          # mirrors lib/src/; helpers/ fakes
  example/                                       # runnable app (path: ../)
```

## Task index

- **P3.1** (Task 3.1.1–3.1.6) — scaffold + models/enums/`PurchasesError`. Pure Dart, fully tested.
- **P3.2** (Task 3.2.1–3.2.3) — `PurchasesApiClient` + `AppUserIdStore`/`KeyValueStore`. Pure Dart.
- **P3.3** (Task 3.3.x) — `MyAmpixPurchases` facade: configure/getCustomerInfo/cache/logIn/logOut/listeners/guard/`SdkOverrides`; abstract `StoreChannel`. Pure Dart (fake channel).
- **P3.4** (Task 3.4.x) — real `StoreChannel` (MethodChannel/EventChannel) + `getOfferings`/`purchasePackage`/`restorePurchases`/out-of-band handling. Pure Dart (fake channel in tests) — defines the native contract.
- **P3.5** (Task 3.5.x) — iOS Swift StoreKit 2 plugin. Native; device/toolchain-gated.
- **P3.6** (Task 3.6.x) — Android Kotlin Play Billing plugin. Native; device/toolchain-gated.
- **P3.7** (Task 3.7.x) — example app + wiring. Dart.

**Build order:** P3.1 → P3.2 → P3.3 → P3.4 (the entire testable SDK) → P3.5 / P3.6 (native) → P3.7.

---

## P3.1 · Package scaffold + models + enums

Sub-project **P3.1** of the `sdk/flutter_purchases` SDK (spec §10). Builds the plugin skeleton and every model / enum / error class, with `fromJson`/`toJson` unit-tested against the **exact** `mobile_purchase` wire JSON. Pure Dart — no native, no networking. All work happens under `sdk/flutter_purchases/`; run every command from that directory.

**Conventions mirrored from `sdk/flutter_analytics` (binding):** hand-rolled immutable `const` classes with `factory X.fromJson` + `Map<String, Object?> toJson()`, no `json_serializable`/`freezed`; `flutter_lints` + `unawaited_futures` + `prefer_final_locals`; tests import the concrete `src/` file directly (e.g. `package:myampix_purchases/src/models/enums.dart`) exactly like `flutter_analytics/test/model/event_test.dart` imports `package:myampix_analytics/src/model/event.dart`. Date fields are ISO-8601 `String` (spec §3). The barrel exports only files that already exist and is **extended** by each model task so every step compiles and `flutter analyze` stays clean.

**Wire facts pinned from the server (do not drift):**
- `GET /v1/offerings` → `{ "current": ResolvedOffering | null }`; each package is `{ identifier, packageType, product: { storeProductId, type, priceCents, currency, durationIso8601, entitlements } }`. `packageType` is the Prisma enum (`UNKNOWN|CUSTOM|LIFETIME|ANNUAL|SIX_MONTH|THREE_MONTH|TWO_MONTH|MONTHLY|WEEKLY`); `product.type` is `AUTO_RENEWABLE_SUBSCRIPTION|NON_RENEWING_SUBSCRIPTION|CONSUMABLE|NON_CONSUMABLE`.
- `GET /v1/subscribers/:appUserId` and `POST /v1/receipts` → `{ "customerInfo": { entitlements: { active: {...}, all: {...} }, subscriptions: [...], firstSeen, lastSeen, managementURL? } }`. Entitlement value shape: `{ isActive, willRenew, periodType, latestPurchaseDate, originalPurchaseDate, expirationDate|null, store, productIdentifier, unsubscribeDetectedAt|null, billingIssueDetectedAt|null, ownershipType }` — the identifier is the **map key**, not a field. `periodType` ∈ `normal|trial|intro|promo`; `store` ∈ `app_store|play_store`; `ownershipType` ∈ `PURCHASED|FAMILY_SHARED`. Dates are `toISOString()` strings.

---

### Task 3.1.1: Package scaffold (pubspec, analysis_options, barrel, version)

**Files:**
- Create `sdk/flutter_purchases/pubspec.yaml`
- Create `sdk/flutter_purchases/analysis_options.yaml`
- Create `sdk/flutter_purchases/lib/src/version.dart`
- Create `sdk/flutter_purchases/lib/myampix_purchases.dart` (barrel)
- Create `sdk/flutter_purchases/.gitignore`
- Test `sdk/flutter_purchases/test/version_test.dart`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: package `myampix_purchases`; barrel `package:myampix_purchases/myampix_purchases.dart`; `const String myampixPurchasesSdkVersion` (= `'0.1.0'`). The `flutter: plugin:` block declares ios/android `pluginClass: MyampixPurchasesPlugin` (android package `com.myampix.purchases`) per §9 — the native dirs are authored later in P3.5/P3.6; unit tests (`flutter test`) never build native, so their absence is fine now.

- [ ] **Step 1: write failing test** — create `test/version_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/myampix_purchases.dart';

void main() {
  test('sdk version constant matches pubspec', () {
    expect(myampixPurchasesSdkVersion, '0.1.0');
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/version_test.dart`. Expected failure: `flutter pub get` / resolution error — no `pubspec.yaml`, and the import `package:myampix_purchases/myampix_purchases.dart` cannot be resolved (`Error: Couldn't resolve the package 'myampix_purchases'`).

- [ ] **Step 3: minimal implementation** —
  Create `pubspec.yaml`:
```yaml
name: myampix_purchases
description: MyAmpix Flutter purchases SDK — a RevenueCat-style client for the mobile_purchase backend.
version: 0.1.0
publish_to: none

environment:
  sdk: ">=3.8.0 <4.0.0"
  flutter: ">=3.32.0"

dependencies:
  flutter:
    sdk: flutter
  http: ^1.3.0
  shared_preferences: ^2.5.0
  uuid: ^4.5.0

dev_dependencies:
  fake_async: ^1.3.1
  flutter_lints: ^6.0.0
  flutter_test:
    sdk: flutter

# This package is a Flutter plugin: it ships native platform code (iOS
# StoreKit 2 / Android Play Billing) that fetches store products, runs the
# purchase, and streams transaction updates to the Dart side over the
# `myampix_purchases/methods` (MethodChannel) and
# `myampix_purchases/transactions` (EventChannel) channels (spec §5). The
# Swift/Kotlin sources are authored in P3.5/P3.6; the Dart layer is fully
# analyzable + unit-testable without them.
flutter:
  plugin:
    platforms:
      android:
        package: com.myampix.purchases
        pluginClass: MyampixPurchasesPlugin
      ios:
        pluginClass: MyampixPurchasesPlugin
```
  Create `analysis_options.yaml`:
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
  Create `lib/src/version.dart`:
```dart
/// SDK version reported by the purchases client and the barrel's public
/// [myampixPurchasesSdkVersion]. Keep in sync with pubspec.yaml.
const String myampixPurchasesSdkVersion = '0.1.0';
```
  Create the barrel `lib/myampix_purchases.dart` (exports only what exists now; each model task appends its export):
```dart
/// MyAmpix Flutter purchases SDK — RevenueCat-style public surface.
///
/// Model + enum exports are added by the P3.1 model tasks; the facade,
/// configuration, and log-level exports are added by P3.3.
library;

export 'src/version.dart';
```
  Create `.gitignore`:
```gitignore
.dart_tool/
.flutter-plugins-dependencies
.packages
build/
pubspec.lock
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter pub get && flutter test test/version_test.dart` → 1 test passes. Then `flutter analyze` → `No issues found!`.

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/pubspec.yaml sdk/flutter_purchases/analysis_options.yaml sdk/flutter_purchases/lib sdk/flutter_purchases/test/version_test.dart sdk/flutter_purchases/.gitignore && git commit -m "feat(purchases-sdk): scaffold myampix_purchases plugin package (P3.1)"`

---

### Task 3.1.2: Model enums (PackageType / ProductType / PeriodType / Store / OwnershipType)

**Files:**
- Create `sdk/flutter_purchases/lib/src/models/enums.dart`
- Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (add export)
- Test `sdk/flutter_purchases/test/models/enums_test.dart`

**Interfaces:**
- Consumes: Task 3.1.1 (package).
- Produces (all consumed by the model tasks below + P3.2/P3.4):
  - `enum PackageType { unknown, custom, lifetime, annual, sixMonth, threeMonth, twoMonth, monthly, weekly }` with `String get wire` and `static PackageType fromWire(String? v)` (unrecognized → `unknown`).
  - `enum ProductType { autoRenewableSubscription, nonRenewingSubscription, consumable, nonConsumable }` with `String get wire` and `static ProductType fromWire(String? v)` (unrecognized → `nonConsumable`, defensive).
  - `enum PeriodType { normal, intro, trial }` with `String get wire` and `static PeriodType fromWire(String? v)` (`promo` → `normal`, unrecognized → `normal`).
  - `enum Store { appStore, macAppStore, playStore, stripe, promotional, amazon, rcBilling, external, unknownStore }` with `String get wire` and `static Store fromWire(String? v)` (unrecognized → `unknownStore`).
  - `enum OwnershipType { purchased, familyShared, unknown }` with `String get wire` and `static OwnershipType fromWire(String? v)` (unrecognized → `unknown`).

- [ ] **Step 1: write failing test** — create `test/models/enums_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/enums.dart';

void main() {
  group('PackageType', () {
    test('maps every server wire value', () {
      expect(PackageType.fromWire('UNKNOWN'), PackageType.unknown);
      expect(PackageType.fromWire('CUSTOM'), PackageType.custom);
      expect(PackageType.fromWire('LIFETIME'), PackageType.lifetime);
      expect(PackageType.fromWire('ANNUAL'), PackageType.annual);
      expect(PackageType.fromWire('SIX_MONTH'), PackageType.sixMonth);
      expect(PackageType.fromWire('THREE_MONTH'), PackageType.threeMonth);
      expect(PackageType.fromWire('TWO_MONTH'), PackageType.twoMonth);
      expect(PackageType.fromWire('MONTHLY'), PackageType.monthly);
      expect(PackageType.fromWire('WEEKLY'), PackageType.weekly);
    });
    test('unrecognized and null fall back to unknown', () {
      expect(PackageType.fromWire('WHATEVER'), PackageType.unknown);
      expect(PackageType.fromWire(null), PackageType.unknown);
    });
    test('wire round-trips', () {
      for (final t in PackageType.values) {
        expect(PackageType.fromWire(t.wire), t);
      }
    });
  });

  group('ProductType', () {
    test('maps every server wire value', () {
      expect(ProductType.fromWire('AUTO_RENEWABLE_SUBSCRIPTION'),
          ProductType.autoRenewableSubscription);
      expect(ProductType.fromWire('NON_RENEWING_SUBSCRIPTION'),
          ProductType.nonRenewingSubscription);
      expect(ProductType.fromWire('CONSUMABLE'), ProductType.consumable);
      expect(ProductType.fromWire('NON_CONSUMABLE'), ProductType.nonConsumable);
    });
    test('unrecognized falls back to nonConsumable (defensive)', () {
      expect(ProductType.fromWire('???'), ProductType.nonConsumable);
      expect(ProductType.fromWire(null), ProductType.nonConsumable);
    });
    test('wire round-trips', () {
      for (final t in ProductType.values) {
        expect(ProductType.fromWire(t.wire), t);
      }
    });
  });

  group('PeriodType', () {
    test('maps server values with promo collapsing to normal', () {
      expect(PeriodType.fromWire('normal'), PeriodType.normal);
      expect(PeriodType.fromWire('intro'), PeriodType.intro);
      expect(PeriodType.fromWire('trial'), PeriodType.trial);
      expect(PeriodType.fromWire('promo'), PeriodType.normal);
    });
    test('unrecognized and null fall back to normal', () {
      expect(PeriodType.fromWire('x'), PeriodType.normal);
      expect(PeriodType.fromWire(null), PeriodType.normal);
    });
    test('wire values', () {
      expect(PeriodType.normal.wire, 'normal');
      expect(PeriodType.intro.wire, 'intro');
      expect(PeriodType.trial.wire, 'trial');
    });
  });

  group('Store', () {
    test('maps the two emitted server values', () {
      expect(Store.fromWire('app_store'), Store.appStore);
      expect(Store.fromWire('play_store'), Store.playStore);
    });
    test('unrecognized and null fall back to unknownStore', () {
      expect(Store.fromWire('web'), Store.unknownStore);
      expect(Store.fromWire(null), Store.unknownStore);
    });
    test('wire round-trips across the RC superset', () {
      for (final s in Store.values) {
        expect(Store.fromWire(s.wire), s);
      }
    });
  });

  group('OwnershipType', () {
    test('maps server values', () {
      expect(OwnershipType.fromWire('PURCHASED'), OwnershipType.purchased);
      expect(OwnershipType.fromWire('FAMILY_SHARED'), OwnershipType.familyShared);
    });
    test('unrecognized and null fall back to unknown', () {
      expect(OwnershipType.fromWire('OTHER'), OwnershipType.unknown);
      expect(OwnershipType.fromWire(null), OwnershipType.unknown);
    });
    test('wire round-trips', () {
      for (final o in OwnershipType.values) {
        expect(OwnershipType.fromWire(o.wire), o);
      }
    });
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/models/enums_test.dart`. Expected failure: compile error `Couldn't resolve the package import 'package:myampix_purchases/src/models/enums.dart'` (file does not exist).

- [ ] **Step 3: minimal implementation** — create `lib/src/models/enums.dart`:
```dart
/// RevenueCat-parity enums, populated from the `mobile_purchase` wire contract
/// (spec §3). Each carries the exact server `wire` string plus a defensive
/// `fromWire` that never throws (the SDK's never-crash guarantee).

/// RevenueCat's `PackageType`; wire values are the server's Prisma enum.
enum PackageType {
  unknown('UNKNOWN'),
  custom('CUSTOM'),
  lifetime('LIFETIME'),
  annual('ANNUAL'),
  sixMonth('SIX_MONTH'),
  threeMonth('THREE_MONTH'),
  twoMonth('TWO_MONTH'),
  monthly('MONTHLY'),
  weekly('WEEKLY');

  const PackageType(this.wire);

  /// The server (Prisma enum) string this value serializes to.
  final String wire;

  static PackageType fromWire(String? v) => PackageType.values.firstWhere(
        (t) => t.wire == v,
        orElse: () => PackageType.unknown,
      );
}

/// RevenueCat's `ProductType`; wire values are the server's Prisma enum.
enum ProductType {
  autoRenewableSubscription('AUTO_RENEWABLE_SUBSCRIPTION'),
  nonRenewingSubscription('NON_RENEWING_SUBSCRIPTION'),
  consumable('CONSUMABLE'),
  nonConsumable('NON_CONSUMABLE');

  const ProductType(this.wire);

  final String wire;

  /// The server always emits one of the four; an unrecognized value defaults
  /// to [nonConsumable] rather than throwing (there is no RC "unknown" type).
  static ProductType fromWire(String? v) => ProductType.values.firstWhere(
        (t) => t.wire == v,
        orElse: () => ProductType.nonConsumable,
      );
}

/// RevenueCat's `PeriodType`. The server's `promo` collapses to [normal]
/// (spec §3): RC has no distinct promo period.
enum PeriodType {
  normal('normal'),
  intro('intro'),
  trial('trial');

  const PeriodType(this.wire);

  final String wire;

  static PeriodType fromWire(String? v) {
    switch (v) {
      case 'trial':
        return PeriodType.trial;
      case 'intro':
        return PeriodType.intro;
      case 'normal':
      case 'promo': // RC has no promo period — collapses to normal (spec §3).
      default:
        return PeriodType.normal;
    }
  }
}

/// RevenueCat's `Store` superset. We only ever emit [appStore]/[playStore];
/// the rest exist for RC parity so a future backend can populate them.
enum Store {
  appStore('app_store'),
  macAppStore('mac_app_store'),
  playStore('play_store'),
  stripe('stripe'),
  promotional('promotional'),
  amazon('amazon'),
  rcBilling('rc_billing'),
  external('external'),
  unknownStore('unknown_store');

  const Store(this.wire);

  final String wire;

  static Store fromWire(String? v) => Store.values.firstWhere(
        (s) => s.wire == v,
        orElse: () => Store.unknownStore,
      );
}

/// RevenueCat's `OwnershipType`; wire values are Apple's `inAppOwnershipType`.
enum OwnershipType {
  purchased('PURCHASED'),
  familyShared('FAMILY_SHARED'),
  unknown('UNKNOWN');

  const OwnershipType(this.wire);

  final String wire;

  static OwnershipType fromWire(String? v) => OwnershipType.values.firstWhere(
        (o) => o.wire == v,
        orElse: () => OwnershipType.unknown,
      );
}
```
  Then append to the barrel `lib/myampix_purchases.dart` (before `export 'src/version.dart';`):
```dart
export 'src/models/enums.dart'
    show OwnershipType, PackageType, PeriodType, ProductType, Store;
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter test test/models/enums_test.dart` → all groups pass. `flutter analyze` → `No issues found!`.

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/lib/src/models/enums.dart sdk/flutter_purchases/lib/myampix_purchases.dart sdk/flutter_purchases/test/models/enums_test.dart && git commit -m "feat(purchases-sdk): RevenueCat-parity model enums with wire mapping (P3.1)"`

---

### Task 3.1.3: Offerings / Offering / Package / StoreProduct

**Files:**
- Create `sdk/flutter_purchases/lib/src/models/store_product.dart`
- Create `sdk/flutter_purchases/lib/src/models/package.dart`
- Create `sdk/flutter_purchases/lib/src/models/offering.dart`
- Create `sdk/flutter_purchases/lib/src/models/offerings.dart`
- Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (add exports)
- Test `sdk/flutter_purchases/test/models/offerings_test.dart`

**Interfaces:**
- Consumes: Task 3.1.2 — `PackageType.fromWire`, `ProductType.fromWire`, `PackageType` values.
- Produces (consumed by P3.4 `getOfferings` + native enrichment, and P3.3/P3.4 facade signatures):
  - `class StoreProduct` — `const StoreProduct({required String identifier, required ProductType productType, required String priceString, required double price, required String currencyCode, String? subscriptionPeriod, String title = '', String description = '', List<String> entitlementIdentifiers = const []})`; `factory StoreProduct.fromJson(Map<String, dynamic> json)` (parses the server `product` object; `price = priceCents/100`, `priceString`/`title`/`description` are server-fallback until native enrichment); `StoreProduct copyWith({String? priceString, double? price, String? currencyCode, String? title, String? description, String? subscriptionPeriod})`; `Map<String, Object?> toJson()`.
  - `class Package` — `const Package({required String identifier, required PackageType packageType, required StoreProduct storeProduct, required String offeringIdentifier})`; `factory Package.fromJson(Map<String, dynamic> json, {required String offeringIdentifier})`; `Map<String, Object?> toJson()`.
  - `class Offering` — `const Offering({required String identifier, required Map<String, Object?> metadata, required List<Package> availablePackages})`; `factory Offering.fromJson(Map<String, dynamic> json)`; convenience getters `Package? get lifetime/annual/sixMonth/threeMonth/twoMonth/monthly/weekly`; `Map<String, Object?> toJson()`.
  - `class Offerings` — `const Offerings({required Map<String, Offering> all, required Offering? current})`; `factory Offerings.fromJson(Map<String, dynamic> json)` (takes the `GET /v1/offerings` envelope `{ current }`; `all = { current.identifier: current }` or `{}`); `Map<String, Object?> toJson()`.

  Note on serialization asymmetry (intentional): these classes project the **server** shape (`storeProductId`/`priceCents`/`packageType` Prisma enum) into the **RevenueCat** shape (`identifier`/`price`/camelCase). `toJson` emits the RevenueCat model shape, so the tests assert `fromJson` against exact server JSON and `toJson` against the model shape separately (they are not symmetric — native enrichment adds fields the server never sends).

- [ ] **Step 1: write failing test** — create `test/models/offerings_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/enums.dart';
import 'package:myampix_purchases/src/models/offerings.dart';
import 'package:myampix_purchases/src/models/store_product.dart';

/// The exact `GET /v1/offerings` wire body (spec §3): `{ current: ResolvedOffering }`.
Map<String, dynamic> offeringsWire() => {
      'current': {
        'identifier': 'default',
        'metadata': {'badge': 'Most popular', 'sort': 1},
        'packages': [
          {
            'identifier': r'$rc_monthly',
            'packageType': 'MONTHLY',
            'product': {
              'storeProductId': 'com.myampix.pro.monthly',
              'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
              'priceCents': 999,
              'currency': 'USD',
              'durationIso8601': 'P1M',
              'entitlements': ['premium'],
            },
          },
          {
            'identifier': r'$rc_annual',
            'packageType': 'ANNUAL',
            'product': {
              'storeProductId': 'com.myampix.pro.annual',
              'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
              'priceCents': 7999,
              'currency': 'USD',
              'durationIso8601': 'P1Y',
              'entitlements': ['premium'],
            },
          },
        ],
      },
    };

void main() {
  group('StoreProduct.fromJson', () {
    test('parses the server product object with a price/100 fallback', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      expect(p.identifier, 'com.myampix.pro.monthly');
      expect(p.productType, ProductType.autoRenewableSubscription);
      expect(p.price, 9.99);
      expect(p.currencyCode, 'USD');
      expect(p.priceString, '9.99');
      expect(p.subscriptionPeriod, 'P1M');
      expect(p.title, '');
      expect(p.description, '');
      expect(p.entitlementIdentifiers, ['premium']);
    });

    test('tolerates null server price fields', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'coins.100',
        'type': 'CONSUMABLE',
        'priceCents': null,
        'currency': null,
        'durationIso8601': null,
        'entitlements': <String>[],
      });
      expect(p.price, 0.0);
      expect(p.currencyCode, '');
      expect(p.subscriptionPeriod, isNull);
      expect(p.productType, ProductType.consumable);
    });

    test('copyWith merges native metadata over the server fallback', () {
      final base = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      final enriched = base.copyWith(
        priceString: r'$9.99',
        price: 9.99,
        currencyCode: 'USD',
        title: 'Pro Monthly',
        description: 'Full access, billed monthly',
      );
      expect(enriched.priceString, r'$9.99');
      expect(enriched.title, 'Pro Monthly');
      expect(enriched.description, 'Full access, billed monthly');
      expect(enriched.identifier, 'com.myampix.pro.monthly');
      expect(enriched.entitlementIdentifiers, ['premium']);
    });

    test('toJson emits the RevenueCat model shape', () {
      final p = StoreProduct.fromJson({
        'storeProductId': 'com.myampix.pro.monthly',
        'type': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceCents': 999,
        'currency': 'USD',
        'durationIso8601': 'P1M',
        'entitlements': ['premium'],
      });
      expect(p.toJson(), {
        'identifier': 'com.myampix.pro.monthly',
        'productType': 'AUTO_RENEWABLE_SUBSCRIPTION',
        'priceString': '9.99',
        'price': 9.99,
        'currencyCode': 'USD',
        'subscriptionPeriod': 'P1M',
        'title': '',
        'description': '',
        'entitlementIdentifiers': ['premium'],
      });
    });
  });

  group('Offerings.fromJson', () {
    test('parses the current offering, packages, and derived all-map', () {
      final offerings = Offerings.fromJson(offeringsWire());
      expect(offerings.current, isNotNull);
      expect(offerings.all.keys, ['default']);
      expect(identical(offerings.all['default'], offerings.current), isTrue);

      final current = offerings.current!;
      expect(current.identifier, 'default');
      expect(current.metadata, {'badge': 'Most popular', 'sort': 1});
      expect(current.availablePackages, hasLength(2));

      final monthly = current.availablePackages.first;
      expect(monthly.identifier, r'$rc_monthly');
      expect(monthly.packageType, PackageType.monthly);
      expect(monthly.offeringIdentifier, 'default');
      expect(monthly.storeProduct.identifier, 'com.myampix.pro.monthly');
      expect(monthly.storeProduct.price, 9.99);
    });

    test('exposes typed convenience accessors filtered by packageType', () {
      final current = Offerings.fromJson(offeringsWire()).current!;
      expect(current.monthly, isNotNull);
      expect(current.monthly!.packageType, PackageType.monthly);
      expect(current.annual, isNotNull);
      expect(current.annual!.storeProduct.identifier, 'com.myampix.pro.annual');
      expect(current.weekly, isNull);
      expect(current.lifetime, isNull);
    });

    test('null current yields empty all-map and null current', () {
      final offerings = Offerings.fromJson({'current': null});
      expect(offerings.current, isNull);
      expect(offerings.all, isEmpty);
    });

    test('toJson emits the model shape (all + current)', () {
      final offerings = Offerings.fromJson(offeringsWire());
      final json = offerings.toJson();
      expect((json['all'] as Map).keys, ['default']);
      final current = json['current'] as Map<String, Object?>;
      expect(current['identifier'], 'default');
      expect(current['metadata'], {'badge': 'Most popular', 'sort': 1});
      final packages = current['packages'] as List;
      expect(packages, hasLength(2));
      expect((packages.first as Map)['packageType'], 'MONTHLY');
      final product = (packages.first as Map)['product'] as Map;
      expect(product['identifier'], 'com.myampix.pro.monthly');
      expect(product['price'], 9.99);
    });
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/models/offerings_test.dart`. Expected failure: compile error — `Couldn't resolve the package import 'package:myampix_purchases/src/models/offerings.dart'` (and `store_product.dart`).

- [ ] **Step 3: minimal implementation** —
  Create `lib/src/models/store_product.dart`:
```dart
import 'enums.dart';

/// A purchasable store product (spec §3). Built from the server `product`
/// object; `priceString`/`price`/`currencyCode`/`title`/`description` are
/// server fallbacks until the native layer enriches them via [copyWith]
/// (spec §4). Dates are not present here — subscription length is the ISO-8601
/// [subscriptionPeriod] string.
class StoreProduct {
  const StoreProduct({
    required this.identifier,
    required this.productType,
    required this.priceString,
    required this.price,
    required this.currencyCode,
    this.subscriptionPeriod,
    this.title = '',
    this.description = '',
    this.entitlementIdentifiers = const [],
  });

  /// Parses the server `product` object: `{ storeProductId, type, priceCents,
  /// currency, durationIso8601, entitlements }`.
  factory StoreProduct.fromJson(Map<String, dynamic> json) {
    final priceCents = json['priceCents'] as int?;
    final price = priceCents == null ? 0.0 : priceCents / 100.0;
    return StoreProduct(
      identifier: json['storeProductId'] as String,
      productType: ProductType.fromWire(json['type'] as String?),
      price: price,
      priceString: price.toStringAsFixed(2),
      currencyCode: (json['currency'] as String?) ?? '',
      subscriptionPeriod: json['durationIso8601'] as String?,
      entitlementIdentifiers:
          ((json['entitlements'] as List<dynamic>?) ?? const <dynamic>[])
              .cast<String>(),
    );
  }

  final String identifier;
  final ProductType productType;
  final String priceString;
  final double price;
  final String currencyCode;
  final String? subscriptionPeriod;
  final String title;
  final String description;
  final List<String> entitlementIdentifiers;

  /// Returns a copy with native store metadata merged over the server fallback
  /// (spec §4's `getProducts` enrichment). Omitted fields keep their value.
  StoreProduct copyWith({
    String? priceString,
    double? price,
    String? currencyCode,
    String? title,
    String? description,
    String? subscriptionPeriod,
  }) =>
      StoreProduct(
        identifier: identifier,
        productType: productType,
        priceString: priceString ?? this.priceString,
        price: price ?? this.price,
        currencyCode: currencyCode ?? this.currencyCode,
        subscriptionPeriod: subscriptionPeriod ?? this.subscriptionPeriod,
        title: title ?? this.title,
        description: description ?? this.description,
        entitlementIdentifiers: entitlementIdentifiers,
      );

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'productType': productType.wire,
        'priceString': priceString,
        'price': price,
        'currencyCode': currencyCode,
        'subscriptionPeriod': subscriptionPeriod,
        'title': title,
        'description': description,
        'entitlementIdentifiers': entitlementIdentifiers,
      };
}
```
  Create `lib/src/models/package.dart`:
```dart
import 'enums.dart';
import 'store_product.dart';

/// One purchasable package inside an [Offering] (spec §3). `offeringIdentifier`
/// is injected from the parent offering (the server package object has no such
/// field).
class Package {
  const Package({
    required this.identifier,
    required this.packageType,
    required this.storeProduct,
    required this.offeringIdentifier,
  });

  factory Package.fromJson(
    Map<String, dynamic> json, {
    required String offeringIdentifier,
  }) =>
      Package(
        identifier: json['identifier'] as String,
        packageType: PackageType.fromWire(json['packageType'] as String?),
        storeProduct:
            StoreProduct.fromJson(json['product'] as Map<String, dynamic>),
        offeringIdentifier: offeringIdentifier,
      );

  final String identifier;
  final PackageType packageType;
  final StoreProduct storeProduct;
  final String offeringIdentifier;

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'packageType': packageType.wire,
        'product': storeProduct.toJson(),
      };
}
```
  Create `lib/src/models/offering.dart`:
```dart
import 'enums.dart';
import 'package.dart';

/// A named group of packages the app can display (spec §3). Built from the
/// server's `current` object `{ identifier, metadata, packages }`.
class Offering {
  const Offering({
    required this.identifier,
    required this.metadata,
    required this.availablePackages,
  });

  factory Offering.fromJson(Map<String, dynamic> json) {
    final identifier = json['identifier'] as String;
    final packagesJson =
        (json['packages'] as List<dynamic>?) ?? const <dynamic>[];
    return Offering(
      identifier: identifier,
      metadata: Map<String, Object?>.from(
        (json['metadata'] as Map?) ?? const <String, Object?>{},
      ),
      availablePackages: [
        for (final p in packagesJson.cast<Map<String, dynamic>>())
          Package.fromJson(p, offeringIdentifier: identifier),
      ],
    );
  }

  final String identifier;
  final Map<String, Object?> metadata;
  final List<Package> availablePackages;

  Package? get lifetime => _ofType(PackageType.lifetime);
  Package? get annual => _ofType(PackageType.annual);
  Package? get sixMonth => _ofType(PackageType.sixMonth);
  Package? get threeMonth => _ofType(PackageType.threeMonth);
  Package? get twoMonth => _ofType(PackageType.twoMonth);
  Package? get monthly => _ofType(PackageType.monthly);
  Package? get weekly => _ofType(PackageType.weekly);

  Package? _ofType(PackageType type) {
    for (final p in availablePackages) {
      if (p.packageType == type) return p;
    }
    return null;
  }

  Map<String, Object?> toJson() => {
        'identifier': identifier,
        'metadata': metadata,
        'packages': [for (final p in availablePackages) p.toJson()],
      };
}
```
  Create `lib/src/models/offerings.dart`:
```dart
import 'offering.dart';

/// The `GET /v1/offerings` result (spec §3). The server returns only the single
/// `current` offering; `all` is derived as `{ current.identifier: current }`
/// (one entry) — multi-offering support is a flagged server enhancement.
class Offerings {
  const Offerings({required this.all, required this.current});

  /// Takes the endpoint envelope `{ current: ResolvedOffering | null }`.
  factory Offerings.fromJson(Map<String, dynamic> json) {
    final currentJson = json['current'] as Map<String, dynamic>?;
    final current =
        currentJson == null ? null : Offering.fromJson(currentJson);
    return Offerings(
      all: current == null
          ? const <String, Offering>{}
          : {current.identifier: current},
      current: current,
    );
  }

  final Map<String, Offering> all;
  final Offering? current;

  Map<String, Object?> toJson() => {
        'all': all.map((k, v) => MapEntry(k, v.toJson())),
        'current': current?.toJson(),
      };
}
```
  Then append to the barrel `lib/myampix_purchases.dart`:
```dart
export 'src/models/offering.dart' show Offering;
export 'src/models/offerings.dart' show Offerings;
export 'src/models/package.dart' show Package;
export 'src/models/store_product.dart' show StoreProduct;
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter test test/models/offerings_test.dart` → all pass. `flutter analyze` → `No issues found!`.

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/lib/src/models/store_product.dart sdk/flutter_purchases/lib/src/models/package.dart sdk/flutter_purchases/lib/src/models/offering.dart sdk/flutter_purchases/lib/src/models/offerings.dart sdk/flutter_purchases/lib/myampix_purchases.dart sdk/flutter_purchases/test/models/offerings_test.dart && git commit -m "feat(purchases-sdk): Offerings/Offering/Package/StoreProduct models (P3.1)"`

---

### Task 3.1.4: CustomerInfo / EntitlementInfos / EntitlementInfo

**Files:**
- Create `sdk/flutter_purchases/lib/src/models/entitlement_info.dart` (holds `EntitlementInfo` + `EntitlementInfos`)
- Create `sdk/flutter_purchases/lib/src/models/customer_info.dart`
- Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (add exports)
- Test `sdk/flutter_purchases/test/models/customer_info_test.dart`

**Interfaces:**
- Consumes: Task 3.1.2 — `PeriodType.fromWire`, `Store.fromWire`, `OwnershipType.fromWire`.
- Produces (consumed by P3.2 network parsing, P3.3 cache/facade, P3.4/P3.5 orchestration):
  - `class EntitlementInfo` — `const EntitlementInfo({required String identifier, required bool isActive, required bool willRenew, required PeriodType periodType, required String latestPurchaseDate, required String originalPurchaseDate, required String? expirationDate, required Store store, required String productIdentifier, required String? unsubscribeDetectedAt, required String? billingIssueDetectedAt, required OwnershipType ownershipType, bool isSandbox = false})`; `factory EntitlementInfo.fromJson(String identifier, Map<String, dynamic> json)` (identifier is the map key, **not** a JSON field); `Map<String, Object?> toJson()` (value shape; excludes identifier).
  - `class EntitlementInfos` — `const EntitlementInfos({Map<String, EntitlementInfo> all = const {}, Map<String, EntitlementInfo> active = const {}})`; `factory EntitlementInfos.fromJson(Map<String, dynamic> json)` (parses the wire `{ active, all }` object); `Map<String, Object?> toJson()`.
  - `class CustomerInfo` — `const CustomerInfo({required EntitlementInfos entitlements, required List<String> activeSubscriptions, required String firstSeen, required String? latestExpirationDate, required String originalAppUserId, required String? managementURL, required String requestDate})`; `factory CustomerInfo.fromJson(Map<String, dynamic> json, {required String originalAppUserId, required String requestDate})` (takes the **inner** `customerInfo` object; `activeSubscriptions` derived from `subscriptions[].storeProductId where isActive`; `latestExpirationDate` derived as the max `expirationDate` across active entitlements; `originalAppUserId`/`requestDate` injected by the caller); `Map<String, Object?> toJson()`.

- [ ] **Step 1: write failing test** — create `test/models/customer_info_test.dart`:
```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/entitlement_info.dart';
import 'package:myampix_purchases/src/models/enums.dart';

/// The exact inner `customerInfo` object of the `GET /v1/subscribers/:id` and
/// `POST /v1/receipts` envelope (spec §3). Two active entitlements (different
/// expirations) + one active and one inactive subscription.
Map<String, dynamic> customerInfoWire() => {
      'entitlements': {
        'active': {
          'premium': {
            'isActive': true,
            'willRenew': true,
            'periodType': 'normal',
            'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
            'expirationDate': '2026-07-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.pro.monthly',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'PURCHASED',
          },
          'pro': {
            'isActive': true,
            'willRenew': false,
            'periodType': 'trial',
            'latestPurchaseDate': '2026-06-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-06-01T00:00:00.000Z',
            'expirationDate': '2026-09-01T00:00:00.000Z',
            'store': 'play_store',
            'productIdentifier': 'com.myampix.pro.annual',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'FAMILY_SHARED',
          },
        },
        'all': {
          'premium': {
            'isActive': true,
            'willRenew': true,
            'periodType': 'normal',
            'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
            'expirationDate': '2026-07-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.pro.monthly',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'PURCHASED',
          },
          'pro': {
            'isActive': true,
            'willRenew': false,
            'periodType': 'trial',
            'latestPurchaseDate': '2026-06-01T00:00:00.000Z',
            'originalPurchaseDate': '2026-06-01T00:00:00.000Z',
            'expirationDate': '2026-09-01T00:00:00.000Z',
            'store': 'play_store',
            'productIdentifier': 'com.myampix.pro.annual',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'FAMILY_SHARED',
          },
          'legacy': {
            'isActive': false,
            'willRenew': false,
            'periodType': 'normal',
            'latestPurchaseDate': '2024-01-01T00:00:00.000Z',
            'originalPurchaseDate': '2024-01-01T00:00:00.000Z',
            'expirationDate': '2025-01-01T00:00:00.000Z',
            'store': 'app_store',
            'productIdentifier': 'com.myampix.legacy',
            'unsubscribeDetectedAt': null,
            'billingIssueDetectedAt': null,
            'ownershipType': 'PURCHASED',
          },
        },
      },
      'subscriptions': [
        {
          'storeProductId': 'com.myampix.pro.monthly',
          'store': 'app_store',
          'isActive': true,
          'willRenew': true,
          'expirationDate': '2026-07-01T00:00:00.000Z',
          'periodType': 'normal',
        },
        {
          'storeProductId': 'com.myampix.legacy',
          'store': 'app_store',
          'isActive': false,
          'willRenew': false,
          'expirationDate': '2025-01-01T00:00:00.000Z',
          'periodType': 'normal',
        },
      ],
      'firstSeen': '2026-01-01T00:00:00.000Z',
      'lastSeen': '2026-07-16T00:00:00.000Z',
      'managementURL': 'https://apps.apple.com/account/subscriptions',
    };

void main() {
  group('EntitlementInfo.fromJson', () {
    test('takes the identifier from the map key and maps every field', () {
      final wire = customerInfoWire();
      final active =
          (wire['entitlements'] as Map)['active'] as Map<String, dynamic>;
      final e = EntitlementInfo.fromJson(
          'premium', active['premium'] as Map<String, dynamic>);
      expect(e.identifier, 'premium');
      expect(e.isActive, isTrue);
      expect(e.willRenew, isTrue);
      expect(e.periodType, PeriodType.normal);
      expect(e.latestPurchaseDate, '2026-05-01T00:00:00.000Z');
      expect(e.originalPurchaseDate, '2026-05-01T00:00:00.000Z');
      expect(e.expirationDate, '2026-07-01T00:00:00.000Z');
      expect(e.store, Store.appStore);
      expect(e.productIdentifier, 'com.myampix.pro.monthly');
      expect(e.unsubscribeDetectedAt, isNull);
      expect(e.billingIssueDetectedAt, isNull);
      expect(e.ownershipType, OwnershipType.purchased);
      expect(e.isSandbox, isFalse);
    });

    test('collapses server promo periodType to normal', () {
      final e = EntitlementInfo.fromJson('promoEnt', {
        'isActive': true,
        'willRenew': true,
        'periodType': 'promo',
        'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
        'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
        'expirationDate': null,
        'store': 'play_store',
        'productIdentifier': 'com.myampix.promo',
        'unsubscribeDetectedAt': null,
        'billingIssueDetectedAt': null,
        'ownershipType': 'PURCHASED',
      });
      expect(e.periodType, PeriodType.normal);
      expect(e.store, Store.playStore);
      expect(e.expirationDate, isNull);
    });

    test('toJson emits the wire value shape (no identifier)', () {
      final wire = customerInfoWire();
      final active =
          (wire['entitlements'] as Map)['active'] as Map<String, dynamic>;
      final e = EntitlementInfo.fromJson(
          'premium', active['premium'] as Map<String, dynamic>);
      expect(e.toJson(), {
        'isActive': true,
        'willRenew': true,
        'periodType': 'normal',
        'latestPurchaseDate': '2026-05-01T00:00:00.000Z',
        'originalPurchaseDate': '2026-05-01T00:00:00.000Z',
        'expirationDate': '2026-07-01T00:00:00.000Z',
        'store': 'app_store',
        'productIdentifier': 'com.myampix.pro.monthly',
        'unsubscribeDetectedAt': null,
        'billingIssueDetectedAt': null,
        'ownershipType': 'PURCHASED',
        'isSandbox': false,
      });
    });
  });

  group('EntitlementInfos', () {
    test('parses active + all keyed by identifier', () {
      final infos = EntitlementInfos.fromJson(
          (customerInfoWire()['entitlements']) as Map<String, dynamic>);
      expect(infos.active.keys.toSet(), {'premium', 'pro'});
      expect(infos.all.keys.toSet(), {'premium', 'pro', 'legacy'});
      expect(infos.active['pro']!.ownershipType, OwnershipType.familyShared);
      expect(infos.all['legacy']!.isActive, isFalse);
    });

    test('round-trips through toJson/fromJson', () {
      final infos = EntitlementInfos.fromJson(
          (customerInfoWire()['entitlements']) as Map<String, dynamic>);
      final round = EntitlementInfos.fromJson(
        jsonDecode(jsonEncode(infos.toJson())) as Map<String, dynamic>,
      );
      expect(round.toJson(), infos.toJson());
      expect(round.active['premium']!.identifier, 'premium');
    });

    test('defaults to empty maps when active/all are missing', () {
      const infos = EntitlementInfos();
      expect(infos.active, isEmpty);
      expect(infos.all, isEmpty);
      final parsed = EntitlementInfos.fromJson(const {});
      expect(parsed.active, isEmpty);
      expect(parsed.all, isEmpty);
    });
  });

  group('CustomerInfo.fromJson', () {
    test('derives activeSubscriptions, latestExpirationDate, and injects ids', () {
      final info = CustomerInfo.fromJson(
        customerInfoWire(),
        originalAppUserId: r'$RCAnonymousID:abc123',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      expect(info.entitlements.active.keys.toSet(), {'premium', 'pro'});
      // Only isActive subscriptions contribute their storeProductId.
      expect(info.activeSubscriptions, ['com.myampix.pro.monthly']);
      // Max expirationDate across ACTIVE entitlements (pro > premium).
      expect(info.latestExpirationDate, '2026-09-01T00:00:00.000Z');
      expect(info.firstSeen, '2026-01-01T00:00:00.000Z');
      expect(info.originalAppUserId, r'$RCAnonymousID:abc123');
      expect(info.managementURL, 'https://apps.apple.com/account/subscriptions');
      expect(info.requestDate, '2026-07-17T10:00:00.000Z');
    });

    test('empty customer yields empty entitlements and null derivations', () {
      final info = CustomerInfo.fromJson(
        {
          'entitlements': {'active': <String, dynamic>{}, 'all': <String, dynamic>{}},
          'subscriptions': <dynamic>[],
          'firstSeen': '2026-07-17T00:00:00.000Z',
          'lastSeen': '2026-07-17T00:00:00.000Z',
        },
        originalAppUserId: r'$RCAnonymousID:new',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      expect(info.entitlements.active, isEmpty);
      expect(info.activeSubscriptions, isEmpty);
      expect(info.latestExpirationDate, isNull);
      expect(info.managementURL, isNull);
    });

    test('toJson emits the RevenueCat CustomerInfo shape', () {
      final info = CustomerInfo.fromJson(
        customerInfoWire(),
        originalAppUserId: r'$RCAnonymousID:abc123',
        requestDate: '2026-07-17T10:00:00.000Z',
      );
      final json = info.toJson();
      expect(json['activeSubscriptions'], ['com.myampix.pro.monthly']);
      expect(json['firstSeen'], '2026-01-01T00:00:00.000Z');
      expect(json['latestExpirationDate'], '2026-09-01T00:00:00.000Z');
      expect(json['originalAppUserId'], r'$RCAnonymousID:abc123');
      expect(json['managementURL'], 'https://apps.apple.com/account/subscriptions');
      expect(json['requestDate'], '2026-07-17T10:00:00.000Z');
      expect((json['entitlements'] as Map).containsKey('active'), isTrue);
    });
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/models/customer_info_test.dart`. Expected failure: compile error — `Couldn't resolve the package import 'package:myampix_purchases/src/models/customer_info.dart'` (and `entitlement_info.dart`).

- [ ] **Step 3: minimal implementation** —
  Create `lib/src/models/entitlement_info.dart`:
```dart
import 'enums.dart';

/// One entitlement's status (spec §3). RevenueCat parity: the `identifier` is
/// the map key of the parent [EntitlementInfos], not a JSON field. `isSandbox`
/// is a deferred field (the server does not emit it) defaulting to `false`.
/// All dates are ISO-8601 strings.
class EntitlementInfo {
  const EntitlementInfo({
    required this.identifier,
    required this.isActive,
    required this.willRenew,
    required this.periodType,
    required this.latestPurchaseDate,
    required this.originalPurchaseDate,
    required this.expirationDate,
    required this.store,
    required this.productIdentifier,
    required this.unsubscribeDetectedAt,
    required this.billingIssueDetectedAt,
    required this.ownershipType,
    this.isSandbox = false,
  });

  factory EntitlementInfo.fromJson(String identifier, Map<String, dynamic> json) =>
      EntitlementInfo(
        identifier: identifier,
        isActive: json['isActive'] as bool? ?? false,
        willRenew: json['willRenew'] as bool? ?? false,
        periodType: PeriodType.fromWire(json['periodType'] as String?),
        latestPurchaseDate: json['latestPurchaseDate'] as String,
        originalPurchaseDate: json['originalPurchaseDate'] as String,
        expirationDate: json['expirationDate'] as String?,
        store: Store.fromWire(json['store'] as String?),
        productIdentifier: json['productIdentifier'] as String,
        unsubscribeDetectedAt: json['unsubscribeDetectedAt'] as String?,
        billingIssueDetectedAt: json['billingIssueDetectedAt'] as String?,
        ownershipType: OwnershipType.fromWire(json['ownershipType'] as String?),
        isSandbox: json['isSandbox'] as bool? ?? false,
      );

  final String identifier;
  final bool isActive;
  final bool willRenew;
  final PeriodType periodType;
  final String latestPurchaseDate;
  final String originalPurchaseDate;
  final String? expirationDate;
  final Store store;
  final String productIdentifier;
  final String? unsubscribeDetectedAt;
  final String? billingIssueDetectedAt;
  final OwnershipType ownershipType;
  final bool isSandbox;

  /// The wire value shape (identifier excluded — it is the parent map key).
  Map<String, Object?> toJson() => {
        'isActive': isActive,
        'willRenew': willRenew,
        'periodType': periodType.wire,
        'latestPurchaseDate': latestPurchaseDate,
        'originalPurchaseDate': originalPurchaseDate,
        'expirationDate': expirationDate,
        'store': store.wire,
        'productIdentifier': productIdentifier,
        'unsubscribeDetectedAt': unsubscribeDetectedAt,
        'billingIssueDetectedAt': billingIssueDetectedAt,
        'ownershipType': ownershipType.wire,
        'isSandbox': isSandbox,
      };
}

/// The `active` (subset) and `all` entitlement maps (spec §3), each keyed by
/// entitlement identifier.
class EntitlementInfos {
  const EntitlementInfos({this.all = const {}, this.active = const {}});

  factory EntitlementInfos.fromJson(Map<String, dynamic> json) {
    Map<String, EntitlementInfo> parse(String key) {
      final raw = (json[key] as Map<String, dynamic>?) ?? const {};
      return {
        for (final entry in raw.entries)
          entry.key: EntitlementInfo.fromJson(
            entry.key,
            entry.value as Map<String, dynamic>,
          ),
      };
    }

    return EntitlementInfos(all: parse('all'), active: parse('active'));
  }

  final Map<String, EntitlementInfo> all;
  final Map<String, EntitlementInfo> active;

  Map<String, Object?> toJson() => {
        'all': all.map((k, v) => MapEntry(k, v.toJson())),
        'active': active.map((k, v) => MapEntry(k, v.toJson())),
      };
}
```
  Create `lib/src/models/customer_info.dart`:
```dart
import 'entitlement_info.dart';

/// The RevenueCat `CustomerInfo` (spec §3), assembled from the inner
/// `customerInfo` object of `GET /v1/subscribers/:id` / `POST /v1/receipts`.
/// `activeSubscriptions` and `latestExpirationDate` are derived; the caller
/// injects `originalAppUserId` (the id used for the request) and `requestDate`
/// (client fetch stamp). All dates are ISO-8601 strings.
class CustomerInfo {
  const CustomerInfo({
    required this.entitlements,
    required this.activeSubscriptions,
    required this.firstSeen,
    required this.latestExpirationDate,
    required this.originalAppUserId,
    required this.managementURL,
    required this.requestDate,
  });

  factory CustomerInfo.fromJson(
    Map<String, dynamic> json, {
    required String originalAppUserId,
    required String requestDate,
  }) {
    final entitlements = EntitlementInfos.fromJson(
      (json['entitlements'] as Map<String, dynamic>?) ?? const {},
    );

    final subscriptions =
        (json['subscriptions'] as List<dynamic>?) ?? const <dynamic>[];
    final activeSubscriptions = <String>[
      for (final sub in subscriptions.cast<Map<String, dynamic>>())
        if (sub['isActive'] == true) sub['storeProductId'] as String,
    ];

    // Max expiration across ACTIVE entitlements. ISO-8601 UTC strings from the
    // server share a fixed format, so lexical compare == chronological compare.
    String? latest;
    for (final e in entitlements.active.values) {
      final exp = e.expirationDate;
      if (exp != null && (latest == null || exp.compareTo(latest) > 0)) {
        latest = exp;
      }
    }

    return CustomerInfo(
      entitlements: entitlements,
      activeSubscriptions: activeSubscriptions,
      firstSeen: json['firstSeen'] as String,
      latestExpirationDate: latest,
      originalAppUserId: originalAppUserId,
      managementURL: json['managementURL'] as String?,
      requestDate: requestDate,
    );
  }

  final EntitlementInfos entitlements;
  final List<String> activeSubscriptions;
  final String firstSeen;
  final String? latestExpirationDate;
  final String originalAppUserId;
  final String? managementURL;
  final String requestDate;

  Map<String, Object?> toJson() => {
        'entitlements': entitlements.toJson(),
        'activeSubscriptions': activeSubscriptions,
        'firstSeen': firstSeen,
        'latestExpirationDate': latestExpirationDate,
        'originalAppUserId': originalAppUserId,
        'managementURL': managementURL,
        'requestDate': requestDate,
      };
}
```
  Then append to the barrel `lib/myampix_purchases.dart`:
```dart
export 'src/models/customer_info.dart' show CustomerInfo;
export 'src/models/entitlement_info.dart' show EntitlementInfo, EntitlementInfos;
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter test test/models/customer_info_test.dart` → all pass. `flutter analyze` → `No issues found!`.

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/lib/src/models/entitlement_info.dart sdk/flutter_purchases/lib/src/models/customer_info.dart sdk/flutter_purchases/lib/myampix_purchases.dart sdk/flutter_purchases/test/models/customer_info_test.dart && git commit -m "feat(purchases-sdk): CustomerInfo/EntitlementInfos/EntitlementInfo models (P3.1)"`

---

### Task 3.1.5: PurchaseResult / StoreTransaction / LogInResult

**Files:**
- Create `sdk/flutter_purchases/lib/src/models/purchase_result.dart` (holds `StoreTransaction` + `PurchaseResult`)
- Create `sdk/flutter_purchases/lib/src/models/login_result.dart`
- Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (add exports)
- Test `sdk/flutter_purchases/test/models/purchase_result_test.dart`

**Interfaces:**
- Consumes: Task 3.1.4 — `CustomerInfo` (+ its `fromJson`).
- Produces (returned by the P3.4 purchase orchestration and P3.3 `logIn`):
  - `class StoreTransaction` — `const StoreTransaction({required String transactionId, required String productId})`; `factory StoreTransaction.fromJson(Map<String, dynamic> json)` (the native `purchase` / EventChannel map: `transactionId`, `storeProductId`); `Map<String, Object?> toJson()`.
  - `class PurchaseResult` — `const PurchaseResult({required CustomerInfo customerInfo, required StoreTransaction? storeTransaction})`; `Map<String, Object?> toJson()`.
  - `class LogInResult` — `const LogInResult({required CustomerInfo customerInfo, required bool created})`; `Map<String, Object?> toJson()`.

- [ ] **Step 1: write failing test** — create `test/models/purchase_result_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/login_result.dart';
import 'package:myampix_purchases/src/models/purchase_result.dart';

CustomerInfo sampleCustomerInfo() => CustomerInfo.fromJson(
      {
        'entitlements': {
          'active': {
            'premium': {
              'isActive': true,
              'willRenew': true,
              'periodType': 'normal',
              'latestPurchaseDate': '2026-07-17T09:00:00.000Z',
              'originalPurchaseDate': '2026-07-17T09:00:00.000Z',
              'expirationDate': '2026-08-17T09:00:00.000Z',
              'store': 'app_store',
              'productIdentifier': 'com.myampix.pro.monthly',
              'unsubscribeDetectedAt': null,
              'billingIssueDetectedAt': null,
              'ownershipType': 'PURCHASED',
            },
          },
          'all': {
            'premium': {
              'isActive': true,
              'willRenew': true,
              'periodType': 'normal',
              'latestPurchaseDate': '2026-07-17T09:00:00.000Z',
              'originalPurchaseDate': '2026-07-17T09:00:00.000Z',
              'expirationDate': '2026-08-17T09:00:00.000Z',
              'store': 'app_store',
              'productIdentifier': 'com.myampix.pro.monthly',
              'unsubscribeDetectedAt': null,
              'billingIssueDetectedAt': null,
              'ownershipType': 'PURCHASED',
            },
          },
        },
        'subscriptions': [
          {
            'storeProductId': 'com.myampix.pro.monthly',
            'store': 'app_store',
            'isActive': true,
            'willRenew': true,
            'expirationDate': '2026-08-17T09:00:00.000Z',
            'periodType': 'normal',
          },
        ],
        'firstSeen': '2026-07-17T09:00:00.000Z',
        'lastSeen': '2026-07-17T09:00:00.000Z',
      },
      originalAppUserId: r'$RCAnonymousID:buyer',
      requestDate: '2026-07-17T09:00:01.000Z',
    );

void main() {
  group('StoreTransaction', () {
    test('parses the native purchase result map', () {
      final txn = StoreTransaction.fromJson({
        'platform': 'APP_STORE',
        'fetchToken': 'jws.header.payload',
        'storeProductId': 'com.myampix.pro.monthly',
        'transactionId': '2000000123456789',
      });
      expect(txn.transactionId, '2000000123456789');
      expect(txn.productId, 'com.myampix.pro.monthly');
      expect(txn.toJson(), {
        'transactionId': '2000000123456789',
        'productId': 'com.myampix.pro.monthly',
      });
    });
  });

  group('PurchaseResult', () {
    test('carries the customerInfo and store transaction', () {
      final result = PurchaseResult(
        customerInfo: sampleCustomerInfo(),
        storeTransaction: const StoreTransaction(
          transactionId: '2000000123456789',
          productId: 'com.myampix.pro.monthly',
        ),
      );
      expect(result.customerInfo.activeSubscriptions,
          ['com.myampix.pro.monthly']);
      expect(result.storeTransaction!.transactionId, '2000000123456789');
      final json = result.toJson();
      expect((json['customerInfo'] as Map)['activeSubscriptions'],
          ['com.myampix.pro.monthly']);
      expect((json['storeTransaction'] as Map)['productId'],
          'com.myampix.pro.monthly');
    });

    test('tolerates a null store transaction (restore / out-of-band)', () {
      final result = PurchaseResult(
        customerInfo: sampleCustomerInfo(),
        storeTransaction: null,
      );
      expect(result.storeTransaction, isNull);
      expect(result.toJson()['storeTransaction'], isNull);
    });
  });

  group('LogInResult', () {
    test('carries customerInfo and the created flag', () {
      final created = LogInResult(
        customerInfo: sampleCustomerInfo(),
        created: true,
      );
      expect(created.created, isTrue);
      expect(created.toJson()['created'], true);

      final existing = LogInResult(
        customerInfo: sampleCustomerInfo(),
        created: false,
      );
      expect(existing.created, isFalse);
      expect((existing.toJson()['customerInfo'] as Map)['originalAppUserId'],
          r'$RCAnonymousID:buyer');
    });
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/models/purchase_result_test.dart`. Expected failure: compile error — `Couldn't resolve the package import 'package:myampix_purchases/src/models/purchase_result.dart'` (and `login_result.dart`).

- [ ] **Step 3: minimal implementation** —
  Create `lib/src/models/purchase_result.dart`:
```dart
import 'customer_info.dart';

/// A minimal RevenueCat `StoreTransaction` (spec §3/§5). Built from the native
/// `purchase` result / EventChannel map; only the fields the Dart layer needs
/// to identify a transaction are kept (the receipt itself never leaves native).
class StoreTransaction {
  const StoreTransaction({
    required this.transactionId,
    required this.productId,
  });

  factory StoreTransaction.fromJson(Map<String, dynamic> json) =>
      StoreTransaction(
        transactionId: json['transactionId'] as String,
        productId: json['storeProductId'] as String,
      );

  final String transactionId;
  final String productId;

  Map<String, Object?> toJson() => {
        'transactionId': transactionId,
        'productId': productId,
      };
}

/// The result of a successful purchase (spec §3): the refreshed [CustomerInfo]
/// plus the [StoreTransaction]. `storeTransaction` is null for flows without a
/// single originating transaction (restore / out-of-band refresh).
class PurchaseResult {
  const PurchaseResult({
    required this.customerInfo,
    required this.storeTransaction,
  });

  final CustomerInfo customerInfo;
  final StoreTransaction? storeTransaction;

  Map<String, Object?> toJson() => {
        'customerInfo': customerInfo.toJson(),
        'storeTransaction': storeTransaction?.toJson(),
      };
}
```
  Create `lib/src/models/login_result.dart`:
```dart
import 'customer_info.dart';

/// The result of `logIn` (spec §3/§4): the refreshed [CustomerInfo] and whether
/// the identified customer was new. `created` is a client-side approximation
/// (the fetched customer had no prior activity) until server-side identity
/// aliasing (roadmap P5) exists — a documented divergence from RevenueCat.
class LogInResult {
  const LogInResult({
    required this.customerInfo,
    required this.created,
  });

  final CustomerInfo customerInfo;
  final bool created;

  Map<String, Object?> toJson() => {
        'customerInfo': customerInfo.toJson(),
        'created': created,
      };
}
```
  Then append to the barrel `lib/myampix_purchases.dart`:
```dart
export 'src/models/login_result.dart' show LogInResult;
export 'src/models/purchase_result.dart' show PurchaseResult, StoreTransaction;
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter test test/models/purchase_result_test.dart` → all pass. `flutter analyze` → `No issues found!`.

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/lib/src/models/purchase_result.dart sdk/flutter_purchases/lib/src/models/login_result.dart sdk/flutter_purchases/lib/myampix_purchases.dart sdk/flutter_purchases/test/models/purchase_result_test.dart && git commit -m "feat(purchases-sdk): PurchaseResult/StoreTransaction/LogInResult models (P3.1)"`

---

### Task 3.1.6: PurchasesError + PurchasesErrorCode

**Files:**
- Create `sdk/flutter_purchases/lib/src/models/purchases_error.dart`
- Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (add export)
- Test `sdk/flutter_purchases/test/models/purchases_error_test.dart`

**Interfaces:**
- Consumes: Task 3.1.1 (package).
- Produces (thrown by P3.2 network mapping and the P3.3/P3.4 throwing facade methods):
  - `enum PurchasesErrorCode { purchaseCancelledError, paymentPendingError, productNotAvailableForPurchaseError, invalidReceiptError, productAlreadyPurchasedError, networkError, storeProblemError, configurationError, unknownError }`.
  - `class PurchasesError implements Exception` — `const PurchasesError(PurchasesErrorCode code, String message, {String? underlyingErrorMessage})`; fields `PurchasesErrorCode code`, `String message`, `String? underlyingErrorMessage`; `bool get userCancelled` (true iff `code == purchaseCancelledError`); value equality (`==`/`hashCode` over code+message+underlyingErrorMessage — lets P3.2 assert exact errors); `String toString()`; `Map<String, Object?> toJson()`.

- [ ] **Step 1: write failing test** — create `test/models/purchases_error_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';

void main() {
  test('exposes all §6 error codes', () {
    expect(PurchasesErrorCode.values, containsAll(const [
      PurchasesErrorCode.purchaseCancelledError,
      PurchasesErrorCode.paymentPendingError,
      PurchasesErrorCode.productNotAvailableForPurchaseError,
      PurchasesErrorCode.invalidReceiptError,
      PurchasesErrorCode.productAlreadyPurchasedError,
      PurchasesErrorCode.networkError,
      PurchasesErrorCode.storeProblemError,
      PurchasesErrorCode.configurationError,
      PurchasesErrorCode.unknownError,
    ]));
  });

  test('is an Exception and can be thrown/caught by type', () {
    expect(
      () => throw const PurchasesError(
        PurchasesErrorCode.invalidReceiptError,
        'Receipt rejected by the store.',
      ),
      throwsA(isA<PurchasesError>().having(
        (e) => e.code,
        'code',
        PurchasesErrorCode.invalidReceiptError,
      )),
    );
  });

  test('userCancelled is true only for the cancelled code', () {
    const cancelled = PurchasesError(
      PurchasesErrorCode.purchaseCancelledError,
      'User cancelled.',
    );
    const network = PurchasesError(
      PurchasesErrorCode.networkError,
      'Offline.',
    );
    expect(cancelled.userCancelled, isTrue);
    expect(network.userCancelled, isFalse);
  });

  test('carries an optional underlying error message', () {
    const err = PurchasesError(
      PurchasesErrorCode.storeProblemError,
      'The store is unavailable.',
      underlyingErrorMessage: 'HTTP 503',
    );
    expect(err.underlyingErrorMessage, 'HTTP 503');
    expect(err.toJson(), {
      'code': 'storeProblemError',
      'message': 'The store is unavailable.',
      'underlyingErrorMessage': 'HTTP 503',
    });
  });

  test('has value equality and a readable toString', () {
    const a = PurchasesError(
      PurchasesErrorCode.configurationError,
      'Not configured.',
    );
    const b = PurchasesError(
      PurchasesErrorCode.configurationError,
      'Not configured.',
    );
    const c = PurchasesError(
      PurchasesErrorCode.networkError,
      'Not configured.',
    );
    expect(a, equals(b));
    expect(a.hashCode, b.hashCode);
    expect(a == c, isFalse);
    expect(a.toString(), 'PurchasesError(configurationError): Not configured.');
  });
}
```

- [ ] **Step 2: run to fail** — `cd sdk/flutter_purchases && flutter test test/models/purchases_error_test.dart`. Expected failure: compile error — `Couldn't resolve the package import 'package:myampix_purchases/src/models/purchases_error.dart'`.

- [ ] **Step 3: minimal implementation** — create `lib/src/models/purchases_error.dart`:
```dart
/// RevenueCat-parity error codes (spec §6), thrown only by the throwing public
/// methods (`getOfferings`, `getCustomerInfo`, `purchasePackage`,
/// `restorePurchases`, `logIn`).
enum PurchasesErrorCode {
  purchaseCancelledError,
  paymentPendingError,
  productNotAvailableForPurchaseError,
  invalidReceiptError,
  productAlreadyPurchasedError,
  networkError,
  storeProblemError,
  configurationError,
  unknownError,
}

/// The typed error surfaced by the throwing facade methods (spec §6). Internal
/// machinery never throws this into non-throwing paths (the never-crash
/// guarantee) — it is mapped from store `PlatformException` codes and the
/// server's RFC-7807 responses by the P3.2 network layer.
class PurchasesError implements Exception {
  const PurchasesError(
    this.code,
    this.message, {
    this.underlyingErrorMessage,
  });

  final PurchasesErrorCode code;
  final String message;
  final String? underlyingErrorMessage;

  /// True only for [PurchasesErrorCode.purchaseCancelledError] — the RC
  /// convention for "the user cancelled" (spec §6).
  bool get userCancelled => code == PurchasesErrorCode.purchaseCancelledError;

  Map<String, Object?> toJson() => {
        'code': code.name,
        'message': message,
        'underlyingErrorMessage': underlyingErrorMessage,
      };

  @override
  bool operator ==(Object other) =>
      other is PurchasesError &&
      other.code == code &&
      other.message == message &&
      other.underlyingErrorMessage == underlyingErrorMessage;

  @override
  int get hashCode => Object.hash(code, message, underlyingErrorMessage);

  @override
  String toString() => 'PurchasesError(${code.name}): $message';
}
```
  Then append to the barrel `lib/myampix_purchases.dart`:
```dart
export 'src/models/purchases_error.dart' show PurchasesError, PurchasesErrorCode;
```

- [ ] **Step 4: run to pass** — `cd sdk/flutter_purchases && flutter test test/models/purchases_error_test.dart` → all pass. Then run the whole suite `flutter test` (all P3.1 tests green) and `flutter analyze` → `No issues found!` (P3.1 acceptance: analyze clean, model round-trips green, no native).

- [ ] **Step 5: commit** — `git add sdk/flutter_purchases/lib/src/models/purchases_error.dart sdk/flutter_purchases/lib/myampix_purchases.dart sdk/flutter_purchases/test/models/purchases_error_test.dart && git commit -m "feat(purchases-sdk): typed PurchasesError + error codes (P3.1)"`


---

## P3.2 · API client + identity

Networking to the three `mobile_purchase` public endpoints and the app-user-id
store. All commands below run from `sdk/flutter_purchases/`. Pure Dart, no
native — fully unit-tested with `package:http/testing` `MockClient` and an
in-memory KV fake, mirroring `myampix_analytics` conventions exactly (injected
`http.Client`, hand-rolled fakes in `test/helpers/`, no mocktail/mockito).

**Shared consumed contract — produced by P3.1 (`lib/src/models/`), relied on verbatim here:**

```dart
// models/offerings.dart
factory Offerings.fromJson(Map<String, dynamic> json);   // json == { "current": ResolvedOffering | null }
Offering? get current;                                    // on Offerings
Map<String, Offering> get all;                            // on Offerings
String get identifier;                                    // on Offering

// models/customer_info.dart  — json == the server `customerInfo` object;
// originalAppUserId + requestDate are client-injected (NOT in the server body).
factory CustomerInfo.fromJson(
  Map<String, dynamic> json, {
  required String originalAppUserId,
  required String requestDate,
});
String get originalAppUserId;            // on CustomerInfo
String get requestDate;                  // on CustomerInfo
String get firstSeen;                    // on CustomerInfo
List<String> get activeSubscriptions;    // on CustomerInfo (derived)
EntitlementInfos get entitlements;       // on CustomerInfo
Map<String, EntitlementInfo> get active; // on EntitlementInfos

// models/purchases_error.dart
enum PurchasesErrorCode {
  purchaseCancelledError,
  paymentPendingError,
  productNotAvailableForPurchaseError,
  invalidReceiptError,
  productAlreadyPurchasedError,
  networkError,
  storeProblemError,
  configurationError,
  unknownError,
}

class PurchasesError implements Exception {
  const PurchasesError({
    required this.code,
    required this.message,
    this.underlyingErrorMessage,
    this.userCancelled = false,
  });
  final PurchasesErrorCode code;
  final String message;
  final String? underlyingErrorMessage;
  final bool userCancelled;
}
```

Server contract confirmed against `backend/mobile_purchase/src`: `GET /v1/offerings`
→ `{ current }` (`OfferingResolverService`), `GET /v1/subscribers/:appUserId` → `{ customerInfo }`
(`SubscribersController`), `POST /v1/receipts` (`HttpCode(200)`) → `{ customerInfo }`
(`ReceiptsController`, body `{app_user_id, platform: 'APP_STORE'|'PLAY_STORE', fetch_token, product_id?}`).
All three are guarded by `PublicApiKeyGuard` reading `Authorization: Bearer <publicSdkKey>`
(a bad/missing key → 401). Errors are RFC-7807 `ProblemException({status, title, detail})`.

---

### Task 3.2.1: PurchasesApiClient — offerings/subscriber/receipt happy paths

**Files:**
- Create `sdk/flutter_purchases/lib/src/network/purchases_api_client.dart`
- Test `sdk/flutter_purchases/test/network/purchases_api_client_test.dart`

**Interfaces:**
- Consumes: `Offerings.fromJson`, `Offerings.current`, `Offerings.all`, `Offering.identifier`, `CustomerInfo.fromJson(..., {originalAppUserId, requestDate})`, `CustomerInfo.originalAppUserId/requestDate/firstSeen/activeSubscriptions/entitlements`, `EntitlementInfos.active` (from P3.1, signatures above); `PurchasesError`/`PurchasesErrorCode` (from P3.1).
- Produces:
  - `PurchasesApiClient({required http.Client client, required String serverUrl, required String apiKey, String Function()? nowIso8601})`
  - `Future<Offerings> getOfferings()`
  - `Future<CustomerInfo> getSubscriber(String appUserId)`
  - `Future<CustomerInfo> postReceipt({required String appUserId, required String platform, required String fetchToken, String? productId})`

- [ ] **Step 1: Write the failing test.** Create `test/network/purchases_api_client_test.dart`:

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/offerings.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';

const _offeringsBody = '''
{
  "current": {
    "identifier": "default",
    "metadata": {"headline": "Go Pro"},
    "packages": [
      {
        "identifier": "\$rc_monthly",
        "packageType": "monthly",
        "product": {
          "storeProductId": "com.myampix.pro.monthly",
          "type": "autoRenewableSubscription",
          "priceCents": 999,
          "currency": "USD",
          "durationIso8601": "P1M",
          "entitlements": ["pro"]
        }
      }
    ]
  }
}
''';

const _entitlement = '''
{
  "isActive": true,
  "willRenew": true,
  "periodType": "normal",
  "latestPurchaseDate": "2026-07-01T00:00:00.000Z",
  "originalPurchaseDate": "2026-06-01T00:00:00.000Z",
  "expirationDate": "2026-08-01T00:00:00.000Z",
  "store": "app_store",
  "productIdentifier": "com.myampix.pro.monthly",
  "unsubscribeDetectedAt": null,
  "billingIssueDetectedAt": null,
  "ownershipType": "PURCHASED"
}
''';

final _subscriberBody = '''
{
  "customerInfo": {
    "entitlements": {"active": {"pro": $_entitlement}, "all": {"pro": $_entitlement}},
    "subscriptions": [
      {
        "storeProductId": "com.myampix.pro.monthly",
        "store": "app_store",
        "isActive": true,
        "willRenew": true,
        "expirationDate": "2026-08-01T00:00:00.000Z",
        "periodType": "normal"
      }
    ],
    "firstSeen": "2026-06-01T00:00:00.000Z",
    "lastSeen": "2026-07-10T00:00:00.000Z"
  }
}
''';

const _receiptBody = '''
{
  "customerInfo": {
    "entitlements": {"active": {}, "all": {}},
    "subscriptions": [],
    "firstSeen": "2026-06-01T00:00:00.000Z",
    "lastSeen": "2026-06-01T00:00:00.000Z"
  }
}
''';

void main() {
  late List<http.Request> requests;

  setUp(() => requests = []);

  PurchasesApiClient build(
    MockClient client, {
    String serverUrl = 'https://api.myampix.test',
  }) =>
      PurchasesApiClient(
        client: client,
        serverUrl: serverUrl,
        apiKey: 'mp_pub_test123',
        nowIso8601: () => '2026-07-17T09:00:00.000Z',
      );

  MockClient responder(String body) => MockClient((request) async {
        requests.add(request);
        return http.Response(
          body,
          200,
          headers: {'content-type': 'application/json'},
        );
      });

  test('getOfferings GETs /v1/offerings with the Bearer key and parses current',
      () async {
    final offerings = await build(responder(_offeringsBody)).getOfferings();

    expect(requests.single.method, 'GET');
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/offerings',
    );
    expect(requests.single.headers['Authorization'], 'Bearer mp_pub_test123');
    expect(offerings.current?.identifier, 'default');
    expect(offerings.all.keys, contains('default'));
  });

  test('getOfferings maps {"current": null} to an empty Offerings', () async {
    final offerings =
        await build(responder('{"current": null}')).getOfferings();
    expect(offerings.current, isNull);
    expect(offerings.all, isEmpty);
  });

  test(
      'getSubscriber URL-encodes the id and injects originalAppUserId + '
      'requestDate', () async {
    final info = await build(responder(_subscriberBody))
        .getSubscriber(r'$RCAnonymousID:abc123');

    expect(requests.single.method, 'GET');
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/subscribers/%24RCAnonymousID%3Aabc123',
    );
    expect(info.originalAppUserId, r'$RCAnonymousID:abc123');
    expect(info.requestDate, '2026-07-17T09:00:00.000Z');
    expect(info.firstSeen, '2026-06-01T00:00:00.000Z');
    expect(info.entitlements.active.keys, contains('pro'));
    expect(info.activeSubscriptions, contains('com.myampix.pro.monthly'));
  });

  test(
      'postReceipt POSTs the snake_case receipt body and omits product_id '
      'when null', () async {
    final info = await build(responder(_receiptBody)).postReceipt(
      appUserId: 'user_42',
      platform: 'APP_STORE',
      fetchToken: 'jws-token',
    );

    final request = requests.single;
    expect(request.method, 'POST');
    expect(request.url.toString(), 'https://api.myampix.test/v1/receipts');
    expect(request.headers['Authorization'], 'Bearer mp_pub_test123');
    expect(request.headers['Content-Type'], contains('application/json'));
    expect(jsonDecode(request.body), {
      'app_user_id': 'user_42',
      'platform': 'APP_STORE',
      'fetch_token': 'jws-token',
    });
    expect(info.originalAppUserId, 'user_42');
    expect(info.entitlements.active, isEmpty);
  });

  test('postReceipt includes product_id when provided', () async {
    await build(responder(_receiptBody)).postReceipt(
      appUserId: 'user_42',
      platform: 'PLAY_STORE',
      fetchToken: 'purchase-token',
      productId: 'com.myampix.pro.monthly',
    );

    expect(jsonDecode(requests.single.body), {
      'app_user_id': 'user_42',
      'platform': 'PLAY_STORE',
      'fetch_token': 'purchase-token',
      'product_id': 'com.myampix.pro.monthly',
    });
  });

  test('strips a trailing slash from serverUrl (no //v1)', () async {
    await build(
      responder(_offeringsBody),
      serverUrl: 'https://api.myampix.test/',
    ).getOfferings();
    expect(
      requests.single.url.toString(),
      'https://api.myampix.test/v1/offerings',
    );
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/network/purchases_api_client_test.dart`. Expected: compile error — `Error: Target of URI doesn't exist: 'package:myampix_purchases/src/network/purchases_api_client.dart'` (0 tests run), because the source file does not exist yet.

- [ ] **Step 3: Minimal implementation.** Create `lib/src/network/purchases_api_client.dart`:

```dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/customer_info.dart';
import '../models/offerings.dart';
import '../models/purchases_error.dart';

/// HTTP client for the three `mobile_purchase` public endpoints
/// (`GET /v1/offerings`, `GET /v1/subscribers/:appUserId`,
/// `POST /v1/receipts`), authenticated with the `mp_pub_` public SDK key via
/// `Authorization: Bearer <apiKey>` (server `PublicApiKeyGuard`).
///
/// `originalAppUserId` and `requestDate` are not part of the server body — the
/// client injects the requested id and a stamped fetch time into every
/// [CustomerInfo] it returns.
class PurchasesApiClient {
  PurchasesApiClient({
    required http.Client client,
    required String serverUrl,
    required String apiKey,
    String Function()? nowIso8601,
  })  : _client = client,
        // A trailing slash would yield `//v1/...`; normalize once, here, at the
        // single place serverUrl is consumed (mirrors Uploader).
        _serverUrl = serverUrl.replaceFirst(RegExp(r'/+$'), ''),
        _apiKey = apiKey,
        _nowIso8601 =
            nowIso8601 ?? (() => DateTime.now().toUtc().toIso8601String());

  final http.Client _client;
  final String _serverUrl;
  final String _apiKey;
  final String Function() _nowIso8601;

  Map<String, String> get _authHeaders => {
        'Accept': 'application/json',
        'Authorization': 'Bearer $_apiKey',
      };

  /// `GET /v1/offerings` → `{ current: ResolvedOffering | null }` → [Offerings].
  Future<Offerings> getOfferings() async =>
      Offerings.fromJson(await _get('/v1/offerings'));

  /// `GET /v1/subscribers/:appUserId` → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> getSubscriber(String appUserId) async => _toCustomerInfo(
        await _get('/v1/subscribers/${Uri.encodeComponent(appUserId)}'),
        appUserId,
      );

  /// `POST /v1/receipts { app_user_id, platform, fetch_token, product_id? }`
  /// → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> postReceipt({
    required String appUserId,
    required String platform,
    required String fetchToken,
    String? productId,
  }) async =>
      _toCustomerInfo(
        await _post('/v1/receipts', <String, Object?>{
          'app_user_id': appUserId,
          'platform': platform,
          'fetch_token': fetchToken,
          if (productId != null) 'product_id': productId,
        }),
        appUserId,
      );

  CustomerInfo _toCustomerInfo(Map<String, dynamic> body, String appUserId) {
    final customer =
        (body['customerInfo'] as Map<String, dynamic>?) ?? const {};
    return CustomerInfo.fromJson(
      customer,
      originalAppUserId: appUserId,
      requestDate: _nowIso8601(),
    );
  }

  Future<Map<String, dynamic>> _get(String path) async => _decode(
        await _client.get(Uri.parse('$_serverUrl$path'), headers: _authHeaders),
      );

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, Object?> payload,
  ) async =>
      _decode(
        await _client.post(
          Uri.parse('$_serverUrl$path'),
          headers: {..._authHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode(payload),
        ),
      );

  Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode == 200 || response.statusCode == 201) {
      if (response.body.isEmpty) return const {};
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw const PurchasesError(
      code: PurchasesErrorCode.unknownError,
      message: 'An unknown error occurred.',
    );
  }
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/network/purchases_api_client_test.dart`. Expected: all 6 tests pass.

- [ ] **Step 5: Commit.**
```bash
git add sdk/flutter_purchases/lib/src/network/purchases_api_client.dart \
        sdk/flutter_purchases/test/network/purchases_api_client_test.dart
git commit -m "feat(purchases): add PurchasesApiClient offerings/subscriber/receipt reads"
```

---

### Task 3.2.2: PurchasesApiClient — RFC-7807 status + network → PurchasesError

**Files:**
- Modify `sdk/flutter_purchases/lib/src/network/purchases_api_client.dart`
- Test `sdk/flutter_purchases/test/network/purchases_api_client_errors_test.dart`

**Interfaces:**
- Consumes: `PurchasesError`/`PurchasesErrorCode` (from P3.1); `PurchasesApiClient` (Task 3.2.1).
- Produces: same three public methods as Task 3.2.1, now throwing a typed `PurchasesError` on every non-2xx status and every transport failure (no raw `http`/`SocketException` escapes). Mapping: `401 → configurationError`, `402 → invalidReceiptError`, `409 → productAlreadyPurchasedError`, `503 → storeProblemError`, any other non-2xx `→ unknownError`, transport failure `→ networkError`; `underlyingErrorMessage` = the RFC-7807 `detail` (falling back to `title`, then raw body).

- [ ] **Step 1: Write the failing test.** Create `test/network/purchases_api_client_errors_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/network/purchases_api_client.dart';

void main() {
  PurchasesApiClient build(MockClient client) => PurchasesApiClient(
        client: client,
        serverUrl: 'https://api.myampix.test',
        apiKey: 'mp_pub_test123',
        nowIso8601: () => '2026-07-17T09:00:00.000Z',
      );

  MockClient problem(int status) => MockClient(
        (request) async => http.Response(
          '{"type":"about:blank","title":"error","detail":"boom","status":$status}',
          status,
          headers: {'content-type': 'application/problem+json'},
        ),
      );

  final mappings = <int, PurchasesErrorCode>{
    401: PurchasesErrorCode.configurationError,
    402: PurchasesErrorCode.invalidReceiptError,
    409: PurchasesErrorCode.productAlreadyPurchasedError,
    503: PurchasesErrorCode.storeProblemError,
    500: PurchasesErrorCode.unknownError,
  };

  mappings.forEach((status, expected) {
    test('maps HTTP $status → $expected carrying the RFC-7807 detail', () async {
      await expectLater(
        build(problem(status)).postReceipt(
          appUserId: 'user_42',
          platform: 'APP_STORE',
          fetchToken: 'jws-token',
        ),
        throwsA(
          isA<PurchasesError>()
              .having((e) => e.code, 'code', expected)
              .having(
                (e) => e.underlyingErrorMessage,
                'underlyingErrorMessage',
                'boom',
              ),
        ),
      );
    });
  });

  test('maps a transport failure (offline) → networkError', () async {
    final client = MockClient(
      (request) async => throw const SocketException('offline'),
    );
    await expectLater(
      build(client).getOfferings(),
      throwsA(
        isA<PurchasesError>()
            .having((e) => e.code, 'code', PurchasesErrorCode.networkError),
      ),
    );
  });

  test('401 on getSubscriber also maps to configurationError', () async {
    await expectLater(
      build(problem(401)).getSubscriber('user_42'),
      throwsA(
        isA<PurchasesError>().having(
          (e) => e.code,
          'code',
          PurchasesErrorCode.configurationError,
        ),
      ),
    );
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/network/purchases_api_client_errors_test.dart`. Expected: the four status-mapping tests fail (the Task 3.2.1 `_decode` throws `unknownError` for every non-2xx and never populates `underlyingErrorMessage`, so `code`/`underlyingErrorMessage` mismatch — e.g. `Expected: ... code: invalidReceiptError ... Actual: ... code: unknownError`), and `maps a transport failure ... → networkError` fails because the `SocketException` propagates uncaught instead of a `PurchasesError`.

- [ ] **Step 3: Minimal implementation.** Replace the whole `lib/src/network/purchases_api_client.dart` with the error-mapping version (adds transport `try/catch` to `_get`/`_post`, replaces `_decode`'s bare throw with `_statusError`, and adds `_networkError`/`_problemDetail`/`_messageFor`):

```dart
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/customer_info.dart';
import '../models/offerings.dart';
import '../models/purchases_error.dart';

/// HTTP client for the three `mobile_purchase` public endpoints
/// (`GET /v1/offerings`, `GET /v1/subscribers/:appUserId`,
/// `POST /v1/receipts`), authenticated with the `mp_pub_` public SDK key via
/// `Authorization: Bearer <apiKey>` (server `PublicApiKeyGuard`).
///
/// Every failure is surfaced as a typed [PurchasesError] (design §6): the
/// RFC-7807 HTTP status maps to a [PurchasesErrorCode], and any transport
/// exception (offline/timeout) maps to [PurchasesErrorCode.networkError]. A raw
/// `http`/`SocketException` never escapes to callers.
///
/// `originalAppUserId` and `requestDate` are not part of the server body — the
/// client injects the requested id and a stamped fetch time into every
/// [CustomerInfo] it returns.
class PurchasesApiClient {
  PurchasesApiClient({
    required http.Client client,
    required String serverUrl,
    required String apiKey,
    String Function()? nowIso8601,
  })  : _client = client,
        // A trailing slash would yield `//v1/...`; normalize once, here, at the
        // single place serverUrl is consumed (mirrors Uploader).
        _serverUrl = serverUrl.replaceFirst(RegExp(r'/+$'), ''),
        _apiKey = apiKey,
        _nowIso8601 =
            nowIso8601 ?? (() => DateTime.now().toUtc().toIso8601String());

  final http.Client _client;
  final String _serverUrl;
  final String _apiKey;
  final String Function() _nowIso8601;

  Map<String, String> get _authHeaders => {
        'Accept': 'application/json',
        'Authorization': 'Bearer $_apiKey',
      };

  /// `GET /v1/offerings` → `{ current: ResolvedOffering | null }` → [Offerings].
  Future<Offerings> getOfferings() async =>
      Offerings.fromJson(await _get('/v1/offerings'));

  /// `GET /v1/subscribers/:appUserId` → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> getSubscriber(String appUserId) async => _toCustomerInfo(
        await _get('/v1/subscribers/${Uri.encodeComponent(appUserId)}'),
        appUserId,
      );

  /// `POST /v1/receipts { app_user_id, platform, fetch_token, product_id? }`
  /// → `{ customerInfo }` → [CustomerInfo].
  Future<CustomerInfo> postReceipt({
    required String appUserId,
    required String platform,
    required String fetchToken,
    String? productId,
  }) async =>
      _toCustomerInfo(
        await _post('/v1/receipts', <String, Object?>{
          'app_user_id': appUserId,
          'platform': platform,
          'fetch_token': fetchToken,
          if (productId != null) 'product_id': productId,
        }),
        appUserId,
      );

  CustomerInfo _toCustomerInfo(Map<String, dynamic> body, String appUserId) {
    final customer =
        (body['customerInfo'] as Map<String, dynamic>?) ?? const {};
    return CustomerInfo.fromJson(
      customer,
      originalAppUserId: appUserId,
      requestDate: _nowIso8601(),
    );
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final http.Response response;
    try {
      response = await _client.get(
        Uri.parse('$_serverUrl$path'),
        headers: _authHeaders,
      );
    } on Object catch (error) {
      throw _networkError(error);
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, Object?> payload,
  ) async {
    final http.Response response;
    try {
      response = await _client.post(
        Uri.parse('$_serverUrl$path'),
        headers: {..._authHeaders, 'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
    } on Object catch (error) {
      throw _networkError(error);
    }
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode == 200 || response.statusCode == 201) {
      if (response.body.isEmpty) return const {};
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw _statusError(response);
  }

  PurchasesError _networkError(Object error) => PurchasesError(
        code: PurchasesErrorCode.networkError,
        message: 'A network error occurred while communicating with the server.',
        underlyingErrorMessage: '$error',
      );

  PurchasesError _statusError(http.Response response) {
    final code = switch (response.statusCode) {
      401 => PurchasesErrorCode.configurationError,
      402 => PurchasesErrorCode.invalidReceiptError,
      409 => PurchasesErrorCode.productAlreadyPurchasedError,
      503 => PurchasesErrorCode.storeProblemError,
      _ => PurchasesErrorCode.unknownError,
    };
    return PurchasesError(
      code: code,
      message: _messageFor(code),
      underlyingErrorMessage: _problemDetail(response.body),
    );
  }

  /// Extracts the RFC-7807 `detail` (falling back to `title`, then the raw
  /// body) for the error's `underlyingErrorMessage`.
  String? _problemDetail(String body) {
    if (body.isEmpty) return null;
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map) {
        final detail = decoded['detail'] ?? decoded['title'];
        return (detail ?? body).toString();
      }
    } on FormatException {
      // Not JSON — surface the raw body verbatim.
    }
    return body;
  }

  String _messageFor(PurchasesErrorCode code) => switch (code) {
        PurchasesErrorCode.configurationError =>
          'There is an issue with your configuration.',
        PurchasesErrorCode.invalidReceiptError => 'The receipt is not valid.',
        PurchasesErrorCode.productAlreadyPurchasedError =>
          'This product is already active for the user.',
        PurchasesErrorCode.storeProblemError =>
          'There was a problem with the store.',
        _ => 'An unknown error occurred.',
      };
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/network/`. Expected: both files green (Task 3.2.1's 6 happy-path tests + the 6 error tests here — the 401/402/409/503/500 mappings, the transport-failure test, and the getSubscriber-401 test).

- [ ] **Step 5: Commit.**
```bash
git add sdk/flutter_purchases/lib/src/network/purchases_api_client.dart \
        sdk/flutter_purchases/test/network/purchases_api_client_errors_test.dart
git commit -m "feat(purchases): map RFC-7807 statuses and network failures to PurchasesError"
```

---

### Task 3.2.3: AppUserIdStore — anonymous id + logIn/logOut identity

Defines the small persisted-KV abstraction (co-located here, since `AppUserIdStore`
is its only consumer in the purchases SDK) and the app-user-id store.

**Files:**
- Create `sdk/flutter_purchases/lib/src/identity/app_user_id_store.dart`
- Create `sdk/flutter_purchases/test/helpers/in_memory_key_value_store.dart`
- Test `sdk/flutter_purchases/test/identity/app_user_id_store_test.dart`
- Test `sdk/flutter_purchases/test/identity/app_user_id_store_login_test.dart`

**Interfaces:**
- Consumes: `shared_preferences` (`SharedPreferences`), `uuid` (`Uuid`) — already in `pubspec.yaml` from P3.1.
- Produces:
  - `abstract interface class KeyValueStore { Future<String?> getString(String key); Future<void> setString(String key, String value); Future<void> remove(String key); }`
  - `class SharedPrefsKeyValueStore implements KeyValueStore` with `static Future<SharedPrefsKeyValueStore> open()`
  - `AppUserIdStore({required KeyValueStore store, String Function()? uuidFactory})`
  - `static const String AppUserIdStore.storageKey` (`'mp_app_user_id'`)
  - `static const String AppUserIdStore.anonymousPrefix` (`r'$RCAnonymousID:'`)
  - `static bool AppUserIdStore.isAnonymousId(String id)`
  - `bool get isAnonymous`
  - `Future<String> currentId()` — loads the persisted id or mints + persists a fresh anonymous `$RCAnonymousID:<hex>` on first use
  - `Future<void> setId(String appUserId)` — logIn: persist a caller-supplied id
  - `Future<String> reset()` — logOut: mint + persist a fresh anonymous id, returns it

- [ ] **Step 1: Write the failing test (mint/persist/reuse).** Create the in-memory KV fake `test/helpers/in_memory_key_value_store.dart`:

```dart
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

/// In-memory [KeyValueStore] fake (no `shared_preferences` plugin), mirroring
/// `myampix_analytics`'s test helper of the same name.
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

Create `test/identity/app_user_id_store_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('mints and persists a \$RCAnonymousID: id on first use', () async {
    final store = InMemoryKeyValueStore();
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );

    final id = await ids.currentId();
    expect(id, r'$RCAnonymousID:aaaaaaaabbbb4ccc8dddeeeeeeeeeeee');
    expect(store.values[AppUserIdStore.storageKey], id);
    expect(ids.isAnonymous, isTrue);
  });

  test('reuses the persisted id across instances (no re-mint)', () async {
    final store = InMemoryKeyValueStore();
    final first = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaa-bbbb-4ccc-8ddd-ee',
    );
    final minted = await first.currentId();

    final second = AppUserIdStore(
      store: store,
      uuidFactory: () => 'ffff-9999-4ccc-8ddd-ee',
    );
    expect(await second.currentId(), minted);
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/identity/app_user_id_store_test.dart`. Expected: compile error — `Error: Target of URI doesn't exist: 'package:myampix_purchases/src/identity/app_user_id_store.dart'` (the source file, and therefore `KeyValueStore`/`AppUserIdStore`, do not exist yet).

- [ ] **Step 3: Minimal implementation.** Create `lib/src/identity/app_user_id_store.dart`:

```dart
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// Small persisted string map, abstracted so tests use an in-memory fake.
/// (Purchases mirrors `myampix_analytics`'s `KeyValueStore`; its only consumer
/// here is [AppUserIdStore], so it is co-located rather than in a storage/ dir.)
abstract interface class KeyValueStore {
  Future<String?> getString(String key);
  Future<void> setString(String key, String value);
  Future<void> remove(String key);
}

/// `shared_preferences`-backed [KeyValueStore] for production.
class SharedPrefsKeyValueStore implements KeyValueStore {
  SharedPrefsKeyValueStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<SharedPrefsKeyValueStore> open() async =>
      SharedPrefsKeyValueStore(await SharedPreferences.getInstance());

  @override
  Future<String?> getString(String key) async => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  @override
  Future<void> remove(String key) => _prefs.remove(key);
}

/// Owns the RevenueCat app-user-id (design §4). An anonymous
/// `$RCAnonymousID:<hex>` id is minted + persisted on first use; `logIn`
/// switches to a custom id ([setId]); `logOut` mints a fresh anonymous id
/// ([reset]). All reads/writes go through the injected [KeyValueStore] so the
/// identity transitions are testable with no `shared_preferences` plugin.
class AppUserIdStore {
  AppUserIdStore({required KeyValueStore store, String Function()? uuidFactory})
      : _store = store,
        _uuidFactory = uuidFactory ?? (() => const Uuid().v4());

  /// Persisted-map key for the active app-user-id.
  static const storageKey = 'mp_app_user_id';

  /// RevenueCat's anonymous-id sentinel prefix.
  static const anonymousPrefix = r'$RCAnonymousID:';

  final KeyValueStore _store;
  final String Function() _uuidFactory;

  String? _current;

  /// Whether [id] is an anonymous (`$RCAnonymousID:`) id.
  static bool isAnonymousId(String id) => id.startsWith(anonymousPrefix);

  /// Whether the last-resolved id is anonymous. Reports `true` before the first
  /// [currentId] (the pre-login anonymous default).
  bool get isAnonymous => isAnonymousId(_current ?? anonymousPrefix);

  /// The active app-user-id, loading the persisted value or minting +
  /// persisting a fresh anonymous id on first launch.
  Future<String> currentId() async {
    final existing = _current ?? await _store.getString(storageKey);
    if (existing != null) {
      _current = existing;
      return existing;
    }
    return _persist(_mintAnonymous());
  }

  Future<String> _persist(String id) async {
    _current = id;
    await _store.setString(storageKey, id);
    return id;
  }

  String _mintAnonymous() =>
      '$anonymousPrefix${_uuidFactory().replaceAll('-', '')}';
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/identity/app_user_id_store_test.dart`. Expected: both tests pass.

- [ ] **Step 5: Commit.**
```bash
git add sdk/flutter_purchases/lib/src/identity/app_user_id_store.dart \
        sdk/flutter_purchases/test/helpers/in_memory_key_value_store.dart \
        sdk/flutter_purchases/test/identity/app_user_id_store_test.dart
git commit -m "feat(purchases): add AppUserIdStore anonymous id mint and persist"
```

- [ ] **Step 6: Write the failing test (logIn/logOut).** Create `test/identity/app_user_id_store_login_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/identity/app_user_id_store.dart';

import '../helpers/in_memory_key_value_store.dart';

void main() {
  test('setId (logIn) persists a custom id and clears anonymity', () async {
    final store = InMemoryKeyValueStore();
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'aaaa-bbbb-4ccc-8ddd-ee',
    );
    await ids.currentId();

    await ids.setId('user_42');
    expect(await ids.currentId(), 'user_42');
    expect(store.values[AppUserIdStore.storageKey], 'user_42');
    expect(ids.isAnonymous, isFalse);
  });

  test('reset (logOut) mints a fresh anonymous id, distinct from the prior id',
      () async {
    final store = InMemoryKeyValueStore();
    var n = 0;
    final ids = AppUserIdStore(
      store: store,
      uuidFactory: () => 'id${++n}-bbbb-4ccc-8ddd-ee',
    );
    await ids.setId('user_42');

    final anon = await ids.reset();
    expect(anon, r'$RCAnonymousID:id1bbbb4ccc8dddee');
    expect(anon, isNot('user_42'));
    expect(await ids.currentId(), anon);
    expect(store.values[AppUserIdStore.storageKey], anon);
    expect(ids.isAnonymous, isTrue);
  });
}
```

- [ ] **Step 7: Run to fail.** `flutter test test/identity/app_user_id_store_login_test.dart`. Expected: compile error — `Error: The method 'setId' isn't defined for the class 'AppUserIdStore'` (and the same for `reset`), because Task 3.2.3's Step-3 implementation only defines `currentId`.

- [ ] **Step 8: Minimal implementation.** Add `setId` and `reset` to `lib/src/identity/app_user_id_store.dart` (insert immediately after the `currentId()` method, before `_persist`):

```dart
  /// `logIn`: switch to a caller-supplied id and persist it.
  Future<void> setId(String appUserId) async {
    await _persist(appUserId);
  }

  /// `logOut`: mint + persist a fresh anonymous id, returning it.
  Future<String> reset() async => _persist(_mintAnonymous());
```

- [ ] **Step 9: Run to pass.** `flutter test test/identity/`. Expected: all four identity tests pass (Step-1 mint/persist/reuse + these logIn/logOut transitions).

- [ ] **Step 10: Commit.**
```bash
git add sdk/flutter_purchases/lib/src/identity/app_user_id_store.dart \
        sdk/flutter_purchases/test/identity/app_user_id_store_login_test.dart
git commit -m "feat(purchases): add AppUserIdStore logIn/logOut identity transitions"
```


---

# P3.3 — Facade + orchestration (no native)

> Scope: the `MyAmpixPurchases` static facade for the read/identity path only —
> `configure`, `isConfigured`/`appUserID`/`isAnonymous`, `getCustomerInfo` (+
> `CustomerInfoCache`), `invalidateCustomerInfoCache`, `logIn`/`logOut`, the
> update listeners, the never-crash `_guard`, the `_tail` Future serialization,
> the `@visibleForTesting SdkOverrides` seam, and `shutdownForTesting`/
> `resetForTesting`. Offerings/products/purchase/restore/`canMakePayments`/
> `setLogLevel` and the concrete native channel are **P3.4+** and out of scope.
> The `StoreChannel` is defined here as an **abstract interface** (P3.4
> implements it) and exercised only through a `FakeStoreChannel` in tests.
>
> **Working directory for all commands:** `sdk/flutter_purchases/`.
>
> **Build order:** this section runs after P3.1 (models/enums/`PurchasesError`/
> logger/clock scaffold) and P3.2 (`PurchasesApiClient`, `AppUserIdStore`,
> `KeyValueStore`/`SharedPrefsKeyValueStore`). The exact symbols P3.3 **consumes**
> from those sections (reconcile against their produced signatures):
>
> - **P3.1** — `MyAmpixLogLevel` (enum `{none, error, warn, info, debug}`) and
>   `PurchasesLogger` in `src/util/logger.dart`, where
>   `const PurchasesLogger({MyAmpixLogLevel level})` and
>   `void log(String message, [Object? error, StackTrace? stackTrace])`;
>   `Clock`/`SystemClock` in `src/util/clock.dart` (`DateTime now()`, `int nowMs()`);
>   `PurchasesError` + `PurchasesErrorCode` in `src/models/purchases_error.dart`
>   where `const PurchasesError({required PurchasesErrorCode code, required String message, String? underlyingErrorMessage, bool userCancelled})`;
>   `CustomerInfo` in `src/models/customer_info.dart` exposing
>   `factory CustomerInfo.fromJson(Map<String, Object?> json, {required String originalAppUserId, required String requestDate})`,
>   `EntitlementInfos get entitlements` (with `Map<String, EntitlementInfo> get all`),
>   `List<String> get activeSubscriptions`, `String get originalAppUserId`,
>   `String get firstSeen`, `String? get managementURL`;
>   `LogInResult` in `src/models/login_result.dart` where
>   `const LogInResult({required CustomerInfo customerInfo, required bool created})`.
> - **P3.2** — `KeyValueStore` (abstract: `Future<String?> getString(String)`,
>   `Future<void> setString(String, String)`, `Future<void> remove(String)`) and
>   `SharedPrefsKeyValueStore` with `static Future<SharedPrefsKeyValueStore> open()`
>   in `src/storage/key_value_store.dart`;
>   `AppUserIdStore` in `src/identity/app_user_id_store.dart` where
>   `AppUserIdStore({required KeyValueStore store, required String Function() uuidFactory})`,
>   `Future<void> load({String? configuredAppUserId})`, `String get current`,
>   `bool get isAnonymous`, `Future<void> logIn(String appUserId)`,
>   `Future<void> logOut()` — anonymous ids are `$RCAnonymousID:` + `uuidFactory()`;
>   `PurchasesApiClient` in `src/network/purchases_api_client.dart` where
>   `PurchasesApiClient({required http.Client httpClient, required String apiKey, required String serverUrl, required Clock clock, PurchasesLogger logger})`
>   and `Future<CustomerInfo> getSubscriber(String appUserId)` (stamps the
>   returned `CustomerInfo`'s `originalAppUserId`/`requestDate`; throws
>   `PurchasesError` on transport/status failure).

---

### Task 3.3.1: PurchasesConfiguration

**Files:**
- Create: `sdk/flutter_purchases/lib/src/configuration.dart`
- Test: `sdk/flutter_purchases/test/configuration_test.dart`

**Interfaces:**
- Consumes (P3.1): `MyAmpixLogLevel` from `src/util/logger.dart`.
- Produces: `class PurchasesConfiguration { PurchasesConfiguration({required String apiKey, required String serverUrl, String? appUserID, MyAmpixLogLevel logLevel = MyAmpixLogLevel.warn}); final String apiKey; final String serverUrl; final String? appUserID; final MyAmpixLogLevel logLevel; }` — `serverUrl` has its single trailing slash normalized off; empty `apiKey`/`serverUrl` trip an assert.

- [ ] **Step 1: Write the failing test.** Create `test/configuration_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/util/logger.dart';

void main() {
  test('holds the supplied fields with warn as the default log level', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com',
      appUserID: 'user_bob',
    );
    expect(config.apiKey, 'mp_pub_abc');
    expect(config.serverUrl, 'https://purchases.example.com');
    expect(config.appUserID, 'user_bob');
    expect(config.logLevel, MyAmpixLogLevel.warn);
  });

  test('appUserID defaults to null and logLevel is overridable', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com',
      logLevel: MyAmpixLogLevel.debug,
    );
    expect(config.appUserID, isNull);
    expect(config.logLevel, MyAmpixLogLevel.debug);
  });

  test('normalizes a single trailing slash off serverUrl', () {
    final config = PurchasesConfiguration(
      apiKey: 'mp_pub_abc',
      serverUrl: 'https://purchases.example.com/',
    );
    expect(config.serverUrl, 'https://purchases.example.com');
  });

  test('asserts on empty apiKey and empty serverUrl', () {
    expect(
      () => PurchasesConfiguration(apiKey: '', serverUrl: 'https://x.example'),
      throwsA(isA<AssertionError>()),
    );
    expect(
      () => PurchasesConfiguration(apiKey: 'mp_pub_abc', serverUrl: ''),
      throwsA(isA<AssertionError>()),
    );
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/configuration_test.dart` → fails to compile: `Target of URI doesn't exist: 'package:myampix_purchases/src/configuration.dart'`.

- [ ] **Step 3: Minimal implementation.** Create `lib/src/configuration.dart`:
```dart
import 'util/logger.dart';

/// Immutable configuration passed to [MyAmpixPurchases.configure] (design §7).
///
/// Mirrors RevenueCat's `PurchasesConfiguration` object shape (not the
/// analytics SDK's positional-token `init`). [serverUrl] is the mobile_purchase
/// base URL with any single trailing slash normalized off so the API client can
/// join paths unconditionally.
class PurchasesConfiguration {
  PurchasesConfiguration({
    required this.apiKey,
    required String serverUrl,
    this.appUserID,
    this.logLevel = MyAmpixLogLevel.warn,
  })  : assert(apiKey.length > 0, 'apiKey must not be empty'),
        assert(serverUrl.length > 0, 'serverUrl must not be empty'),
        serverUrl = serverUrl.endsWith('/')
            ? serverUrl.substring(0, serverUrl.length - 1)
            : serverUrl;

  /// The `mp_pub_` public SDK key (required).
  final String apiKey;

  /// mobile_purchase base URL, trailing slash normalized (required).
  final String serverUrl;

  /// Explicit app-user-id; `null` → anonymous `$RCAnonymousID:`.
  final String? appUserID;

  /// Verbosity of the SDK's internal, debug-only logging. Defaults to warn.
  final MyAmpixLogLevel logLevel;
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/configuration_test.dart` → all 4 tests pass.

- [ ] **Step 5: Commit.** `git add lib/src/configuration.dart test/configuration_test.dart && git commit -m "feat(purchases): add PurchasesConfiguration (P3.3)"`

---

### Task 3.3.2: Abstract StoreChannel interface + carrier types + FakeStoreChannel

**Files:**
- Create: `sdk/flutter_purchases/lib/src/store/store_channel.dart`
- Create: `sdk/flutter_purchases/test/helpers/fake_store_channel.dart`
- Test: `sdk/flutter_purchases/test/store/store_channel_test.dart`

**Interfaces:**
- Consumes: none.
- Produces:
  - `abstract interface class StoreChannel { Future<List<StoreProductMetadata>> getProducts(List<String> productIds); Future<StorePurchase> purchase({required String storeProductId, required String appAccountToken}); Future<void> finishTransaction(String transactionId); Future<void> restore(); Future<bool> canMakePayments(); Stream<StoreTransaction> get transactions; }`
  - `class StoreProductMetadata { const StoreProductMetadata({required String storeProductId, required String priceString, required double price, required String currencyCode, required String title, required String description, String? subscriptionPeriodIso8601}); }`
  - `class StorePurchase { const StorePurchase({required String platform, required String fetchToken, required String storeProductId, String? transactionId}); }`
  - `class StoreTransaction { const StoreTransaction({required String platform, required String fetchToken, required String storeProductId, required String transactionId, required String reason}); }`
  - Test helper `FakeStoreChannel implements StoreChannel` (call counters + `emitTransaction`/`dispose`).

- [ ] **Step 1: Write the failing test.** Create `test/store/store_channel_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/store/store_channel.dart';

import '../helpers/fake_store_channel.dart';

void main() {
  test('carrier types hold their fields', () {
    const meta = StoreProductMetadata(
      storeProductId: 'premium_monthly',
      priceString: r'$9.99',
      price: 9.99,
      currencyCode: 'USD',
      title: 'Premium',
      description: 'Premium monthly',
      subscriptionPeriodIso8601: 'P1M',
    );
    expect(meta.storeProductId, 'premium_monthly');
    expect(meta.price, 9.99);
    expect(meta.subscriptionPeriodIso8601, 'P1M');

    const purchase = StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws-token',
      storeProductId: 'premium_monthly',
    );
    expect(purchase.platform, 'APP_STORE');
    expect(purchase.transactionId, isNull);

    const txn = StoreTransaction(
      platform: 'PLAY_STORE',
      fetchToken: 'purchase-token',
      storeProductId: 'premium_monthly',
      transactionId: 'gpa.123',
      reason: 'renewal',
    );
    expect(txn.reason, 'renewal');
  });

  test('FakeStoreChannel conforms to StoreChannel and records calls', () async {
    final channel = FakeStoreChannel();
    final StoreChannel typed = channel;

    expect(await typed.canMakePayments(), isTrue);
    final purchase =
        await typed.purchase(storeProductId: 'p', appAccountToken: 'token');
    expect(purchase.storeProductId, 'p');
    expect(purchase.platform, 'APP_STORE');
    await typed.finishTransaction('tx1');
    await typed.restore();
    expect(await typed.getProducts(const ['p']), isEmpty);

    expect(channel.canMakePaymentsCalls, 1);
    expect(channel.purchaseCalls, 1);
    expect(channel.finishCalls, 1);
    expect(channel.restoreCalls, 1);
    expect(channel.getProductsCalls, 1);
  });

  test('FakeStoreChannel broadcasts emitted transactions', () async {
    final channel = FakeStoreChannel();
    final received = <StoreTransaction>[];
    final sub = channel.transactions.listen(received.add);
    channel.emitTransaction(
      const StoreTransaction(
        platform: 'APP_STORE',
        fetchToken: 'jws',
        storeProductId: 'p',
        transactionId: 'tx',
        reason: 'purchase',
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(received, hasLength(1));
    expect(received.single.reason, 'purchase');
    await sub.cancel();
    await channel.dispose();
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/store/store_channel_test.dart` → fails: `Target of URI doesn't exist: 'package:myampix_purchases/src/store/store_channel.dart'`.

- [ ] **Step 3: Minimal implementation.** Create `lib/src/store/store_channel.dart`:
```dart
import 'dart:async';

/// Localized store metadata for one product, returned by the native
/// `getProducts` call (design §5). The concrete channel that produces these
/// ships in P3.4; P3.3 only defines the contract.
class StoreProductMetadata {
  const StoreProductMetadata({
    required this.storeProductId,
    required this.priceString,
    required this.price,
    required this.currencyCode,
    required this.title,
    required this.description,
    this.subscriptionPeriodIso8601,
  });

  final String storeProductId;
  final String priceString;
  final double price;
  final String currencyCode;
  final String title;
  final String description;
  final String? subscriptionPeriodIso8601;
}

/// The receipt of a native store purchase, before server validation (design §5).
/// `fetchToken` is the iOS StoreKit 2 JWS or the Android purchaseToken.
class StorePurchase {
  const StorePurchase({
    required this.platform,
    required this.fetchToken,
    required this.storeProductId,
    this.transactionId,
  });

  final String platform; // "APP_STORE" | "PLAY_STORE"
  final String fetchToken;
  final String storeProductId;
  final String? transactionId;
}

/// An out-of-band transaction pushed on the native EventChannel (design §5).
class StoreTransaction {
  const StoreTransaction({
    required this.platform,
    required this.fetchToken,
    required this.storeProductId,
    required this.transactionId,
    required this.reason,
  });

  final String platform; // "APP_STORE" | "PLAY_STORE"
  final String fetchToken;
  final String storeProductId;
  final String transactionId;
  final String reason; // "purchase" | "renewal" | "restore"
}

/// Dart-side contract for the native store layer (StoreKit 2 / Play Billing).
///
/// P3.3 defines this seam so the facade can be wired to a fake and never touch
/// a real platform channel in tests; the concrete MethodChannel/EventChannel
/// implementation (and the purchase/offerings orchestration built on top of it)
/// ships in P3.4.
abstract interface class StoreChannel {
  Future<List<StoreProductMetadata>> getProducts(List<String> productIds);
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  });
  Future<void> finishTransaction(String transactionId);
  Future<void> restore();
  Future<bool> canMakePayments();
  Stream<StoreTransaction> get transactions;
}
```
Create `test/helpers/fake_store_channel.dart`:
```dart
import 'dart:async';

import 'package:myampix_purchases/src/store/store_channel.dart';

/// Hand-rolled fake for the P3.3 facade tests: records call counts, returns
/// canned values, and lets a test drive the out-of-band transaction stream.
/// No mocktail/mockito — matches the flutter_analytics test conventions.
class FakeStoreChannel implements StoreChannel {
  int getProductsCalls = 0;
  int purchaseCalls = 0;
  int finishCalls = 0;
  int restoreCalls = 0;
  int canMakePaymentsCalls = 0;

  final StreamController<StoreTransaction> _transactions =
      StreamController<StoreTransaction>.broadcast();

  void emitTransaction(StoreTransaction transaction) =>
      _transactions.add(transaction);

  Future<void> dispose() => _transactions.close();

  @override
  Future<List<StoreProductMetadata>> getProducts(List<String> productIds) async {
    getProductsCalls++;
    return const <StoreProductMetadata>[];
  }

  @override
  Future<StorePurchase> purchase({
    required String storeProductId,
    required String appAccountToken,
  }) async {
    purchaseCalls++;
    return StorePurchase(
      platform: 'APP_STORE',
      fetchToken: 'jws-$appAccountToken',
      storeProductId: storeProductId,
    );
  }

  @override
  Future<void> finishTransaction(String transactionId) async {
    finishCalls++;
  }

  @override
  Future<void> restore() async {
    restoreCalls++;
  }

  @override
  Future<bool> canMakePayments() async {
    canMakePaymentsCalls++;
    return true;
  }

  @override
  Stream<StoreTransaction> get transactions => _transactions.stream;
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/store/store_channel_test.dart` → all 3 tests pass.

- [ ] **Step 5: Commit.** `git add lib/src/store/store_channel.dart test/helpers/fake_store_channel.dart test/store/store_channel_test.dart && git commit -m "feat(purchases): define abstract StoreChannel seam + FakeStoreChannel (P3.3)"`

---

### Task 3.3.3: CustomerInfoCache

**Files:**
- Create: `sdk/flutter_purchases/lib/src/customer_info_cache.dart`
- Create: `sdk/flutter_purchases/test/helpers/fake_clock.dart`
- Test: `sdk/flutter_purchases/test/customer_info_cache_test.dart`

**Interfaces:**
- Consumes (P3.1): `Clock` from `src/util/clock.dart`; `CustomerInfo` from `src/models/customer_info.dart`.
- Produces: `class CustomerInfoCache { CustomerInfoCache({required Clock clock, Duration staleness = const Duration(minutes: 5)}); CustomerInfo? get value; bool get isStale; void store(CustomerInfo info); void invalidate(); void clear(); }`

- [ ] **Step 1: Write the failing test.** Create `test/helpers/fake_clock.dart`:
```dart
import 'package:myampix_purchases/src/util/clock.dart';

/// Deterministic clock driven by tests (mirrors flutter_analytics' FakeClock).
class FakeClock implements Clock {
  FakeClock([DateTime? start]) : _now = start ?? DateTime.utc(2026, 7, 17, 10);

  DateTime _now;

  void advance(Duration duration) => _now = _now.add(duration);

  @override
  DateTime now() => _now;

  @override
  int nowMs() => _now.millisecondsSinceEpoch;
}
```
Create `test/customer_info_cache_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:myampix_purchases/src/customer_info_cache.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';

import 'helpers/fake_clock.dart';

CustomerInfo buildInfo() => CustomerInfo.fromJson(
      const {
        'entitlements': {'all': <String, Object?>{}, 'active': <String, Object?>{}},
        'subscriptions': <Object?>[],
        'firstSeen': '2026-07-17T10:00:00Z',
        'managementURL': null,
      },
      originalAppUserId: 'user_a',
      requestDate: '2026-07-17T10:00:00Z',
    );

void main() {
  test('starts empty and stale', () {
    final cache = CustomerInfoCache(clock: FakeClock());
    expect(cache.value, isNull);
    expect(cache.isStale, isTrue);
  });

  test('store makes it fresh and returns the value; goes stale at the window', () {
    final clock = FakeClock(DateTime.utc(2026, 7, 17, 10));
    final cache =
        CustomerInfoCache(clock: clock, staleness: const Duration(minutes: 5));
    final info = buildInfo();
    cache.store(info);
    expect(identical(cache.value, info), isTrue);
    expect(cache.isStale, isFalse);
    clock.advance(const Duration(minutes: 4, seconds: 59));
    expect(cache.isStale, isFalse);
    clock.advance(const Duration(seconds: 1));
    expect(cache.isStale, isTrue);
  });

  test('invalidate marks stale but keeps the last value', () {
    final cache = CustomerInfoCache(clock: FakeClock());
    final info = buildInfo();
    cache.store(info);
    cache.invalidate();
    expect(cache.isStale, isTrue);
    expect(identical(cache.value, info), isTrue);
  });

  test('clear drops the value', () {
    final cache = CustomerInfoCache(clock: FakeClock());
    cache.store(buildInfo());
    cache.clear();
    expect(cache.value, isNull);
    expect(cache.isStale, isTrue);
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/customer_info_cache_test.dart` → fails: `Target of URI doesn't exist: 'package:myampix_purchases/src/customer_info_cache.dart'`.

- [ ] **Step 3: Minimal implementation.** Create `lib/src/customer_info_cache.dart`:
```dart
import 'models/customer_info.dart';
import 'util/clock.dart';

/// In-memory cache of the latest [CustomerInfo] with a clock-driven staleness
/// window (design §4). RevenueCat pre-fetches; we fetch lazily and cache, so
/// the facade serves a fresh value without a network round-trip and refetches
/// once the value ages past [staleness] or is invalidated.
class CustomerInfoCache {
  CustomerInfoCache({
    required Clock clock,
    Duration staleness = const Duration(minutes: 5),
  })  : _clock = clock,
        _staleness = staleness;

  final Clock _clock;
  final Duration _staleness;

  CustomerInfo? _value;
  int? _cachedAtMs;

  /// The last cached value, or `null` if never stored / cleared.
  CustomerInfo? get value => _value;

  /// True when there is no value, when it was invalidated, or when it has aged
  /// to or past the [staleness] window.
  bool get isStale {
    final cachedAt = _cachedAtMs;
    if (_value == null || cachedAt == null) return true;
    return _clock.nowMs() - cachedAt >= _staleness.inMilliseconds;
  }

  /// Stores [info] and stamps it fresh at the current clock time.
  void store(CustomerInfo info) {
    _value = info;
    _cachedAtMs = _clock.nowMs();
  }

  /// Forces the next read to be treated as stale while keeping the last value
  /// (so listeners/readers still see something until the refetch lands).
  void invalidate() {
    _cachedAtMs = null;
  }

  /// Drops the value entirely (used on identity switches).
  void clear() {
    _value = null;
    _cachedAtMs = null;
  }
}
```

- [ ] **Step 4: Run to pass.** `flutter test test/customer_info_cache_test.dart` → all 4 tests pass.

- [ ] **Step 5: Commit.** `git add lib/src/customer_info_cache.dart test/helpers/fake_clock.dart test/customer_info_cache_test.dart && git commit -m "feat(purchases): add CustomerInfoCache with clock-driven staleness (P3.3)"`

---

### Task 3.3.4: Facade skeleton — SdkOverrides, configure, isConfigured/appUserID/isAnonymous, _guard/_tail, reset/shutdownForTesting

**Files:**
- Create: `sdk/flutter_purchases/lib/src/myampix_purchases.dart`
- Create: `sdk/flutter_purchases/test/helpers/in_memory_key_value_store.dart`
- Modify: `sdk/flutter_purchases/lib/myampix_purchases.dart` (barrel — append facade exports)
- Test: `sdk/flutter_purchases/test/facade_config_test.dart`

**Interfaces:**
- Consumes (P3.1): `PurchasesLogger`/`MyAmpixLogLevel` (`src/util/logger.dart`), `Clock`/`SystemClock` (`src/util/clock.dart`), `PurchasesError`/`PurchasesErrorCode` (`src/models/purchases_error.dart`), `CustomerInfo` (`src/models/customer_info.dart`), `LogInResult` (`src/models/login_result.dart`).
- Consumes (P3.2): `KeyValueStore`/`SharedPrefsKeyValueStore` (`src/storage/key_value_store.dart`), `AppUserIdStore` (`src/identity/app_user_id_store.dart`), `PurchasesApiClient` (`src/network/purchases_api_client.dart`).
- Consumes (P3.3): `PurchasesConfiguration`, `StoreChannel`.
- Produces:
  - `typedef CustomerInfoUpdateListener = void Function(CustomerInfo customerInfo);`
  - `class SdkOverrides { const SdkOverrides({http.Client? httpClient, KeyValueStore? keyValueStore, StoreChannel? storeChannel, Clock? clock, String Function()? uuidFactory}); }` (`@visibleForTesting`)
  - `class MyAmpixPurchases` statics: `static Future<void> configure(PurchasesConfiguration configuration, {@visibleForTesting SdkOverrides? overrides})`, `static Future<bool> get isConfigured`, `static Future<String> get appUserID`, `static Future<bool> get isAnonymous`, `static void resetForTesting()`, `static Future<void> shutdownForTesting()`.

- [ ] **Step 1: Write the failing test.** Create `test/helpers/in_memory_key_value_store.dart`:
```dart
import 'package:myampix_purchases/src/storage/key_value_store.dart';

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
Create `test/facade_config_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/fake_clock.dart';
import 'helpers/fake_store_channel.dart';
import 'helpers/in_memory_key_value_store.dart';

void main() {
  late InMemoryKeyValueStore keyValueStore;
  late FakeClock clock;

  MockClient neverCalled() =>
      MockClient((request) async => fail('unexpected HTTP request to ${request.url}'));

  setUp(() {
    keyValueStore = InMemoryKeyValueStore();
    clock = FakeClock(DateTime.utc(2026, 7, 17, 10));
    MyAmpixPurchases.resetForTesting();
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  Future<void> configure({
    String? appUserID,
    http.Client? client,
    FakeStoreChannel? storeChannel,
    String Function()? uuidFactory,
  }) =>
      MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
          appUserID: appUserID,
        ),
        overrides: SdkOverrides(
          httpClient: client ?? neverCalled(),
          keyValueStore: keyValueStore,
          clock: clock,
          uuidFactory: uuidFactory ?? (() => 'anon0001'),
          storeChannel: storeChannel,
        ),
      );

  test('isConfigured is false before configure', () async {
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });

  test('appUserID throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.appUserID,
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('isAnonymous throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.isAnonymous,
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('configure mints an anonymous app-user-id', () async {
    await configure();
    expect(await MyAmpixPurchases.isConfigured, isTrue);
    expect(await MyAmpixPurchases.appUserID, r'$RCAnonymousID:anon0001');
    expect(await MyAmpixPurchases.isAnonymous, isTrue);
  });

  test('configure adopts an explicit app-user-id', () async {
    await configure(appUserID: 'user_bob');
    expect(await MyAmpixPurchases.appUserID, 'user_bob');
    expect(await MyAmpixPurchases.isAnonymous, isFalse);
  });

  test('configure never touches an injected store channel on the read path', () async {
    final channel = FakeStoreChannel();
    await configure(storeChannel: channel);
    await MyAmpixPurchases.appUserID;
    await MyAmpixPurchases.isAnonymous;
    expect(channel.getProductsCalls, 0);
    expect(channel.purchaseCalls, 0);
    expect(channel.canMakePaymentsCalls, 0);
    await channel.dispose();
  });

  test('a failed configure leaves the SDK unconfigured (never throws)', () async {
    // A throwing key-value store must degrade to "not configured", not throw.
    await MyAmpixPurchases.configure(
      PurchasesConfiguration(apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
      overrides: SdkOverrides(
        httpClient: neverCalled(),
        keyValueStore: _ThrowingKeyValueStore(),
        clock: clock,
        uuidFactory: () => 'anon0001',
      ),
    );
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });
}

class _ThrowingKeyValueStore implements dynamic {
  Future<String?> getString(String key) async => throw StateError('boom');
  Future<void> setString(String key, String value) async => throw StateError('boom');
  Future<void> remove(String key) async => throw StateError('boom');
}
```
> Note: replace the `_ThrowingKeyValueStore` stub's `implements dynamic` with `implements KeyValueStore` and add `import 'package:myampix_purchases/src/storage/key_value_store.dart';` — written here as a self-contained reminder so the failing test compiles once the package exists. Concretely, the class must be:
```dart
// add at top: import 'package:myampix_purchases/src/storage/key_value_store.dart';
class _ThrowingKeyValueStore implements KeyValueStore {
  @override
  Future<String?> getString(String key) async => throw StateError('boom');
  @override
  Future<void> setString(String key, String value) async => throw StateError('boom');
  @override
  Future<void> remove(String key) async => throw StateError('boom');
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/facade_config_test.dart` → fails: `Target of URI doesn't exist: 'package:myampix_purchases/src/myampix_purchases.dart'`.

- [ ] **Step 3: Minimal implementation.** Create `lib/src/myampix_purchases.dart`:
```dart
import 'dart:async';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

import 'configuration.dart';
import 'customer_info_cache.dart';
import 'identity/app_user_id_store.dart';
import 'models/customer_info.dart';
import 'models/login_result.dart';
import 'models/purchases_error.dart';
import 'network/purchases_api_client.dart';
import 'storage/key_value_store.dart';
import 'store/store_channel.dart';
import 'util/clock.dart';
import 'util/logger.dart';

/// Callback fired with the latest [CustomerInfo] whenever it changes (login,
/// logout — and, from P3.4, purchase / out-of-band transactions). A throwing
/// listener never escapes into the SDK. Mirrors RevenueCat's listener typedef.
typedef CustomerInfoUpdateListener = void Function(CustomerInfo customerInfo);

/// Testing-only dependency overrides for [MyAmpixPurchases.configure].
/// Production code must not pass this parameter.
@visibleForTesting
class SdkOverrides {
  const SdkOverrides({
    this.httpClient,
    this.keyValueStore,
    this.storeChannel,
    this.clock,
    this.uuidFactory,
  });

  final http.Client? httpClient;
  final KeyValueStore? keyValueStore;
  final StoreChannel? storeChannel;
  final Clock? clock;
  final String Function()? uuidFactory;
}

/// The RevenueCat-style static facade (design §2). Every internal step is
/// guarded: read/identity methods surface a typed [PurchasesError], listener
/// dispatch never throws, and pre-configure throwing methods raise
/// [PurchasesErrorCode.configurationError]. The purchase/offerings surface
/// ships in P3.4.
class MyAmpixPurchases {
  MyAmpixPurchases._();

  static final MyAmpixPurchases _instance = MyAmpixPurchases._();

  bool _configured = false;
  PurchasesLogger _logger = const PurchasesLogger();
  Clock _clock = const SystemClock();
  PurchasesApiClient? _apiClient;
  AppUserIdStore? _appUserIdStore;
  CustomerInfoCache? _customerInfoCache;
  StoreChannel? _storeChannel;
  final List<CustomerInfoUpdateListener> _listeners = <CustomerInfoUpdateListener>[];

  /// Serializes every guarded call onto one chain so fire-and-forget calls
  /// observe the same ordering a synchronous API would imply (mirrors the
  /// analytics facade's `_tail`). Each step completes normally — it never
  /// rethrows into the chain — so one failure never stalls later calls.
  Future<void> _tail = Future<void>.value();

  // ---- configuration & identity ----

  /// Configures the SDK (design §4). Persists nothing but the app-user-id;
  /// resolves the identity (explicit id, else persisted/minted anonymous
  /// `$RCAnonymousID:`); does NOT block on the network. Never throws: on
  /// failure the SDK stays unconfigured and later calls no-op/throw
  /// configurationError.
  static Future<void> configure(
    PurchasesConfiguration configuration, {
    @visibleForTesting SdkOverrides? overrides,
  }) async {
    final instance = _instance;
    try {
      instance._logger = PurchasesLogger(level: configuration.logLevel);
      instance._clock = overrides?.clock ?? const SystemClock();
      final keyValueStore =
          overrides?.keyValueStore ?? await SharedPrefsKeyValueStore.open();
      final uuidFactory = overrides?.uuidFactory ?? (() => const Uuid().v4());
      final httpClient = overrides?.httpClient ?? http.Client();

      final appUserIdStore =
          AppUserIdStore(store: keyValueStore, uuidFactory: uuidFactory);
      await appUserIdStore.load(configuredAppUserId: configuration.appUserID);
      instance._appUserIdStore = appUserIdStore;

      instance._apiClient = PurchasesApiClient(
        httpClient: httpClient,
        apiKey: configuration.apiKey,
        serverUrl: configuration.serverUrl,
        clock: instance._clock,
        logger: instance._logger,
      );
      instance._customerInfoCache = CustomerInfoCache(clock: instance._clock);
      // The concrete MethodChannel/EventChannel StoreChannel arrives in P3.4;
      // P3.3 only stores an injected fake (or null in production) so a widget
      // test never touches a platform channel.
      instance._storeChannel = overrides?.storeChannel;
      instance._configured = true;
      instance._logger.log(
        'MyAmpixPurchases configured | serverUrl=${configuration.serverUrl} '
        '| appUserID=${appUserIdStore.current} '
        '| anonymous=${appUserIdStore.isAnonymous}',
      );
    } on Object catch (error, stackTrace) {
      instance._logger.log('configure failed; SDK not configured', error, stackTrace);
    }
  }

  /// Whether [configure] has completed. Never throws.
  static Future<bool> get isConfigured => Future<bool>.value(_instance._configured);

  /// The active app-user-id (anonymous or custom). Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<String> get appUserID =>
      _instance._serialize<String>('appUserID', () async {
        _instance._requireConfigured();
        return _instance._appUserIdStore!.current;
      });

  /// Whether the active app-user-id is anonymous. Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<bool> get isAnonymous =>
      _instance._serialize<bool>('isAnonymous', () async {
        _instance._requireConfigured();
        return _instance._appUserIdStore!.isAnonymous;
      });

  // ---- internals ----

  void _requireConfigured() {
    if (!_configured) {
      throw const PurchasesError(
        code: PurchasesErrorCode.configurationError,
        message: 'MyAmpixPurchases.configure has not been called.',
      );
    }
  }

  /// Serializes a value-returning throwing op on [_tail]. Maps an unexpected
  /// error to [PurchasesErrorCode.unknownError]; a [PurchasesError] passes
  /// through unchanged. The chain step always completes normally.
  Future<T> _serialize<T>(String operation, Future<T> Function() body) {
    final completer = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        final result = await body();
        completer.complete(result);
      } on PurchasesError catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      } on Object catch (error, stackTrace) {
        _logger.log('$operation failed', error, stackTrace);
        completer.completeError(
          PurchasesError(
            code: PurchasesErrorCode.unknownError,
            message: '$operation failed',
            underlyingErrorMessage: '$error',
          ),
          stackTrace,
        );
      }
    });
    return completer.future;
  }

  /// Serializes a non-throwing void op on [_tail]. Any error from [body] is
  /// swallowed + logged (never-crash); the returned future always completes.
  Future<void> _guard(String operation, FutureOr<void> Function() body) {
    final completer = Completer<void>();
    _tail = _tail.then((_) async {
      try {
        await body();
      } on Object catch (error, stackTrace) {
        _logger.log('$operation failed', error, stackTrace);
      } finally {
        completer.complete();
      }
    });
    return completer.future;
  }

  /// Fires every listener with [info]; a throwing listener is logged and
  /// skipped so the rest still run and dispatch never crashes.
  void _dispatchUpdate(CustomerInfo info) {
    for (final listener in List<CustomerInfoUpdateListener>.of(_listeners)) {
      try {
        listener(info);
      } on Object catch (error, stackTrace) {
        _logger.log('CustomerInfo update listener threw', error, stackTrace);
      }
    }
  }

  /// Resets all static state between tests (config, cache, listeners, chain).
  @visibleForTesting
  static void resetForTesting() {
    final instance = _instance;
    instance._configured = false;
    instance._apiClient = null;
    instance._appUserIdStore = null;
    instance._customerInfoCache = null;
    instance._storeChannel = null;
    instance._clock = const SystemClock();
    instance._logger = const PurchasesLogger();
    instance._listeners.clear();
    instance._tail = Future<void>.value();
  }

  /// Tears the SDK down between tests. P3.4 cancels its out-of-band transaction
  /// subscription here before the reset; P3.3 has nothing async to cancel.
  @visibleForTesting
  static Future<void> shutdownForTesting() async {
    resetForTesting();
  }
}
```
Then append to the barrel `lib/myampix_purchases.dart`:
```dart
export 'src/configuration.dart' show PurchasesConfiguration;
export 'src/myampix_purchases.dart'
    show MyAmpixPurchases, SdkOverrides, CustomerInfoUpdateListener;
export 'src/store/store_channel.dart'
    show StoreChannel, StoreProductMetadata, StorePurchase, StoreTransaction;
```

- [ ] **Step 4: Run to pass.** `flutter test test/facade_config_test.dart` → all 7 tests pass. Then `flutter analyze` → clean.

- [ ] **Step 5: Commit.** `git add lib/src/myampix_purchases.dart lib/myampix_purchases.dart test/helpers/in_memory_key_value_store.dart test/facade_config_test.dart && git commit -m "feat(purchases): add MyAmpixPurchases facade skeleton — configure, identity getters, guard/tail, test seams (P3.3)"`

---

### Task 3.3.5: getCustomerInfo (+ cache) and invalidateCustomerInfoCache

**Files:**
- Modify: `sdk/flutter_purchases/lib/src/myampix_purchases.dart`
- Create: `sdk/flutter_purchases/test/helpers/subscriber_fixtures.dart`
- Test: `sdk/flutter_purchases/test/facade_customer_info_test.dart`

**Interfaces:**
- Consumes (P3.2): `PurchasesApiClient.getSubscriber(String appUserId)` via an injected `MockClient` (returns the spec §3 `{customerInfo}` envelope).
- Produces: `static Future<CustomerInfo> getCustomerInfo()` (cache-first; refetch when stale/invalidated; throws `configurationError` pre-configure), `static Future<void> invalidateCustomerInfoCache()` (non-throwing; logged no-op pre-configure).

- [ ] **Step 1: Write the failing test.** Create `test/helpers/subscriber_fixtures.dart`:
```dart
/// Spec §3-shaped `GET /v1/subscribers/:appUserId` response envelopes for the
/// facade orchestration tests (driven through MockClient). Parsing itself is
/// P3.1 (`CustomerInfo.fromJson`) / P3.2 (`PurchasesApiClient`); these bodies
/// match the mobile_purchase contract the design pins.
const String subscriberJsonEmpty =
    '{"customerInfo":{"entitlements":{"all":{},"active":{}},'
    '"subscriptions":[],"firstSeen":"2026-07-17T10:00:00Z",'
    '"managementURL":null}}';

const String subscriberJsonActive =
    '{"customerInfo":{"entitlements":{"all":{"premium":{"isActive":true,'
    '"willRenew":true,"periodType":"normal",'
    '"latestPurchaseDate":"2026-07-01T00:00:00Z",'
    '"originalPurchaseDate":"2026-01-01T00:00:00Z",'
    '"expirationDate":"2026-08-01T00:00:00Z","store":"app_store",'
    '"productIdentifier":"premium_monthly","ownershipType":"PURCHASED"}},'
    '"active":{"premium":{"isActive":true,"willRenew":true,'
    '"periodType":"normal","latestPurchaseDate":"2026-07-01T00:00:00Z",'
    '"originalPurchaseDate":"2026-01-01T00:00:00Z",'
    '"expirationDate":"2026-08-01T00:00:00Z","store":"app_store",'
    '"productIdentifier":"premium_monthly","ownershipType":"PURCHASED"}}},'
    '"subscriptions":[{"storeProductId":"premium_monthly","isActive":true,'
    '"expirationDate":"2026-08-01T00:00:00Z"}],'
    '"firstSeen":"2026-01-01T00:00:00Z",'
    '"managementURL":"https://apps.apple.com/account/subscriptions"}}';
```
Create `test/facade_customer_info_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/fake_clock.dart';
import 'helpers/in_memory_key_value_store.dart';
import 'helpers/subscriber_fixtures.dart';

void main() {
  late InMemoryKeyValueStore keyValueStore;
  late FakeClock clock;

  setUp(() {
    keyValueStore = InMemoryKeyValueStore();
    clock = FakeClock(DateTime.utc(2026, 7, 17, 10));
    MyAmpixPurchases.resetForTesting();
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  Future<void> configureWith(http.Client client) => MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
        ),
        overrides: SdkOverrides(
          httpClient: client,
          keyValueStore: keyValueStore,
          clock: clock,
          uuidFactory: () => 'anon0001',
        ),
      );

  test('getCustomerInfo throws configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.getCustomerInfo(),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });

  test('getCustomerInfo fetches once then serves from cache', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(request.url.path, contains('/v1/subscribers/'));
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    final first = await MyAmpixPurchases.getCustomerInfo();
    expect(first.originalAppUserId, r'$RCAnonymousID:anon0001');
    expect(calls, 1);

    final second = await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 1); // served from cache — no second request
    expect(identical(first, second), isTrue);
  });

  test('invalidateCustomerInfoCache forces the next getCustomerInfo to refetch',
      () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 1);
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 2);
  });

  test('invalidateCustomerInfoCache is a no-op before configure (never throws)',
      () async {
    await MyAmpixPurchases.invalidateCustomerInfoCache();
    expect(await MyAmpixPurchases.isConfigured, isFalse);
  });

  test('getCustomerInfo refetches once the cache goes stale', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response(subscriberJsonEmpty, 200);
    });
    await configureWith(client);

    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 1);
    clock.advance(const Duration(minutes: 6)); // past the 5-minute window
    await MyAmpixPurchases.getCustomerInfo();
    expect(calls, 2);
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/facade_customer_info_test.dart` → fails: `The method 'getCustomerInfo' isn't defined for the type 'MyAmpixPurchases'`.

- [ ] **Step 3: Minimal implementation.** In `lib/src/myampix_purchases.dart`, add the customer-info section after the identity getters (before `// ---- internals ----`):
```dart
  // ---- customer info ----

  /// Returns the cached [CustomerInfo] when fresh, else fetches
  /// `GET /v1/subscribers/:appUserId`, caches it, and returns it (design §4).
  /// Throws [PurchasesErrorCode.configurationError] before [configure].
  static Future<CustomerInfo> getCustomerInfo() =>
      _instance._serialize<CustomerInfo>('getCustomerInfo', () async {
        _instance._requireConfigured();
        final cache = _instance._customerInfoCache!;
        final cached = cache.value;
        if (cached != null && !cache.isStale) return cached;
        final info = await _instance._apiClient!
            .getSubscriber(_instance._appUserIdStore!.current);
        cache.store(info);
        return info;
      });

  /// Marks the cached [CustomerInfo] stale so the next [getCustomerInfo]
  /// refetches (design §4). Non-throwing; a logged no-op before [configure].
  static Future<void> invalidateCustomerInfoCache() {
    final instance = _instance;
    if (!instance._configured) {
      instance._logger
          .log('invalidateCustomerInfoCache ignored: configure has not been called.');
      return Future<void>.value();
    }
    return instance._guard('invalidateCustomerInfoCache', () {
      instance._customerInfoCache!.invalidate();
    });
  }
```

- [ ] **Step 4: Run to pass.** `flutter test test/facade_customer_info_test.dart` → all 5 tests pass.

- [ ] **Step 5: Commit.** `git add lib/src/myampix_purchases.dart test/helpers/subscriber_fixtures.dart test/facade_customer_info_test.dart && git commit -m "feat(purchases): add getCustomerInfo (+cache) and invalidateCustomerInfoCache (P3.3)"`

---

### Task 3.3.6: logIn/logOut + CustomerInfo update listeners

**Files:**
- Modify: `sdk/flutter_purchases/lib/src/myampix_purchases.dart`
- Test: `sdk/flutter_purchases/test/facade_identity_test.dart`

**Interfaces:**
- Consumes (P3.2): `AppUserIdStore.logIn(String)` / `AppUserIdStore.logOut()` / `AppUserIdStore.current` / `AppUserIdStore.isAnonymous`; `PurchasesApiClient.getSubscriber` via `MockClient`.
- Consumes (P3.1): `LogInResult`, `CustomerInfo` (`entitlements.all`, `activeSubscriptions`).
- Produces: `static Future<LogInResult> logIn(String appUserID)`, `static Future<CustomerInfo> logOut()`, `static void addCustomerInfoUpdateListener(CustomerInfoUpdateListener listener)`, `static void removeCustomerInfoUpdateListener(CustomerInfoUpdateListener listener)`.

- [ ] **Step 1: Write the failing test.** Create `test/facade_identity_test.dart`:
```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:myampix_purchases/src/configuration.dart';
import 'package:myampix_purchases/src/models/customer_info.dart';
import 'package:myampix_purchases/src/models/purchases_error.dart';
import 'package:myampix_purchases/src/myampix_purchases.dart';

import 'helpers/fake_clock.dart';
import 'helpers/in_memory_key_value_store.dart';
import 'helpers/subscriber_fixtures.dart';

void main() {
  late InMemoryKeyValueStore keyValueStore;
  late FakeClock clock;

  setUp(() {
    keyValueStore = InMemoryKeyValueStore();
    clock = FakeClock(DateTime.utc(2026, 7, 17, 10));
    MyAmpixPurchases.resetForTesting();
  });

  tearDown(() async {
    await MyAmpixPurchases.shutdownForTesting();
  });

  Future<void> configure({
    required http.Client client,
    String? appUserID,
    String Function()? uuidFactory,
  }) =>
      MyAmpixPurchases.configure(
        PurchasesConfiguration(
          apiKey: 'mp_pub_test',
          serverUrl: 'http://localhost:8080',
          appUserID: appUserID,
        ),
        overrides: SdkOverrides(
          httpClient: client,
          keyValueStore: keyValueStore,
          clock: clock,
          uuidFactory: uuidFactory ?? (() => 'anon0001'),
        ),
      );

  MockClient serving(String body) =>
      MockClient((request) async => http.Response(body, 200));

  test('logIn switches the id, caches, and fires the listener', () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final result = await MyAmpixPurchases.logIn('user_alice');
    expect(await MyAmpixPurchases.appUserID, 'user_alice');
    expect(await MyAmpixPurchases.isAnonymous, isFalse);
    expect(result.customerInfo.originalAppUserId, 'user_alice');
    expect(result.created, isTrue); // no prior entitlements
    expect(received, hasLength(1));
    expect(received.single.originalAppUserId, 'user_alice');
  });

  test('logIn reports created=false when the customer already has entitlements',
      () async {
    await configure(client: serving(subscriberJsonActive));
    final result = await MyAmpixPurchases.logIn('user_returning');
    expect(result.created, isFalse);
  });

  test('logOut mints a fresh anonymous id and fires the listener', () async {
    var n = 0;
    await configure(
      client: serving(subscriberJsonEmpty),
      appUserID: 'user_alice',
      uuidFactory: () => 'fresh${n++}',
    );
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final info = await MyAmpixPurchases.logOut();
    expect(await MyAmpixPurchases.isAnonymous, isTrue);
    expect((await MyAmpixPurchases.appUserID).startsWith(r'$RCAnonymousID:'), isTrue);
    expect(info.originalAppUserId.startsWith(r'$RCAnonymousID:'), isTrue);
    expect(received, hasLength(1));
  });

  test('removeCustomerInfoUpdateListener stops delivery', () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    void listener(CustomerInfo info) => received.add(info);
    MyAmpixPurchases.addCustomerInfoUpdateListener(listener);
    MyAmpixPurchases.removeCustomerInfoUpdateListener(listener);

    await MyAmpixPurchases.logIn('user_x');
    expect(received, isEmpty);
  });

  test('a throwing listener never crashes dispatch; others still fire', () async {
    await configure(client: serving(subscriberJsonEmpty));
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener((_) => throw StateError('boom'));
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);

    final result = await MyAmpixPurchases.logIn('user_y');
    expect(result.customerInfo.originalAppUserId, 'user_y');
    expect(received, hasLength(1));
  });

  test('a listener added before configure survives and fires after login',
      () async {
    final received = <CustomerInfo>[];
    MyAmpixPurchases.addCustomerInfoUpdateListener(received.add);
    await configure(client: serving(subscriberJsonEmpty));
    await MyAmpixPurchases.logIn('user_z');
    expect(received, hasLength(1));
  });

  test('logIn and logOut throw configurationError before configure', () async {
    await expectLater(
      MyAmpixPurchases.logIn('x'),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
    await expectLater(
      MyAmpixPurchases.logOut(),
      throwsA(isA<PurchasesError>()
          .having((e) => e.code, 'code', PurchasesErrorCode.configurationError)),
    );
  });
}
```

- [ ] **Step 2: Run to fail.** `flutter test test/facade_identity_test.dart` → fails: `The method 'logIn' isn't defined for the type 'MyAmpixPurchases'`.

- [ ] **Step 3: Minimal implementation.** In `lib/src/myampix_purchases.dart`, add an account-lifecycle section after the customer-info section:
```dart
  // ---- update listeners ----

  /// Registers a listener fired with the latest [CustomerInfo] on identity
  /// changes (and, from P3.4, purchases / out-of-band transactions). Listeners
  /// persist across [configure] and can be added before it. Never throws.
  static void addCustomerInfoUpdateListener(CustomerInfoUpdateListener listener) {
    _instance._listeners.add(listener);
  }

  /// Removes a previously registered listener. Never throws.
  static void removeCustomerInfoUpdateListener(
      CustomerInfoUpdateListener listener) {
    _instance._listeners.remove(listener);
  }

  // ---- account lifecycle ----

  /// Switches the active app-user-id to [appUserID], refetches + caches
  /// [CustomerInfo], and fires the update listeners (design §4). `created` is
  /// the client-side approximation (no server aliasing until P5): the fetched
  /// customer had no entitlements and no active subscriptions. Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<LogInResult> logIn(String appUserID) =>
      _instance._serialize<LogInResult>('logIn', () async {
        _instance._requireConfigured();
        await _instance._appUserIdStore!.logIn(appUserID);
        _instance._customerInfoCache!.clear();
        final info = await _instance._apiClient!
            .getSubscriber(_instance._appUserIdStore!.current);
        _instance._customerInfoCache!.store(info);
        final created = info.entitlements.all.isEmpty &&
            info.activeSubscriptions.isEmpty;
        _instance._dispatchUpdate(info);
        return LogInResult(customerInfo: info, created: created);
      });

  /// Logs the user out: mints a fresh anonymous `$RCAnonymousID:`, refetches +
  /// caches [CustomerInfo], and fires the update listeners (design §4). Throws
  /// [PurchasesErrorCode.configurationError] before [configure].
  static Future<CustomerInfo> logOut() =>
      _instance._serialize<CustomerInfo>('logOut', () async {
        _instance._requireConfigured();
        await _instance._appUserIdStore!.logOut();
        _instance._customerInfoCache!.clear();
        final info = await _instance._apiClient!
            .getSubscriber(_instance._appUserIdStore!.current);
        _instance._customerInfoCache!.store(info);
        _instance._dispatchUpdate(info);
        return info;
      });
```

- [ ] **Step 4: Run to pass.** `flutter test test/facade_identity_test.dart` → all 7 tests pass. Then run the whole suite + analyzer: `flutter test && flutter analyze` → green + clean.

- [ ] **Step 5: Commit.** `git add lib/src/myampix_purchases.dart test/facade_identity_test.dart && git commit -m "feat(purchases): add logIn/logOut + CustomerInfo update listeners (P3.3)"`


---

## P3.4 · Dart store-channel contract + purchase orchestration (fake native)

**Scope:** the Dart side of the native `MethodChannel`/`EventChannel` (`StoreChannel` real impl,
value objects, `TransactionStream`), `getOfferings()` (server offerings + native product
enrichment), `purchasePackage`/`purchaseStoreProduct`, `restorePurchases()`, and the out-of-band
transaction-stream handler. Everything is tested with no real platform against a `FakeStoreChannel`
+ `package:http/testing` `MockClient`, mirroring `myampix_analytics` conventions exactly
(hand-rolled fromJson/parse, injected `package:http` client, MockClient + hand-rolled fakes in
`test/helpers/`, never-crash guards, `_tail` serialization, `@visibleForTesting` seams,
`flutter_lints`/`unawaited_futures`). No codegen, no mocktail/mockito.

### Shared contracts CONSUMED (pinned signatures from earlier sub-projects)

These are authored in P3.1–P3.3, in parallel. This section compiles against exactly these shapes;
the controller reconciles any drift.

**P3.1 (models/enums/errors)** — `lib/src/models/…`:
```dart
// Built by the API client / getOfferings orchestration; only `.identifier` is read here.
class Offerings { factory Offerings.fromJson(Map<String, dynamic> json); Offering? get current; Map<String, Offering> get all; }
class Offering  { String get identifier; Map<String, Object?> get metadata; List<Package> get availablePackages; }
class Package   { String get identifier; PackageType get packageType; StoreProduct get storeProduct; String get offeringIdentifier; }
// StoreProduct.fromJson reads the server product map AND, when present, the native-override keys
// this section injects (priceString/price/currencyCode/title/description/subscriptionPeriodIso8601),
// preferring native and falling back to server priceCents/currency/durationIso8601 (spec §3).
class StoreProduct { String get identifier; String get priceString; double get price; String get currencyCode; String? get subscriptionPeriod; String get title; String get description; }
class CustomerInfo { /* opaque here; passed through */ }
class PurchaseResult { const PurchaseResult({required CustomerInfo customerInfo, required StoreTransaction storeTransaction}); }
class PurchasesError implements Exception {
  const PurchasesError({required PurchasesErrorCode code, required String message, String? underlyingErrorMessage});
  final PurchasesErrorCode code; final String message; final String? underlyingErrorMessage;
  bool get userCancelled; // true iff code == PurchasesErrorCode.purchaseCancelled
}
enum PurchasesErrorCode { purchaseCancelled, paymentPending, productNotAvailableForPurchase, invalidReceipt, productAlreadyPurchased, network, storeProblem, configuration, unknown }
```
> Cross-reference: P3.1's `PurchaseResult.storeTransaction` is typed as the `StoreTransaction`
> **produced by this section** (`lib/src/store/store_transaction.dart`). That file imports nothing
> from `models/`, so there is no import cycle.

**P3.2 (API client)** — `lib/src/network/purchases_api_client.dart`:
```dart
class PurchasesApiClient {
  PurchasesApiClient({required http.Client client, required String serverUrl, required String apiKey});
  Future<Map<String, dynamic>> fetchOfferings();                 // GET /v1/offerings → decoded body { current: {...}|null }
  Future<CustomerInfo> fetchSubscriber(String appUserId);        // GET /v1/subscribers/:id → CustomerInfo
  Future<CustomerInfo> postReceipt({required String appUserId, required String platform, required String fetchToken, required String productId}); // POST /v1/receipts → CustomerInfo; throws PurchasesError on 402/409/503/network
}
```

**P3.3 (facade + fake store seam)** — `lib/src/store/store_channel.dart` + `lib/src/myampix_purchases.dart`:
```dart
// Interface declared by P3.3 (raw channel maps so the value objects stay P3.4-owned).
abstract class StoreChannel {
  Future<List<Map<String, Object?>>> getProducts(List<String> productIds);
  Future<Map<String, Object?>> purchase({required String storeProductId, required String appAccountToken}); // throws PlatformException on cancel/pending/etc.
  Future<void> finishTransaction(String transactionId);
  Future<void> restore();                 // emits restore-tagged txns on `transactions`; no direct return (spec §5)
  Future<bool> canMakePayments();
  Stream<Map<String, Object?>> get transactions;
}
// Facade seams this section wires into (Task 3.4.6):
class MyAmpixPurchases {
  static Future<void> configure(PurchasesConfiguration configuration, {@visibleForTesting PurchasesOverrides? overrides});
  static Future<CustomerInfo> getCustomerInfo();
  static void addCustomerInfoUpdateListener(CustomerInfoUpdateListener listener);
  static Future<void> shutdownForTesting();
  // P3.3-internal (referenced by the Task 3.4.6 edit; adjust to P3.3's actual private names if they differ):
  //   PurchasesApiClient _apiClient; StoreChannel _store; CustomerInfoCache _cache (void set(CustomerInfo));
  //   String _appUserId; void _notifyListeners(CustomerInfo); Future<T> _throwing<T>(String op, Future<T> Function() body);
}
@visibleForTesting class PurchasesOverrides { const PurchasesOverrides({http.Client? httpClient, StoreChannel? storeChannel, KeyValueStore? keyValueStore, String Function()? idFactory}); }
typedef CustomerInfoUpdateListener = void Function(CustomerInfo);
```

### Payload shapes PRODUCED (the Dart↔native contract P3.5/P3.6 implement)

- **`getProducts`** → `invokeMethod('getProducts', {'productIds': List<String>})` → `List<{ storeProductId, priceString, price /*micros→double*/, currencyCode, title, description, subscriptionPeriodIso8601? }>` (not-found omitted).
- **`purchase`** → `invokeMethod('purchase', {'storeProductId': String, 'appAccountToken': String /*uuid*/})` → `{ platform: "APP_STORE"|"PLAY_STORE", fetchToken, storeProductId, transactionId }` **or** `PlatformException(code ∈ userCancelled|paymentPending|productNotAvailable|storeProblem)`. *(Refinement of spec §5: the purchase result carries `transactionId`, which `finishTransaction` requires.)*
- **`finishTransaction`** → `invokeMethod('finishTransaction', {'transactionId': String})`.
- **`restore`** → `invokeMethod('restore')` (emits on the event channel).
- **`canMakePayments`** → `invokeMethod('canMakePayments')` → `bool`.
- **transactions EventChannel** (`myampix_purchases/transactions`) → broadcast of `{ platform, fetchToken, storeProductId, transactionId, reason: "purchase"|"renewal"|"restore" }`.

---

### Task 3.4.1: Store-channel value objects (`StoreProductMetadata`, `StoreTransaction`)

The typed, defensively-parsed embodiments of the native payload shapes. No dependency on P3.1/P3.2/P3.3.

- **Files:**
  - Create `sdk/flutter_purchases/lib/src/store/store_product_metadata.dart`
  - Create `sdk/flutter_purchases/lib/src/store/store_transaction.dart`
  - Test `sdk/flutter_purchases/test/store/store_product_metadata_test.dart`
  - Test `sdk/flutter_purchases/test/store/store_transaction_test.dart`
- **Interfaces:**
  - Consumes: nothing.
  - Produces: `StoreProductMetadata` (`static StoreProductMetadata? parse(Object?)`, `Map<String, Object?> toProductPatch()`, fields `storeProductId/priceString/price/currencyCode/title/description/subscriptionPeriodIso8601`); `StoreTransaction` (`static StoreTransaction? parse(Object?)`, `Map<String, Object?> toJson()`, fields `platform/fetchToken/storeProductId/transactionId/reason`); `enum TransactionReason { purchase, renewal, restore }`.

- [ ] **Step 1: Write failing test for `StoreProductMetadata.parse` / `toProductPatch`.**
  Create `sdk/flutter_purchases/test/store/store_product_metadata_test.dart`:
  ```dart
  import 'package:flutter_test/flutter_test.dart';
  import 'package:myampix_purchases/src/store/store_product_metadata.dart';

  void main() {
    group('StoreProductMetadata.parse', () {
      test('parses a full native getProducts entry (platform-channel Map)', () {
        final m = StoreProductMetadata.parse(<Object?, Object?>{
          'storeProductId': 'com.myampix.pro_month',
          'priceString': r'$9.99',
          'price': 9.99,
          'currencyCode': 'USD',
          'title': 'Pro Monthly',
          'description': 'All the things',
          'subscriptionPeriodIso8601': 'P1M',
        });
        expect(m, isNotNull);
        expect(m!.storeProductId, 'com.myampix.pro_month');
        expect(m.priceString, r'$9.99');
        expect(m.price, 9.99);
        expect(m.currencyCode, 'USD');
        expect(m.title, 'Pro Monthly');
        expect(m.description, 'All the things');
        expect(m.subscriptionPeriodIso8601, 'P1M');
      });

      test('missing optional fields default (empty strings, null period, 0 price)', () {
        final m = StoreProductMetadata.parse(<Object?, Object?>{
          'storeProductId': 'sku_x',
        });
        expect(m, isNotNull);
        expect(m!.priceString, '');
        expect(m.price, 0);
        expect(m.currencyCode, '');
        expect(m.title, '');
        expect(m.description, '');
        expect(m.subscriptionPeriodIso8601, isNull);
      });

      test('int price is coerced to double', () {
        final m = StoreProductMetadata.parse(<Object?, Object?>{
          'storeProductId': 'sku_x',
          'price': 5,
        });
        expect(m!.price, 5.0);
      });

      test('malformed payloads return null and never throw', () {
        expect(StoreProductMetadata.parse(null), isNull);
        expect(StoreProductMetadata.parse('not a map'), isNull);
        expect(StoreProductMetadata.parse(<Object?, Object?>{}), isNull); // no storeProductId
        expect(StoreProductMetadata.parse(<Object?, Object?>{'storeProductId': ''}), isNull);
        expect(StoreProductMetadata.parse(<Object?, Object?>{'storeProductId': 42}), isNull);
      });

      test('toProductPatch emits only the StoreProduct native-override keys', () {
        final patch = StoreProductMetadata.parse(<Object?, Object?>{
          'storeProductId': 'sku_x',
          'priceString': '€4,99',
          'price': 4.99,
          'currencyCode': 'EUR',
          'title': 'T',
          'description': 'D',
        })!.toProductPatch();
        expect(patch, {
          'priceString': '€4,99',
          'price': 4.99,
          'currencyCode': 'EUR',
          'title': 'T',
          'description': 'D',
        });
        expect(patch.containsKey('subscriptionPeriodIso8601'), isFalse); // omitted when null
        expect(patch.containsKey('storeProductId'), isFalse);            // never overrides the id
      });
    });
  }
  ```
- [ ] **Step 2: Run to fail.** `cd sdk/flutter_purchases && flutter test test/store/store_product_metadata_test.dart` → fails: `Error: Couldn't resolve the package 'myampix_purchases'` / `store_product_metadata.dart` does not exist (compile error).
- [ ] **Step 3: Minimal implementation.** Create `sdk/flutter_purchases/lib/src/store/store_product_metadata.dart`:
  ```dart
  /// Parsed native `getProducts` entry — localized store metadata for one
  /// product. The native side (StoreKit 2 `Product` / Play Billing
  /// `ProductDetails`) fills these; the Dart layer merges them onto the server
  /// product JSON via [toProductPatch] before `StoreProduct.fromJson` (spec §4).
  class StoreProductMetadata {
    const StoreProductMetadata({
      required this.storeProductId,
      required this.priceString,
      required this.price,
      required this.currencyCode,
      required this.title,
      required this.description,
      this.subscriptionPeriodIso8601,
    });

    /// Defensive parse of one platform-channel map. Returns null (never throws)
    /// for anything without a non-empty `storeProductId`.
    static StoreProductMetadata? parse(Object? raw) {
      if (raw is! Map) return null;
      final id = raw['storeProductId'];
      if (id is! String || id.isEmpty) return null;
      final period = raw['subscriptionPeriodIso8601'];
      return StoreProductMetadata(
        storeProductId: id,
        priceString: raw['priceString'] is String ? raw['priceString'] as String : '',
        price: _asDouble(raw['price']) ?? 0,
        currencyCode: raw['currencyCode'] is String ? raw['currencyCode'] as String : '',
        title: raw['title'] is String ? raw['title'] as String : '',
        description: raw['description'] is String ? raw['description'] as String : '',
        subscriptionPeriodIso8601: period is String && period.isNotEmpty ? period : null,
      );
    }

    final String storeProductId;
    final String priceString;
    final double price;
    final String currencyCode;
    final String title;
    final String description;
    final String? subscriptionPeriodIso8601;

    /// The native-override keys merged onto the server product map so
    /// `StoreProduct.fromJson` prefers native price/title/period and falls back
    /// to the server's `priceCents`/`currency`/`durationIso8601` (spec §3).
    Map<String, Object?> toProductPatch() => <String, Object?>{
      'priceString': priceString,
      'price': price,
      'currencyCode': currencyCode,
      'title': title,
      'description': description,
      if (subscriptionPeriodIso8601 != null)
        'subscriptionPeriodIso8601': subscriptionPeriodIso8601,
    };

    static double? _asDouble(Object? value) {
      if (value is double) return value;
      if (value is int) return value.toDouble();
      if (value is String) return double.tryParse(value);
      return null;
    }
  }
  ```
- [ ] **Step 4: Run to pass.** `cd sdk/flutter_purchases && flutter test test/store/store_product_metadata_test.dart` → all pass.
- [ ] **Step 5: Write failing test for `StoreTransaction.parse`.**
  Create `sdk/flutter_purchases/test/store/store_transaction_test.dart`:
  ```dart
  import 'package:flutter_test/flutter_test.dart';
  import 'package:myampix_purchases/src/store/store_transaction.dart';

  void main() {
    group('StoreTransaction.parse', () {
      test('parses a direct purchase result (no reason → purchase)', () {
        final t = StoreTransaction.parse(<Object?, Object?>{
          'platform': 'APP_STORE',
          'fetchToken': 'jws.header.payload',
          'storeProductId': 'com.myampix.pro_month',
          'transactionId': '2000000123456789',
        });
        expect(t, isNotNull);
        expect(t!.platform, 'APP_STORE');
        expect(t.fetchToken, 'jws.header.payload');
        expect(t.storeProductId, 'com.myampix.pro_month');
        expect(t.transactionId, '2000000123456789');
        expect(t.reason, TransactionReason.purchase);
      });

      test('parses an out-of-band renewal / restore reason', () {
        expect(
          StoreTransaction.parse(<Object?, Object?>{
            'platform': 'PLAY_STORE', 'fetchToken': 'ptok', 'storeProductId': 'sku',
            'transactionId': 'GPA.1', 'reason': 'renewal',
          })!.reason,
          TransactionReason.renewal,
        );
        expect(
          StoreTransaction.parse(<Object?, Object?>{
            'platform': 'PLAY_STORE', 'fetchToken': 'ptok', 'storeProductId': 'sku',
            'transactionId': 'GPA.2', 'reason': 'restore',
          })!.reason,
          TransactionReason.restore,
        );
      });

      test('unknown reason falls back to purchase', () {
        expect(
          StoreTransaction.parse(<Object?, Object?>{
            'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 's',
            'transactionId': 'x', 'reason': 'lol',
          })!.reason,
          TransactionReason.purchase,
        );
      });

      test('malformed payloads return null and never throw', () {
        expect(StoreTransaction.parse(null), isNull);
        expect(StoreTransaction.parse('nope'), isNull);
        expect(StoreTransaction.parse(<Object?, Object?>{}), isNull);
        expect(StoreTransaction.parse(<Object?, Object?>{ // bad platform
          'platform': 'WEB', 'fetchToken': 't', 'storeProductId': 's', 'transactionId': 'x',
        }), isNull);
        expect(StoreTransaction.parse(<Object?, Object?>{ // empty token
          'platform': 'APP_STORE', 'fetchToken': '', 'storeProductId': 's', 'transactionId': 'x',
        }), isNull);
        expect(StoreTransaction.parse(<Object?, Object?>{ // missing transactionId
          'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 's',
        }), isNull);
      });

      test('toJson round-trips the wire shape', () {
        final t = StoreTransaction.parse(<Object?, Object?>{
          'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 's',
          'transactionId': 'x', 'reason': 'restore',
        })!;
        expect(t.toJson(), {
          'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 's',
          'transactionId': 'x', 'reason': 'restore',
        });
      });
    });
  }
  ```
- [ ] **Step 6: Run to fail.** `cd sdk/flutter_purchases && flutter test test/store/store_transaction_test.dart` → compile error: `store_transaction.dart` / `StoreTransaction` not found.
- [ ] **Step 7: Minimal implementation.** Create `sdk/flutter_purchases/lib/src/store/store_transaction.dart`:
  ```dart
  /// Why a transaction reached the Dart layer (spec §5 `reason`).
  enum TransactionReason { purchase, renewal, restore }

  /// A store transaction surfaced by the native layer — the receipt the Dart
  /// side posts to `mobile_purchase` (`fetchToken` is a StoreKit 2 JWS on iOS,
  /// a Play Billing `purchaseToken` on Android). Used both as a direct
  /// `purchase` result and as an out-of-band `transactions` event, and exposed
  /// on the public `PurchaseResult.storeTransaction`.
  class StoreTransaction {
    const StoreTransaction({
      required this.platform,
      required this.fetchToken,
      required this.storeProductId,
      required this.transactionId,
      required this.reason,
    });

    /// Defensive parse of a platform-channel map. Returns null (never throws)
    /// on any missing/typed-wrong required field. Absent `reason` → `purchase`
    /// (a direct buy result carries no reason).
    static StoreTransaction? parse(Object? raw) {
      if (raw is! Map) return null;
      final platform = raw['platform'];
      final fetchToken = raw['fetchToken'];
      final storeProductId = raw['storeProductId'];
      final transactionId = raw['transactionId'];
      if (platform != 'APP_STORE' && platform != 'PLAY_STORE') return null;
      if (fetchToken is! String || fetchToken.isEmpty) return null;
      if (storeProductId is! String || storeProductId.isEmpty) return null;
      if (transactionId is! String || transactionId.isEmpty) return null;
      return StoreTransaction(
        platform: platform as String,
        fetchToken: fetchToken,
        storeProductId: storeProductId,
        transactionId: transactionId,
        reason: _reasonFrom(raw['reason']),
      );
    }

    final String platform;
    final String fetchToken;
    final String storeProductId;
    final String transactionId;
    final TransactionReason reason;

    Map<String, Object?> toJson() => <String, Object?>{
      'platform': platform,
      'fetchToken': fetchToken,
      'storeProductId': storeProductId,
      'transactionId': transactionId,
      'reason': reason.name,
    };

    static TransactionReason _reasonFrom(Object? value) {
      switch (value) {
        case 'renewal':
          return TransactionReason.renewal;
        case 'restore':
          return TransactionReason.restore;
        default:
          return TransactionReason.purchase;
      }
    }
  }
  ```
- [ ] **Step 8: Run to pass.** `cd sdk/flutter_purchases && flutter test test/store/store_transaction_test.dart` → all pass.
- [ ] **Step 9: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/store/store_product_metadata.dart lib/src/store/store_transaction.dart \
          test/store/store_product_metadata_test.dart test/store/store_transaction_test.dart
  git commit -m "feat(purchases): store-channel value objects (StoreProductMetadata, StoreTransaction)"
  ```

---

### Task 3.4.2: Real `MethodChannelStoreChannel` (injectable-channel test seam)

The `StoreChannel` implementation backed by `MethodChannel('myampix_purchases/methods')` +
`EventChannel('myampix_purchases/transactions')`, with `@visibleForTesting` injection so it is
driven by a mock method channel + a fake event stream with no real platform.

- **Files:**
  - Create `sdk/flutter_purchases/lib/src/store/method_channel_store_channel.dart`
  - Test `sdk/flutter_purchases/test/store/method_channel_store_channel_test.dart`
  - (References `lib/src/store/store_channel.dart` — the P3.3 interface. If P3.4 runs before P3.3 finalizes it, create that file with exactly the `abstract class StoreChannel` signature in "Shared contracts CONSUMED".)
- **Interfaces:**
  - Consumes: `abstract class StoreChannel` (P3.3).
  - Produces: `class MethodChannelStoreChannel implements StoreChannel` with `MethodChannelStoreChannel({@visibleForTesting MethodChannel? methodChannel, @visibleForTesting Stream<dynamic>? transactionEvents})`, and `static const String methodsChannelName`, `transactionsChannelName`.

- [ ] **Step 1: Write failing test.** Create `sdk/flutter_purchases/test/store/method_channel_store_channel_test.dart`:
  ```dart
  import 'dart:async';

  import 'package:flutter/services.dart';
  import 'package:flutter_test/flutter_test.dart';
  import 'package:myampix_purchases/src/store/method_channel_store_channel.dart';

  void main() {
    TestWidgetsFlutterBinding.ensureInitialized();

    final channel = MethodChannel(MethodChannelStoreChannel.methodsChannelName);
    late List<MethodCall> calls;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

    void handle(Future<Object?>? Function(MethodCall call) handler) =>
        messenger.setMockMethodCallHandler(channel, handler);

    setUp(() => calls = []);
    tearDown(() => messenger.setMockMethodCallHandler(channel, null));

    test('getProducts sends {productIds} and coerces the result list of maps', () async {
      handle((call) async {
        calls.add(call);
        return <Object?>[
          <Object?, Object?>{'storeProductId': 'a', 'priceString': r'$1', 'price': 1.0, 'currencyCode': 'USD', 'title': 'A', 'description': 'd'},
        ];
      });
      final store = MethodChannelStoreChannel();

      final result = await store.getProducts(['a', 'b']);

      expect(calls.single.method, 'getProducts');
      expect(calls.single.arguments, {'productIds': ['a', 'b']});
      expect(result, hasLength(1));
      expect(result.single['storeProductId'], 'a');
      expect(result.single, isA<Map<String, Object?>>());
    });

    test('getProducts tolerates a null native return', () async {
      handle((call) async => null);
      expect(await MethodChannelStoreChannel().getProducts(['a']), isEmpty);
    });

    test('purchase sends {storeProductId, appAccountToken} and coerces the map', () async {
      handle((call) async {
        calls.add(call);
        return <Object?, Object?>{
          'platform': 'APP_STORE', 'fetchToken': 'jws', 'storeProductId': 'a', 'transactionId': 'tx1',
        };
      });
      final store = MethodChannelStoreChannel();

      final result = await store.purchase(storeProductId: 'a', appAccountToken: 'uuid-1');

      expect(calls.single.method, 'purchase');
      expect(calls.single.arguments, {'storeProductId': 'a', 'appAccountToken': 'uuid-1'});
      expect(result, isA<Map<String, Object?>>());
      expect(result['transactionId'], 'tx1');
    });

    test('purchase propagates a PlatformException (e.g. userCancelled)', () async {
      handle((call) async => throw PlatformException(code: 'userCancelled'));
      expect(
        () => MethodChannelStoreChannel().purchase(storeProductId: 'a', appAccountToken: 'u'),
        throwsA(isA<PlatformException>().having((e) => e.code, 'code', 'userCancelled')),
      );
    });

    test('finishTransaction sends {transactionId}', () async {
      handle((call) async { calls.add(call); return null; });
      await MethodChannelStoreChannel().finishTransaction('tx1');
      expect(calls.single.method, 'finishTransaction');
      expect(calls.single.arguments, {'transactionId': 'tx1'});
    });

    test('restore sends restore; canMakePayments returns the bool (null → false)', () async {
      handle((call) async { calls.add(call); return call.method == 'canMakePayments' ? true : null; });
      final store = MethodChannelStoreChannel();
      await store.restore();
      expect(await store.canMakePayments(), isTrue);
      expect(calls.map((c) => c.method), containsAll(<String>['restore', 'canMakePayments']));
    });

    test('transactions coerces event maps and drops non-maps', () async {
      final controller = StreamController<dynamic>.broadcast();
      final store = MethodChannelStoreChannel(transactionEvents: controller.stream);
      final seen = <Map<String, Object?>>[];
      final sub = store.transactions.listen(seen.add);

      controller
        ..add(<Object?, Object?>{'platform': 'APP_STORE', 'transactionId': 'tx1'})
        ..add('garbage')
        ..add(42);
      await pumpEventQueue();

      expect(seen, hasLength(1));
      expect(seen.single, isA<Map<String, Object?>>());
      expect(seen.single['transactionId'], 'tx1');
      await sub.cancel();
      await controller.close();
    });
  }
  ```
- [ ] **Step 2: Run to fail.** `cd sdk/flutter_purchases && flutter test test/store/method_channel_store_channel_test.dart` → compile error: `method_channel_store_channel.dart` / `MethodChannelStoreChannel` not found.
- [ ] **Step 3: Minimal implementation.** Create `sdk/flutter_purchases/lib/src/store/method_channel_store_channel.dart`:
  ```dart
  import 'package:flutter/foundation.dart' show visibleForTesting;
  import 'package:flutter/services.dart';

  import 'store_channel.dart';

  /// The production [StoreChannel]: a `MethodChannel` for Dart→native
  /// request/response and an `EventChannel` broadcast for native→Dart
  /// transaction pushes (spec §5). Holds no server URL or key — it only
  /// surfaces store products and receipts. Both channels have a
  /// `@visibleForTesting` seam so the orchestration is driven with no platform.
  class MethodChannelStoreChannel implements StoreChannel {
    MethodChannelStoreChannel({
      @visibleForTesting MethodChannel? methodChannel,
      @visibleForTesting Stream<dynamic>? transactionEvents,
    }) : _methods = methodChannel ?? const MethodChannel(methodsChannelName),
         _events = transactionEvents ??
             const EventChannel(transactionsChannelName).receiveBroadcastStream();

    static const String methodsChannelName = 'myampix_purchases/methods';
    static const String transactionsChannelName = 'myampix_purchases/transactions';

    final MethodChannel _methods;
    final Stream<dynamic> _events;

    @override
    Future<List<Map<String, Object?>>> getProducts(List<String> productIds) async {
      final result = await _methods.invokeMethod<List<dynamic>>(
        'getProducts',
        <String, Object?>{'productIds': productIds},
      );
      if (result == null) return const <Map<String, Object?>>[];
      return <Map<String, Object?>>[
        for (final entry in result)
          if (entry is Map) _coerce(entry),
      ];
    }

    @override
    Future<Map<String, Object?>> purchase({
      required String storeProductId,
      required String appAccountToken,
    }) async {
      final result = await _methods.invokeMethod<Map<dynamic, dynamic>>(
        'purchase',
        <String, Object?>{
          'storeProductId': storeProductId,
          'appAccountToken': appAccountToken,
        },
      );
      return _coerce(result ?? const <dynamic, dynamic>{});
    }

    @override
    Future<void> finishTransaction(String transactionId) => _methods.invokeMethod<void>(
      'finishTransaction',
      <String, Object?>{'transactionId': transactionId},
    );

    @override
    Future<void> restore() => _methods.invokeMethod<void>('restore');

    @override
    Future<bool> canMakePayments() async =>
        (await _methods.invokeMethod<bool>('canMakePayments')) ?? false;

    @override
    Stream<Map<String, Object?>> get transactions =>
        _events.where((event) => event is Map).map((event) => _coerce(event as Map));

    static Map<String, Object?> _coerce(Map<dynamic, dynamic> raw) =>
        raw.map((key, value) => MapEntry('$key', value));
  }
  ```
- [ ] **Step 4: Run to pass.** `cd sdk/flutter_purchases && flutter test test/store/method_channel_store_channel_test.dart` → all pass.
- [ ] **Step 5: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/store/method_channel_store_channel.dart test/store/method_channel_store_channel_test.dart
  git commit -m "feat(purchases): MethodChannel/EventChannel-backed StoreChannel with test seam"
  ```

---

### Task 3.4.3: `getOfferings()` — server offerings + native product enrichment

`OfferingsService`: `GET /v1/offerings` → collect the packages' `storeProductId`s → native
`getProducts` → merge native metadata onto each product map → `Offerings.fromJson` → cache. Also
introduces the shared `FakeStoreChannel` test helper.

- **Files:**
  - Create `sdk/flutter_purchases/lib/src/offerings_service.dart`
  - Create `sdk/flutter_purchases/test/helpers/fake_store_channel.dart`
  - Test `sdk/flutter_purchases/test/offerings_service_test.dart`
- **Interfaces:**
  - Consumes: `PurchasesApiClient.fetchOfferings()` (P3.2); `StoreChannel.getProducts` (P3.3 iface); `Offerings.fromJson` / `StoreProduct` (P3.1); `StoreProductMetadata` (3.4.1).
  - Produces: `class OfferingsService { OfferingsService({required PurchasesApiClient apiClient, required StoreChannel store, MamLogger logger}); Future<Offerings> getOfferings(); }`; test helper `FakeStoreChannel implements StoreChannel`.

- [ ] **Step 1: Write the `FakeStoreChannel` helper** (no test yet — support code).
  Create `sdk/flutter_purchases/test/helpers/fake_store_channel.dart`:
  ```dart
  import 'dart:async';

  import 'package:flutter/services.dart' show PlatformException;
  import 'package:myampix_purchases/src/store/store_channel.dart';

  /// Hand-rolled fake of the native store channel (no mocktail). Records
  /// finish/purchase calls, returns canned getProducts/purchase results, throws
  /// a canned PlatformException, and drives the out-of-band `transactions`
  /// stream (restore replays [restoreEmissions]).
  class FakeStoreChannel implements StoreChannel {
    final StreamController<Map<String, Object?>> _transactions =
        StreamController<Map<String, Object?>>.broadcast();

    List<Map<String, Object?>> productsResult = const [];
    Map<String, Object?>? purchaseResult;
    PlatformException? purchaseError;
    bool payments = true;
    List<Map<String, Object?>> restoreEmissions = const [];

    final List<String> finished = [];
    final List<Map<String, Object?>> purchaseCalls = [];
    final List<List<String>> getProductsCalls = [];
    bool restoreCalled = false;

    @override
    Future<List<Map<String, Object?>>> getProducts(List<String> productIds) async {
      getProductsCalls.add(productIds);
      return productsResult;
    }

    @override
    Future<Map<String, Object?>> purchase({
      required String storeProductId,
      required String appAccountToken,
    }) async {
      purchaseCalls.add({'storeProductId': storeProductId, 'appAccountToken': appAccountToken});
      if (purchaseError != null) throw purchaseError!;
      final result = purchaseResult;
      if (result == null) throw StateError('FakeStoreChannel.purchaseResult not set');
      return result;
    }

    @override
    Future<void> finishTransaction(String transactionId) async => finished.add(transactionId);

    @override
    Future<void> restore() async {
      restoreCalled = true;
      for (final emission in restoreEmissions) {
        _transactions.add(emission);
      }
    }

    @override
    Future<bool> canMakePayments() async => payments;

    @override
    Stream<Map<String, Object?>> get transactions => _transactions.stream;

    /// Push an out-of-band transaction (renewal / interrupted purchase).
    void emit(Map<String, Object?> transaction) => _transactions.add(transaction);

    Future<void> dispose() => _transactions.close();
  }
  ```
- [ ] **Step 2: Write failing test for `OfferingsService`.**
  Create `sdk/flutter_purchases/test/offerings_service_test.dart`:
  ```dart
  import 'dart:convert';

  import 'package:flutter_test/flutter_test.dart';
  import 'package:http/http.dart' as http;
  import 'package:http/testing.dart';
  import 'package:myampix_purchases/src/network/purchases_api_client.dart';
  import 'package:myampix_purchases/src/offerings_service.dart';

  import 'helpers/fake_store_channel.dart';

  /// The exact `GET /v1/offerings` body shape (spec §3): a single current
  /// offering with server-side product fields (priceCents/currency/durationIso8601).
  Map<String, dynamic> _offeringsJson() => {
    'current': {
      'identifier': 'default',
      'metadata': {'hero': 'blue'},
      'packages': [
        {
          'identifier': r'$rc_monthly',
          'packageType': 'monthly',
          'product': {
            'storeProductId': 'com.myampix.pro_month',
            'type': 'autoRenewableSubscription',
            'priceCents': 999,
            'currency': 'USD',
            'durationIso8601': 'P1M',
            'entitlements': ['pro'],
          },
        },
      ],
    },
  };

  void main() {
    late FakeStoreChannel store;
    late List<http.Request> requests;

    setUp(() {
      store = FakeStoreChannel();
      requests = [];
    });
    tearDown(() => store.dispose());

    PurchasesApiClient apiWith(Map<String, dynamic> body) => PurchasesApiClient(
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode(body), 200,
            headers: {'content-type': 'application/json'});
      }),
      serverUrl: 'http://localhost:8080',
      apiKey: 'mp_pub_test',
    );

    OfferingsService build(PurchasesApiClient api) =>
        OfferingsService(apiClient: api, store: store);

    test('enriches each StoreProduct with native price/title after asking '
        'getProducts for the collected ids', () async {
      store.productsResult = [
        {
          'storeProductId': 'com.myampix.pro_month',
          'priceString': r'$9.99',
          'price': 9.99,
          'currencyCode': 'USD',
          'title': 'Pro Monthly',
          'description': 'Everything',
          'subscriptionPeriodIso8601': 'P1M',
        },
      ];

      final offerings = await build(apiWith(_offeringsJson())).getOfferings();

      expect(store.getProductsCalls.single, ['com.myampix.pro_month']);
      final product = offerings.current!.availablePackages.single.storeProduct;
      expect(product.identifier, 'com.myampix.pro_month');
      expect(product.priceString, r'$9.99');
      expect(product.price, 9.99);
      expect(product.title, 'Pro Monthly');
      expect(product.subscriptionPeriod, 'P1M');
    });

    test('when native returns nothing, StoreProduct falls back to server price', () async {
      store.productsResult = const []; // native unavailable

      final offerings = await build(apiWith(_offeringsJson())).getOfferings();

      final product = offerings.current!.availablePackages.single.storeProduct;
      // Server fallback (StoreProduct.fromJson: priceCents 999 / currency USD).
      expect(product.currencyCode, 'USD');
      expect(product.price, 9.99);
      expect(product.title, ''); // native-only field, empty without native
    });

    test('caches after first fetch (second call issues no new HTTP nor getProducts)', () async {
      store.productsResult = const [];
      final service = build(apiWith(_offeringsJson()));

      await service.getOfferings();
      await service.getOfferings();

      expect(requests, hasLength(1));
      expect(store.getProductsCalls, hasLength(1));
    });

    test('a null current yields empty offerings and never touches native', () async {
      final offerings = await build(apiWith({'current': null})).getOfferings();
      expect(offerings.current, isNull);
      expect(store.getProductsCalls, isEmpty);
    });
  }
  ```
- [ ] **Step 3: Run to fail.** `cd sdk/flutter_purchases && flutter test test/offerings_service_test.dart` → compile error: `offerings_service.dart` / `OfferingsService` not found.
- [ ] **Step 4: Minimal implementation.** Create `sdk/flutter_purchases/lib/src/offerings_service.dart`:
  ```dart
  import 'models/offerings.dart';
  import 'network/purchases_api_client.dart';
  import 'store/store_channel.dart';
  import 'store/store_product_metadata.dart';
  import 'util/logger.dart';

  /// Fetches offerings from `mobile_purchase` and enriches each product with
  /// native store metadata (spec §4). The server ships the catalog fields
  /// (priceCents/currency/durationIso8601); the native layer supplies the
  /// localized priceString/title/description/period. Cached in memory after the
  /// first successful fetch (RevenueCat pre-fetches; we fetch lazily + cache).
  class OfferingsService {
    OfferingsService({
      required PurchasesApiClient apiClient,
      required StoreChannel store,
      MamLogger logger = const MamLogger(),
    }) : _apiClient = apiClient,
         _store = store,
         _logger = logger;

    final PurchasesApiClient _apiClient;
    final StoreChannel _store;
    final MamLogger _logger;

    Offerings? _cache;

    Future<Offerings> getOfferings() async {
      final cached = _cache;
      if (cached != null) return cached;
      final body = await _apiClient.fetchOfferings();
      final offerings = await _enrich(body);
      _cache = offerings;
      return offerings;
    }

    /// Merges native `getProducts` metadata onto the raw server product maps in
    /// place, then builds the models via `Offerings.fromJson`. Building AFTER
    /// the merge is what lets `StoreProduct.fromJson` prefer native fields and
    /// fall back to the server ones (spec §3).
    Future<Offerings> _enrich(Map<String, dynamic> body) async {
      final current = body['current'];
      if (current is! Map) return Offerings.fromJson(body);

      final packages = current['packages'];
      final productMaps = <Map<String, dynamic>>[
        if (packages is List)
          for (final package in packages)
            if (package is Map && package['product'] is Map)
              (package['product'] as Map).cast<String, dynamic>(),
      ];
      final ids = <String>[
        for (final product in productMaps)
          if (product['storeProductId'] is String) product['storeProductId'] as String,
      ];

      if (ids.isNotEmpty) {
        final byId = <String, StoreProductMetadata>{};
        for (final entry in await _store.getProducts(ids)) {
          final metadata = StoreProductMetadata.parse(entry);
          if (metadata != null) byId[metadata.storeProductId] = metadata;
        }
        for (final product in productMaps) {
          final metadata = byId[product['storeProductId']];
          if (metadata != null) product.addAll(metadata.toProductPatch());
        }
        _logger.log('getOfferings: enriched ${byId.length}/${ids.length} product(s) from native');
      }

      return Offerings.fromJson(body);
    }
  }
  ```
  > Note: the `import 'models/offerings.dart';`, `network/purchases_api_client.dart`, and
  > `util/logger.dart` paths are the P3.1/P3.2/P3.3 files; adjust if their final locations differ.
  > `productMaps` holds `.cast<String, dynamic>()` **views** over the decoded body, so `addAll`
  > mutates the same maps `Offerings.fromJson(body)` then reads.
- [ ] **Step 5: Run to pass.** `cd sdk/flutter_purchases && flutter test test/offerings_service_test.dart` → all pass.
- [ ] **Step 6: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/offerings_service.dart test/offerings_service_test.dart test/helpers/fake_store_channel.dart
  git commit -m "feat(purchases): getOfferings with native product enrichment + FakeStoreChannel"
  ```

---

### Task 3.4.4: `PurchaseController` — purchase orchestration + §6 error mapping

Native purchase → `POST /v1/receipts` → cache/listener → finish, with error mapping (userCancelled
et al.) and the "server failed after store purchase ⇒ leave the transaction unfinished" rule (§4).

- **Files:**
  - Create `sdk/flutter_purchases/lib/src/purchase_controller.dart`
  - Test `sdk/flutter_purchases/test/purchase_controller_test.dart`
- **Interfaces:**
  - Consumes: `PurchasesApiClient.postReceipt` (P3.2); `StoreChannel.purchase/finishTransaction` (P3.3 iface); `Package`/`StoreProduct`/`PurchaseResult`/`CustomerInfo`/`PurchasesError`/`PurchasesErrorCode` (P3.1); `StoreTransaction` (3.4.1).
  - Produces:
    ```dart
    class PurchaseController {
      PurchaseController({
        required PurchasesApiClient apiClient,
        required StoreChannel store,
        required String Function() appUserId,
        required void Function(CustomerInfo) onCustomerInfoUpdated,
        String Function(String appUserId)? appAccountTokenFactory,
        MamLogger logger,
      });
      Future<PurchaseResult> purchasePackage(Package packageToPurchase);
      Future<PurchaseResult> purchaseStoreProduct(StoreProduct product);
    }
    ```

- [ ] **Step 1: Write failing test.**
  Create `sdk/flutter_purchases/test/purchase_controller_test.dart`:
  ```dart
  import 'dart:convert';

  import 'package:flutter/services.dart' show PlatformException;
  import 'package:flutter_test/flutter_test.dart';
  import 'package:http/http.dart' as http;
  import 'package:http/testing.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';
  import 'package:myampix_purchases/src/network/purchases_api_client.dart';
  import 'package:myampix_purchases/src/purchase_controller.dart';

  import 'helpers/fake_store_channel.dart';
  import 'helpers/purchase_fixtures.dart';

  void main() {
    late FakeStoreChannel store;
    late List<http.Request> receiptPosts;
    late List<CustomerInfo> notified;

    setUp(() {
      store = FakeStoreChannel();
      receiptPosts = [];
      notified = [];
    });
    tearDown(() => store.dispose());

    /// Routes /v1/receipts by status; captures the POST for body assertions.
    PurchasesApiClient apiReturning(int status) => PurchasesApiClient(
      client: MockClient((request) async {
        if (request.method == 'POST' && request.url.path == '/v1/receipts') {
          receiptPosts.add(request);
          if (status != 200) return http.Response(rfc7807(status), status);
          return http.Response(jsonEncode({'customerInfo': customerInfoJson()}), 200,
              headers: {'content-type': 'application/json'});
        }
        return http.Response('{}', 404);
      }),
      serverUrl: 'http://localhost:8080',
      apiKey: 'mp_pub_test',
    );

    PurchaseController build(PurchasesApiClient api) => PurchaseController(
      apiClient: api,
      store: store,
      appUserId: () => r'$RCAnonymousID:0123456789abcdef0123456789abcdef',
      onCustomerInfoUpdated: notified.add,
      appAccountTokenFactory: (id) => 'token-for-$id',
    );

    test('happy path: purchase → POST receipt → notify → finish → PurchaseResult', () async {
      store.purchaseResult = {
        'platform': 'APP_STORE', 'fetchToken': 'jws.tok', 'storeProductId': 'com.myampix.pro_month',
        'transactionId': '2000000123456789',
      };
      final controller = build(apiReturning(200));

      final result = await controller.purchaseStoreProduct(storeProduct('com.myampix.pro_month'));

      // Native purchase was invoked with the derived appAccountToken.
      expect(store.purchaseCalls.single, {
        'storeProductId': 'com.myampix.pro_month',
        'appAccountToken': r'token-for-$RCAnonymousID:0123456789abcdef0123456789abcdef',
      });
      // The receipt POST carried the §4 fields.
      final posted = jsonDecode(receiptPosts.single.body) as Map<String, dynamic>;
      expect(posted['app_user_id'], r'$RCAnonymousID:0123456789abcdef0123456789abcdef');
      expect(posted['platform'], 'APP_STORE');
      expect(posted['fetch_token'], 'jws.tok');
      expect(posted['product_id'], 'com.myampix.pro_month');
      // Cache/listener fired, transaction finished, result returned.
      expect(notified, hasLength(1));
      expect(store.finished.single, '2000000123456789');
      expect(result.storeTransaction.transactionId, '2000000123456789');
      expect(result.customerInfo, notified.single);
    });

    test('user cancel maps to purchaseCancelled (userCancelled) and never posts', () async {
      store.purchaseError = PlatformException(code: 'userCancelled');
      final controller = build(apiReturning(200));

      await expectLater(
        controller.purchaseStoreProduct(storeProduct('sku')),
        throwsA(isA<PurchasesError>()
            .having((e) => e.code, 'code', PurchasesErrorCode.purchaseCancelled)
            .having((e) => e.userCancelled, 'userCancelled', isTrue)),
      );
      expect(receiptPosts, isEmpty);
      expect(store.finished, isEmpty);
    });

    test('paymentPending / productNotAvailable / storeProblem codes map through', () async {
      for (final entry in {
        'paymentPending': PurchasesErrorCode.paymentPending,
        'productNotAvailable': PurchasesErrorCode.productNotAvailableForPurchase,
        'storeProblem': PurchasesErrorCode.storeProblem,
      }.entries) {
        store.purchaseError = PlatformException(code: entry.key);
        await expectLater(
          build(apiReturning(200)).purchaseStoreProduct(storeProduct('sku')),
          throwsA(isA<PurchasesError>().having((e) => e.code, 'code', entry.value)),
        );
      }
    });

    test('server 402 after a successful store purchase: leave txn UNFINISHED and throw', () async {
      store.purchaseResult = {
        'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 'sku', 'transactionId': 'tx9',
      };
      await expectLater(
        build(apiReturning(402)).purchaseStoreProduct(storeProduct('sku')),
        throwsA(isA<PurchasesError>().having((e) => e.code, 'code', PurchasesErrorCode.invalidReceipt)),
      );
      expect(receiptPosts, hasLength(1)); // it was attempted
      expect(store.finished, isEmpty);    // but NOT finished → re-delivers next launch
      expect(notified, isEmpty);
    });

    test('a finish() failure after a granted receipt does not fail the purchase', () async {
      store.purchaseResult = {
        'platform': 'APP_STORE', 'fetchToken': 't', 'storeProductId': 'sku', 'transactionId': 'tx1',
      };
      final failingFinish = _FinishThrowsStoreChannel()..purchaseResult = store.purchaseResult;
      final controller = PurchaseController(
        apiClient: apiReturning(200),
        store: failingFinish,
        appUserId: () => 'u',
        onCustomerInfoUpdated: notified.add,
        appAccountTokenFactory: (id) => id,
      );

      final result = await controller.purchaseStoreProduct(storeProduct('sku'));
      expect(result.customerInfo, isNotNull);
      expect(notified, hasLength(1)); // grant still observed
    });

    test('purchasePackage delegates to the package storeProduct', () async {
      store.purchaseResult = {
        'platform': 'PLAY_STORE', 'fetchToken': 'ptok', 'storeProductId': 'sku_pkg', 'transactionId': 'GPA.1',
      };
      await build(apiReturning(200)).purchasePackage(packageFor('sku_pkg'));
      expect(store.purchaseCalls.single['storeProductId'], 'sku_pkg');
    });
  }

  /// A store channel whose finishTransaction always throws (still a real
  /// purchase result), proving the finish guard.
  class _FinishThrowsStoreChannel extends FakeStoreChannel {
    @override
    Future<void> finishTransaction(String transactionId) async =>
        throw PlatformException(code: 'storeProblem');
  }
  ```
  And create the fixtures helper `sdk/flutter_purchases/test/helpers/purchase_fixtures.dart`:
  ```dart
  import 'dart:convert';

  import 'package:myampix_purchases/myampix_purchases.dart';

  /// A minimal RFC-7807 body for a given status (the API client maps by status,
  /// not by body, per spec §6).
  String rfc7807(int status) => jsonEncode({
    'type': 'about:blank',
    'title': 'error',
    'status': status,
  });

  /// The exact §3 CustomerInfo/subscriber JSON (also the `{customerInfo}` wrapped
  /// body of POST /v1/receipts). Must satisfy P3.1 `CustomerInfo.fromJson`.
  Map<String, dynamic> customerInfoJson() => {
    'entitlements': {
      'all': {'pro': _entitlement()},
      'active': {'pro': _entitlement()},
    },
    'subscriptions': [
      {'storeProductId': 'com.myampix.pro_month', 'isActive': true, 'expirationDate': '2026-08-16T10:00:00Z'},
    ],
    'firstSeen': '2026-07-01T00:00:00Z',
    'managementURL': 'https://apps.apple.com/account/subscriptions',
  };

  Map<String, dynamic> _entitlement() => {
    'identifier': 'pro',
    'isActive': true,
    'willRenew': true,
    'periodType': 'normal',
    'latestPurchaseDate': '2026-07-16T10:00:00Z',
    'originalPurchaseDate': '2026-07-16T10:00:00Z',
    'expirationDate': '2026-08-16T10:00:00Z',
    'store': 'app_store',
    'productIdentifier': 'com.myampix.pro_month',
    'ownershipType': 'PURCHASED',
  };

  /// A StoreProduct with the given id (only `.identifier` matters to the
  /// purchase path). Built from the server product JSON via P3.1.
  StoreProduct storeProduct(String id) => StoreProduct.fromJson({
    'storeProductId': id,
    'type': 'autoRenewableSubscription',
    'priceCents': 999,
    'currency': 'USD',
    'durationIso8601': 'P1M',
    'entitlements': ['pro'],
  });

  /// A Package wrapping [storeProduct] for the given id.
  Package packageFor(String id) => Package.fromJson({
    'identifier': r'$rc_monthly',
    'packageType': 'monthly',
    'offeringIdentifier': 'default',
    'product': {
      'storeProductId': id,
      'type': 'autoRenewableSubscription',
      'priceCents': 999,
      'currency': 'USD',
      'durationIso8601': 'P1M',
      'entitlements': ['pro'],
    },
  });
  ```
  > `StoreProduct.fromJson` / `Package.fromJson` are P3.1 factories; the exact keys must match P3.1
  > (they mirror the §3 offerings product/package JSON). Adjust the fixture if P3.1's factories differ.
- [ ] **Step 2: Run to fail.** `cd sdk/flutter_purchases && flutter test test/purchase_controller_test.dart` → compile error: `purchase_controller.dart` / `PurchaseController` not found.
- [ ] **Step 3: Minimal implementation.** Create `sdk/flutter_purchases/lib/src/purchase_controller.dart`:
  ```dart
  import 'package:flutter/services.dart' show PlatformException;
  import 'package:uuid/uuid.dart';

  import 'models/customer_info.dart';
  import 'models/package.dart';
  import 'models/purchase_result.dart';
  import 'models/purchases_error.dart';
  import 'models/store_product.dart';
  import 'network/purchases_api_client.dart';
  import 'store/store_channel.dart';
  import 'store/store_transaction.dart';
  import 'util/logger.dart';

  /// Purchase orchestration (spec §4). Runs the native store purchase, posts the
  /// receipt to `mobile_purchase`, refreshes the cache + fires the update
  /// listener via [onCustomerInfoUpdated], then finishes the transaction. Store
  /// errors and server RFC-7807 statuses surface as typed [PurchasesError]
  /// (spec §6). Restore + out-of-band handling are added in Task 3.4.5.
  class PurchaseController {
    PurchaseController({
      required PurchasesApiClient apiClient,
      required StoreChannel store,
      required String Function() appUserId,
      required void Function(CustomerInfo) onCustomerInfoUpdated,
      String Function(String appUserId)? appAccountTokenFactory,
      MamLogger logger = const MamLogger(),
    }) : _apiClient = apiClient,
         _store = store,
         _appUserId = appUserId,
         _onCustomerInfoUpdated = onCustomerInfoUpdated,
         _appAccountTokenFactory = appAccountTokenFactory ?? _defaultAppAccountToken,
         _logger = logger;

    final PurchasesApiClient _apiClient;
    final StoreChannel _store;
    final String Function() _appUserId;
    final void Function(CustomerInfo) _onCustomerInfoUpdated;
    final String Function(String appUserId) _appAccountTokenFactory;
    final MamLogger _logger;

    Future<PurchaseResult> purchasePackage(Package packageToPurchase) =>
        purchaseStoreProduct(packageToPurchase.storeProduct);

    Future<PurchaseResult> purchaseStoreProduct(StoreProduct product) async {
      final appUserId = _appUserId();
      final Map<String, Object?> raw;
      try {
        raw = await _store.purchase(
          storeProductId: product.identifier,
          appAccountToken: _appAccountTokenFactory(appUserId),
        );
      } on PlatformException catch (error) {
        throw _mapPlatformException(error);
      }

      final transaction = StoreTransaction.parse(raw);
      if (transaction == null) {
        throw const PurchasesError(
          code: PurchasesErrorCode.storeProblem,
          message: 'The store returned a malformed purchase result.',
        );
      }

      // On failure here (402/409/503/network → PurchasesError) we deliberately
      // do NOT finish: the transaction stays unfinished and re-delivers via the
      // transaction stream on next launch to be retried — no lost purchase (§4).
      final customerInfo = await _apiClient.postReceipt(
        appUserId: appUserId,
        platform: transaction.platform,
        fetchToken: transaction.fetchToken,
        productId: transaction.storeProductId,
      );

      _onCustomerInfoUpdated(customerInfo);
      await _finishQuietly(transaction.transactionId);
      return PurchaseResult(customerInfo: customerInfo, storeTransaction: transaction);
    }

    /// Finish AFTER the server grant. A finish failure must not fail an already
    /// server-granted purchase — the transaction simply re-delivers and is
    /// finished on retry (never-crash guarantee, §2/§4).
    Future<void> _finishQuietly(String transactionId) async {
      try {
        await _store.finishTransaction(transactionId);
      } on Object catch (error, stackTrace) {
        _logger.log('finishTransaction failed (server already granted; will retry)', error, stackTrace);
      }
    }

    PurchasesError _mapPlatformException(PlatformException error) {
      switch (error.code) {
        case 'userCancelled':
          return PurchasesError(code: PurchasesErrorCode.purchaseCancelled, message: 'Purchase was cancelled.', underlyingErrorMessage: error.message);
        case 'paymentPending':
          return PurchasesError(code: PurchasesErrorCode.paymentPending, message: 'The payment is pending.', underlyingErrorMessage: error.message);
        case 'productNotAvailable':
          return PurchasesError(code: PurchasesErrorCode.productNotAvailableForPurchase, message: 'The product is not available for purchase.', underlyingErrorMessage: error.message);
        case 'storeProblem':
        default:
          return PurchasesError(code: PurchasesErrorCode.storeProblem, message: 'There was a problem with the store.', underlyingErrorMessage: error.message);
      }
    }

    /// StoreKit's `appAccountToken` must be a UUID. Anonymous ids embed a uuid
    /// hex (`$RCAnonymousID:<32 hex>`) we reuse; custom ids derive a stable v5.
    static String _defaultAppAccountToken(String appUserId) {
      const prefix = r'$RCAnonymousID:';
      if (appUserId.startsWith(prefix)) {
        final hex = appUserId.substring(prefix.length);
        if (hex.length == 32 && RegExp(r'^[0-9a-fA-F]{32}$').hasMatch(hex)) {
          return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-'
              '${hex.substring(16, 20)}-${hex.substring(20)}';
        }
      }
      return const Uuid().v5(Namespace.url.value, appUserId);
    }
  }
  ```
  > The `models/*.dart` and `network/purchases_api_client.dart` import paths are P3.1/P3.2 files;
  > adjust to their final locations. `PurchasesError` const-constructs with the P3.1 signature.
- [ ] **Step 4: Run to pass.** `cd sdk/flutter_purchases && flutter test test/purchase_controller_test.dart` → all pass.
- [ ] **Step 5: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/purchase_controller.dart test/purchase_controller_test.dart test/helpers/purchase_fixtures.dart
  git commit -m "feat(purchases): purchase orchestration with PurchasesError mapping"
  ```

---

### Task 3.4.5: `TransactionStream` + out-of-band handling + `restorePurchases()`

The `EventChannel` handler (renewals / interrupted purchases / restore) and `restorePurchases()`,
both routed through the same receipt→cache→listener→finish path, serialized on a `_tail` chain.

- **Files:**
  - Create `sdk/flutter_purchases/lib/src/store/transaction_stream.dart`
  - Modify `sdk/flutter_purchases/lib/src/purchase_controller.dart` (add `start`/`stop`/`idle`/`restorePurchases`, wire `TransactionStream`)
  - Test `sdk/flutter_purchases/test/store/transaction_stream_test.dart`
  - Test `sdk/flutter_purchases/test/purchase_restore_test.dart`
- **Interfaces:**
  - Consumes: `StoreChannel.transactions/restore/finishTransaction` (P3.3 iface); `PurchasesApiClient.postReceipt/fetchSubscriber` (P3.2); `StoreTransaction` (3.4.1).
  - Produces: `class TransactionStream { TransactionStream({required Stream<Map<String,Object?>> source, required void Function(StoreTransaction) onTransaction}); void start(); Future<void> stop(); }`; adds to `PurchaseController`: `void start()`, `Future<void> stop()`, `Future<void> get idle`, `Future<CustomerInfo> restorePurchases()`.

- [ ] **Step 1: Write failing test for `TransactionStream`.**
  Create `sdk/flutter_purchases/test/store/transaction_stream_test.dart`:
  ```dart
  import 'dart:async';

  import 'package:flutter_test/flutter_test.dart';
  import 'package:myampix_purchases/src/store/store_transaction.dart';
  import 'package:myampix_purchases/src/store/transaction_stream.dart';

  void main() {
    late StreamController<Map<String, Object?>> controller;
    late List<StoreTransaction> seen;
    late TransactionStream stream;

    setUp(() {
      controller = StreamController<Map<String, Object?>>.broadcast();
      seen = [];
      stream = TransactionStream(source: controller.stream, onTransaction: seen.add);
      stream.start();
    });
    tearDown(() async {
      await stream.stop();
      await controller.close();
    });

    test('parses well-formed events and dispatches StoreTransactions', () async {
      controller.add({
        'platform': 'APP_STORE', 'fetchToken': 'jws', 'storeProductId': 'sku',
        'transactionId': 'tx1', 'reason': 'renewal',
      });
      await pumpEventQueue();
      expect(seen.single.transactionId, 'tx1');
      expect(seen.single.reason, TransactionReason.renewal);
    });

    test('drops malformed events without throwing', () async {
      controller
        ..add(<String, Object?>{}) // missing everything
        ..add({'platform': 'WEB', 'fetchToken': 't', 'storeProductId': 's', 'transactionId': 'x'});
      await pumpEventQueue();
      expect(seen, isEmpty);
    });

    test('start is idempotent; stop is safe twice', () async {
      stream.start(); // no double-listen
      controller.add({
        'platform': 'PLAY_STORE', 'fetchToken': 't', 'storeProductId': 's', 'transactionId': 'x',
      });
      await pumpEventQueue();
      expect(seen, hasLength(1));
      await stream.stop();
      await stream.stop();
    });

    test('a stream error never throws', () async {
      controller.addError(StateError('channel boom'));
      await pumpEventQueue();
      expect(seen, isEmpty);
    });
  }
  ```
- [ ] **Step 2: Run to fail.** `cd sdk/flutter_purchases && flutter test test/store/transaction_stream_test.dart` → compile error: `transaction_stream.dart` / `TransactionStream` not found.
- [ ] **Step 3: Minimal implementation of `TransactionStream`.** Create `sdk/flutter_purchases/lib/src/store/transaction_stream.dart`:
  ```dart
  import 'dart:async';

  import 'store_transaction.dart';

  /// Subscribes to the native `transactions` EventChannel (spec §5), parses each
  /// raw map into a [StoreTransaction] (dropping malformed ones), and hands it
  /// to [onTransaction]. Never throws: a malformed payload or a channel-level
  /// error degrades to "no dispatch", never a crash (§2).
  class TransactionStream {
    TransactionStream({
      required Stream<Map<String, Object?>> source,
      required void Function(StoreTransaction) onTransaction,
    }) : _source = source,
         _onTransaction = onTransaction;

    final Stream<Map<String, Object?>> _source;
    final void Function(StoreTransaction) _onTransaction;
    StreamSubscription<Map<String, Object?>>? _subscription;

    /// Begins listening (idempotent).
    void start() {
      _subscription ??= _source.listen(
        _handle,
        onError: (Object error, StackTrace stackTrace) {
          // Never-throw: a channel error must not tear down the caller.
        },
      );
    }

    Future<void> stop() async {
      await _subscription?.cancel();
      _subscription = null;
    }

    void _handle(Map<String, Object?> raw) {
      try {
        final transaction = StoreTransaction.parse(raw);
        if (transaction != null) _onTransaction(transaction);
      } on Object catch (_) {
        // Drop hostile/malformed payloads.
      }
    }
  }
  ```
- [ ] **Step 4: Run to pass.** `cd sdk/flutter_purchases && flutter test test/store/transaction_stream_test.dart` → all pass.
- [ ] **Step 5: Write failing test for out-of-band + restore.**
  Create `sdk/flutter_purchases/test/purchase_restore_test.dart`:
  ```dart
  import 'dart:convert';

  import 'package:flutter_test/flutter_test.dart';
  import 'package:http/http.dart' as http;
  import 'package:http/testing.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';
  import 'package:myampix_purchases/src/network/purchases_api_client.dart';
  import 'package:myampix_purchases/src/purchase_controller.dart';

  import 'helpers/fake_store_channel.dart';
  import 'helpers/purchase_fixtures.dart';

  void main() {
    late FakeStoreChannel store;
    late List<http.Request> receiptPosts;
    late List<http.Request> subscriberGets;
    late List<CustomerInfo> notified;

    setUp(() {
      store = FakeStoreChannel();
      receiptPosts = [];
      subscriberGets = [];
      notified = [];
    });
    tearDown(() => store.dispose());

    PurchasesApiClient api() => PurchasesApiClient(
      client: MockClient((request) async {
        if (request.method == 'POST' && request.url.path == '/v1/receipts') {
          receiptPosts.add(request);
          return http.Response(jsonEncode({'customerInfo': customerInfoJson()}), 200,
              headers: {'content-type': 'application/json'});
        }
        if (request.method == 'GET' && request.url.path.startsWith('/v1/subscribers/')) {
          subscriberGets.add(request);
          return http.Response(jsonEncode(customerInfoJson()), 200,
              headers: {'content-type': 'application/json'});
        }
        return http.Response('{}', 404);
      }),
      serverUrl: 'http://localhost:8080',
      apiKey: 'mp_pub_test',
    );

    PurchaseController build() => PurchaseController(
      apiClient: api(),
      store: store,
      appUserId: () => 'user-1',
      onCustomerInfoUpdated: notified.add,
      appAccountTokenFactory: (id) => id,
    );

    test('an out-of-band renewal posts a receipt, notifies, and finishes', () async {
      final controller = build()..start();
      store.emit({
        'platform': 'APP_STORE', 'fetchToken': 'renewtok', 'storeProductId': 'com.myampix.pro_month',
        'transactionId': 'tx_renew', 'reason': 'renewal',
      });
      await pumpEventQueue();
      await controller.idle;

      final posted = jsonDecode(receiptPosts.single.body) as Map<String, dynamic>;
      expect(posted['fetch_token'], 'renewtok');
      expect(posted['app_user_id'], 'user-1');
      expect(notified, hasLength(1));
      expect(store.finished.single, 'tx_renew');
      await controller.stop();
    });

    test('a malformed out-of-band event is dropped and never throws', () async {
      final controller = build()..start();
      store.emit({'garbage': true});
      await pumpEventQueue();
      await controller.idle;
      expect(receiptPosts, isEmpty);
      expect(store.finished, isEmpty);
      await controller.stop();
    });

    test('restorePurchases replays restore txns to /v1/receipts, then refetches '
        'and returns the subscriber CustomerInfo', () async {
      store.restoreEmissions = [
        {'platform': 'APP_STORE', 'fetchToken': 'r1', 'storeProductId': 'com.myampix.pro_month', 'transactionId': 'tx_r1', 'reason': 'restore'},
        {'platform': 'APP_STORE', 'fetchToken': 'r2', 'storeProductId': 'com.myampix.pro_year', 'transactionId': 'tx_r2', 'reason': 'restore'},
      ];
      final controller = build()..start();

      final info = await controller.restorePurchases();

      expect(store.restoreCalled, isTrue);
      expect(receiptPosts, hasLength(2)); // one per restored transaction
      expect(receiptPosts.map((r) => (jsonDecode(r.body) as Map)['fetch_token']),
          containsAll(<String>['r1', 'r2']));
      expect(store.finished, containsAll(<String>['tx_r1', 'tx_r2']));
      expect(subscriberGets, hasLength(1)); // final refetch (§4)
      expect(info, isNotNull);
      expect(notified.last, info); // refetch also fires the listener
      await controller.stop();
    });
  }
  ```
- [ ] **Step 6: Run to fail.** `cd sdk/flutter_purchases && flutter test test/purchase_restore_test.dart` → fails: `PurchaseController` has no `start` / `idle` / `restorePurchases` (compile error).
- [ ] **Step 7: Extend `PurchaseController`.** Edit `sdk/flutter_purchases/lib/src/purchase_controller.dart`:
  - add imports at the top:
    ```dart
    import 'dart:async';

    import 'store/transaction_stream.dart';
    ```
  - add fields after `_logger`:
    ```dart
    TransactionStream? _stream;

    /// Serializes out-of-band receipt processing so `restorePurchases` can await
    /// a settled state before refetching (mirrors the analytics `_tail` chain).
    Future<void> _tail = Future<void>.value();
    ```
  - add methods inside the class:
    ```dart
    /// Subscribes to the native transaction stream (renewals / interrupted
    /// purchases / restore). Idempotent.
    void start() {
      _stream ??= TransactionStream(
        source: _store.transactions,
        onTransaction: _processOutOfBand,
      )..start();
    }

    Future<void> stop() async {
      await _stream?.stop();
      _stream = null;
    }

    /// Resolves when the current out-of-band processing chain is idle.
    Future<void> get idle => _tail;

    /// Restores entitlements (spec §4): the native side re-emits the current
    /// transactions on the stream (`reason: restore`), each is posted to
    /// `/v1/receipts` by [_processOutOfBand], then we refetch the subscriber and
    /// return it as the authoritative CustomerInfo.
    Future<CustomerInfo> restorePurchases() async {
      await _store.restore();
      // Let the EventChannel deliver the just-emitted restore transactions,
      // then drain their receipt posts before the refetch reads server state.
      await Future<void>.delayed(Duration.zero);
      await _tail;
      final customerInfo = await _apiClient.fetchSubscriber(_appUserId());
      _onCustomerInfoUpdated(customerInfo);
      return customerInfo;
    }

    /// Out-of-band transaction → receipt → cache/listener → finish, serialized
    /// on [_tail]. Never throws: a failed post leaves the transaction unfinished
    /// for retry (§4).
    void _processOutOfBand(StoreTransaction transaction) {
      _tail = _tail.then((_) async {
        try {
          final customerInfo = await _apiClient.postReceipt(
            appUserId: _appUserId(),
            platform: transaction.platform,
            fetchToken: transaction.fetchToken,
            productId: transaction.storeProductId,
          );
          _onCustomerInfoUpdated(customerInfo);
          await _finishQuietly(transaction.transactionId);
        } on Object catch (error, stackTrace) {
          _logger.log('out-of-band transaction failed; left unfinished for retry', error, stackTrace);
        }
      });
    }
    ```
- [ ] **Step 8: Run to pass.** `cd sdk/flutter_purchases && flutter test test/store/transaction_stream_test.dart test/purchase_restore_test.dart test/purchase_controller_test.dart` → all pass.
- [ ] **Step 9: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/store/transaction_stream.dart lib/src/purchase_controller.dart \
          test/store/transaction_stream_test.dart test/purchase_restore_test.dart
  git commit -m "feat(purchases): out-of-band transaction stream + restorePurchases"
  ```

---

### Task 3.4.6: Facade wiring — expose `getOfferings`/`purchase*`/`restorePurchases`

Wire `OfferingsService` + `PurchaseController` into the P3.3 facade and expose the four throwing
public methods, plus barrel exports. Drive the whole flow through `configure` against fakes.

- **Files:**
  - Modify `sdk/flutter_purchases/lib/src/myampix_purchases.dart` (facade — P3.3)
  - Modify `sdk/flutter_purchases/lib/myampix_purchases.dart` (barrel — P3.1/P3.3)
  - Test `sdk/flutter_purchases/test/myampix_purchases_purchase_test.dart`
- **Interfaces:**
  - Consumes: P3.3 facade internals (`_apiClient`, `_store`, `_cache.set`, `_appUserId`, `_notifyListeners`, `_throwing`, `configure`, `PurchasesOverrides`, `shutdownForTesting`); `OfferingsService`/`PurchaseController` (3.4.3–3.4.5).
  - Produces (added to the frozen §2 surface):
    ```dart
    static Future<Offerings>        getOfferings();
    static Future<PurchaseResult>   purchasePackage(Package packageToPurchase);
    static Future<PurchaseResult>   purchaseStoreProduct(StoreProduct product);
    static Future<CustomerInfo>     restorePurchases();
    ```

- [ ] **Step 1: Write failing facade test.**
  Create `sdk/flutter_purchases/test/myampix_purchases_purchase_test.dart`:
  ```dart
  import 'dart:convert';

  import 'package:flutter_test/flutter_test.dart';
  import 'package:http/http.dart' as http;
  import 'package:http/testing.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';

  import 'helpers/fake_store_channel.dart';
  import 'helpers/purchase_fixtures.dart';

  void main() {
    TestWidgetsFlutterBinding.ensureInitialized();

    late FakeStoreChannel store;
    late List<http.Request> requests;

    setUp(() {
      store = FakeStoreChannel();
      requests = [];
    });
    tearDown(() async {
      await MyAmpixPurchases.shutdownForTesting();
      await store.dispose();
    });

    http.Client mockClient() => MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/v1/offerings') {
        return http.Response(jsonEncode(offeringsJson()), 200, headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && request.url.path == '/v1/receipts') {
        return http.Response(jsonEncode({'customerInfo': customerInfoJson()}), 200, headers: {'content-type': 'application/json'});
      }
      if (request.url.path.startsWith('/v1/subscribers/')) {
        return http.Response(jsonEncode(customerInfoJson()), 200, headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });

    Future<void> configure() => MyAmpixPurchases.configure(
      const PurchasesConfiguration(apiKey: 'mp_pub_test', serverUrl: 'http://localhost:8080'),
      overrides: PurchasesOverrides(httpClient: mockClient(), storeChannel: store),
    );

    test('getOfferings returns enriched offerings through the facade', () async {
      store.productsResult = [
        {'storeProductId': 'com.myampix.pro_month', 'priceString': r'$9.99', 'price': 9.99, 'currencyCode': 'USD', 'title': 'Pro Monthly', 'description': 'd', 'subscriptionPeriodIso8601': 'P1M'},
      ];
      await configure();

      final offerings = await MyAmpixPurchases.getOfferings();
      expect(offerings.current!.availablePackages.single.storeProduct.title, 'Pro Monthly');
    });

    test('purchaseStoreProduct runs the full flow and fires the update listener', () async {
      store.purchaseResult = {
        'platform': 'APP_STORE', 'fetchToken': 'jws', 'storeProductId': 'com.myampix.pro_month', 'transactionId': 'tx1',
      };
      final updates = <CustomerInfo>[];
      await configure();
      MyAmpixPurchases.addCustomerInfoUpdateListener(updates.add);

      final result = await MyAmpixPurchases.purchaseStoreProduct(storeProduct('com.myampix.pro_month'));

      expect(result.storeTransaction.transactionId, 'tx1');
      expect(store.finished.single, 'tx1');
      expect(updates, isNotEmpty);
    });

    test('a user cancel surfaces as a thrown PurchasesError(userCancelled)', () async {
      store.purchaseError = _cancelException();
      await configure();
      await expectLater(
        MyAmpixPurchases.purchaseStoreProduct(storeProduct('sku')),
        throwsA(isA<PurchasesError>().having((e) => e.userCancelled, 'userCancelled', isTrue)),
      );
    });

    test('a throwing method before configure throws PurchasesError(configuration)', () async {
      await expectLater(
        MyAmpixPurchases.getOfferings(),
        throwsA(isA<PurchasesError>().having((e) => e.code, 'code', PurchasesErrorCode.configuration)),
      );
    });
  }

  // Local helper so this test file needs no flutter/services import.
  Object _cancelException() {
    // FakeStoreChannel.purchaseError is a PlatformException; build one here.
    return _PlatformCancel();
  }
  ```
  > Replace `_cancelException()`/`_PlatformCancel` with a direct
  > `import 'package:flutter/services.dart' show PlatformException;` and
  > `store.purchaseError = PlatformException(code: 'userCancelled');` (kept inline above only to
  > show the assertion; use the real `PlatformException` in the committed file). Also add
  > `Map<String, dynamic> offeringsJson()` to `test/helpers/purchase_fixtures.dart` reusing the §3
  > body from Task 3.4.3's `_offeringsJson`.
- [ ] **Step 2: Run to fail.** `cd sdk/flutter_purchases && flutter test test/myampix_purchases_purchase_test.dart` → fails: `MyAmpixPurchases` has no `getOfferings`/`purchaseStoreProduct`/`restorePurchases` (compile error).
- [ ] **Step 3: Wire the facade.** Edit `sdk/flutter_purchases/lib/src/myampix_purchases.dart`:
  - add imports:
    ```dart
    import 'offerings_service.dart';
    import 'purchase_controller.dart';
    ```
  - add instance fields alongside the other `late final` services:
    ```dart
    late final OfferingsService _offerings;
    late final PurchaseController _purchases;
    ```
  - in the configure/`_start` body, AFTER `_apiClient`, `_store`, `_cache`, and the identity load are set up, construct + start:
    ```dart
    _offerings = OfferingsService(apiClient: _apiClient, store: _store, logger: _logger);
    _purchases = PurchaseController(
      apiClient: _apiClient,
      store: _store,
      appUserId: () => _appUserId,
      onCustomerInfoUpdated: (info) {
        _cache.set(info);
        _notifyListeners(info);
      },
      logger: _logger,
    );
    _purchases.start(); // subscribe to the out-of-band transaction stream
    ```
  - in `shutdownForTesting`, before resetting the instance: `await _purchases.stop();`
  - add the four public methods (throwing per §2/§6; reuse the P3.3 `_throwing` helper that maps
    pre-configure → `PurchasesError(configuration)` and unexpected → `PurchasesError(unknown)` while
    passing thrown `PurchasesError` through unchanged):
    ```dart
    static Future<Offerings> getOfferings() =>
        _instance._throwing('getOfferings', () => _instance._offerings.getOfferings());

    static Future<PurchaseResult> purchasePackage(Package packageToPurchase) =>
        _instance._throwing('purchasePackage', () => _instance._purchases.purchasePackage(packageToPurchase));

    static Future<PurchaseResult> purchaseStoreProduct(StoreProduct product) =>
        _instance._throwing('purchaseStoreProduct', () => _instance._purchases.purchaseStoreProduct(product));

    static Future<CustomerInfo> restorePurchases() =>
        _instance._throwing('restorePurchases', () => _instance._purchases.restorePurchases());
    ```
    > If P3.3 did not add `_throwing`, add it here:
    > ```dart
    > Future<T> _throwing<T>(String operation, Future<T> Function() body) async {
    >   if (!_configured) {
    >     throw const PurchasesError(code: PurchasesErrorCode.configuration, message: 'MyAmpixPurchases.configure has not completed.');
    >   }
    >   try {
    >     return await body();
    >   } on PurchasesError {
    >     rethrow;
    >   } on Object catch (error, stackTrace) {
    >     _logger.log('$operation failed', error, stackTrace);
    >     throw PurchasesError(code: PurchasesErrorCode.unknown, message: '$operation failed.', underlyingErrorMessage: '$error');
    >   }
    > }
    > ```
- [ ] **Step 4: Update the barrel.** Edit `sdk/flutter_purchases/lib/myampix_purchases.dart` to export the produced public transaction type (the facade + models are already exported by P3.1/P3.3):
    ```dart
    export 'src/store/store_transaction.dart' show StoreTransaction, TransactionReason;
    ```
- [ ] **Step 5: Finalize the test file** (swap the inline `_cancelException`/`_PlatformCancel` for the real `PlatformException` import as noted) and run to pass.
  `cd sdk/flutter_purchases && flutter test test/myampix_purchases_purchase_test.dart` → all pass.
- [ ] **Step 6: Full-suite + analyze gate.**
  `cd sdk/flutter_purchases && flutter analyze && flutter test` → analyzer clean, all tests green.
- [ ] **Step 7: Commit.**
  ```bash
  cd sdk/flutter_purchases
  git add lib/src/myampix_purchases.dart lib/myampix_purchases.dart \
          test/myampix_purchases_purchase_test.dart test/helpers/purchase_fixtures.dart
  git commit -m "feat(purchases): expose getOfferings/purchase*/restorePurchases on the facade"
  ```


---

## P3.5 · iOS native (Swift, StoreKit 2)

Native (Swift) half of the `myampix_purchases/methods` MethodChannel and
`myampix_purchases/transactions` EventChannel defined in design §5. This is
**not** Dart-TDD — Swift cannot be unit-tested here (a real purchase is
device+sandbox-gated, §0). Each task's loop is: write the complete Swift/podspec
→ confirm the Dart side still analyzes clean → attempt the Xcode compile *iff the
toolchain + example iOS project exist, else flag toolchain/P3.7-gated* → run a
StoreKit 2 review checklist → commit.

**Toolchain reality (checked at authoring time):** `xcodebuild -version` →
**Xcode 26.6** IS present locally. BUT the plugin's iOS code only compiles inside
a host Xcode project, which is the `example/` app built in **P3.7**. `pod lib
lint` cannot stand in because the `Flutter` pod is a development pod supplied by
the flutter tool, not published to CocoaPods trunk (`pod lib lint` errors "Unable
to find a specification for `Flutter`"). Therefore, until P3.7 lands, every task
below is **compile-gated on P3.7**: verification is limited to (a) `flutter
analyze` staying clean on the Dart side, (b) `xcodebuild -version` confirming the
toolchain, and (c) the per-task StoreKit 2 review checklist. Once P3.7's
`example/ios/Runner.xcworkspace` exists, run the `xcodebuild` command shown in
each task's Step 3 to actually compile. A **real purchase** additionally needs a
physical device + App Store Connect sandbox tester + signed build (§0/§11) and is
out of scope for verification here.

**Shared prerequisite (P3.1):** `sdk/flutter_purchases/pubspec.yaml` already
declares the plugin block. P3.5 requires its `flutter.plugin.platforms.ios` entry
to name `pluginClass: MyampixPurchasesPlugin` (Task 3.5.1 Step 1 ensures this).

---

### Task 3.5.1: iOS plugin scaffold + podspec + channel wiring + `canMakePayments`

Registers both channels, wires the never-drop EventChannel buffer, implements the
one trivially-synchronous method (`canMakePayments`), and routes the four
async methods to `FlutterMethodNotImplemented` until their own task lands (a
valid, compilable intermediate — the Dart P3.4 tests drive a `FakeStoreChannel`,
never this real channel, so nothing regresses).

**Files:**
- Create `sdk/flutter_purchases/ios/myampix_purchases.podspec`
- Create `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`
- Modify `sdk/flutter_purchases/pubspec.yaml` (ensure `ios: pluginClass: MyampixPurchasesPlugin`)
- Test: none (native; see the review checklist in Step 4 — the Dart↔native contract is exercised on the Dart side in P3.4 against `FakeStoreChannel`)

**Interfaces:**
- **Consumes (from P3.4 — the Dart `StoreChannel` that sends over `MethodChannel('myampix_purchases/methods')`):** `StoreChannel.canMakePayments()` invokes method `"canMakePayments"` with no args, expecting a `bool`. `StoreChannel`'s `EventChannel('myampix_purchases/transactions')` listener expects a broadcast stream of `Map` payloads.
- **Produces (the iOS half of the channel — later native tasks extend this same class):** `public class MyampixPurchasesPlugin: NSObject, FlutterPlugin, FlutterStreamHandler`; `public static func register(with:)` wiring `FlutterMethodChannel("myampix_purchases/methods")` + `FlutterEventChannel("myampix_purchases/transactions")`; `public func handle(_:result:)` answering `"canMakePayments"` → `AppStore.canMakePayments` (`Bool`).

- [ ] **Step 1: Write the podspec, the plugin scaffold, and confirm the pubspec plugin block.**

  `sdk/flutter_purchases/ios/myampix_purchases.podspec`:
  ```ruby
  #
  # To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
  # Run `pod lib lint myampix_purchases.podspec` to validate before publishing.
  #
  Pod::Spec.new do |s|
    s.name             = 'myampix_purchases'
    s.version          = '0.1.0'
    s.summary          = 'MyAmpix Flutter purchases SDK — native iOS StoreKit 2 layer.'
    s.description      = <<-DESC
  Native StoreKit 2 store-operation layer for the MyAmpix Flutter purchases SDK
  (a RevenueCat-style client for the mobile_purchase server). Fetches products,
  runs purchases with appAccountToken self-attribution, streams
  Transaction.updates, finishes transactions after the server grants, and
  replays currentEntitlements for restore. Holds no server URL/key; does no HTTP.
                         DESC
    s.homepage         = 'https://myampix.dev'
    s.license          = { :type => 'Proprietary', :text => 'See project root' }
    s.author           = { 'MyAmpix' => 'engineering@myampix.dev' }
    s.source           = { :path => '.' }
    s.source_files = 'Classes/**/*'
    s.dependency 'Flutter'
    s.platform = :ios, '15.0'

    # Flutter.framework does not contain an i386 slice. StoreKit 2 (async
    # Product/Transaction APIs) requires the iOS 15 deployment target above.
    s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'i386' }
    s.swift_version = '5.0'
  end
  ```

  `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`:
  ```swift
  import Flutter
  import StoreKit
  import UIKit

  /// MyAmpix Flutter purchases SDK — native iOS half (StoreKit 2).
  ///
  /// Answers the `myampix_purchases/methods` MethodChannel (Dart → native store
  /// operations) and pushes out-of-band transactions onto the
  /// `myampix_purchases/transactions` EventChannel (native → Dart). It performs
  /// STORE OPERATIONS ONLY: fetch products, run purchases, surface the StoreKit 2
  /// `jwsRepresentation` receipt, stream `Transaction.updates`, finish
  /// transactions after the Dart layer confirms the server granted, and replay
  /// `Transaction.currentEntitlements` for restore. It holds NO server URL/key
  /// and does NO HTTP — all networking, the CustomerInfo model, identity and
  /// orchestration live in Dart (design §1/§5).
  ///
  /// Defensive by construction: every StoreKit call is wrapped so a failure maps
  /// to a typed `FlutterError` (never a crash into the host), and payloads Dart
  /// could not map onto the §5 contract are dropped rather than forwarded.
  public class MyampixPurchasesPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    private static let methodChannelName = "myampix_purchases/methods"
    private static let eventChannelName = "myampix_purchases/transactions"

    private var eventSink: FlutterEventSink?

    /// Transactions observed before Dart attaches its EventChannel listener
    /// (e.g. a renewal replayed at cold start, before `runApp`) are buffered here
    /// and flushed on `onListen`, so nothing is silently dropped.
    private var pendingPayloads: [[String: Any?]] = []

    public static func register(with registrar: FlutterPluginRegistrar) {
      let instance = MyampixPurchasesPlugin()

      let methodChannel = FlutterMethodChannel(
        name: methodChannelName,
        binaryMessenger: registrar.messenger()
      )
      registrar.addMethodCallDelegate(instance, channel: methodChannel)

      let eventChannel = FlutterEventChannel(
        name: eventChannelName,
        binaryMessenger: registrar.messenger()
      )
      eventChannel.setStreamHandler(instance)

      // Keep the instance alive for the engine's lifetime so the long-lived
      // Transaction.updates task (attached in Task 3.5.4) is never deallocated.
      registrar.publish(instance)
    }

    // MARK: - FlutterStreamHandler

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
      eventSink = events
      if !pendingPayloads.isEmpty {
        pendingPayloads.forEach { events($0) }
        pendingPayloads.removeAll()
      }
      return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
      eventSink = nil
      return nil
    }

    // MARK: - Emit / result helpers (always hop to main for Flutter calls)

    func emit(_ payload: [String: Any?]) {
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        if let sink = self.eventSink {
          sink(payload)
        } else {
          self.pendingPayloads.append(payload)
        }
      }
    }

    func succeed(_ result: @escaping FlutterResult, _ value: Any?) {
      DispatchQueue.main.async { result(value) }
    }

    func fail(_ result: @escaping FlutterResult, _ code: String, _ message: String, _ details: String? = nil) {
      DispatchQueue.main.async { result(FlutterError(code: code, message: message, details: details)) }
    }

    // MARK: - FlutterPlugin dispatch

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
      switch call.method {
      case "canMakePayments":
        // Static, synchronous StoreKit 2 gate — no async hop needed.
        result(AppStore.canMakePayments)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
  ```

  In `sdk/flutter_purchases/pubspec.yaml`, ensure the plugin block names the iOS
  class (add/confirm — mirrors `myampix_analytics`):
  ```yaml
  flutter:
    plugin:
      platforms:
        android:
          package: com.myampix.purchases
          pluginClass: MyampixPurchasesPlugin
        ios:
          pluginClass: MyampixPurchasesPlugin
  ```

- [ ] **Step 2: Confirm the Dart side still analyzes clean (no Dart changed, but this is the standing native-task gate).**
  ```bash
  cd sdk/flutter_purchases && flutter analyze
  ```
  Expected: `No issues found!` (the pubspec plugin block is the only Dart-tree
  change; it must not introduce analyzer errors).

- [ ] **Step 3: iOS compile check (toolchain-gated).**
  ```bash
  xcodebuild -version   # confirm toolchain present → "Xcode 26.6"
  # Full compile is only possible inside the P3.7 example host project:
  if [ -d sdk/flutter_purchases/example/ios ]; then
    cd sdk/flutter_purchases/example && flutter pub get && \
    cd ios && pod install && \
    xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
  else
    echo "COMPILE GATED: example app (P3.7) absent; toolchain present (Xcode 26.6). Verifying via analyze + review only."
  fi
  ```
  Expected NOW: the `else` branch (example app is P3.7). Flag the task
  **compile-gated on P3.7**. Once P3.7 exists, expect `BUILD SUCCEEDED`.

- [ ] **Step 4: StoreKit 2 review checklist.**
  - [ ] Channel names EXACTLY `myampix_purchases/methods` (method) and `myampix_purchases/transactions` (event) — byte-for-byte the §5 contract P3.4's Dart consumes.
  - [ ] `register` uses `addMethodCallDelegate(_:channel:)` (routes to `handle(_:result:)`) AND `setStreamHandler(self)` AND `registrar.publish(instance)` (retains the instance for the engine lifetime).
  - [ ] EventChannel buffers `pendingPayloads` before `onListen`, flushes on listen, clears `eventSink` on `onCancel` — no lost cold-start events.
  - [ ] `AppStore.canMakePayments` (StoreKit 2 static `Bool`), not the legacy `SKPaymentQueue.canMakePayments()`.
  - [ ] Podspec: `s.platform = :ios, '15.0'` (StoreKit 2 floor), `s.swift_version = '5.0'`, `s.dependency 'Flutter'`, `source_files = 'Classes/**/*'`.
  - [ ] Class name/`pluginClass` match between Swift, podspec `source_files`, and pubspec (`MyampixPurchasesPlugin`).

- [ ] **Step 5: Commit.**
  ```bash
  git add sdk/flutter_purchases/ios/myampix_purchases.podspec \
          sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift \
          sdk/flutter_purchases/pubspec.yaml
  git commit -m "feat(purchases-ios): scaffold StoreKit 2 plugin + podspec + canMakePayments"
  ```

---

### Task 3.5.2: `getProducts` — `Product.products(for:)` → localized metadata payloads

**Files:**
- Modify `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`
- Test: none (native; contract verified Dart-side in P3.4 against `FakeStoreChannel`)

**Interfaces:**
- **Consumes (from P3.4):** `StoreChannel.getProducts(List<String> productIds)` invokes method `"getProducts"` with args `{ "productIds": List<String> }`, expecting `List<Map>` where each map has `storeProductId` (String), `priceString` (String), `price` (double), `currencyCode` (String), `title` (String), `description` (String), `subscriptionPeriodIso8601` (String?). Products not found are omitted from the list.
- **Produces:** `handle(_:result:)` case `"getProducts"` → `handleGetProducts(_:result:)` returning the list above; helpers `productPayload(_ product: Product) -> [String: Any?]` and `static func iso8601Duration(_ period: Product.SubscriptionPeriod) -> String`.

- [ ] **Step 1: Wire the dispatch case and append the `getProducts` extension.**

  Edit the `handle(_:result:)` switch in `MyampixPurchasesPlugin.swift` — add the
  `getProducts` case above `default`:
  ```swift
      case "canMakePayments":
        result(AppStore.canMakePayments)
      case "getProducts":
        handleGetProducts(call, result: result)
      default:
        result(FlutterMethodNotImplemented)
  ```

  Append to the end of `MyampixPurchasesPlugin.swift`:
  ```swift
  // MARK: - getProducts

  extension MyampixPurchasesPlugin {
    func handleGetProducts(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
      let args = call.arguments as? [String: Any]
      let ids = (args?["productIds"] as? [String]) ?? []
      guard !ids.isEmpty else {
        succeed(result, [])
        return
      }
      Task { [weak self] in
        guard let self = self else { return }
        do {
          // `Product.products(for:)` already omits ids the store cannot resolve,
          // which satisfies the "products not found are omitted" clause of §5.
          let products = try await Product.products(for: ids)
          let payloads = products.map { self.productPayload($0) }
          self.succeed(result, payloads)
        } catch {
          self.fail(result, "storeProblem", "Failed to load products", "\(error)")
        }
      }
    }

    func productPayload(_ product: Product) -> [String: Any?] {
      var map: [String: Any?] = [
        "storeProductId": product.id,
        "priceString": product.displayPrice,
        // StoreKit 2 `price` is a Decimal in MAJOR currency units (e.g. 9.99).
        // The unified §5 "micros→double" note is the Android convention; iOS
        // returns the plain major-unit double and Dart merges it directly.
        "price": NSDecimalNumber(decimal: product.price).doubleValue,
        "currencyCode": product.priceFormatStyle.locale.currencyCode ?? "",
        "title": product.displayName,
        "description": product.description,
        "subscriptionPeriodIso8601": nil,
      ]
      if let period = product.subscription?.subscriptionPeriod {
        map["subscriptionPeriodIso8601"] = Self.iso8601Duration(period)
      }
      return map
    }

    /// Maps a StoreKit 2 subscription period to an ISO-8601 duration string
    /// (`P1W`/`P1M`/`P1Y`/`P3D`), matching the server's `durationIso8601`.
    static func iso8601Duration(_ period: Product.SubscriptionPeriod) -> String {
      let n = period.value
      switch period.unit {
      case .day: return "P\(n)D"
      case .week: return "P\(n)W"
      case .month: return "P\(n)M"
      case .year: return "P\(n)Y"
      @unknown default: return "P\(n)D"
      }
    }
  }
  ```

- [ ] **Step 2: Dart analyze.**
  ```bash
  cd sdk/flutter_purchases && flutter analyze
  ```
  Expected: `No issues found!` (Dart tree unchanged; standing gate).

- [ ] **Step 3: iOS compile check (toolchain-gated).**
  ```bash
  xcodebuild -version
  if [ -d sdk/flutter_purchases/example/ios ]; then
    cd sdk/flutter_purchases/example && flutter pub get && cd ios && pod install && \
    xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
  else
    echo "COMPILE GATED on P3.7; toolchain present (Xcode 26.6)."
  fi
  ```
  Expected NOW: `else` branch — compile-gated on P3.7.

- [ ] **Step 4: StoreKit 2 review checklist.**
  - [ ] `Product.products(for:)` (StoreKit 2 async), not the legacy `SKProductsRequest`.
  - [ ] Payload keys match §5 exactly: `storeProductId`, `priceString`, `price`, `currencyCode`, `title`, `description`, `subscriptionPeriodIso8601`.
  - [ ] `priceString` = `displayPrice` (already localized/formatted); `price` = decimal→double major units; `title` = `displayName`; `description` = `product.description`.
  - [ ] Missing ids omitted (not returned as null entries) — relies on `Product.products(for:)` returning only resolved products.
  - [ ] Non-subscription products emit `subscriptionPeriodIso8601 = nil` (no `product.subscription`).
  - [ ] Empty/absent `productIds` → `[]`, never a crash; errors → `storeProblem` FlutterError, never a throw into the host.
  - [ ] All Flutter callbacks hop to main via `succeed`/`fail` (StoreKit async runs off the platform thread).

- [ ] **Step 5: Commit.**
  ```bash
  git add sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift
  git commit -m "feat(purchases-ios): getProducts via StoreKit 2 Product.products(for:)"
  ```

---

### Task 3.5.3: `purchase` — `Product.purchase(options:[.appAccountToken(UUID)])` → JWS receipt

**Files:**
- Modify `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`
- Test: none (native; a REAL purchase is device+sandbox-gated, §0/§11 — verification here is compile + review only)

**Interfaces:**
- **Consumes (from P3.4):** `StoreChannel.purchase({storeProductId, appAccountToken})` invokes method `"purchase"` with args `{ "storeProductId": String, "appAccountToken": String /* uuid */ }`, expecting `{ "platform": "APP_STORE", "fetchToken": String /* JWS */, "storeProductId": String }` on success, OR a `PlatformException` whose `code` ∈ `userCancelled | paymentPending | productNotAvailable | storeProblem`.
- **Produces:** `handle(_:result:)` case `"purchase"` → `handlePurchase(_:result:)` returning the success map above (transaction deliberately left UNFINISHED); StoreKit error mapper `failPurchase(_ result:_ error:)`.

- [ ] **Step 1: Wire the dispatch case and append the `purchase` extension.**

  Edit the `handle(_:result:)` switch — add the `purchase` case:
  ```swift
      case "getProducts":
        handleGetProducts(call, result: result)
      case "purchase":
        handlePurchase(call, result: result)
      default:
        result(FlutterMethodNotImplemented)
  ```

  Append to `MyampixPurchasesPlugin.swift`:
  ```swift
  // MARK: - purchase

  extension MyampixPurchasesPlugin {
    func handlePurchase(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
      let args = call.arguments as? [String: Any]
      guard let storeProductId = args?["storeProductId"] as? String, !storeProductId.isEmpty else {
        fail(result, "storeProblem", "Missing storeProductId")
        return
      }
      let tokenString = args?["appAccountToken"] as? String
      Task { [weak self] in
        guard let self = self else { return }
        do {
          let products = try await Product.products(for: [storeProductId])
          guard let product = products.first else {
            self.fail(result, "productNotAvailable", "Product \(storeProductId) is not available")
            return
          }

          // Self-attribution: bind the App Store transaction to our app-user-id
          // (the Dart layer passes uuidFor(appUserId)). appAccountToken must be
          // a valid UUID; if Dart ever sends a non-UUID we simply purchase
          // without the option rather than fail the whole purchase.
          var options: Set<Product.PurchaseOption> = []
          if let tokenString = tokenString, let uuid = UUID(uuidString: tokenString) {
            options.insert(.appAccountToken(uuid))
          }

          let purchaseResult = try await product.purchase(options: options)
          switch purchaseResult {
          case .success(let verification):
            // Forward the signed JWS receipt to Dart; the server re-verifies it.
            // The transaction is deliberately LEFT UNFINISHED — Dart calls
            // finishTransaction only AFTER mobile_purchase grants (design §4). A
            // crash between store-success and server-grant therefore re-delivers
            // the transaction via Transaction.updates (Task 3.5.4) instead of
            // losing the purchase.
            self.succeed(result, [
              "platform": "APP_STORE",
              "fetchToken": verification.jwsRepresentation,
              "storeProductId": product.id,
            ])
          case .userCancelled:
            self.fail(result, "userCancelled", "Purchase cancelled by the user")
          case .pending:
            self.fail(result, "paymentPending", "Purchase is pending (e.g. Ask to Buy / SCA)")
          @unknown default:
            self.fail(result, "storeProblem", "Unknown purchase result")
          }
        } catch {
          self.failPurchase(result, error)
        }
      }
    }

    /// Maps a thrown StoreKit 2 error to the §6 FlutterError code contract.
    func failPurchase(_ result: @escaping FlutterResult, _ error: Error) {
      if let skError = error as? StoreKitError {
        switch skError {
        case .userCancelled:
          fail(result, "userCancelled", "Purchase cancelled by the user")
        case .notAvailableInStorefront:
          fail(result, "productNotAvailable", "Product not available in this storefront", "\(skError)")
        default:
          fail(result, "storeProblem", "StoreKit error", "\(skError)")
        }
        return
      }
      if let purchaseError = error as? Product.PurchaseError {
        switch purchaseError {
        case .productUnavailable:
          fail(result, "productNotAvailable", "Product unavailable for purchase", "\(purchaseError)")
        default:
          fail(result, "storeProblem", "Purchase failed", "\(purchaseError)")
        }
        return
      }
      fail(result, "storeProblem", "Purchase failed", "\(error)")
    }
  }
  ```

- [ ] **Step 2: Dart analyze.**
  ```bash
  cd sdk/flutter_purchases && flutter analyze
  ```
  Expected: `No issues found!`

- [ ] **Step 3: iOS compile check (toolchain-gated).**
  ```bash
  xcodebuild -version
  if [ -d sdk/flutter_purchases/example/ios ]; then
    cd sdk/flutter_purchases/example && flutter pub get && cd ios && pod install && \
    xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
  else
    echo "COMPILE GATED on P3.7; toolchain present (Xcode 26.6)."
  fi
  ```
  Expected NOW: `else` branch — compile-gated on P3.7. **A real purchase is
  device+sandbox-gated** and cannot be exercised here (§0/§11).

- [ ] **Step 4: StoreKit 2 review checklist.**
  - [ ] `Product.purchase(options:)` called with `Set<Product.PurchaseOption>` containing `.appAccountToken(UUID)` (self-attribution, mirrors RC's `appAccountToken`).
  - [ ] `appAccountToken` parsed via `UUID(uuidString:)`; a non-UUID degrades to purchasing without the option, never fails the purchase.
  - [ ] Success returns `{ platform: "APP_STORE", fetchToken: <verification.jwsRepresentation>, storeProductId }` — `fetchToken` is the JWS, exactly what Dart POSTs to `/v1/receipts` (§4 step 2).
  - [ ] **Transaction is NOT finished here** — finishing is Dart-driven after the server grants (§4 step 4 / Task 3.5.4). Losing this invariant would drop purchases on a mid-flow crash.
  - [ ] Result mapping: `.userCancelled`→`userCancelled`, `.pending`→`paymentPending`, `@unknown default`→`storeProblem`.
  - [ ] Thrown-error mapping: `StoreKitError.userCancelled`→`userCancelled`, `.notAvailableInStorefront`/`Product.PurchaseError.productUnavailable`→`productNotAvailable`, everything else→`storeProblem` — matching the §6 code set the Dart `StoreChannel` maps to `PurchasesError`.
  - [ ] Product resolved fresh via `Product.products(for:[id])`; empty → `productNotAvailable`.
  - [ ] No throw escapes into the host; all paths end in `succeed`/`fail` on main.

- [ ] **Step 5: Commit.**
  ```bash
  git add sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift
  git commit -m "feat(purchases-ios): purchase via Product.purchase with appAccountToken -> JWS"
  ```

---

### Task 3.5.4: `Transaction.updates` stream → EventChannel + `finishTransaction`

**Files:**
- Modify `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`
- Test: none (native; out-of-band stream handling verified Dart-side in P3.4 via `FakeStoreChannel` emitting on the fake EventChannel)

**Interfaces:**
- **Consumes (from P3.4):** `StoreChannel.finishTransaction(String transactionId)` invokes method `"finishTransaction"` with args `{ "transactionId": String }`, expecting a `null`/void ack. `TransactionStream` (P3.4) listens on `EventChannel('myampix_purchases/transactions')` for maps `{ platform, fetchToken, storeProductId, transactionId, reason }` and defensively drops malformed ones.
- **Produces:** a long-lived `Transaction.updates` task started in `register` (`startTransactionUpdates()`), emitting `{ platform: "APP_STORE", fetchToken, storeProductId, transactionId, reason: "renewal" }` per out-of-band transaction; `handle(_:result:)` case `"finishTransaction"` → `handleFinishTransaction(_:result:)` calling `Transaction.finish()`.

- [ ] **Step 1: Add the updates task, `finishTransaction`, wire dispatch, and launch the task in `register`.**

  In `MyampixPurchasesPlugin.swift`, add the task-handle property beside `pendingPayloads`:
  ```swift
    private var pendingPayloads: [[String: Any?]] = []

    /// Long-lived task draining `Transaction.updates` (renewals, interrupted
    /// purchases, revocations) onto the EventChannel. Started in `register`,
    /// cancelled in `deinit`.
    private var updatesTask: Task<Void, Never>?
  ```

  Add a `deinit` (place it right after the property block, before `register`):
  ```swift
    deinit {
      updatesTask?.cancel()
    }
  ```

  In `register`, launch the updates task after `registrar.publish(instance)`:
  ```swift
      // Keep the instance alive for the engine's lifetime so the long-lived
      // Transaction.updates task (attached below) is never deallocated.
      registrar.publish(instance)

      // Attach the out-of-band transaction listener (renewals, restores
      // completed out of band, interrupted purchases). Design §4.
      instance.startTransactionUpdates()
  ```

  Edit the `handle(_:result:)` switch — add the `finishTransaction` case:
  ```swift
      case "purchase":
        handlePurchase(call, result: result)
      case "finishTransaction":
        handleFinishTransaction(call, result: result)
      default:
        result(FlutterMethodNotImplemented)
  ```

  Append to `MyampixPurchasesPlugin.swift`:
  ```swift
  // MARK: - Transaction.updates stream + finishTransaction

  extension MyampixPurchasesPlugin {
    /// Drains `Transaction.updates` for the app's lifetime. Every out-of-band
    /// transaction (renewal, interrupted purchase completed later, family-share
    /// grant) is forwarded to Dart, which POSTs it to /v1/receipts and refreshes
    /// CustomerInfo. This is how a renewal detected on-device reaches the server
    /// even without a store→server webhook (design §4 "Out-of-band transactions").
    func startTransactionUpdates() {
      guard updatesTask == nil else { return }
      updatesTask = Task.detached { [weak self] in
        for await verification in Transaction.updates {
          guard let self = self else { return }
          // The server re-verifies the JWS, so we forward the payload without
          // failing on `.unverified`; `unsafePayloadValue` only reads the id.
          let transaction = verification.unsafePayloadValue
          self.emit([
            "platform": "APP_STORE",
            "fetchToken": verification.jwsRepresentation,
            "storeProductId": transaction.productID,
            "transactionId": String(transaction.id),
            "reason": "renewal",
          ])
        }
      }
    }

    /// Finishes a transaction after the Dart layer confirmed the server granted
    /// (design §4 step 4). Scans `Transaction.unfinished` for the matching id so
    /// it works even across app restarts (no in-memory transaction cache needed).
    func handleFinishTransaction(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
      let args = call.arguments as? [String: Any]
      guard let transactionId = args?["transactionId"] as? String, !transactionId.isEmpty else {
        // Malformed input is an ack no-op, never a crash.
        succeed(result, nil)
        return
      }
      Task { [weak self] in
        guard let self = self else { return }
        for await verification in Transaction.unfinished {
          let transaction = verification.unsafePayloadValue
          if String(transaction.id) == transactionId {
            await transaction.finish()
            break
          }
        }
        self.succeed(result, nil)
      }
    }
  }
  ```

- [ ] **Step 2: Dart analyze.**
  ```bash
  cd sdk/flutter_purchases && flutter analyze
  ```
  Expected: `No issues found!`

- [ ] **Step 3: iOS compile check (toolchain-gated).**
  ```bash
  xcodebuild -version
  if [ -d sdk/flutter_purchases/example/ios ]; then
    cd sdk/flutter_purchases/example && flutter pub get && cd ios && pod install && \
    xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
  else
    echo "COMPILE GATED on P3.7; toolchain present (Xcode 26.6)."
  fi
  ```
  Expected NOW: `else` branch — compile-gated on P3.7.

- [ ] **Step 4: StoreKit 2 review checklist.**
  - [ ] `Transaction.updates` drained by ONE long-lived task started in `register`, retained via `updatesTask` and `registrar.publish`, cancelled in `deinit` — not restarted per call, never deallocated.
  - [ ] Emitted payload matches the §5 event shape exactly: `platform="APP_STORE"`, `fetchToken`=`jwsRepresentation`, `storeProductId`=`transaction.productID`, `transactionId`=`String(transaction.id)`, `reason="renewal"` (∈ `purchase|renewal|restore`).
  - [ ] `emit` buffers if Dart hasn't listened yet (cold-start renewal not dropped).
  - [ ] `finishTransaction` scans `Transaction.unfinished` and calls `await transaction.finish()` — stateless across restarts; matched by `String(transaction.id)`.
  - [ ] `finishTransaction` acks (`result(nil)`) even when no match is found or args are malformed — never throws, never hangs the Dart future.
  - [ ] `unsafePayloadValue` is intentional (server is the verification authority); id read does not depend on local verification.

- [ ] **Step 5: Commit.**
  ```bash
  git add sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift
  git commit -m "feat(purchases-ios): Transaction.updates stream + finishTransaction"
  ```

---

### Task 3.5.5: `restore` — `Transaction.currentEntitlements` → EventChannel

**Files:**
- Modify `sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift`
- Test: none (native; restore flow verified Dart-side in P3.4 via `FakeStoreChannel`)

**Interfaces:**
- **Consumes (from P3.4):** `StoreChannel.restore()` invokes method `"restore"` with no args, expecting a `null`/void ack (no direct return); the restored transactions arrive asynchronously on the EventChannel, which `TransactionStream` (P3.4) posts to `/v1/receipts` before Dart refetches `CustomerInfo` (§4 `restorePurchases()`).
- **Produces:** `handle(_:result:)` case `"restore"` → `handleRestore(_:result:)` emitting one event per `Transaction.currentEntitlements` with `reason: "restore"`, and acking `result(nil)` immediately.

- [ ] **Step 1: Wire the dispatch case and append the `restore` extension.**

  Edit the `handle(_:result:)` switch — add the `restore` case:
  ```swift
      case "finishTransaction":
        handleFinishTransaction(call, result: result)
      case "restore":
        handleRestore(call, result: result)
      default:
        result(FlutterMethodNotImplemented)
  ```

  Append to `MyampixPurchasesPlugin.swift`:
  ```swift
  // MARK: - restore (Transaction.currentEntitlements)

  extension MyampixPurchasesPlugin {
    /// Replays the user's current entitlements onto the EventChannel. Per §5
    /// `restore()` has NO direct return — it acks immediately and each active
    /// entitlement is pushed as a `reason: "restore"` event, which Dart binds to
    /// the current app-user-id by POSTing to /v1/receipts (design §4
    /// `restorePurchases()`), then refetches CustomerInfo.
    func handleRestore(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
      succeed(result, nil)
      Task { [weak self] in
        guard let self = self else { return }
        for await verification in Transaction.currentEntitlements {
          let transaction = verification.unsafePayloadValue
          self.emit([
            "platform": "APP_STORE",
            "fetchToken": verification.jwsRepresentation,
            "storeProductId": transaction.productID,
            "transactionId": String(transaction.id),
            "reason": "restore",
          ])
        }
      }
    }
  }
  ```

- [ ] **Step 2: Dart analyze.**
  ```bash
  cd sdk/flutter_purchases && flutter analyze
  ```
  Expected: `No issues found!`

- [ ] **Step 3: iOS compile check (toolchain-gated).**
  ```bash
  xcodebuild -version
  if [ -d sdk/flutter_purchases/example/ios ]; then
    cd sdk/flutter_purchases/example && flutter pub get && cd ios && pod install && \
    xcodebuild -workspace Runner.xcworkspace -scheme Runner -configuration Debug \
      -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build
  else
    echo "COMPILE GATED on P3.7; toolchain present (Xcode 26.6)."
  fi
  ```
  Expected NOW: `else` branch — compile-gated on P3.7. Once P3.7 exists this
  builds the **complete** plugin (all five methods + both streams). A real
  restore against sandbox purchases is device-gated (§0/§11).

- [ ] **Step 4: StoreKit 2 review checklist.**
  - [ ] `restore` uses `Transaction.currentEntitlements` (StoreKit 2), not `SKPaymentQueue.restoreCompletedTransactions()`.
  - [ ] `result(nil)` is returned immediately (no direct payload) — matches the §5 "no direct return" contract; the Dart future resolves promptly while events stream in.
  - [ ] Each entitlement emits `reason: "restore"` with the same §5 payload shape as the updates stream.
  - [ ] Restored transactions are NOT finished here (subscriptions are not consumables; finishing is server-grant-driven only, consistent with Task 3.5.4).
  - [ ] Uses the shared buffering `emit` — restore events before a listener are not lost.
  - [ ] **Full-plugin cross-check:** the `handle` switch now covers all five §5 methods — `canMakePayments`, `getProducts`, `purchase`, `finishTransaction`, `restore` — with `FlutterMethodNotImplemented` only in `default`; channel names, payload keys, and error codes are byte-identical to what P3.4's Dart `StoreChannel`/`TransactionStream` send and expect.

- [ ] **Step 5: Commit.**
  ```bash
  git add sdk/flutter_purchases/ios/Classes/MyampixPurchasesPlugin.swift
  git commit -m "feat(purchases-ios): restore via Transaction.currentEntitlements"
  ```


---

## P3.6 · Android native (Kotlin, Google Play Billing v7+)

Implements the **Android half** of the `myampix_purchases/*` channel contract fixed in
§5 of the design and consumed by **P3.4** (`StoreChannel` / `TransactionStream`, Dart side).
This is **native code, not Dart-TDD**: there is no Dart unit test that exercises Kotlin —
the Dart↔native contract is validated on the Dart side against `FakeStoreChannel` (P3.4).
Verification here is (a) `flutter analyze` (Dart + pubspec plugin block), (b) Gradle
compilation **iff** the local Android toolchain + a consuming app exist, else flagged, and
(c) a Billing-semantics review checklist. A real purchase is device + Play-sandbox gated.

**Toolchain reality captured at plan time (2026-07-17), so the acceptance gate is honest:**
- `flutter` 3.41.7 stable — present. `flutter analyze` runs.
- System `java` is **JDK 8** (`1.8.0_491`). AGP 8.11 + `jvmTarget 17` needs **JDK 17+** →
  Gradle build is **toolchain-gated** until `JAVA_HOME` points at a 17 JBR (e.g. Android
  Studio's bundled `.../jbr/Contents/Home`).
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` **unset**; the SDK itself exists at
  `~/Library/Android/sdk` → needs `example/android/local.properties` `sdk.dir=...` or the env var.
- `sdk/flutter_purchases/example/android` is **ABSENT** (the example app is **P3.7**). The
  spec's acceptance command `cd example/android && ./gradlew :myampix_purchases:assembleDebug`
  therefore **cannot run until P3.7 exists**. → Android compilation is flagged
  **toolchain-gated + example-gated**; it does not block P3.6, exactly per §0/§8.

**CONSUMES (from P3.4, the Dart `StoreChannel` — must match §5 byte-for-byte):**
- `MethodChannel('myampix_purchases/methods')` invocations from Dart:
  - `getProducts({ productIds: List<String> })`
  - `purchase({ storeProductId: String, appAccountToken: String })`
  - `finishTransaction({ transactionId: String, consume?: bool })`
  - `restore()`
  - `canMakePayments()`
- `EventChannel('myampix_purchases/transactions')` that P3.4's `TransactionStream` listens on.

**PRODUCES (the Android half of the channel — what P3.4/P3.5 rely on for cross-platform parity):**
- `MethodChannel` handler returning, per §5:
  - `getProducts` → `List<{ storeProductId, priceString, price:double, currencyCode, title, description, subscriptionPeriodIso8601? }>` (unfound ids omitted).
  - `purchase` → `{ platform: "PLAY_STORE", fetchToken: <purchaseToken>, storeProductId }`, OR `PlatformException(code ∈ {userCancelled, paymentPending, productNotAvailable, storeProblem})`.
  - `finishTransaction` → `null` after `acknowledgePurchase` (default) / `consumeAsync` (when `consume==true`).
  - `restore` → `null`, side-effect: emits current purchases on the EventChannel with `reason:"restore"`.
  - `canMakePayments` → `bool`.
- `EventChannel` broadcast of `{ platform:"PLAY_STORE", fetchToken, storeProductId, transactionId, reason: "renewal"|"restore" }` (Android never emits `"purchase"` on the stream — an explicit `purchase()` is returned directly; renewals / interrupted-purchase replays use `"renewal"`, explicit restore uses `"restore"`).

---

### Task 3.6.1: Android Gradle module + manifest + plugin registration

Stand up the `android/` Gradle module (namespace `com.myampix.purchases`, compileSdk 36,
minSdk 24, JVM 17, Play Billing v7+) and wire the plugin into the pubspec plugin block so
Flutter's `GeneratedPluginRegistrant` discovers `MyampixPurchasesPlugin` on Android.

**Files:**
- Create `sdk/flutter_purchases/android/build.gradle`
- Create `sdk/flutter_purchases/android/src/main/AndroidManifest.xml`
- Modify `sdk/flutter_purchases/pubspec.yaml` (the `flutter.plugin.platforms.android` entry — the file itself is scaffolded by **P3.1**; this task adds/verifies the Android platform block. If P3.1 already added it, confirm it matches exactly and skip the edit.)

**Interfaces:**
- Consumes: nothing (config only).
- Produces: the Gradle module that compiles `MyampixPurchasesPlugin.kt` (Task 3.6.2); the pubspec registration that makes `pluginClass: MyampixPurchasesPlugin` / `package: com.myampix.purchases` discoverable.

- [ ] **Step 1: Write `android/build.gradle`.** Mirror `flutter_analytics/android/build.gradle` exactly (Kotlin 2.2.20, AGP 8.11.1, namespace, compileSdk 36, JVM 17, minSdk 24) but swap the dependency set: this plugin is an **active** biller, so it only needs Play Billing v7+ (no install-referrer).

```gradle
group 'com.myampix.purchases'
version '1.0-SNAPSHOT'

buildscript {
    ext.kotlin_version = '2.2.20'
    repositories {
        google()
        mavenCentral()
    }

    dependencies {
        classpath 'com.android.tools.build:gradle:8.11.1'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
    }
}

rootProject.allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'

android {
    namespace 'com.myampix.purchases'
    compileSdk 36

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    sourceSets {
        main.kotlin.srcDirs += 'src/main/kotlin'
    }

    defaultConfig {
        minSdk 24
    }
}

dependencies {
    // Google Play Billing — used ACTIVELY here (unlike the analytics SDK's
    // passive observer): this plugin fetches ProductDetails, launches the
    // billing flow, acknowledges/consumes, and replays purchases on connect.
    // The billing AAR merges the `com.android.vending.BILLING` permission via
    // manifest merging, so AndroidManifest.xml declares nothing itself.
    implementation 'com.android.billingclient:billing:7.1.1'
}
```

- [ ] **Step 2: Write `android/src/main/AndroidManifest.xml`.** Mirror the analytics manifest shape exactly — an empty manifest whose `package` matches the namespace. The `com.android.vending.BILLING` permission is merged from the billing library AAR, so it is intentionally NOT declared here.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.myampix.purchases">
</manifest>
```

- [ ] **Step 3: Add/verify the Android plugin block in `pubspec.yaml`.** The `flutter.plugin.platforms` block is authored by P3.1; ensure it contains the Android entry below verbatim (add it if missing). This is what makes Flutter generate the Android registrant for `MyampixPurchasesPlugin`.

```yaml
flutter:
  plugin:
    platforms:
      android:
        package: com.myampix.purchases
        pluginClass: MyampixPurchasesPlugin
      ios:
        pluginClass: MyampixPurchasesPlugin
```

- [ ] **Step 4: Verify (Dart side) — `flutter analyze`.** From the package root, the analyzer parses `pubspec.yaml` (including the plugin block) and the Dart tree. This is the always-runnable acceptance gate.

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/sdk/flutter_purchases && flutter analyze
```
Expected: `No issues found!` (Dart/pubspec are clean; the `.gradle`/`.xml`/`.kt` files are not analyzed by `flutter analyze` — they are compiled by Gradle in Task 3.6.2 Step 3).

- [ ] **Step 5: Commit.**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && \
  git add sdk/flutter_purchases/android/build.gradle \
          sdk/flutter_purchases/android/src/main/AndroidManifest.xml \
          sdk/flutter_purchases/pubspec.yaml && \
  git commit -m "feat(purchases-android): gradle module + manifest + plugin registration (P3.6)"
```

---

### Task 3.6.2: `MyampixPurchasesPlugin.kt` — BillingClient, MethodChannel, EventChannel

The whole Android native surface in one file (mirrors §9's single-`.kt` layout, stays <500
lines). `FlutterPlugin` + `ActivityAware` (launchBillingFlow needs a foreground Activity) +
`MethodCallHandler` + `PurchasesUpdatedListener`. Deliberately defensive like the analytics
plugin: no billing callback ever crashes the host.

**Files:**
- Create `sdk/flutter_purchases/android/src/main/kotlin/com/myampix/purchases/MyampixPurchasesPlugin.kt`

**Interfaces:**
- Consumes: the P3.4 MethodChannel invocations + EventChannel subscription (see section CONSUMES).
- Produces: the section PRODUCES surface (the Android channel half).

- [ ] **Step 1: Write the plugin file.** Complete Kotlin below.

```kotlin
package com.myampix.purchases

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * MyAmpix Purchases — Android native store layer (Google Play Billing v7+).
 *
 * Unlike the analytics plugin (a PASSIVE billing observer), this plugin is the
 * ACTIVE biller for the RevenueCat-style purchases SDK: it fetches
 * [ProductDetails], launches the purchase flow with an obfuscated account id
 * (our `appAccountToken` self-attribution), acknowledges/consumes on command,
 * and replays out-of-band / interrupted purchases so Dart can POST them to
 * `mobile_purchase`'s `/v1/receipts`.
 *
 * It holds NO server URL or key and does NO HTTP — it only surfaces store
 * receipts (the Play `purchaseToken`) over two channels (§5):
 *   · MethodChannel `myampix_purchases/methods`  (Dart → native request/response)
 *   · EventChannel  `myampix_purchases/transactions` (native → Dart pushes)
 *
 * Threading: BillingClient is built with no custom executor, so Play Billing
 * v7 delivers every listener callback on the main thread — the same thread
 * `onMethodCall` runs on — making it safe to resolve [MethodChannel.Result]
 * and [EventChannel.EventSink] directly inside those callbacks.
 *
 * Kept deliberately defensive: every entry point is wrapped so a Play Billing
 * failure (missing Play Services, disconnect, malformed callback) degrades to
 * a typed error / dropped event, never a host crash.
 */
class MyampixPurchasesPlugin :
    FlutterPlugin,
    ActivityAware,
    MethodChannel.MethodCallHandler,
    PurchasesUpdatedListener {

    private var methodChannel: MethodChannel? = null
    private var eventChannel: EventChannel? = null
    private var eventSink: EventChannel.EventSink? = null
    private var billingClient: BillingClient? = null
    private var activity: Activity? = null

    /** ProductDetails learned via getProducts()/purchase(); reused to launch flows. */
    private val productDetailsById = mutableMapOf<String, ProductDetails>()

    /** Purchases keyed by purchaseToken so finishTransaction() can ack/consume by token. */
    private val purchasesByToken = mutableMapOf<String, Purchase>()

    /** De-dupes a purchase seen via both the live listener and the connect/restore replay. */
    private val seenTokens = mutableSetOf<String>()

    /** Buffers out-of-band payloads observed before Dart attaches its EventChannel listener. */
    private val pendingEvents = mutableListOf<Map<String, Any?>>()

    /** The single in-flight explicit purchase() call, resolved by onPurchasesUpdated. */
    private var pendingPurchaseResult: MethodChannel.Result? = null
    private var pendingPurchaseProductId: String? = null

    // ---- FlutterPlugin ----

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        val methods = MethodChannel(binding.binaryMessenger, METHOD_CHANNEL)
        methods.setMethodCallHandler(this)
        methodChannel = methods

        val events = EventChannel(binding.binaryMessenger, EVENT_CHANNEL)
        events.setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
                    eventSink = sink
                    if (pendingEvents.isNotEmpty()) {
                        pendingEvents.forEach { sink.success(it) }
                        pendingEvents.clear()
                    }
                }

                override fun onCancel(arguments: Any?) {
                    eventSink = null
                }
            },
        )
        eventChannel = events

        startBillingClient(binding.applicationContext)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel?.setMethodCallHandler(null)
        methodChannel = null
        eventChannel?.setStreamHandler(null)
        eventChannel = null
        eventSink = null
        try {
            billingClient?.endConnection()
        } catch (_: Throwable) {
            // Never crash the host on teardown.
        }
        billingClient = null
    }

    // ---- ActivityAware (launchBillingFlow needs a foreground Activity) ----

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    // ---- BillingClient lifecycle ----

    private fun startBillingClient(context: Context) {
        try {
            val client = BillingClient.newBuilder(context)
                .setListener(this)
                .enablePendingPurchases(
                    PendingPurchasesParams.newBuilder().enableOneTimeProducts().build(),
                )
                .build()
            billingClient = client
            client.startConnection(
                object : BillingClientStateListener {
                    override fun onBillingSetupFinished(billingResult: BillingResult) {
                        if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                            // Renewed / interrupted purchases waiting since a prior
                            // session re-deliver here (unacknowledged only) so Dart
                            // can POST /v1/receipts and then finishTransaction().
                            replayPurchases(client, REASON_RENEWAL, onlyUnacknowledged = true)
                        }
                    }

                    override fun onBillingServiceDisconnected() {
                        // Never crash; method calls lazily reconnect via runWhenReady().
                    }
                },
            )
        } catch (_: Throwable) {
            // Play Billing may be unavailable (no Play Services, ...). Never crash.
        }
    }

    private fun runWhenReady(result: MethodChannel.Result, action: (BillingClient) -> Unit) {
        val client = billingClient
        if (client == null) {
            result.error(ERR_STORE_PROBLEM, "Billing client unavailable", null)
            return
        }
        if (client.isReady) {
            action(client)
            return
        }
        var settled = false
        client.startConnection(
            object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (settled) return
                    settled = true
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        action(client)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }

                override fun onBillingServiceDisconnected() {
                    // The OK/!OK branch above settles on the next setup callback.
                }
            },
        )
    }

    // ---- MethodChannel ----

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "getProducts" -> getProducts(call, result)
                "purchase" -> purchase(call, result)
                "finishTransaction" -> finishTransaction(call, result)
                "restore" -> restore(result)
                "canMakePayments" -> canMakePayments(result)
                else -> result.notImplemented()
            }
        } catch (t: Throwable) {
            result.error(ERR_STORE_PROBLEM, t.message, null)
        }
    }

    /** getProducts({ productIds }) -> List<Map> ; unfound ids omitted. */
    private fun getProducts(call: MethodCall, result: MethodChannel.Result) {
        val productIds = call.argument<List<String>>("productIds") ?: emptyList()
        if (productIds.isEmpty()) {
            result.success(emptyList<Map<String, Any?>>())
            return
        }
        runWhenReady(result) { client ->
            val merged = mutableListOf<Map<String, Any?>>()
            val addedIds = mutableSetOf<String>()
            var remaining = 2
            var settled = false
            for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
                queryDetails(client, productIds, type) { details ->
                    for (d in details) {
                        productDetailsById[d.productId] = d
                        if (addedIds.add(d.productId)) {
                            mapProductDetails(d)?.let { merged.add(it) }
                        }
                    }
                    remaining -= 1
                    if (remaining == 0 && !settled) {
                        settled = true
                        result.success(merged)
                    }
                }
            }
        }
    }

    private fun queryDetails(
        client: BillingClient,
        productIds: List<String>,
        type: String,
        onResult: (List<ProductDetails>) -> Unit,
    ) {
        try {
            val products = productIds.map { id ->
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(type)
                    .build()
            }
            val params = QueryProductDetailsParams.newBuilder()
                .setProductList(products)
                .build()
            client.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    onResult(productDetailsList)
                } else {
                    onResult(emptyList())
                }
            }
        } catch (_: Throwable) {
            onResult(emptyList())
        }
    }

    /**
     * Maps one [ProductDetails] to the §5 getProducts row. One-time products
     * read `oneTimePurchaseOfferDetails`; subscriptions read the LAST pricing
     * phase of the first offer (the base recurring price + its ISO-8601
     * `billingPeriod`, e.g. "P1M"). Micros are converted to a double price.
     */
    private fun mapProductDetails(d: ProductDetails): Map<String, Any?>? {
        val oneTime = d.oneTimePurchaseOfferDetails
        if (oneTime != null) {
            return mapOf(
                "storeProductId" to d.productId,
                "priceString" to oneTime.formattedPrice,
                "price" to oneTime.priceAmountMicros / 1_000_000.0,
                "currencyCode" to oneTime.priceCurrencyCode,
                "title" to d.title,
                "description" to d.description,
                "subscriptionPeriodIso8601" to null,
            )
        }
        val phase = d.subscriptionOfferDetails
            ?.firstOrNull()
            ?.pricingPhases
            ?.pricingPhaseList
            ?.lastOrNull()
            ?: return null
        return mapOf(
            "storeProductId" to d.productId,
            "priceString" to phase.formattedPrice,
            "price" to phase.priceAmountMicros / 1_000_000.0,
            "currencyCode" to phase.priceCurrencyCode,
            "title" to d.title,
            "description" to d.description,
            "subscriptionPeriodIso8601" to phase.billingPeriod,
        )
    }

    /** purchase({ storeProductId, appAccountToken }) -> resolved by onPurchasesUpdated. */
    private fun purchase(call: MethodCall, result: MethodChannel.Result) {
        val storeProductId = call.argument<String>("storeProductId")
        val appAccountToken = call.argument<String>("appAccountToken")
        if (storeProductId.isNullOrEmpty()) {
            result.error(ERR_STORE_PROBLEM, "storeProductId is required", null)
            return
        }
        val currentActivity = activity
        if (currentActivity == null) {
            result.error(ERR_STORE_PROBLEM, "No foreground activity for the billing flow", null)
            return
        }
        if (pendingPurchaseResult != null) {
            result.error(ERR_STORE_PROBLEM, "A purchase is already in progress", null)
            return
        }
        runWhenReady(result) { client ->
            val cached = productDetailsById[storeProductId]
            if (cached != null) {
                launchFlow(client, currentActivity, cached, appAccountToken, result)
                return@runWhenReady
            }
            // Not cached (purchase without a prior getProducts). Fetch SUBS then
            // INAPP details on demand, then launch — or error if truly unknown.
            var remaining = 2
            var found: ProductDetails? = null
            var settled = false
            for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
                queryDetails(client, listOf(storeProductId), type) { details ->
                    details.firstOrNull { it.productId == storeProductId }?.let {
                        productDetailsById[it.productId] = it
                        found = it
                    }
                    remaining -= 1
                    if (remaining == 0 && !settled) {
                        settled = true
                        val d = found
                        if (d == null) {
                            result.error(
                                ERR_PRODUCT_NOT_AVAILABLE,
                                "Product $storeProductId not found",
                                null,
                            )
                        } else {
                            launchFlow(client, currentActivity, d, appAccountToken, result)
                        }
                    }
                }
            }
        }
    }

    private fun launchFlow(
        client: BillingClient,
        activity: Activity,
        details: ProductDetails,
        appAccountToken: String?,
        result: MethodChannel.Result,
    ) {
        val productParamsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
        // Subscriptions require an offer token; one-time products must not set one.
        details.subscriptionOfferDetails?.firstOrNull()?.offerToken?.let {
            productParamsBuilder.setOfferToken(it)
        }
        val flowBuilder = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productParamsBuilder.build()))
        if (!appAccountToken.isNullOrEmpty()) {
            // Self-attribution: binds the Play purchase to our app-user-id (the
            // Android analogue of StoreKit 2's .appAccountToken).
            flowBuilder.setObfuscatedAccountId(appAccountToken)
        }
        // Register the pending call BEFORE launching so a fast callback resolves it.
        pendingPurchaseResult = result
        pendingPurchaseProductId = details.productId
        val launch = client.launchBillingFlow(activity, flowBuilder.build())
        if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
            // The sheet never opened; resolve now and clear the pending call.
            clearPendingPurchase()
            result.error(mapBillingCode(launch.responseCode), launch.debugMessage, null)
        }
    }

    override fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: MutableList<Purchase>?,
    ) {
        try {
            val pending = pendingPurchaseResult
            val pendingId = pendingPurchaseProductId
            if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                if (pending != null) {
                    clearPendingPurchase()
                    pending.error(mapBillingCode(billingResult.responseCode), billingResult.debugMessage, null)
                }
                return
            }
            val list = purchases ?: emptyList()
            list.forEach { indexPurchase(it) }
            var handledPending = false
            for (purchase in list) {
                val matchesPending = !handledPending &&
                    pending != null &&
                    (pendingId == null || purchase.products.contains(pendingId))
                if (matchesPending) {
                    handledPending = true
                    clearPendingPurchase()
                    resolvePendingPurchase(pending!!, purchase, pendingId)
                } else {
                    // A purchase/renewal completed outside our explicit call.
                    emitPurchase(purchase, REASON_RENEWAL)
                }
            }
            if (!handledPending && pending != null) {
                // OK with no purchase object (rare). Don't hang the Dart Future:
                // surface storeProblem; the purchase (if any) still re-delivers
                // on the next connect replay, so nothing is lost.
                clearPendingPurchase()
                pending.error(ERR_STORE_PROBLEM, "Purchase update carried no purchase", null)
            }
        } catch (_: Throwable) {
            // Never crash the host from a billing callback.
        }
    }

    /**
     * Resolves the explicit purchase() MethodChannel call. Deliberately does
     * NOT acknowledge here — Dart calls finishTransaction() only AFTER
     * `mobile_purchase` grants the entitlement (§4), so a server failure leaves
     * the purchase un-acked and it re-delivers on next launch (no lost purchase).
     */
    private fun resolvePendingPurchase(
        result: MethodChannel.Result,
        purchase: Purchase,
        productId: String?,
    ) {
        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                val storeProductId = productId ?: purchase.products.firstOrNull() ?: ""
                result.success(
                    mapOf(
                        "platform" to PLATFORM,
                        "fetchToken" to purchase.purchaseToken,
                        "storeProductId" to storeProductId,
                    ),
                )
            }
            Purchase.PurchaseState.PENDING ->
                result.error(ERR_PAYMENT_PENDING, "Purchase is pending", null)
            else ->
                result.error(ERR_STORE_PROBLEM, "Purchase in unspecified state", null)
        }
    }

    /** finishTransaction({ transactionId, consume? }) -> null (ack default / consume opt-in). */
    private fun finishTransaction(call: MethodCall, result: MethodChannel.Result) {
        val token = call.argument<String>("transactionId")
        val consume = call.argument<Boolean>("consume") ?: false
        if (token.isNullOrEmpty()) {
            result.error(ERR_STORE_PROBLEM, "transactionId (purchase token) is required", null)
            return
        }
        runWhenReady(result) { client ->
            if (consume) {
                val params = ConsumeParams.newBuilder().setPurchaseToken(token).build()
                client.consumeAsync(params) { billingResult, _ ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        result.success(null)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }
            } else {
                if (purchasesByToken[token]?.isAcknowledged == true) {
                    // Idempotent: already acknowledged (e.g. a re-delivered replay).
                    result.success(null)
                    return@runWhenReady
                }
                val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()
                client.acknowledgePurchase(params) { billingResult ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        result.success(null)
                    } else {
                        result.error(ERR_STORE_PROBLEM, billingResult.debugMessage, null)
                    }
                }
            }
        }
    }

    /** restore() -> null; re-emits ALL current purchases on the EventChannel. */
    private fun restore(result: MethodChannel.Result) {
        runWhenReady(result) { client ->
            // A deliberate restore re-binds everything to the (possibly new)
            // app-user-id, so clear the de-dupe and emit every purchase.
            seenTokens.clear()
            replayPurchases(client, REASON_RESTORE, onlyUnacknowledged = false)
            result.success(null)
        }
    }

    private fun canMakePayments(result: MethodChannel.Result) {
        val client = billingClient
        if (client != null && client.isReady) {
            val supported = client.isFeatureSupported(BillingClient.FeatureType.SUBSCRIPTIONS)
            result.success(supported.responseCode == BillingClient.BillingResponseCode.OK)
        } else {
            result.success(false)
        }
    }

    /**
     * Queries owned purchases (SUBS + INAPP) and emits each on the EventChannel.
     * `onlyUnacknowledged` restricts a connect replay to genuinely interrupted
     * purchases (still awaiting a server grant); restore() passes false to emit all.
     */
    private fun replayPurchases(client: BillingClient, reason: String, onlyUnacknowledged: Boolean) {
        for (type in listOf(BillingClient.ProductType.SUBS, BillingClient.ProductType.INAPP)) {
            try {
                val params = QueryPurchasesParams.newBuilder().setProductType(type).build()
                client.queryPurchasesAsync(params) { billingResult, purchases ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        for (p in purchases) {
                            indexPurchase(p)
                            if (onlyUnacknowledged && p.isAcknowledged) continue
                            emitPurchase(p, reason)
                        }
                    }
                }
            } catch (_: Throwable) {
                // Best-effort only.
            }
        }
    }

    private fun indexPurchase(purchase: Purchase) {
        val token = purchase.purchaseToken
        if (token.isNotEmpty()) purchasesByToken[token] = purchase
    }

    private fun emitPurchase(purchase: Purchase, reason: String) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        val token = purchase.purchaseToken
        if (token.isEmpty()) return
        if (!seenTokens.add(token)) return // de-dupe live listener vs replay
        val storeProductId = purchase.products.firstOrNull() ?: return
        emit(
            mapOf(
                "platform" to PLATFORM,
                "fetchToken" to token,
                "storeProductId" to storeProductId,
                "transactionId" to (purchase.orderId ?: token),
                "reason" to reason,
            ),
        )
    }

    private fun emit(payload: Map<String, Any?>) {
        val sink = eventSink
        if (sink != null) {
            sink.success(payload)
        } else {
            pendingEvents.add(payload)
        }
    }

    private fun clearPendingPurchase() {
        pendingPurchaseResult = null
        pendingPurchaseProductId = null
    }

    private companion object {
        const val METHOD_CHANNEL = "myampix_purchases/methods"
        const val EVENT_CHANNEL = "myampix_purchases/transactions"
        const val PLATFORM = "PLAY_STORE"
        const val REASON_RENEWAL = "renewal"
        const val REASON_RESTORE = "restore"
        const val ERR_USER_CANCELLED = "userCancelled"
        const val ERR_PAYMENT_PENDING = "paymentPending"
        const val ERR_PRODUCT_NOT_AVAILABLE = "productNotAvailable"
        const val ERR_STORE_PROBLEM = "storeProblem"
    }
}

private fun mapBillingCode(responseCode: Int): String = when (responseCode) {
    BillingClient.BillingResponseCode.USER_CANCELED -> "userCancelled"
    BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "productNotAvailable"
    // Everything else (SERVICE_*, BILLING_UNAVAILABLE, DEVELOPER_ERROR, ERROR,
    // ITEM_ALREADY_OWNED, ITEM_NOT_OWNED, NETWORK_ERROR, FEATURE_NOT_SUPPORTED)
    // maps to the single §5 store-failure code; PENDING is handled separately.
    else -> "storeProblem"
}
```

- [ ] **Step 2: Verify (Dart side) — `flutter analyze`.** The Kotlin file does not affect the Dart analyzer, but re-run it to confirm the package is still clean after adding native sources (no accidental pubspec breakage).

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix/sdk/flutter_purchases && flutter analyze
```
Expected: `No issues found!`

- [ ] **Step 3: Verify (native compile) — Gradle, TOOLCHAIN-GATED + EXAMPLE-GATED.** The spec's acceptance command compiles the Android module through a consuming app. At plan time `example/android` does not exist (it is **P3.7**), the system JDK is **8** (need **17**), and `ANDROID_HOME` is unset — so this step is expected to be **flagged, not run**, until those gates open. When they do, run exactly:

```bash
# Prereqs (open the gate):
#   1. JDK 17: export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
#   2. Android SDK: echo "sdk.dir=$HOME/Library/Android/sdk" > \
#        /Users/aimeric/Documents/personnal-project/MyAmpix/sdk/flutter_purchases/example/android/local.properties
#   3. The example app must exist (P3.7) — `flutter create` under example/ generates android/.
cd /Users/aimeric/Documents/personnal-project/MyAmpix/sdk/flutter_purchases/example/android && \
  ./gradlew :myampix_purchases:assembleDebug
```
Expected when the gate is open: `BUILD SUCCESSFUL`. Until then, record in the PR/commit:
**"Android native compilation flagged toolchain-gated (system JDK 8, ANDROID_HOME unset) and example-gated (example/android is P3.7); Dart `flutter analyze` clean; Kotlin reviewed against Billing semantics (Task 3.6.3)."**

- [ ] **Step 4: Commit.**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && \
  git add sdk/flutter_purchases/android/src/main/kotlin/com/myampix/purchases/MyampixPurchasesPlugin.kt && \
  git commit -m "feat(purchases-android): BillingClient plugin — getProducts/purchase/finish/restore over channels (P3.6)"
```

---

### Task 3.6.3: Google Play Billing semantics review checklist + gated acceptance

No new code — the acceptance gate for native written-but-not-run code (§8). A reviewer (and
Codex) walks the checklist against `MyampixPurchasesPlugin.kt`; the device/sandbox items are
explicitly deferred to the hard external gates (§11). Record the outcome in the PR description.

**Files:**
- None (review artifact recorded in the PR / commit message; do NOT create a `.md`).

**Interfaces:**
- Consumes: Task 3.6.2's plugin.
- Produces: a signed-off review + an honest gate statement.

- [ ] **Step 1: Channel-contract conformance (verifiable now, by reading the code).**
  - [ ] Channel names are exactly `myampix_purchases/methods` and `myampix_purchases/transactions` (match §5 / P3.4).
  - [ ] `getProducts` rows carry exactly `{storeProductId, priceString, price, currencyCode, title, description, subscriptionPeriodIso8601}`; `price` is micros→double; subs period is the ISO-8601 `billingPeriod`; one-time products send `subscriptionPeriodIso8601: null`; unfound ids are omitted.
  - [ ] `purchase` success returns `{platform:"PLAY_STORE", fetchToken:<purchaseToken>, storeProductId}`; errors are `PlatformException(code)` with `code ∈ {userCancelled, paymentPending, productNotAvailable, storeProblem}` and nothing else.
  - [ ] EventChannel payloads carry `{platform, fetchToken, storeProductId, transactionId, reason}` with `reason ∈ {renewal, restore}`.
  - [ ] `finishTransaction` acknowledges by default and consumes only when `consume==true`; is idempotent on an already-acknowledged token.

- [ ] **Step 2: Play Billing v7 semantics (verifiable now).**
  - [ ] `BillingClient` built with `enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())` (the v7 form; the no-arg overload is deprecated).
  - [ ] `queryProductDetailsAsync` is called for BOTH `SUBS` and `INAPP` and the results merged (a productId is one type or the other; unfound ids drop out).
  - [ ] Subscription pricing reads the LAST pricing phase of the first offer (base recurring price + period), and `launchBillingFlow` sets the subscription `offerToken`; one-time products set NO offer token.
  - [ ] `setObfuscatedAccountId(appAccountToken)` is set on the flow (self-attribution) whenever a non-empty token is supplied.
  - [ ] Acknowledgement is DEFERRED to `finishTransaction` (called by Dart only after the `/v1/receipts` grant), never done inside `onPurchasesUpdated` — so a post-purchase server failure leaves the purchase un-acked and it re-delivers next launch (no lost purchase, §4).
  - [ ] `queryPurchasesAsync` runs on connect (unacknowledged only → `reason:"renewal"`) and for `restore()` (all → `reason:"restore"`), and `PurchasesUpdatedListener` handles the live path; `seenTokens` de-dupes live-vs-replay.
  - [ ] Threading: BillingClient uses the default (main-thread) executor, so resolving `MethodChannel.Result`/`EventSink.success` directly inside billing callbacks is on the platform thread. (If a future Billing bump changes the default executor, wrap resolutions in a `Handler(Looper.getMainLooper())`.)
  - [ ] Defensiveness: every callback/entry point is `try/catch`-guarded; teardown ends the connection without throwing; a missing Activity / disconnected client yields a typed `storeProblem`, never a crash.
  - [ ] Error mapping: `USER_CANCELED→userCancelled`, `ITEM_UNAVAILABLE→productNotAvailable`, `PurchaseState.PENDING→paymentPending`, everything else→`storeProblem`.
  - [ ] Manifest/permission: the `com.android.vending.BILLING` permission is merged from the billing AAR (not hand-declared); `android/build.gradle` namespace `com.myampix.purchases`, compileSdk 36, minSdk 24, JVM 17.

- [ ] **Step 3: Deferred — device + Play sandbox gated (CANNOT be verified here; §0/§11).** Record as gated, do not attempt:
  - [ ] A real `launchBillingFlow` purchase on a physical Android device with a Play license tester.
  - [ ] End-to-end: purchase → `POST /v1/receipts` grants entitlement → `finishTransaction` acknowledges → renewal re-delivered on next launch.
  - [ ] `restorePurchases` re-binds existing Play purchases to the current app-user-id.
  - [ ] Requires: a Google Play app with subscription/IAP products, both `storeProductId`s registered as server catalog `Product`s mapped to `Entitlement`s, and the server deployed with real Google credentials (X1).

- [ ] **Step 4: Commit the review outcome** (in the PR description or an empty marker commit — no new file per repo rules).

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && \
  git commit --allow-empty -m "chore(purchases-android): Billing-semantics review checklist signed off; native compile toolchain/example-gated, real purchase device+sandbox-gated (P3.6)"
```


---

## P3.7 · Example app + wiring

Scope: a minimal, runnable `example/` Flutter app that drives the whole public
`MyAmpixPurchases` facade end-to-end — configure with an `mp_pub_` key + serverUrl,
`getOfferings()` → list packages, `purchasePackage` → buy, `getCustomerInfo()` →
show `entitlements.active`, and `restorePurchases()` — plus a README documenting the
manual device/sandbox test steps and the env the user must supply. Acceptance:
`flutter analyze` clean on `example/`; a widget test that pumps the app against
injected fakes (MockClient + a mocked platform MethodChannel + mocked
SharedPreferences — no real store, no real network). PRODUCES nothing downstream.

**Consumed public surface (must match P3.1/P3.3/P3.4 exactly).** These are the exact
signatures this section imports from `package:myampix_purchases/myampix_purchases.dart`.
If any drift from the finalized earlier sections, reconcile the fixtures/imports here
(they are the only coupling points):

- Facade (P3.3/P3.4 — `MyAmpixPurchases`):
  - `static Future<void> configure(PurchasesConfiguration configuration, {@visibleForTesting SdkOverrides? overrides})`
  - `static Future<Offerings> getOfferings()`
  - `static Future<CustomerInfo> getCustomerInfo()`
  - `static Future<PurchaseResult> purchasePackage(Package packageToPurchase)`
  - `static Future<CustomerInfo> restorePurchases()`
  - `static void addCustomerInfoUpdateListener(CustomerInfoUpdateListener listener)`
  - `static void removeCustomerInfoUpdateListener(CustomerInfoUpdateListener listener)`
  - `@visibleForTesting static Future<void> shutdownForTesting()`
- Config/enums/listener (P3.1/P3.3):
  - `class PurchasesConfiguration({required String apiKey, required String serverUrl, String? appUserID, MyAmpixLogLevel logLevel})`
  - `enum MyAmpixLogLevel { none, error, warn, info, debug }`
  - `typedef CustomerInfoUpdateListener = void Function(CustomerInfo)`
  - `@visibleForTesting class SdkOverrides({http.Client? httpClient, ...})` (this section only
    reads the `httpClient` field; the store side is faked at the platform MethodChannel per §5,
    so no other `SdkOverrides` field is required by P3.7)
- Models (P3.1):
  - `Offerings { Offering? current; Map<String,Offering> all; }`
  - `Offering { List<Package> availablePackages; String identifier; }`
  - `Package { String identifier; StoreProduct storeProduct; }`
  - `StoreProduct { String title; String priceString; }`
  - `PurchaseResult { CustomerInfo customerInfo; }`
  - `CustomerInfo { EntitlementInfos entitlements; }`
  - `EntitlementInfos { Map<String,EntitlementInfo> active; }`
  - `EntitlementInfo { String identifier; String productIdentifier; }`
  - `PurchasesError { String message; bool userCancelled; }` (thrown by the throwing methods; §6)
- Native contract (P3.4/P3.5/P3.6 — §5), faked in the widget test via `MethodChannel('myampix_purchases/methods')`:
  - method `getProducts({productIds})` → `List<{storeProductId, priceString, price, currencyCode, title, description, subscriptionPeriodIso8601?}>`
  - method `purchase({storeProductId, appAccountToken})` → `{platform, fetchToken, storeProductId, transactionId}`
  - methods `finishTransaction({transactionId})`, `restore()`, `canMakePayments()`

---

### Task 3.7.1: example package scaffold + demo config

Bootstraps the `example/` package (pubspec with a `path: ../` dep on the SDK,
`flutter_lints` analysis options, and a copy-pasteable `demo_config.dart` holding the
`mp_pub_` key + serverUrl). Mirrors `sdk/flutter_analytics/example` exactly.

**Files:**
- Create: `sdk/flutter_purchases/example/pubspec.yaml`
- Create: `sdk/flutter_purchases/example/analysis_options.yaml`
- Create: `sdk/flutter_purchases/example/lib/demo_config.dart`
- Test: `sdk/flutter_purchases/example/test/demo_config_test.dart`

**Interfaces:**
- Consumes: nothing yet (pure scaffold).
- Produces (for later tasks in this section only): top-level `const String demoServerUrl`,
  `const String demoApiKey` in `myampix_purchases_example/demo_config.dart`.

- [ ] **Step 1: write failing test.** Create `sdk/flutter_purchases/example/test/demo_config_test.dart`:

  ```dart
  import 'package:flutter_test/flutter_test.dart';
  import 'package:myampix_purchases_example/demo_config.dart';

  void main() {
    test('demo config is a public mp_pub_ SDK key against a normalized base URL', () {
      // The demo must use a PUBLIC SDK key (mp_pub_), never a secret server key.
      expect(demoApiKey, startsWith('mp_pub_'));
      expect(demoApiKey.length, greaterThan('mp_pub_'.length));

      // A usable http(s) base URL with no trailing slash (the SDK normalizes,
      // but the demo config is authored already-normalized).
      expect(demoServerUrl, anyOf(startsWith('http://'), startsWith('https://')));
      expect(demoServerUrl, isNot(endsWith('/')));
    });
  }
  ```

- [ ] **Step 2: run to fail.**
  `cd sdk/flutter_purchases/example && flutter test test/demo_config_test.dart`
  Expected failure: analysis/compile error — `Target of URI doesn't exist:
  'package:myampix_purchases_example/demo_config.dart'` (and `demoApiKey`/`demoServerUrl`
  undefined), because neither the pubspec nor `demo_config.dart` exist yet.

- [ ] **Step 3: minimal implementation.** Create the three source files.

  `sdk/flutter_purchases/example/pubspec.yaml`:
  ```yaml
  name: myampix_purchases_example
  description: >-
    Example Flutter app demonstrating the MyAmpix purchases SDK
    (myampix_purchases): configure, offerings, purchase, entitlements, restore.
  publish_to: none
  version: 0.1.0

  environment:
    sdk: ">=3.8.0 <4.0.0"
    flutter: ">=3.32.0"

  dependencies:
    flutter:
      sdk: flutter
    myampix_purchases:
      path: ../

  dev_dependencies:
    flutter_test:
      sdk: flutter
    flutter_lints: ^6.0.0
    http: ^1.2.0
    shared_preferences: ^2.2.0

  flutter:
    uses-material-design: true
  ```

  `sdk/flutter_purchases/example/analysis_options.yaml`:
  ```yaml
  include: package:flutter_lints/flutter.yaml
  ```

  `sdk/flutter_purchases/example/lib/demo_config.dart`:
  ```dart
  /// Demo configuration for the MyAmpix purchases example app.
  ///
  /// These are intentionally plain top-level `const`s (no `--dart-define` / env
  /// plumbing) so the example stays copy-pasteable.
  library;

  /// Base URL of the `mobile_purchase` backend the demo app talks to.
  ///
  /// Defaults to `http://localhost:8088`, which works on a real device, desktop,
  /// or the iOS simulator alongside a `mobile_purchase` backend on this machine.
  /// The Android emulator cannot reach the host's `localhost` — use
  /// `http://10.0.2.2:8088` instead (the emulator's alias for the host loopback).
  const String demoServerUrl = 'http://localhost:8088';

  /// Demo PUBLIC SDK key: `mp_pub_` followed by 32 hex zeros.
  ///
  /// This is a placeholder public key. A real `mobile_purchase` deployment will
  /// reject it (401) — replace it with the `mp_pub_` key printed for your app.
  /// The demo still runs regardless: the SDK never throws internal machinery
  /// into the host, and the throwing read/purchase methods surface a typed
  /// `PurchasesError` the demo catches and shows on screen.
  const String demoApiKey = 'mp_pub_00000000000000000000000000000000';
  ```

- [ ] **Step 4: run to pass.**
  `cd sdk/flutter_purchases/example && flutter test test/demo_config_test.dart`
  Expected: `+1: All tests passed`.

- [ ] **Step 5: commit.**
  ```sh
  git add sdk/flutter_purchases/example/pubspec.yaml \
          sdk/flutter_purchases/example/analysis_options.yaml \
          sdk/flutter_purchases/example/lib/demo_config.dart \
          sdk/flutter_purchases/example/test/demo_config_test.dart
  git commit -m "test(purchases-example): scaffold example package + demo config"
  ```

---

### Task 3.7.2: demo app widget + facade wiring + acceptance widget test

The runnable demo UI and its wiring to the facade: `main()` configures
`MyAmpixPurchases`, and a single `PurchasesDemoPage` loads offerings + customer info,
renders each package with a **Buy** button (`purchasePackage`), renders
`entitlements.active` from `getCustomerInfo`, and a **Restore** action
(`restorePurchases`). The acceptance widget test pumps `PurchasesDemoApp` against
injected fakes — a `MockClient` (via `SdkOverrides.httpClient`) serving the three
`mobile_purchase` endpoints, a mocked `myampix_purchases/methods` MethodChannel
(§5 store contract), and `SharedPreferences.setMockInitialValues` — so a full
buy + restore runs with **no real store and no real network**.

**Files:**
- Create: `sdk/flutter_purchases/example/lib/main.dart`
- Create: `sdk/flutter_purchases/example/lib/purchases_demo_page.dart`
- Test: `sdk/flutter_purchases/example/test/widget_test.dart`

**Interfaces:**
- Consumes: the full public facade + models listed at the top of this section
  (`MyAmpixPurchases.configure/getOfferings/getCustomerInfo/purchasePackage/restorePurchases/`
  `addCustomerInfoUpdateListener/removeCustomerInfoUpdateListener/shutdownForTesting`,
  `PurchasesConfiguration`, `MyAmpixLogLevel`, `SdkOverrides`, `Offerings`, `Offering`,
  `Package`, `StoreProduct`, `CustomerInfo`, `EntitlementInfos`, `EntitlementInfo`,
  `PurchaseResult`, `PurchasesError`); the §5 native MethodChannel contract, faked.
- Produces (for the widget test only): `Future<void> configureDemo()`,
  `class PurchasesDemoApp extends StatelessWidget`, `class PurchasesDemoPage extends StatefulWidget`.

- [ ] **Step 1: write failing test.** Create `sdk/flutter_purchases/example/test/widget_test.dart`.
  It registers a mock `myampix_purchases/methods` MethodChannel, a `MockClient`
  serving `GET /v1/offerings`, `GET /v1/subscribers/:id`, `POST /v1/receipts` (fixtures
  follow the §3 server contract), configures the SDK with `SdkOverrides(httpClient: ...)`
  inside `runAsync` (real zone, so the mocked `shared_preferences`/channel round-trips
  complete), pumps `PurchasesDemoApp`, then asserts the package + empty-entitlements
  render, taps **Buy**, and asserts the granted entitlement + success snackbar.

  ```dart
  import 'dart:convert';

  import 'package:flutter/material.dart';
  import 'package:flutter/services.dart';
  import 'package:flutter_test/flutter_test.dart';
  import 'package:http/http.dart' as http;
  import 'package:http/testing.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';
  import 'package:myampix_purchases_example/demo_config.dart';
  import 'package:myampix_purchases_example/main.dart';
  import 'package:shared_preferences/shared_preferences.dart';

  /// The store product the fixtures + native fake agree on.
  const String _productId = 'com.myampix.pro.monthly';

  /// A current offering with a single monthly package, shaped per design §3
  /// (`GET /v1/offerings` → `{ current: ResolvedOffering | null }`).
  final Map<String, Object?> _offeringsJson = {
    'current': {
      'identifier': 'default',
      'metadata': <String, Object?>{},
      'packages': [
        {
          'identifier': r'$rc_monthly',
          'packageType': 'monthly',
          'product': {
            'storeProductId': _productId,
            'type': 'autoRenewableSubscription',
            'priceCents': 999,
            'currency': 'USD',
            'durationIso8601': 'P1M',
            'entitlements': ['pro'],
          },
        },
      ],
    },
  };

  /// A subscriber with no entitlements yet (the initial `GET /v1/subscribers/:id`).
  final Map<String, Object?> _emptyCustomerJson = {
    'firstSeen': '2026-07-01T00:00:00Z',
    'managementURL': null,
    'subscriptions': <Object?>[],
    'entitlements': {'all': <String, Object?>{}, 'active': <String, Object?>{}},
  };

  /// The 'pro' entitlement (map key is the identifier, per §3).
  final Map<String, Object?> _proEntitlement = {
    'isActive': true,
    'willRenew': true,
    'periodType': 'normal',
    'latestPurchaseDate': '2026-07-17T00:00:00Z',
    'originalPurchaseDate': '2026-07-17T00:00:00Z',
    'expirationDate': '2026-08-17T00:00:00Z',
    'store': 'app_store',
    'productIdentifier': _productId,
    'unsubscribeDetectedAt': null,
    'billingIssueDetectedAt': null,
    'ownershipType': 'PURCHASED',
  };

  /// The granted customer returned by `POST /v1/receipts` → `{ customerInfo }`.
  late final Map<String, Object?> _grantedCustomerJson = {
    'firstSeen': '2026-07-01T00:00:00Z',
    'managementURL': null,
    'subscriptions': [
      {'storeProductId': _productId, 'isActive': true, 'expirationDate': '2026-08-17T00:00:00Z'},
    ],
    'entitlements': {
      'all': {'pro': _proEntitlement},
      'active': {'pro': _proEntitlement},
    },
  };

  http.Client _fakeBackend() {
    return MockClient((request) async {
      final path = request.url.path;
      if (request.method == 'GET' && path.endsWith('/v1/offerings')) {
        return http.Response(jsonEncode(_offeringsJson), 200,
            headers: {'content-type': 'application/json'});
      }
      if (request.method == 'GET' && path.contains('/v1/subscribers/')) {
        return http.Response(jsonEncode(_emptyCustomerJson), 200,
            headers: {'content-type': 'application/json'});
      }
      if (request.method == 'POST' && path.endsWith('/v1/receipts')) {
        return http.Response(jsonEncode({'customerInfo': _grantedCustomerJson}), 200,
            headers: {'content-type': 'application/json'});
      }
      return http.Response('{}', 404);
    });
  }

  /// Advances the tree by a fixed, bounded number of frames — enough to run the
  /// initState loads + a tap's async round-trip (MockClient + mocked channel)
  /// to completion, without depending on a perpetual animation.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  void main() {
    const channel = MethodChannel('myampix_purchases/methods');

    setUp(() {
      // Make the persisted app-user-id store (shared_preferences) work under test.
      SharedPreferences.setMockInitialValues(<String, Object>{});

      // Fake the native store: no real StoreKit / Play Billing. getProducts
      // returns localized metadata; purchase returns a receipt token; finish is
      // a no-op ack. Keys mirror the design §5 native contract.
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        switch (call.method) {
          case 'getProducts':
            return <Object?>[
              {
                'storeProductId': _productId,
                'priceString': r'$9.99',
                'price': 9.99,
                'currencyCode': 'USD',
                'title': 'Pro Monthly',
                'description': 'Monthly pro subscription',
                'subscriptionPeriodIso8601': 'P1M',
              },
            ];
          case 'purchase':
            return <String, Object?>{
              'platform': 'APP_STORE',
              'fetchToken': 'fake-jws-token',
              'storeProductId': _productId,
              'transactionId': 'txn-1',
            };
          case 'finishTransaction':
          case 'restore':
            return null;
          case 'canMakePayments':
            return true;
          default:
            return null;
        }
      });
    });

    tearDown(() async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
      await MyAmpixPurchases.shutdownForTesting();
    });

    testWidgets('demo shows offerings, buys a package, and shows the granted '
        'entitlement — all against fakes, no real store', (tester) async {
      // Configure in the REAL async zone: the mocked shared_preferences /
      // MethodChannel replies are delivered off the fake-async clock, so this
      // avoids a deadlock before the first pump. The SDK still never throws.
      await tester.runAsync(() async {
        await MyAmpixPurchases.configure(
          const PurchasesConfiguration(
            apiKey: demoApiKey,
            serverUrl: demoServerUrl,
            logLevel: MyAmpixLogLevel.debug,
          ),
          overrides: SdkOverrides(httpClient: _fakeBackend()),
        );
      });

      await tester.pumpWidget(const PurchasesDemoApp());
      await settle(tester);

      // Offerings rendered (native title + native priceString).
      expect(find.text('Pro Monthly'), findsOneWidget);
      expect(find.text(r'$9.99'), findsOneWidget);
      // No entitlements before buying.
      expect(find.text('No active entitlements.'), findsOneWidget);

      // Buy the package.
      await tester.tap(find.widgetWithText(FilledButton, 'Buy'));
      await settle(tester);

      // Granted 'pro' entitlement is now shown and a success snackbar fired.
      expect(find.text('No active entitlements.'), findsNothing);
      expect(find.textContaining('pro'), findsWidgets);
      expect(find.textContaining('Purchased'), findsOneWidget);
    });
  }
  ```

- [ ] **Step 2: run to fail.**
  `cd sdk/flutter_purchases/example && flutter test test/widget_test.dart`
  Expected failure: compile error — `Target of URI doesn't exist:
  'package:myampix_purchases_example/main.dart'` and `PurchasesDemoApp` undefined,
  because `main.dart` / `purchases_demo_page.dart` don't exist yet.

- [ ] **Step 3: minimal implementation.** Create the two source files.

  `sdk/flutter_purchases/example/lib/main.dart`:
  ```dart
  import 'package:flutter/material.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';

  import 'demo_config.dart';
  import 'purchases_demo_page.dart';

  Future<void> main() async {
    WidgetsFlutterBinding.ensureInitialized();
    await configureDemo();
    runApp(const PurchasesDemoApp());
  }

  /// Configures MyAmpixPurchases for the demo.
  ///
  /// Factored out of [main] so it can be reused; the widget test configures the
  /// SDK itself (with `SdkOverrides` fakes) and does NOT call this — production
  /// code must never pass the `@visibleForTesting` overrides seam. `configure`
  /// never throws internal machinery into the host; on an unreachable backend
  /// the throwing read/purchase methods surface a typed `PurchasesError` that
  /// the demo page catches and shows on screen.
  Future<void> configureDemo() {
    return MyAmpixPurchases.configure(
      const PurchasesConfiguration(
        apiKey: demoApiKey,
        serverUrl: demoServerUrl,
        logLevel: MyAmpixLogLevel.debug,
      ),
    );
  }

  class PurchasesDemoApp extends StatelessWidget {
    const PurchasesDemoApp({super.key});

    @override
    Widget build(BuildContext context) {
      return MaterialApp(
        title: 'MyAmpix Purchases Demo',
        theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
        home: const PurchasesDemoPage(),
      );
    }
  }
  ```

  `sdk/flutter_purchases/example/lib/purchases_demo_page.dart`:
  ```dart
  import 'package:flutter/material.dart';
  import 'package:myampix_purchases/myampix_purchases.dart';

  /// Minimal end-to-end demo of the MyAmpixPurchases facade:
  /// `getOfferings` → `purchasePackage` → `getCustomerInfo` (entitlements.active)
  /// → `restorePurchases`.
  class PurchasesDemoPage extends StatefulWidget {
    const PurchasesDemoPage({super.key});

    @override
    State<PurchasesDemoPage> createState() => _PurchasesDemoPageState();
  }

  class _PurchasesDemoPageState extends State<PurchasesDemoPage> {
    Offerings? _offerings;
    CustomerInfo? _customerInfo;
    String? _error;
    bool _loading = true;

    @override
    void initState() {
      super.initState();
      // Fires on every CustomerInfo change (purchase, restore, renewal).
      MyAmpixPurchases.addCustomerInfoUpdateListener(_onCustomerInfo);
      _load();
    }

    @override
    void dispose() {
      MyAmpixPurchases.removeCustomerInfoUpdateListener(_onCustomerInfo);
      super.dispose();
    }

    void _onCustomerInfo(CustomerInfo info) {
      if (!mounted) return;
      setState(() => _customerInfo = info);
    }

    Future<void> _load() async {
      setState(() {
        _loading = true;
        _error = null;
      });
      try {
        final offerings = await MyAmpixPurchases.getOfferings();
        final info = await MyAmpixPurchases.getCustomerInfo();
        if (!mounted) return;
        setState(() {
          _offerings = offerings;
          _customerInfo = info;
          _loading = false;
        });
      } on PurchasesError catch (e) {
        if (!mounted) return;
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }

    Future<void> _buy(Package package) async {
      try {
        final result = await MyAmpixPurchases.purchasePackage(package);
        if (!mounted) return;
        setState(() => _customerInfo = result.customerInfo);
        _snack('Purchased ${package.identifier}');
      } on PurchasesError catch (e) {
        _snack(e.userCancelled ? 'Purchase cancelled' : 'Purchase failed: ${e.message}');
      }
    }

    Future<void> _restore() async {
      try {
        final info = await MyAmpixPurchases.restorePurchases();
        if (!mounted) return;
        setState(() => _customerInfo = info);
        _snack('Restored ${info.entitlements.active.length} entitlement(s)');
      } on PurchasesError catch (e) {
        _snack('Restore failed: ${e.message}');
      }
    }

    void _snack(String message) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(message)));
    }

    @override
    Widget build(BuildContext context) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('MyAmpix Purchases Demo'),
          actions: [
            IconButton(
              onPressed: _restore,
              icon: const Icon(Icons.restore),
              tooltip: 'Restore purchases',
            ),
          ],
        ),
        body: _buildBody(),
      );
    }

    Widget _buildBody() {
      if (_loading) {
        return const Center(child: CircularProgressIndicator());
      }
      if (_error != null) {
        return _ErrorView(message: _error!, onRetry: _load);
      }
      final packages = _offerings?.current?.availablePackages ?? const <Package>[];
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Entitlements', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          _EntitlementsView(customerInfo: _customerInfo),
          const Divider(height: 32),
          Text('Packages', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          if (packages.isEmpty)
            const Text('No packages in the current offering.')
          else
            ...packages.map(
              (p) => Card(
                child: ListTile(
                  title: Text(
                    p.storeProduct.title.isEmpty ? p.identifier : p.storeProduct.title,
                  ),
                  subtitle: Text(p.storeProduct.priceString),
                  trailing: FilledButton(
                    onPressed: () => _buy(p),
                    child: const Text('Buy'),
                  ),
                ),
              ),
            ),
        ],
      );
    }
  }

  class _EntitlementsView extends StatelessWidget {
    const _EntitlementsView({required this.customerInfo});

    final CustomerInfo? customerInfo;

    @override
    Widget build(BuildContext context) {
      final active =
          customerInfo?.entitlements.active ?? const <String, EntitlementInfo>{};
      if (active.isEmpty) {
        return const Text('No active entitlements.');
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final e in active.values)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 18),
                  const SizedBox(width: 8),
                  Expanded(child: Text('${e.identifier} · ${e.productIdentifier}')),
                ],
              ),
            ),
        ],
      );
    }
  }

  class _ErrorView extends StatelessWidget {
    const _ErrorView({required this.message, required this.onRetry});

    final String message;
    final VoidCallback onRetry;

    @override
    Widget build(BuildContext context) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
    }
  }
  ```

- [ ] **Step 4: run to pass.**
  `cd sdk/flutter_purchases/example && flutter test test/widget_test.dart`
  Expected: `+1: All tests passed`. (Offerings render with the native title/price, the
  empty-entitlement state shows on load, and after tapping **Buy** the granted `pro`
  entitlement + the "Purchased" snackbar appear — the full purchase round-trip ran
  against the MockClient + mocked MethodChannel with no real store.)

- [ ] **Step 5: commit.**
  ```sh
  git add sdk/flutter_purchases/example/lib/main.dart \
          sdk/flutter_purchases/example/lib/purchases_demo_page.dart \
          sdk/flutter_purchases/example/test/widget_test.dart
  git commit -m "feat(purchases-example): demo app wiring + acceptance widget test"
  ```

---

### Task 3.7.3: README + `flutter analyze` acceptance gate

Documents how to run the demo, the env the user must supply (`mp_pub_` key, serverUrl,
store products, sandbox testers, devices), and the manual device/sandbox test steps that
cannot be automated here (the hard external gates of §11). Closes the sub-project on its
stated acceptance: `flutter analyze` clean on `example/`.

**Files:**
- Create: `sdk/flutter_purchases/example/README.md`
- Test (acceptance gate, not a Dart unit test): `flutter analyze` clean on `example/`,
  plus the two test files from Tasks 3.7.1–3.7.2 green.

- [ ] **Step 1: run the acceptance gate to fail (baseline).**
  `cd sdk/flutter_purchases/example && flutter analyze`
  If analyze reports any issue at this point (e.g. an unused import, a missing
  `depend_on_referenced_packages` for `http`/`shared_preferences` used only in the test,
  or an `invalid_use_of_visible_for_testing_member` from referencing `SdkOverrides` in
  non-test code), that is the failing signal to fix before proceeding. Expected clean
  target: `No issues found!`. (This step is the red/observe step for the analyze gate;
  fix any reported issue by adjusting imports/deps — production `lib/` must not reference
  the `@visibleForTesting` `overrides` seam, which is why `configureDemo()` omits it.)

- [ ] **Step 2: write the README.** Create `sdk/flutter_purchases/example/README.md`:

  ```markdown
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

  | What | Where | Notes |
  | --- | --- | --- |
  | `mp_pub_` public SDK key | `lib/demo_config.dart` → `demoApiKey` | PUBLIC key only — never a secret server key. The placeholder (`mp_pub_` + 32 zeros) is rejected (401) by a real backend. |
  | `mobile_purchase` base URL | `lib/demo_config.dart` → `demoServerUrl` | Defaults to `http://localhost:8088`. On the **Android emulator** use `http://10.0.2.2:8088`. |
  | App Store Connect app + IAP products | App Store Connect | Each `storeProductId` must exist as an IAP and be registered as a catalog `Product` mapped to an `Entitlement` on the server. |
  | Google Play app + subscription products | Play Console | Same mapping requirement as iOS. |
  | Sandbox / license testers | App Store Connect / Play Console | A sandbox Apple ID and a Play license tester are required to run a real purchase. |
  | Physical iOS + Android devices, signed builds | — | A real `Product.purchase()` / `launchBillingFlow` cannot run on plain CI. |

  ## Manual device / sandbox test steps (cannot be automated here)

  A **real** purchase is device + sandbox gated. To verify the full loop by hand:

  1. Deploy `mobile_purchase` with a public HTTPS URL and real Apple/Google store
     credentials; point `demoServerUrl` at it and set a real `mp_pub_` key.
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
  serving the three `mobile_purchase` endpoints, a mocked `myampix_purchases/methods`
  MethodChannel, and mocked `shared_preferences` — so the offerings → buy →
  entitlement → restore flow is exercised with **no real store and no real network**.
  ```

- [ ] **Step 3: run the acceptance gate to pass.**
  ```sh
  cd sdk/flutter_purchases/example
  flutter analyze
  flutter test
  ```
  Expected: `flutter analyze` prints `No issues found!`; `flutter test` reports both
  `test/demo_config_test.dart` and `test/widget_test.dart` green (`All tests passed`).

- [ ] **Step 4: commit.**
  ```sh
  git add sdk/flutter_purchases/example/README.md
  git commit -m "docs(purchases-example): README with manual device/sandbox test steps"
  ```


---

