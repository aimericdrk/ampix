# MyRevenueCat Charts — Dashboard Vertical Slice — Design

**Date:** 2026-07-18
**Status:** Draft design, pending review
**Scope:** One RevenueCat-style graph page working end-to-end: `mobile_purchase` metrics endpoints → dashboard→`mobile_purchase` reach → the dashboard `/rc/charts` page.
**Program context:** The "dashboard wiring" sub-project of the RevenueCat-parity program, first slice. The `mobile_purchase` server (M1–M5) and `flutter_purchases` SDK are complete; this is the first dashboard surface wired to the new billing-authority service (today the dashboard's MyRevenueCat pages read the legacy `mobile_analytics` RC mirror only).

---

## 0. Scope, non-goals, honest computation limits

**In scope (this slice):** three time-series charts + headline KPIs on the existing `/rc/charts` placeholder route — **Revenue over time**, **MRR**, **Active Subscriptions over time** — driven by real `mobile_purchase` data, plus the server endpoints and the dashboard→`mobile_purchase` data-fetch seam they need.

**Non-goals (deferred, named so they aren't mistaken for gaps):**
- The other RC dashboard placeholders — Products/Entitlements/Offerings config UIs, Customers list, Paywalls — are LATER slices of this same sub-project.
- Repointing the existing `/rc/overview` + `/rc/conversion` pages off the legacy mirror onto `mobile_purchase` — later; the mirror keeps working.
- Churn/trial-funnel/cohort/LTV charts — later slices.
- FX/multi-currency normalization to a single display currency — deferred (v1 is per-currency; see §3).
- Any `nav-model.ts` structural change — the `/rc/charts` route already exists; we only replace its page component.

**Honest computation limits (important — the metrics differ in fidelity):**
- **Revenue over time is EXACT.** `Transaction` is an immutable ledger with `purchasedAt` history, so revenue is a true time series.
- **MRR and Active-Subscriptions "over time" are APPROXIMATE for historical churn.** The `Subscription` table holds only CURRENT state (one live row per store subscription identity; no daily history). A *true* historical active-count/MRR series requires materialized daily snapshots — which need the X2 scheduler (not built). For v1 we compute them from the current `Subscription` rows' active windows `[purchasedAt, expiresAt]`: a subscription counts toward bucket `T` if `purchasedAt ≤ T` and (`expiresAt IS NULL` or `expiresAt > T`) and not revoked. This is accurate for the current value and the recent past but **understates historical churn** (a subscription that expired long ago is simply absent from current state). This limitation is documented in the spec, surfaced in the endpoint docs, and shown as a footnote on the chart. Exact historical snapshots are an X2 follow-up.

---

## 1. Server — `mobile_purchase` `MetricsModule`

New module `backend/mobile_purchase/src/metrics/` (mirrors the catalog module's structure: controller + service + support + tests). It is the FIRST aggregation code in the service.

### 1.1 Endpoints (dashboard-JWT surface — the existing authz seam)

All under `@Controller('api/v1/projects/:projectId/metrics')`, `@UseGuards(ProjectAccessGuard)`, `@RequireProjectRole('viewer')` — the exact pattern the catalog `GET` routes use. `ProjectAccessGuard` forwards the dashboard `Authorization` header to `mobile_analytics`'s internal role endpoint (no JWT secret here). Zod-validated query.

Common query params: `from` (ISO date, default `to − 30d`), `to` (ISO date, default now), `granularity` (`day` | `week` | `month`, default `day`), `environment` (`PRODUCTION` | `SANDBOX`, default `PRODUCTION`).

```
GET /api/v1/projects/:projectId/metrics/revenue?from&to&granularity&environment
  → 200 {
      currency: string | null,          // the dominant currency (see §3); null if no data
      totalCents: number,               // sum over the range (dominant currency)
      series: [{ bucket: string /*ISO date, bucket start*/, amountCents: number }],
      byCurrency: [{ currency: string, totalCents: number }]   // full multi-currency breakdown
    }

GET /api/v1/projects/:projectId/metrics/mrr?from&to&granularity&environment
  → 200 {
      currency: string | null,
      mrrCents: number,                 // CURRENT MRR (as of `to`), dominant currency
      series: [{ bucket: string, mrrCents: number }],           // window-approximated (see §0)
      unattributedActiveCount: number,  // active subs with no importable Product/period, excluded from MRR
      approximate: true                 // historical-churn caveat flag
    }

GET /api/v1/projects/:projectId/metrics/active-subscriptions?from&to&granularity&environment
  → 200 {
      current: number,                  // active subs as of `to`
      series: [{ bucket: string, count: number }],              // window-approximated (see §0)
      approximate: true
    }
```

Errors: `401` (missing/invalid auth — from the guard), `403` (insufficient role), `400` (bad query, RFC-7807), `503` (analytics role-service unreachable — from the guard). All RFC-7807 via the existing `ProblemException`.

### 1.2 `MetricsService` — aggregation semantics

- **Active-subscription states:** a `Subscription` is "active" when `status ∈ {TRIAL, INTRO, ACTIVE, CANCELLED, GRACE_PERIOD}` (the entitled states — same set the entitlement engine's compute-on-read uses), scoped to `projectId` + `environment`. `@@index([projectId, status])` supports the current count.
- **Revenue:** `SUM(Transaction.priceCents)` grouped by `date_trunc(granularity, purchasedAt)`, scoped `projectId` + `environment`, **excluding `revokedAt IS NOT NULL`** (refunds/chargebacks) and rows with `priceCents IS NULL`. Full history from the ledger.
- **MRR derivation:** current MRR = `Σ monthlyCents(sub)` over active subs, where `monthlyCents(sub)` normalizes `sub.priceCents` to a monthly figure via the sub's `Product.durationIso8601` (`Subscription.productId → Product`, nullable): `P1M`→×1, `P1Y`→÷12, `P1W`→×(30/7), `P3M`→÷3, `P6M`→÷6, `P1W`/`P7D`→weekly, `P1D`→×30, etc. Active subs whose `productId` is null OR whose product has no resolvable period are **excluded** from MRR and counted in `unattributedActiveCount` (never silently dropped). MRR/active-subs series are computed by evaluating the active-window predicate at each bucket start (§0).
- **Currency (v1, per-currency):** amounts are summed in minor units grouped by `currency`; `byCurrency` returns every currency's total; the top-level `currency`/`totalCents`/`mrrCents` report the **dominant** currency (the one with the largest total). Rows with `currency IS NULL` are grouped under a `null` currency bucket and excluded from the dominant selection. FX normalization to one display currency is deferred (flagged).
- **Time bucketing:** SQL `date_trunc` (or a generated bucket series so empty buckets render as zero, not gaps) between `from` and `to`. Buckets are UTC.
- Uses Prisma `groupBy`/`$queryRaw` as needed (raw SQL for `date_trunc` + generated series; Prisma `groupBy` where it suffices). All reads scoped by `projectId` (this service has no Project FK; `projectId` is the opaque scope column).

### 1.3 Migration

Add `@@index([projectId, environment, purchasedAt])` to `Transaction` (only `@@index([projectId])` exists) so revenue time-series scans use an index. Standard `migrate dev --create-only` → review SQL → `migrate deploy` on `:5433` → regenerate the local client; confirm `mobile_analytics` tsc stays 0 (per-service client separation).

### 1.4 Tests

Testcontainers-backed `MetricsService` tests: revenue sum + bucketing + refund exclusion + env filter + null-price exclusion; MRR derivation across periods (P1M/P1Y/P1W) + `unattributedActiveCount`; active-subscription window predicate at bucket boundaries; per-currency grouping + dominant selection; empty-project (zeros, not errors). Plus an e2e boot test proving the routes are guarded (viewer 200 / missing-auth 401) with `ProjectAccessService` faked (like the catalog e2e).

---

## 2. Dashboard → `mobile_purchase` reach

The dashboard calls only same-origin today (`apiFetch` → `apiBaseUrl`, default `''`), all `mobile_analytics`. `mobile_purchase` is a separate service and BOTH use `/api/v1/projects/:projectId/…` (path collision), so it needs a distinct origin/base.

- **Runtime config:** add `purchaseApiBaseUrl` to the dashboard runtime config (`dashboard/src/lib/config.ts`), default `''` in same-origin deploys but settable to the `mobile_purchase` origin (dev: its dev server; prod: set by X1). When empty AND no proxy is configured, the RC data pages degrade gracefully (see gating).
- **`purchaseApiFetch`:** a thin sibling of `apiFetch` (`dashboard/src/lib/api/`) that prefixes `purchaseApiBaseUrl`, forwards the `Authorization: Bearer <dashboard JWT>` header (same token store `apiFetch` uses) and `Content-Type`, and maps RFC-7807 error bodies to the app's error type — identical error handling to `apiFetch`. This is the reusable seam ALL future RC dashboard pages (config UIs, customers) use.
- **CORS:** enable CORS on `mobile_purchase` (`main.ts`) for the dashboard origin(s) (config-driven allowlist, credentials/Authorization allowed). Dev alternative: a Vite dev-server proxy that routes a distinct dashboard-side prefix to `mobile_purchase`, avoiding CORS — but the direct-origin + CORS path is the primary design (works in prod behind X1). Preflight (`OPTIONS`) must pass the guard-free (CORS handled before routing).
- **Tests:** `purchaseApiFetch` unit test (base URL prefixing, auth header forwarded, RFC-7807 → error) with a mocked fetch, mirroring the existing `apiFetch` tests.

---

## 3. Dashboard — the `/rc/charts` page

Replace the `/rc/charts` `RcPlaceholderPage` (route already registered in `router.tsx`; **no `nav-model` change**) with a real page under `dashboard/src/features/revenuecat/`.

- **Data hooks:** TanStack Query hooks (`useRcMrr`, `useRcRevenue`, `useRcActiveSubscriptions`) over `purchaseApiFetch`, keyed by `projectId` + range + granularity, mirroring the existing `features/revenuecat/api.ts` hook style.
- **Page composition (mirror `RcOverviewPage`):** a header with a range/granularity control; a KPI row (`KpiTile`) for current MRR, active subscribers, revenue-in-range; and three `ChartCard`-wrapped `ComparisonTrend` charts (Revenue, MRR, Active Subscriptions) from the shared Recharts kit (`dashboard/src/features/analytics/components/charts/`), each `role="img"` + the accessible `<table>` equivalent the kit already ships. A footnote surfaces the MRR/active-subs historical-approximation caveat and the per-currency note.
- **Gating & degradation:** gated behind `rcEnabled` (the existing `useRcEnabled()` flag) like every other RC page. If `purchaseApiBaseUrl` is unset/unreachable, the hooks surface an error state that `ChartCard` renders as its error slot (never a crash), with a message that the purchase service isn't configured.
- **Accent:** `/rc/charts` is in the "Monitor" group (lime accent) — the page uses the section accent like its siblings.
- **Tests:** page tests with MSW mocking `purchaseApiFetch` responses — loading, empty (zeros render, no crash), error (ChartCard error slot), and data (KPIs + charts + the accessible tables render the mocked values). Follow the existing RC page test patterns.

---

## 4. WIP safety

The user has uncommitted collapse-rail WIP in `dashboard/`. This slice:
- Does NOT touch `nav-model.ts`'s `revenuecat` tool block, `RC_GATED`, `allGroups()`, or the new `PROJECT_SETTINGS` export (the `/rc/charts` route already exists — zero nav change).
- Does NOT touch any WIP file (`AppLayout.tsx`, `OrgSwitcher/ProjectSwitcher/ToolRail/CommandPalette`, `render-app.tsx`, `RailInitial.tsx`, the layout `*.test.tsx`).
- Adds only new files under `dashboard/src/features/revenuecat/` + `dashboard/src/lib/api/` + `dashboard/src/lib/config.ts` (a one-field addition) + the `router.tsx` line for `/rc/charts` (swap the placeholder component import — a single, isolated line well outside the WIP files).

---

## 5. Decomposition — buildable increments

**Build order:** server first (unblocks everything), then reach, then the page.

**S1 · Server MetricsModule + endpoints + migration** — the `metrics/` module: `MetricsService` (revenue/MRR/active-subscriptions aggregations, MRR derivation, env/currency handling), the 3 guarded controllers, Zod query validation, the `Transaction` time-series index migration. *Acceptance:* Testcontainers metrics tests green (aggregation/MRR/active-window/currency/empty); e2e guard test (viewer 200 / 401); `mobile_purchase` tsc 0, `mobile_analytics` tsc 0.

**S2 · Dashboard reach (`purchaseApiFetch` + config + CORS)** — `purchaseApiBaseUrl` runtime config, `purchaseApiFetch`, `mobile_purchase` CORS. *Acceptance:* `purchaseApiFetch` unit tests (base/auth/error) green; `mobile_purchase` CORS allows the dashboard origin (a boot/e2e check); dashboard `tsc`/lint clean.

**S3 · Dashboard `/rc/charts` page + hooks** — the query hooks + the page + the router swap + gating. *Acceptance:* page tests (loading/empty/error/data via MSW) green; `rcEnabled` gating; the accessible tables render; dashboard build/lint clean; **no WIP file touched** (verified by `git status`).

**Suggested order:** S1 → S2 → S3.

---

## 6. External gates (unchanged)
Real metrics need real ingested purchases (device+sandbox+deployed webhooks — the same gates as the server). The whole slice is buildable + testable against seeded/mocked data without them. Exact historical MRR/active-subscription snapshots need the X2 scheduler (deferred).
