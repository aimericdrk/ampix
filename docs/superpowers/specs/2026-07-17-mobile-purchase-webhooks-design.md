# mobile_purchase — Store webhooks + Subscription / Customer / Entitlement subsystem — Design

**Date:** 2026-07-17
**Status:** Draft design, pending review
**Service:** `backend/mobile_purchase` (NestJS 11, own Postgres on `:5433`, own generated Prisma client at `generated/client` — import from there, **never** `@prisma/client`).
**Program context:** This is the **billing-authority core** — roadmap items **P1 (receipt validation + entitlement engine)** and **P2 (store notifications)** from `2026-07-16-revenuecat-parity-program-roadmap.md`, built as the increment *after* the catalog domain (P0, already shipped: App/Product/Entitlement/Offering/Package).
**Reference (pattern only):** `backend/mobile_analytics/src/revenuecat/webhook/` — journal-first / idempotency / unlinked-replay. We reuse the *shape*, not the RevenueCat coupling: this service ingests **Apple ASSN v2** and **Google RTDN** notifications *directly*, and is itself the billing authority (validates receipts, owns entitlement truth).

---

## 0. Scope, non-goals, honest gates

**In scope (this increment):**
- Two store-authenticated webhook endpoints (Apple ASSN v2, Google RTDN over Pub/Sub).
- New Prisma models: `Customer`, `Subscription`, `Transaction`, `StoreNotification` (journal), enums.
- Reserved App-User-ID validation at the customer boundary (deferred from P0).
- The entitlement engine + subscription lifecycle state machine (single source of `gives_access`).
- The SDK-facing read API (`GET /v1/subscribers/:appUserId`) and synchronous receipt intake (`POST /v1/receipts`), both `publicSdkKey`-authenticated like `/v1/offerings`.

**Explicit non-goals (deferred, named so they are not mistaken for gaps):**
- **Scheduler / worker (X2).** No time-driven job exists. Handled by *compute-on-read* + webhooks as the primary transition signal (§7). A reconciliation sweep is flagged as an X2 follow-up, not built.
- **Full Customers dashboard, identity graph / aliasing, promotional grant/revoke** — roadmap **P5**. This increment models one `Customer = one app_user_id`; a minimal admin read is optional (§6).
- **The purchasing SDK** (Dart→native, `getCustomerInfo` stream) — roadmap **P3**. We define the *server contract* the SDK will call.
- **Deploy pipeline (X1).** Store notifications need public HTTPS; that is a hard prerequisite (§8), procured/built elsewhere.
- **Apple refund automation** (`CONSUMPTION_REQUEST` response), **price-consent flows**, **subscription-group modeling**, **paywalls/experiments** — later P-items. We *journal* the relevant notifications and no-op their side effects for now.

---

## 1. Webhook endpoints (public, store-authenticated, no JWT)

Both endpoints are unauthenticated by JWT and carry **no `:projectId` in the path** — unlike the RC mirror, a store notification does not know our project id. The **App** (and therefore `projectId`) is resolved from the store's own identifier inside the *verified* payload (`bundleId` for Apple, `packageName` for Google). Signature/OIDC verification **is** the authentication.

### 1.1 Apple — App Store Server Notifications V2

```
POST /webhooks/apple
Content-Type: application/json
Body: { "signedPayload": "<JWS compact, ES256>" }
→ 200 always once verified+journaled (idempotent); 401 on bad signature; 400 on unparseable envelope.
```

**Verification (this is the auth):**
1. Parse the JWS compact serialization; read the protected header `x5c` (base64-DER cert chain: `[leaf, intermediate, Apple Root CA - G3]`).
2. Build and validate the chain to **Apple Root CA – G3** (a *public* cert we bundle in-repo — not a secret; ship it as an asset). Check validity dates and that the leaf's key signs the JWS (ES256).
3. On any failure → `401` (do **not** journal — it is not a real Apple call). Use Apple's `app-store-server-library` (Node) for chain + JWS verification rather than hand-rolling x5c logic.

**Decode (nested JWS):** the verified payload is `responseBodyV2DecodedPayload`:
- `notificationType`, `subtype`, `notificationUUID` (→ journal idempotency key), `signedDate`, `version`.
- `data.bundleId` (→ resolve App), `data.environment` (`Sandbox`|`Production`), `data.appAppleId`.
- `data.signedTransactionInfo` → **JWS** → `JWSTransactionDecodedPayload`: `transactionId`, `originalTransactionId`, `productId`, `type`, `purchaseDate`, `expiresDate`, `inAppOwnershipType`, `appAccountToken` (**the customer link**, a UUID), `offerType`, `revocationDate`, `revocationReason`, `price`, `currency`.
- `data.signedRenewalInfo` → **JWS** → `JWSRenewalInfoDecodedPayload`: `autoRenewStatus` (0/1 → `willRenew`), `autoRenewProductId`, `expirationIntent`, `gracePeriodExpiresDate`, `isInBillingRetryPeriod`, `offerType`, `renewalDate`, `priceIncreaseStatus`.

