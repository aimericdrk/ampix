# MyRevenueCat → RevenueCat parity — Program Roadmap

**Date:** 2026-07-16
**Status:** Draft roadmap (decomposition), pending user approval of scope + phasing
**Type:** Spec-of-specs. This is NOT an implementation spec — it decomposes "clone RevenueCat, every feature" into sub-projects, each of which gets its own spec → plan → build cycle.
**Supersedes intent of:** `2026-07-12-revenuecat-integration-design.md` (the *mirror*) and the deferred-decisions section of `2026-07-16-dashboard-tool-rail-design.md`.

## The goal, stated honestly

You asked for MyRevenueCat (and the SDK) to have "exactly the same features as the original RevenueCat, every feature without missing one." This document is the complete map, so nothing is silently dropped.

**The blunt reality:** RevenueCat is a mature SaaS built by a large team over ~8 years. Its surface is ~10 independent product domains, several of which (Customer Center, Paywalls + rendering SDK, the Charts analytics product, the integrations catalog, the REST API) are *whole products in their own right*. This cannot be one build, or one plan. It is a **program** of ~14 sub-projects. A few pieces of literal parity are **not achievable** for a self-hosted clone at all (see *Out of scope*), and the honest thing is to name them rather than pretend.

**What we have today** (verified against the code this session):
- **Backend RC module** = a *downstream consumer* of RevenueCat. It ingests RC's webhooks and reads RC's REST v2. It validates **zero** Apple/Google receipts, owns **zero** entitlement decisions, and never sees a purchase token. It is an analytics/CRM projection of RC's billing truth into ClickHouse events + a Postgres `SubscriptionState` mirror + `$rc_*` profile properties.
- **SDK** (`myampix_analytics`, Flutter) = a *purchase observer*. Native iOS StoreKit-1 / Android Play-Billing hooks watch the app's own transactions (read-only, never finishes/acknowledges them) and re-emit one `$in_app_purchase` analytics event. There is no purchase/restore/offerings/entitlements API and no Dart→native command channel.
- **Dashboard** = Overview + Conversion pages are real (backed by the mirror metrics); Charts, Customers, Products, Entitlements, Offerings, Paywalls are **placeholder routes**.

So today MyAmpix is the layer RevenueCat sits *upstream* of. Parity means building the entire **billing-authority stack** that currently lives *inside* RevenueCat: receipt validation, store notifications, the entitlement engine, a purchase-intake API, and a real purchasing SDK — plus the merchandising, paywall, analytics, and integration products layered on top.

## Scope decisions (recommended — please confirm or change)

These four decisions shape the whole roadmap and the definition of "done." Defaults are recommended; the roadmap is written against them.