**App mapping:** `App.findFirst({ projectId?: any, platform: IOS, bundleId })`. Unknown `bundleId` → journal `SKIPPED` (audit), `200`.

**Notification-type handling** (`→` = state effect; see §4 for the state machine). Order events by `signedDate`, ignore stale (§7).

| notificationType | subtype | Meaning | Effect |
|---|---|---|---|
| `SUBSCRIBED` | `INITIAL_BUY` | first purchase | create Subscription → `TRIAL` or `ACTIVE` (per `offerType`/`type`), Transaction |
| `SUBSCRIBED` | `RESUBSCRIBE` | re-sub in group | Subscription → `ACTIVE`, new Transaction |
| `DID_RENEW` | — | renewed | `ACTIVE`, extend `expiresAt`, new Transaction |
| `DID_RENEW` | `BILLING_RECOVERY` | recovered after retry | `ACTIVE`, clear `billingIssueDetectedAt` |
| `DID_CHANGE_RENEWAL_STATUS` | `AUTO_RENEW_DISABLED` | user turned off auto-renew | `willRenew=false`, `unsubscribeDetectedAt=now`, status `CANCELLED` (still active until `expiresAt`) |
| `DID_CHANGE_RENEWAL_STATUS` | `AUTO_RENEW_ENABLED` | re-enabled | `willRenew=true`, clear `unsubscribeDetectedAt`, `ACTIVE` |
| `DID_CHANGE_RENEWAL_PREF` | `UPGRADE` | plan change now | new product/Subscription effective immediately (proration) |
| `DID_CHANGE_RENEWAL_PREF` | `DOWNGRADE` | plan change next period | set `autoRenewProductId` (pending) |
| `DID_FAIL_TO_RENEW` | `GRACE_PERIOD` | billing failed, in grace | `GRACE_PERIOD`, `billingIssueDetectedAt=now`, `gracePeriodExpiresAt` |
| `DID_FAIL_TO_RENEW` | — | billing failed, no grace | `BILLING_RETRY`, `billingIssueDetectedAt=now` |
| `GRACE_PERIOD_EXPIRED` | — | grace ended, still retrying | `BILLING_RETRY`, access now off (`isActive=false`) |
| `EXPIRED` | `VOLUNTARY`/`BILLING_RETRY`/`PRICE_INCREASE`/`PRODUCT_NOT_FOR_SALE` | ended | `EXPIRED` |
| `OFFER_REDEEMED` | — | promo/win-back applied | update `periodType`/product |
| `PRICE_INCREASE` | `PENDING`/`ACCEPTED` | price consent | record `priceIncreaseStatus`, no access change |
| `RENEWAL_EXTENDED` / `RENEWAL_EXTENSION` | — | dev-granted extension | extend `expiresAt` |
| `REFUND` | — | txn refunded | mark Transaction `revokedAt`, `REVOKED`, recompute |
| `REFUND_REVERSED` | — | refund reversed | un-revoke, restore |
| `REFUND_DECLINED` | — | refund denied | no change (journal) |
| `REVOKE` | — | Family Sharing access pulled | `isActive=false` |
| `CONSUMPTION_REQUEST` | — | Apple asks for consumption data | journal only (refund automation = later P-item) |
| `ONE_TIME_CHARGE` | — | non-renewing / consumable | Transaction record |
| `TEST` | — | ASSN test ping | journal only, no-op |

### 1.2 Google — Play RTDN over Pub/Sub push

```
POST /webhooks/google
Body: { "message": { "data": "<base64>", "messageId": "...", "publishTime": "..." }, "subscription": "..." }
→ 200 always once verified+journaled; 401 on bad push auth; 400 on unparseable envelope.
```

**Push authentication (the auth):** two supported modes, chosen per §Decision:
- **OIDC (preferred):** Pub/Sub signs the push with a Google-issued JWT in `Authorization: Bearer <jwt>`. Verify against Google's JWKS, check `aud` == our configured audience and `email` == the configured push service-account. Reject → `401`.
- **Shared-secret fallback:** a high-entropy token in the push endpoint URL (`?token=…`), constant-time compared (`timingSafeEqual`, as the RC mirror guard does). Simpler; no external key fetch.

**Decode:** base64-decode `message.data` → `DeveloperNotification`:
`{ version, packageName, eventTimeMillis, subscriptionNotification? | oneTimeProductNotification? | voidedPurchaseNotification? | testNotification? }`.
- `subscriptionNotification`: `{ notificationType (int), purchaseToken, subscriptionId }`.
- `voidedPurchaseNotification`: `{ purchaseToken, orderId, productType, refundType }`.
- `oneTimeProductNotification`: `{ notificationType (int), purchaseToken, sku }`.

**App mapping:** `App.findFirst({ platform: ANDROID, packageName })`. Unknown → journal `SKIPPED`.

**Authoritative state fetch (hard dependency):** RTDN carries **no state** — only a trigger + token. We MUST call the **Google Play Developer API** `purchases.subscriptionsv2.get(packageName, purchaseToken)` to obtain the real `SubscriptionPurchaseV2` (`subscriptionState`, `lineItems[].{productId, expiryTime, autoRenewingPlan, offerDetails}`, `latestOrderId`, `linkedPurchaseToken`, `externalAccountIdentifiers.obfuscatedExternalAccountId` = **the customer link**, `acknowledgementState`). One-time products use `purchases.products.get`.
→ **This call needs `App.storeCredentials` (the Play service-account JSON), which is currently NULL** (P0 shipped the encrypted column, not the writer). **Flagged dependency:** live Google ingest is blocked until a connect-store flow populates it. Build behind a `StoreClient` interface, mocked in tests; return `503`/journal `FAILED` (replayable) when creds are absent at runtime.

**Notification-type handling** (after the authoritative fetch — the fetched `subscriptionState` is truth; the notification is only the trigger, which naturally absorbs out-of-order delivery):

| type | name | Effect |
|---|---|---|
| 1 | `RECOVERED` | `ACTIVE`, clear `billingIssueDetectedAt` |
| 2 | `RENEWED` | `ACTIVE`, extend `expiresAt`, Transaction |
| 3 | `CANCELED` | `willRenew=false`, `unsubscribeDetectedAt=now`, `CANCELLED` (active until expiry) |
| 4 | `PURCHASED` | new Subscription → `TRIAL`/`ACTIVE`, Transaction |
| 5 | `ON_HOLD` | `BILLING_RETRY`, `billingIssueDetectedAt`, `isActive=false` |
| 6 | `IN_GRACE_PERIOD` | `GRACE_PERIOD`, `billingIssueDetectedAt`, `isActive=true` |
| 7 | `RESTARTED` | `ACTIVE`, `willRenew=true`, clear `unsubscribeDetectedAt` |
| 8 | `PRICE_CHANGE_CONFIRMED` | no access change |
| 9 | `DEFERRED` | extend `expiresAt` |
| 10 | `PAUSED` | `PAUSED`, `isActive=false`, `willRenew=true` |
| 11 | `PAUSE_SCHEDULE_CHANGED` | record scheduled pause |
| 12 | `REVOKED` | `REVOKED`, `isActive=false` immediately (refund/chargeback) |
| 13 | `EXPIRED` | `EXPIRED` |
| 20 | `PENDING_PURCHASE_CANCELED` | pending purchase abandoned → no grant |
| — | `voidedPurchaseNotification` | mark matching Transaction `revokedAt`, `REVOKED`, recompute (`refundType` FULL/QUANTITY) |
| — | `oneTimeProductNotification` 1/2 | consumable/non-consumable Transaction (via `purchases.products.get`) |
| — | `testNotification` | journal only, no-op |

---

## 2. Data model (new Prisma models, `mobile_purchase/prisma/schema.prisma`)

All scoped by a plain `project_id @db.Uuid` column (no FK — this service owns no Project table), `uuid(7)` ids, snake_case `@map`/`@@map`, matching the catalog convention. New enums:

```prisma
enum Store        { APP_STORE  PLAY_STORE }        // RC-style store attribution (distinct from AppPlatform)
enum Environment  { SANDBOX    PRODUCTION }
enum PeriodType   { NORMAL     TRIAL     INTRO     PROMO }
enum SubscriptionStatus {
  TRIAL  INTRO  ACTIVE          // entitled + (usually) renewing
  CANCELLED                     // auto-renew off, still entitled until expiresAt
  GRACE_PERIOD                  // billing failed, still entitled during grace
  BILLING_RETRY                 // billing failed, NOT entitled, store still retrying
  PAUSED                        // Google pause, not entitled, resumes later
  EXPIRED  REVOKED              // terminal / access removed (revoke = refund/family-share/chargeback)
}
enum JournalStatus { PROCESSED  FAILED  UNLINKED  SKIPPED }  // mirrors the RC journal
```