| # | Decision | Recommended | Why |
|---|---|---|---|
| S1 | **SDK platforms** | Flutter (iOS + Android) first. Native iOS, native Android, React Native, Unity, KMP, Web, Amazon, macOS SDKs are each a separate large effort — enumerated as future phases, not built now. | You have exactly one SDK (Flutter). "Every platform RC ships" is 8+ SDKs; that alone is years. Flutter covers iOS+Android from your existing plugin. |
| S2 | **Stores** | Apple App Store + Google Play first. Stripe / RevenueCat-Web-Billing / Amazon / Paddle deferred. | Apple+Google are ~all mobile subscription revenue and share the entitlement engine. Web/Stripe billing is a distinct integration. |
| S3 | **The existing mirror** | Keep it as an optional *legacy import* path during the transition; the new billing-authority stack becomes the primary source of truth. Retire the mirror once native billing is proven. | The mirror is merge-ready and gives a migration story for a project already on real RevenueCat. Ripping it out now loses that and destabilizes the analytics that depend on `$rc_*`. |
| S4 | **Literal-parity exclusions** | Explicitly out: cross-customer **benchmark percentiles** (needs RC's aggregate data across all their customers), RC's own **plan-tier feature gating** (N/A for self-hosted), and the non-Flutter platform SDKs (S1). | Some "features" are only possible *because* RC is a multi-tenant SaaS with millions of apps. A self-hosted clone structurally cannot reproduce them. |

## Feasibility prerequisites (hard gates, not features)

None of the billing-authority work can be **end-to-end verified** — and some can't run at all — until these exist. They are infrastructure, and they block the core.

1. **A deployment.** There is *no deployment today* — no Dockerfile, no registry, no cloud. Store-to-server notifications (Apple ASSN v2, Google RTDN) require **publicly reachable HTTPS endpoints**. → Prerequisite project **X1 (Deploy pipeline)**, already scoped in the tool-rail spec's deferred section.
2. **A scheduler.** Renewals, trial expirations, grace-period transitions, and reconciliation are time-driven. There is *no scheduler* in the backend today (flagged as a blocker for alerts and RC backfill already). → Prerequisite **X2 (Scheduler/worker)**.
3. **Store developer accounts + credentials.** Apple: App Store Connect API key + In-App-Purchase key (for signing offers) + ASSN v2 configured. Google: Play Developer API service account + a Pub/Sub topic for RTDN. Sandbox tester accounts on both. **These are external, human, and account-gated** — the build can proceed against *mocked* store responses, but "a real sandbox purchase flips an entitlement" cannot be verified without them. This is on you to procure; the roadmap assumes they arrive before the billing-authority project's final verification.
4. **SDK auth model.** RC uses **public SDK keys** (safe to ship) vs **secret server keys** (server-only) vs **v2 granular-permission keys**. Today MyAmpix has one `sdk_tokens` scheme (plaintext, ingest-scoped) and HS256 symmetric JWTs. The key model needs designing before the purchase-intake API. → Folded into **P1**.

## The decomposition — 14 sub-projects

Each is its own spec → plan → build. Grouped into layers; dependency arrows noted. Complexity: S/M/L/XL/XXL.

### Layer A — Billing authority (the core; everything depends on it)

**P0 · Domain model & multi-app hierarchy** — XL — *deps: none*
The configuration substrate. Project → **Apps** (one per platform/store, each with its own store credentials + public/secret API keys) → **Products** (imported from stores; types: auto-renewable sub, non-renewing sub, consumable, non-consumable, prepaid) → **Entitlements** (access levels; many-products-to-many-entitlements) → **Offerings** → **Packages** (typed: monthly/annual/lifetime/weekly/custom…). Plus **App User ID validation** (reserved-ID blocklist: `no_user`, `null`, `nil`, bundle-id, etc.; no PII/device IDs). This replaces today's single `RevenueCatIntegration` row with a real catalog.
*Acceptance:* can define apps, products, entitlements, offerings/packages via API + dashboard; product↔entitlement and package↔product mappings persist and are queryable; invalid App User IDs are rejected exactly as RC's blocklist does.

**P1 · Receipt validation + purchase-intake API + entitlement engine** — XXL — *deps: P0, X1, X2*
THE core. (a) **Purchase intake**: a `/receipts`-style API the SDK POSTs a StoreKit JWS transaction / Play purchase token to, authenticated by public SDK key. (b) **Store validation**: Apple App Store Server API (verify signed `JWSTransaction`/`JWSRenewalInfo`) and Google Play Developer API (`purchases.subscriptionsv2.get`, `purchases.products.get`). (c) **Entitlement computation engine** — the crown jewel: from validated transactions compute per-customer active entitlements with `isActive`, `willRenew`, `periodType` (normal/trial/intro/promo), `expirationDate`, `store`, `ownershipType`, `unsubscribeDetectedAt`, `billingIssueDetectedAt`, `verification`. (d) **CustomerInfo** assembly. (e) **Subscription lifecycle state machine**: trial → active → billing-retry/grace → expired/churned; refunds/revocation; **product changes** (upgrade/downgrade/crossgrade with proration). (f) **Deduplication + idempotency** (reuse the journal pattern).
*Acceptance:* a validated Apple + a validated Google purchase (mocked store responses in tests; real sandbox once creds exist) each produce a correct CustomerInfo with active entitlements; renewal, expiration, grace, refund, and upgrade transitions each move state correctly; the engine is the single source of `gives_access`.

**P2 · Store-to-server notifications** — L — *deps: P1, X1, X2*
Apple **App Store Server Notifications V2** (`signedPayload` JWS; all types/subtypes: SUBSCRIBED, DID_RENEW, DID_FAIL_TO_RENEW, GRACE_PERIOD_EXPIRED, EXPIRED, REFUND, CONSUMPTION_REQUEST, PRICE_INCREASE, …) and Google **Real-Time Developer Notifications** over Pub/Sub. Verify signatures, dedupe against P1's ledger, drive the lifecycle engine. Includes **Apple refund-request automation** (`$appleRefundHandlingPreference`, consumption-data signals) and Google **voided purchases** + cancel-reason mapping.
*Acceptance:* each notification type updates entitlement state without a client round-trip; signatures are cryptographically verified (not a shared-secret compare like today's mirror).

### Layer B — Client purchasing SDK

**P3 · Flutter purchasing SDK (iOS + Android)** — XXL — *deps: P0, P1*
Turn the observer into a purchaser. **Dart→native MethodChannel** (only an EventChannel exists today). `getOfferings()`/`getProducts()` (Android must add `ProductType.SUBS`/`subscriptionOfferDetails` — today INAPP-only). `purchase(package/product)` with promo/win-back offers + Google product-change/proration. **Transaction finishing** (`finishTransaction` / `acknowledge` / `consume`). `restorePurchases()` / `syncPurchases()`. `getCustomerInfo()` + `entitlements.active` + a **CustomerInfo-updated listener stream**. `logIn`/`logOut`/aliasing, `setAttributes` + reserved attributes. The full **`PurchasesErrorCode` contract** (stable codes 1–23+, retry semantics). **Offline Entitlements** (StoreKit2/billing-lib local verification against disk-cached product→entitlement maps when the backend is unreachable; consumables excluded on iOS). Recommend migrating iOS to **StoreKit 2**.
*Acceptance:* a Flutter host app can fetch offerings, buy, restore, and read entitlements; entitlement state matches the backend; errors surface with RC-identical codes; entitlements resolve offline from cache.

### Layer C — Merchandising & customer UI (dashboard placeholders → real)

**P4 · Products / Entitlements / Offerings management UI** — L — *deps: P0*
The dashboard `Products`, `Entitlements`, `Offerings` placeholder pages become real CRUD over P0's model (store import, product→entitlement mapping, offering/package builder).
*Acceptance:* the three placeholder pages manage the real catalog; changes reflected in what the SDK fetches.

**P5 · Customers management** — L — *deps: P1*
The `Customers` placeholder page: customer list + detail (subscription history, transactions, entitlements, **aliases/identity graph**, attributes, activity feed), **grant/revoke promotional entitlements**, refund handling, offering overrides. Wires up the already-orphaned `useUserSubscription`/`useRefreshUserSubscription` hooks.
*Acceptance:* every customer's true entitlement state is inspectable; admin can grant/revoke/refund and see it reflected.

**P6 · Paywalls (config + rendering SDK + analytics)** — XXL — *deps: P0, P3, P4*
Three parts, each large: (a) **Paywall config** — remote paywall model, a visual **editor** (Paywalls v2 component model, templates, variables, localization), targeting/placements, A/B. (b) **Rendering SDK** — `RevenueCatUI` for Flutter: `presentPaywall`/`presentPaywallIfNeeded(requiredEntitlement)`, footer/modal variants, the full callback set (`onPurchaseStarted/Completed/Error/Cancelled`, `onRestore*`, `onDismiss`). (c) **Paywall analytics** — impression/conversion funnel cohorted by first-impression date, PAYWALL_IMPRESSION/CLOSE/CANCEL events.
*Acceptance:* a paywall configured in the dashboard renders in the Flutter app, drives purchases through P3, and its conversion shows in analytics.

**P7 · Customer Center** — L — *deps: P3, P5, P6*
The drop-in native support UI + remote config: help paths (restore, refund via Apple sheet, change plan, cancel), churn-prevention offers wired to feedback (`rc_cancel_offer`/`rc_refund_offer`), cancellation surveys, Customer Center events.
*Acceptance:* the SDK presents a configurable Customer Center; cancel/refund flows and win-back offers work end-to-end.

### Layer D — Analytics & growth

**P8 · Charts / analytics product** — XL — *deps: P1* (extends the existing mirror analytics)
The full chart catalog RC ships, not just today's Overview: MRR + MRR Movement, ARR, Revenue (realized vs estimated, with **currency normalization to USD + estimated net proceeds** = price − commission − tax), Realized LTV, ARPU/ARPPU; Active Subscriptions (+ Movement, healthy/at-risk), Active Trials (+ Movement), New/Reactivated Customers; Conversion-to-paying, Trial Conversion, Retention, Churn, **Cohort Explorer**; **App Store Refund Requests** chart. Plus chart infra: date-range/granularity, the full **segment/filter dimensions** (country, store, product, offering, platform, campaign, sandbox), saved charts, CSV export, the **Overview dashboard** + `metrics/overview` API. (Benchmark percentiles vs comparable apps — **out**, S4.)
*Acceptance:* each chart matches RC's definition on the same data; today's Overview/Conversion become a subset of this.

**P9 · Experiments / Targeting / Placements** — L — *deps: P0, P3, P6*
A/B tests over offerings/paywalls (enrollment, metrics, significance, gradual rollout of winners), targeting rules & audiences, **Placements** (custom offering-placement identifiers + overrides) that the SDK's `getCurrentOfferingForPlacement` consumes.
*Acceptance:* a running experiment shows different offerings/paywalls to enrolled users and reports significant results.

### Layer E — Platform surfaces & integrations

**P10 · REST API v1 + v2** — XL — *deps: P0, P1, P5*
**v1**: `POST /receipts`, subscriber GET/attributes, grant/revoke promotional entitlements, offering override, delete customer, defer/refund. **v2**: resource model over Projects/Apps/Products/Entitlements/Offerings/Packages/Customers/Purchases/Subscriptions/Invoices with list pagination. **Key-permission model** (public/secret/v2-granular). Rate limits, idempotency, error shape.
*Acceptance:* the documented v1+v2 surface is callable with the right key scopes; the SDK's own calls go through v1.

**P11 · Integrations catalog + webhooks-out + scheduled exports** — L — *deps: P1, X2*
Outbound **webhooks** (full event-type set, retry policy, per-event enable, sandbox toggle, delivery mechanics) + the **managed destination catalog** (~27: Amplitude, Braze, Segment, Mixpanel, Firebase, Slack real-time notifier, Stripe, S3/GCS, …) with per-destination event mapping, + **Scheduled Data Exports** (ETL to S3/GCS on a schedule) + email summary reports.
*Acceptance:* an event fires the configured destinations with correct mapping; a scheduled export lands raw data in a bucket.

**P12 · Advanced / long-tail** — L (bundle) — *deps: various*
The remaining first-class features so "none missing" holds: **Virtual Currencies** (dashboard config + grant/deduct + ledger + `VIRTUAL_CURRENCY_TRANSACTION` webhook + client read), **Win-back offers**, **Web-purchase Redemption Links** (native `parseAsWebPurchaseRedemption`/`redeemWebPurchase`, one-time/60-min/QR), **Trusted Entitlements** (`disabled`/`informational`/`enforced` modes + `VerificationResult`), **In-App Messages** (billing-issue/price-consent/generic/win-back), **Subscription Groups** (iOS) as a modeled object, **deferred/pending purchases** ("Ask to Buy", Google pending).
*Acceptance:* each sub-feature works to RC's documented behavior; tracked as a checklist so none is dropped.

### Layer X — Cross-cutting prerequisites

**X1 · Deploy pipeline** — L — *deps: none* — Dockerfile, registry, cloud, public HTTPS. Blocks P2, P11. (Already scoped in the tool-rail spec's deferred section.)
**X2 · Scheduler / worker** — M — *deps: X1* — time-driven renewals/expirations/grace/reconciliation. Blocks P1, P2, P11.

## Build order (phased)

```
Phase 0 (infra gates):        X1 Deploy  →  X2 Scheduler
Phase 1 (the spine):          P0 Domain model  →  P1 Billing authority  →  P2 Store notifications
Phase 2 (make it usable):     P3 Flutter SDK  +  P4 Catalog UI  →  P5 Customers
Phase 3 (growth surfaces):    P6 Paywalls  →  P7 Customer Center ; P8 Charts (parallel)
Phase 4 (platform):           P9 Experiments ; P10 REST API ; P11 Integrations
Phase 5 (completeness):       P12 Advanced/long-tail checklist
```
Critical path to a **minimum real RevenueCat** ("the SDK sells a subscription and the app can ask *is this user subscribed*"): **X1 → X2 → P0 → P1 → P3**. Everything else layers on that spine.

## Out of scope / not literally achievable

Stated explicitly so they are not mistaken for gaps:
- **Non-Flutter platform SDKs** (native iOS, native Android, RN, Unity, KMP, Web, Amazon, macOS) — each a separate SDK program (S1).
- **Stripe / Web Billing / Amazon / Paddle stores** — deferred (S2).
- **Benchmark percentiles vs comparable apps** — requires RevenueCat's cross-tenant aggregate data; impossible for a single self-hosted install (S4).
- **RevenueCat's own plan-tier feature gating** (Pro/Enterprise) — N/A; if you want to monetize the clone that's its own product decision.

## Definition of "parity"

Because "every feature" spans infeasible items, parity is defined as: **feature-complete against Apple + Google on the Flutter SDK, for every RevenueCat product domain P0–P12, with the S1–S4 exclusions named above.** Each sub-project carries its own acceptance criteria (listed per P-item); the program is "done" when P0–P12 pass theirs and the P12 long-tail checklist is fully ticked.

## Next step

Approve/adjust this roadmap (especially the four S-decisions and the phasing). Then we brainstorm **sub-project #1** — which, per the critical path, is **X1 (Deploy pipeline)** if you want infra first, or **P0 (Domain model)** if you'd rather design the billing substrate first and deploy in parallel. Each sub-project then gets its own spec → plan → subagent-driven build, exactly like the tool-rail work.