```prisma
// One row per SDK-provided app_user_id, per project. Aliasing/identity-graph = P5 (out of scope).
model Customer {
  id         String   @id @default(uuid(7)) @db.Uuid
  projectId  String   @map("project_id") @db.Uuid
  appUserId  String   @map("app_user_id")                 // validated, non-reserved (§3)
  // Store-account linkage tokens used to attribute notifications back to this customer:
  appleAppAccountToken  String? @map("apple_app_account_token") @db.Uuid  // Apple appAccountToken
  googleObfuscatedId    String? @map("google_obfuscated_account_id")      // Google obfuscatedExternalAccountId (≤64 chars)
  attributes  Json?                                        // subscriber attributes (reserved + custom); write API = P5
  createdAt   DateTime  @default(now()) @map("created_at")
  lastSeenAt  DateTime? @map("last_seen_at")
  subscriptions Subscription[]
  transactions  Transaction[]

  @@unique([projectId, appUserId])
  @@index([projectId])
  @@index([appleAppAccountToken])
  @@index([googleObfuscatedId])
  @@map("customers")
}

// The per-customer, per-product subscription STATE (one live row per store subscription identity).
model Subscription {
  id                     String   @id @default(uuid(7)) @db.Uuid
  projectId              String   @map("project_id") @db.Uuid
  customerId             String   @map("customer_id") @db.Uuid
  appId                  String   @map("app_id") @db.Uuid
  productId              String?  @map("product_id") @db.Uuid          // FK → catalog Product; NULL if store product not yet imported
  storeProductId         String   @map("store_product_id")
  store                  Store
  environment            Environment
  status                 SubscriptionStatus
  periodType             PeriodType @default(NORMAL) @map("period_type")
  // Store identity (one is set per store; see §7 on Google token rotation):
  originalTransactionId  String?  @map("original_transaction_id")      // Apple: stable across renewals
  purchaseToken          String?  @map("purchase_token")               // Google: latest; linkedPurchaseToken chains upgrades
  purchasedAt            DateTime @map("purchased_at")
  originalPurchasedAt    DateTime? @map("original_purchased_at")
  expiresAt              DateTime? @map("expires_at")
  autoRenewStatus        Boolean  @default(true) @map("auto_renew_status")     // → willRenew
  autoRenewProductId     String?  @map("auto_renew_product_id")               // pending downgrade/change
  unsubscribeDetectedAt  DateTime? @map("unsubscribe_detected_at")
  billingIssueDetectedAt DateTime? @map("billing_issue_detected_at")
  gracePeriodExpiresAt   DateTime? @map("grace_period_expires_at")
  refundedAt             DateTime? @map("refunded_at")
  priceCents             Int?     @map("price_cents")
  currency               String?
  lastEventAt            DateTime? @map("last_event_at")               // ordering guard (Apple signedDate / Google eventTime)
  updatedAt              DateTime @updatedAt @map("updated_at")
  customer               Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([projectId, store, originalTransactionId])   // Apple identity
  @@unique([projectId, store, purchaseToken])           // Google identity (latest token)
  @@index([projectId, status])
  @@index([customerId])
  @@map("subscriptions")
}

// Immutable record of every validated store transaction (purchase/renewal/one-time). Idempotent.
model Transaction {
  id                    String   @id @default(uuid(7)) @db.Uuid
  projectId             String   @map("project_id") @db.Uuid
  customerId            String?  @map("customer_id") @db.Uuid          // NULL until linked (unlinked-replay)
  appId                 String   @map("app_id") @db.Uuid
  subscriptionId        String?  @map("subscription_id") @db.Uuid
  store                 Store
  environment           Environment
  storeTransactionId    String   @map("store_transaction_id")         // Apple transactionId / Google orderId
  originalTransactionId String?  @map("original_transaction_id")
  storeProductId        String   @map("store_product_id")
  type                  ProductType                                    // reuse catalog enum
  purchasedAt           DateTime @map("purchased_at")
  expiresAt             DateTime? @map("expires_at")
  priceCents            Int?     @map("price_cents")
  currency              String?
  isTrialPeriod         Boolean  @default(false) @map("is_trial_period")
  revokedAt             DateTime? @map("revoked_at")
  rawPayload            Json     @map("raw_payload")                   // the validated decoded store payload (audit)
  createdAt             DateTime @default(now()) @map("created_at")
  customer              Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@unique([projectId, store, storeTransactionId])   // transaction-level idempotency
  @@index([projectId])
  @@index([originalTransactionId])
  @@map("transactions")
}

// Webhook journal — journal-first, idempotent by store event id, replayable. Mirrors the RC pattern.
model StoreNotification {
  id               String   @id @default(uuid(7)) @db.Uuid
  projectId        String?  @map("project_id") @db.Uuid    // NULL only for unresolved-App (SKIPPED) rows
  appId            String?  @map("app_id") @db.Uuid
  store            Store
  storeEventId     String   @map("store_event_id")         // Apple notificationUUID / Google messageId
  notificationType String   @map("notification_type")
  subtype          String?
  appUserId        String?  @map("app_user_id")            // resolved link, if any
  payload          Json                                    // full VERIFIED + decoded notification
  status           JournalStatus
  error            String?
  receivedAt       DateTime  @default(now()) @map("received_at")
  processedAt      DateTime? @map("processed_at")

  @@unique([store, storeEventId])        // global idempotency; Apple UUID / Google messageId are globally unique
  @@index([status])
  @@index([projectId, status])
  @@index([projectId, appUserId, status])
  @@map("store_notifications")
}
```

**Relation to the catalog:** `Subscription.productId` / `Transaction`'s product resolve to a catalog `Product` by `(appId, storeProductId)` (the catalog's `@@unique([appId, storeProductId])`). Entitlements flow `Product → ProductEntitlement → Entitlement` — the exact join `OfferingResolverService` already walks. A store product we have **not** imported yields `productId = null` and **empty** entitlements (graceful; the engine simply grants nothing until the catalog is filled in).

---

## 3. App-User-ID reserved-id validation (the deferred P0 item, at the customer boundary)

Belongs here, not the catalog — it guards the *customer* identity the SDK asserts. Enforced in `CustomerService.resolve()` on every `/v1/subscribers/:appUserId` and `/v1/receipts` call (RC's blocklist behavior). Rejects with `400` (RFC 7807 via `ProblemException`):

- Empty / whitespace-only.
- Reserved literals (case-insensitive): `no_user`, `null`, `nil`, `none`, `(null)`, `nan`, `[]`, `unidentified`.
- Equals the App's `publicSdkKey`, `bundleId`, or `packageName`.
- Starts with `$RCAnonymousID:` or contains the reserved `$` sentinel prefix used by package identifiers.
- Looks like a device identifier (IDFA/IDFV/GAID zero-UUID `00000000-0000-...`) or is a raw email address (warn+reject — PII must not be an id).
- Exceeds max length (`≤ 200`) or contains control characters.

Implemented as a pure `validateAppUserId(appUserId, app)` returning `ok | { reason }`, unit-tested against the full blocklist (no creds needed).

---

## 4. Entitlement engine + subscription lifecycle state machine

**The engine is the single source of `gives_access`.** It takes a `Customer` + its `Subscription`/`Transaction` rows and computes **CustomerInfo** by mapping each active/owned store product to catalog `Entitlement` identifiers via `ProductEntitlement`.

**Compute-on-read (no scheduler):** `isActive` is derived at read time as `status ∈ {TRIAL, INTRO, ACTIVE, CANCELLED, GRACE_PERIOD} AND (expiresAt == null OR expiresAt > now)`. This keeps reads correct even though nothing actively flips a subscription to `EXPIRED` at its expiry instant (see §7). `EntitlementInfo` per entitlement identifier:

```
EntitlementInfo {
  isActive, willRenew, periodType,               // periodType: normal|trial|intro|promo
  latestPurchaseDate, originalPurchaseDate, expirationDate,
  store,                                          // app_store | play_store
  productIdentifier,                              // the storeProductId backing it
  unsubscribeDetectedAt, billingIssueDetectedAt,
  ownershipType                                   // PURCHASED | FAMILY_SHARED (from Apple inAppOwnershipType)
}
```
- `willRenew = autoRenewStatus AND status ∉ {EXPIRED, REVOKED, CANCELLED, PAUSED}`.
- Multiple products mapping to the same entitlement → the entitlement is active if **any** backing subscription is active; its fields come from the latest-expiring active one.
- Non-renewing / non-consumable (lifetime) products entitle from a `Transaction` with no `expiresAt` and no `revokedAt`.

**State machine** (states = `SubscriptionStatus`; transitions driven by §1 tables and `/receipts`):

```
                 purchase(trial)              trial converts / paid purchase
        ┌──────────────────────────┐   ┌────────────────────────────────────┐
        ▼                          │   ▼                                    │
     ( TRIAL ) ───converts───▶ ( ACTIVE ) ◀── DID_RENEW / RENEWED / RECOVERED / RESTARTED
        │                     │   │  ▲                                       
        │ auto-renew off      │   │  │ billing recovers (BILLING_RECOVERY / RECOVERED)
        ▼                     │   │  │                                       
   ( CANCELLED ) ─expiry─▶ (EXPIRED)   │ billing fails                       
   (still entitled              ▲      ▼                                     
    until expiresAt)            │  ( GRACE_PERIOD ) ──grace ends──▶ ( BILLING_RETRY ) ──retry ends──▶ (EXPIRED)
                                │  (entitled)                        (NOT entitled)                    
        Google pause ──▶ ( PAUSED ) ──resume──▶ (ACTIVE)                                              
                                                                                                     
   any state ──REFUND / REVOKE / VOIDED / voided-chargeback──▶ ( REVOKED )  [isActive=false immediately]
   REVOKED ──REFUND_REVERSED──▶ (restore prior computed state)
```

- **trial → active**: renewal after a trial (`DID_RENEW`, Google `RENEWED` with paid line item).
- **active → cancelled**: auto-renew disabled; entitlement stays active until `expiresAt`, `willRenew=false`, `unsubscribeDetectedAt` set.
- **active → grace/billing-retry**: `DID_FAIL_TO_RENEW` (grace vs not) / Google `IN_GRACE_PERIOD` vs `ON_HOLD`.
- **grace/retry → active**: `BILLING_RECOVERY` / `RECOVERED`.
- **→ expired**: expiry notification, or compute-on-read past `expiresAt`.
- **→ revoked**: refund / Family-Sharing revoke / Google void — immediate loss of access; `REFUND_REVERSED` restores.
- **product change (upgrade/downgrade/crossgrade)**: upgrade = new Subscription effective now (proration handled by the store; we record the new transaction and expire the old); downgrade = `autoRenewProductId` pending, applied at next renewal.

The engine + state machine are pure functions over fixtures — **fully unit-testable without store credentials**.

---

## 5. Customer-facing read API (what the future flutter_purchases SDK calls)

Both endpoints reuse the existing `PublicApiKeyGuard` (`Authorization: Bearer mp_pub_…` → resolves `req.sdkApp = { id, projectId }`), exactly like `/v1/offerings`. No JWT, no `ProjectAccessGuard`.

```
GET /v1/subscribers/:appUserId
  Auth: PublicApiKeyGuard.  :appUserId validated (§3).
  Resolves-or-creates the Customer within req.sdkApp.projectId, computes CustomerInfo (§4).
  → 200 { customerInfo: { entitlements: { active, all }, subscriptions, firstSeen, lastSeen, managementURL? } }
  → 400 reserved/invalid app_user_id.  (Unknown-but-valid id ⇒ empty CustomerInfo, RC-style.)
```

```
POST /v1/receipts     // synchronous validation — don't wait for the async webhook
  Auth: PublicApiKeyGuard.
  Body: {
    app_user_id: string,                      // validated (§3)
    platform: "APP_STORE" | "PLAY_STORE",
    fetch_token: string,                      // Apple: signed StoreKit2 JWS txn; Google: purchaseToken
    product_id?: string,                      // Google needs the sku; Apple derives it
    presented_offering_identifier?: string    // attribution (stored on Transaction, optional)
  }
  Flow: validate token against the store (Apple App Store Server API / Google purchases.*),
        upsert Transaction + Subscription, BIND appAccountToken/obfuscatedId ↔ Customer,
        run the engine, then replay any UNLINKED/FAILED journal rows for this customer (§7).
  → 200 { customerInfo }   → 400 invalid id / bad token   → 402/409 store rejects the receipt
```

`POST /v1/receipts` is the primary attribution path: because Apple's `appAccountToken` must be a UUID and Google's `obfuscatedExternalAccountId` is set at purchase time, intake is where we **explicitly** bind the store token to our `app_user_id`, so a webhook that arrived first as `UNLINKED` gets resolved on the next intake+replay.

---

## 6. Auth / tenancy summary

| Surface | Route(s) | Auth | Guard |
|---|---|---|---|
| Apple webhook | `POST /webhooks/apple` | JWS x5c → Apple Root G3 | signature (custom) |
| Google webhook | `POST /webhooks/google` | Pub/Sub OIDC **or** shared-secret | OIDC verify / `timingSafeEqual` |
| SDK read | `GET /v1/subscribers/:appUserId` | `publicSdkKey` | `PublicApiKeyGuard` |
| SDK receipt intake | `POST /v1/receipts` | `publicSdkKey` | `PublicApiKeyGuard` |
| Admin customer read (optional, minimal) | `GET /api/v1/projects/:projectId/customers…` | dashboard JWT (via analytics) | `ProjectAccessGuard` + `@RequireProjectRole('viewer')` |

The full Customers dashboard (detail, aliases, grant/revoke, refunds) is **P5** and out of scope; only a read-only list/detail is optional here to unblock manual verification, following the exact `AppsController` pattern (`api/v1/projects/:projectId/...`, `@RequireProjectRole`).

---

## 7. Idempotency, ordering, replay, and the scheduler gap

- **Idempotency:** journal `@@unique([store, storeEventId])` — a duplicate delivery hits Prisma `P2002` → **idempotent 200 no-op** (as the mirror does). Transaction `@@unique([projectId, store, storeTransactionId])` de-dupes the purchase itself. Both webhooks are journal-first: **verify → decode → insert provisional `FAILED` journal row → run handler → finalize** `PROCESSED`/`FAILED`/`UNLINKED`/`SKIPPED`. Verification failures never journal (they are not real store calls) and return `401`.
- **Ordering:** store notifications can arrive out of order. **Apple:** the notification carries the full signed transaction+renewal info; guard with `Subscription.lastEventAt` (from `signedDate`) — ignore a payload older than the last applied. **Google:** always re-fetch `subscriptionsv2.get`, whose returned `subscriptionState` is authoritative — so RTDN is only a *trigger* and stale-order delivery self-heals (the fetch reflects current truth regardless of which notification woke us).
- **Replay:** `replayUnlinked(projectId, appUserId?)` re-runs `UNLINKED` (no customer link yet) + `FAILED` journal rows, oldest-first, capped per batch — identical to the mirror's `replayUnlinked`. Triggered after a successful `/v1/receipts` link, and (future) by a scheduled sweep.
- **Scheduler gap (honest):** there is **no scheduler** (roadmap X2, not built). Time-driven transitions — trial→expired at `expiresAt`, grace→expired at `gracePeriodExpiresAt` — are **not actively flipped**. Mitigations that make this correct *without* a scheduler for this increment:
  1. **compute-on-read** (§4) — `isActive` is derived from `expiresAt > now`, so reads are always correct even if the row still says `ACTIVE`.
  2. **webhooks are the primary transition signal** — Apple `EXPIRED`/`GRACE_PERIOD_EXPIRED` and Google `EXPIRED` *do* fire at expiry; the stored `status` converges when they arrive.
  - **Where a scheduler is still needed later (flag, don't build):** a **reconciliation sweep** to catch *missed* webhooks (network loss / downtime), proactive materialization of expiries for analytics/push (webhooks-out P11), and grace/billing-retry timeouts if the store's terminal notification is lost. These require **X2**; noted as the follow-up, not in scope.

---

## 8. External prerequisites (procurement gates — human, account-gated, on the user)

**Apple:**
1. **App Store Connect API key** — Issuer ID + Key ID + `.p8` private key — for the App Store Server API (`/v1/receipts` validation, transaction history). Secret → stored per-App in `storeCredentials` (encrypted).
2. **ASSN v2 configured** in App Store Connect (Production **and** Sandbox notification URLs) pointing at the deployed `POST /webhooks/apple`. **Needs the public HTTPS deploy (X1).**
3. **Apple Root CA – G3** cert bundled in-repo for x5c verification (public, not secret).
4. **Sandbox tester account(s)**; each `bundleId` registered as an `App`.

**Google:**
1. **Google Cloud project** with the **Play Developer API** enabled.
2. **Service-account JSON** with Play Console access (view financial data / manage orders) → becomes `App.storeCredentials` (encrypted). **Currently NULL — blocks `subscriptionsv2.get`, i.e. all live Google ingest.**
3. **Pub/Sub topic + push subscription** → `POST /webhooks/google` (OIDC service account **or** shared-secret token); RTDN wired to the topic in Play Console. **Needs X1.**
4. **License tester(s)**; each `packageName` registered as an `App`.

**Buildable + unit-testable against MOCKED payloads (no creds):**
- JWS x5c verification logic (Apple's published sample payloads + a self-signed test chain), notification decoding, Pub/Sub envelope decode + OIDC verify (mocked Google JWKS), journal idempotency/replay, the entitlement engine + full state machine, CustomerInfo assembly, reserved-id validation, both SDK endpoints' contracts (store validation behind a mocked `StoreClient`).

**Requires real credentials (cannot be verified without them):**
- "A real sandbox purchase flips an entitlement" end-to-end; `purchases.subscriptionsv2.get` / `products.get` against a live service account; live ASSN/RTDN delivery; signature validation against *production* Apple/Google chains. These gate **final** verification, not the build.

---

## 9. Decomposition — 5 buildable sub-increments

Each is a spec-sized unit with its own acceptance criteria. Dependencies noted. All are unit-testable against mocks; credential-gated items are called out.

**M1 · Data model + journal + customer boundary** — *deps: none.*
Add the enums + `Customer`/`Subscription`/`Transaction`/`StoreNotification` models, migrate on `:5433`, generate the client. `CustomerService.resolve()` with reserved-id validation (§3). `StoreNotificationJournal` service: journal-first insert, `P2002` idempotency, finalize, `replayUnlinked` skeleton. No store I/O.
*Acceptance:* migration applies; reserved app_user_ids rejected exactly per the blocklist; a repeated `(store, storeEventId)` is an idempotent no-op; `replayUnlinked` sweeps `UNLINKED`+`FAILED` oldest-first. All unit-tested, no creds.

**M2 · Apple ASSN v2 ingest** — *deps: M1 (+ M4 state mapper, co-designed).*
`POST /webhooks/apple`; JWS x5c verify → Apple Root G3; decode notification + nested transaction/renewal JWS; resolve App by `bundleId`; journal; upsert Transaction/Subscription; the §1.1 type→transition table.
*Acceptance:* Apple sample signed payloads verify + decode; each notificationType/subtype produces the correct Transaction/Subscription/journal outcome (fixtures); bad signature → `401`, no journal; unknown bundleId → `SKIPPED`. Live ASSN delivery flagged (needs #1.2/X1).

**M3 · Google RTDN ingest** — *deps: M1 (+ M4).*
`POST /webhooks/google`; Pub/Sub OIDC / shared-secret auth; base64 envelope decode → `DeveloperNotification`; resolve App by `packageName`; `StoreClient.getSubscriptionV2()` (interface, mocked in tests, real needs the service account); §1.2 type→transition table; voided + one-time handling.
*Acceptance:* envelope decodes; each notificationType maps correctly against mocked `subscriptionsv2` responses; voided purchase revokes; missing storeCredentials → journal `FAILED` (replayable), not a crash; unknown packageName → `SKIPPED`. Live fetch flagged (needs service-account creds).

**M4 · Entitlement engine + lifecycle state machine** — *deps: M1; consumes/feeds M2+M3.*
The compute-CustomerInfo core (§4): `Product → ProductEntitlement → Entitlement` mapping, `EntitlementInfo` derivation (`isActive`/`willRenew`/`periodType`/`expirationDate`/`store`/`unsubscribeDetectedAt`/`billingIssueDetectedAt`/`ownershipType`), compute-on-read expiry, the full state machine that M2/M3 call into. (Built alongside M2/M3 so the transition logic lives in one place, not duplicated per store.)
*Acceptance:* given fixture Subscriptions/Transactions, CustomerInfo matches expected active entitlements; renewal/expiry/grace/billing-retry/refund/revoke/upgrade/downgrade each transition correctly; unimported store product ⇒ empty entitlements, not an error. Pure unit tests, no creds.

**M5 · SDK read + receipt-intake API** — *deps: M1, M4 (store validation client shared with M3).*
`GET /v1/subscribers/:appUserId` → CustomerInfo (`PublicApiKeyGuard`). `POST /v1/receipts` → synchronous store validation (mocked `StoreClient`) → Transaction/Subscription upsert + token binding + `replayUnlinked` → CustomerInfo.
*Acceptance:* key-authenticated read returns correct CustomerInfo; a posted receipt reflects entitlements immediately without a webhook; reserved/invalid id → `400`; store-rejected receipt → `402/409`; mismatched key/project isolation holds. Real store validation flagged (mocked in tests).

**Suggested order:** M1 → M4 (engine on fixtures) → M2 → M3 → M5. M2/M3 depend on M4's transition seam, so M4 is scaffolded early and completed alongside the two ingests.

---

## 10. Open decisions to weigh (raised, not resolved)

1. **Customer↔store-token linkage strategy.** Option (i): rely on **explicit `/v1/receipts` binding** (the SDK always posts the receipt, we bind token↔app_user_id, webhooks that land first sit `UNLINKED` until the next intake+replay). Option (ii): also **hand the SDK a per-customer UUID** to set as Apple `appAccountToken` / Google `obfuscatedExternalAccountId` at purchase time, so store notifications self-attribute with no intake call. *Recommendation:* (i) now (robust, testable, no SDK change), (ii) folded into the P3 SDK later. This decides whether webhooks can be self-sufficient.

2. **Compute-on-read vs materialized entitlement state, given no scheduler (X2).** On-read (recommended) keeps reads correct today with zero jobs but cannot emit server-initiated "expired/renewed" events (needed for webhooks-out P11, push, some analytics) and re-queries per read. Materialized needs X2 to flip expiries on time. *Recommendation:* on-read now; add a materialized cache + reconciliation sweep when X2 lands. Confirm you don't need server-initiated lifecycle events in this increment.

*(Secondary, lower-stakes: Google push auth — OIDC vs shared-secret token — recommend OIDC for prod, shared-secret acceptable for early sandbox.)*
