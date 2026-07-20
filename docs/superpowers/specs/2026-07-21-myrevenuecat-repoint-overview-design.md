# MyRevenueCat — Repoint Overview off the mirror (+ de-gate Conversion) — Design

**Goal:** Move the MyRevenueCat **Overview** page off the legacy `mobile_analytics` RevenueCat mirror onto our own `mobile_purchase` billing-authority service (a new summary endpoint), and drop the "Connect RevenueCat" gate from **both** Overview and Conversion — so the whole MyRevenueCat surface is the from-scratch clone with no external-RC dependency.

**Design principle:** MyRevenueCat is the self-hosted clone; its pages read `mobile_purchase` and never gate on a real-RevenueCat connection.

---

## §0. Constraints & principles

- **Overview = full repoint** onto a new `mobile_purchase` summary endpoint via `purchaseApiFetch`. **Conversion = de-gate only** — it keeps reading its `mobile_analytics` attribution endpoint (`/metrics/subscriptions/attribution`), because the events/screens that drive trial→paid conversion live in the analytics event stream, not in `mobile_purchase`. Moving Conversion's subscription source off the mirror is OUT of scope (a cross-service change, deferred).
- **No connect gate:** remove `useRcEnabled`/`RcConnectPage` from BOTH pages; gate-then-mount on `useProjects()` resolving only, then render directly (empty/zero states when a project has no subscriptions yet).
- **Do NOT break the Charts page** (`RcChartsPage` already reads `mobile_purchase` metrics — untouched).
- **Summary shape:** the new endpoint returns the EXACT existing `SubscriptionsSummaryResponse` snake_case shape (`lib/api/types.ts`) so `RcOverviewPage`'s KPI/chart rendering is unchanged — only its data hook + gate change. (This endpoint is Overview-specific; the snake_case match to the page's existing contract is deliberate, minimizing page churn.)
- **Roles:** the summary endpoint is `@RequireProjectRole('viewer')` (read-only), like the other metrics routes. Reads only; no mutations in this sub-project.
- **Per-service isolation:** no schema change expected; `mobile_analytics` `tsc` stays 0.
- **Window-approximation:** MRR/active/in-trial/grace are current-state; by_day new/churned/revenue and trials are window-approximated from current Subscription/Transaction rows — same §0 convention as the Charts slice; the endpoint is honest about this.
- **HARD WIP rule:** never touch `dashboard/src/components/layout/*`, layout `*.test.tsx`, `nav-model.ts` (NOT edited), `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`. No co-author trailers. Reuse the chart kit (`ChartCard`/`KpiTile`/`ComparisonTrend`/`DonutChart`), `formatCurrency`/`formatPercent`.

## §1. Server (`mobile_purchase`, additive)

### §1.1 Summary endpoint
`GET /api/v1/projects/:projectId/metrics/summary?from&to&environment` — `ProjectAccessGuard` + `@RequireProjectRole('viewer')`, Zod query reusing the metrics `from/to/environment` schema (default 30-day window, `PRODUCTION`). Returns the `SubscriptionsSummaryResponse` shape:

```
{
  mrr_cents: number, active: number, in_trial: number, grace: number,
  new_subscriptions: number, churned: number, trials_started: number, trials_converted: number,
  by_day: { t: string /*ISO bucket*/, new_subscriptions: number, churned: number, revenue: number }[],
  by_product: { product_id: string, active: number, mrr_cents: number }[],
  by_store: { store: string, active: number }[],
  churn_reasons: { reason: string, count: number }[],
  recent_events: { insert_id: string, event: string, distinct_id: string, timestamp: string, product_id: string, price: number }[]
}
```

### §1.2 `SummaryService` computation (from Subscription/Transaction, reusing `MetricsService` helpers)
- `mrr_cents` — the as-of-`to` dominant-currency MRR (reuse `MetricsService.mrr`'s headline logic). `active` — active-status subs as-of-`to`. `in_trial` — active subs with `periodType ∈ {TRIAL, INTRO}`. `grace` — active subs with `status = GRACE_PERIOD`.
- `new_subscriptions` — subs with `purchasedAt ∈ [from, to]`. `churned` — subs that ended in `[from, to]` (a terminal signal in range: `unsubscribeDetectedAt`/`refundedAt`/`expiresAt`-past for a non-renewing/expired sub). `trials_started` — subs whose `periodType ∈ {TRIAL, INTRO}` with `purchasedAt ∈ [from, to]`. `trials_converted` — subs that were trial and are now in a paid active state (approximated from current `periodType = NORMAL` + `status` active + a prior trial signal). All window-approximated.
- `by_day` — for each bucket in `generateBuckets(from, to, granularity=day)`: `new_subscriptions` (purchasedAt in bucket), `churned` (terminal signal in bucket), `revenue` (Σ Transaction.priceCents non-revoked purchasedAt in bucket). Zero-filled.
- `by_product` — group active subs by `productId`: `active` count + `mrr_cents` (normalized via the product period, reusing the MRR helper). `by_store` — group active subs by `store`: `active` count.
- `churn_reasons` — map the terminal billing signals of subs churned in-range to RC-style reasons: `billing_error` (`billingIssueDetectedAt` set), `voluntary_cancel` (`unsubscribeDetectedAt` set, no billing issue), `refund` (`refundedAt` set), `expiration` (expired with no renewal, none of the above). `{ reason, count }[]`, descending by count.
- `recent_events` — most-recent N (e.g. 20) subscription lifecycle events derived from Transactions (initial_purchase/renewal/cancellation as inferable from the transaction + sub state), each with `distinct_id` = the customer's `appUserId` (join Customer), `product_id` = `storeProductId`, `price` = `priceCents/100`, `timestamp` = `purchasedAt`, `insert_id` = the transaction id.
- Env filter = `PRODUCTION` default. All scoped by `projectId`.

### §1.3 Tests
Testcontainers `SummaryService` spec (each aggregate: MRR/active/in_trial/grace; new/churned/trials; by_day zero-fill; by_product/by_store grouping; churn-reason mapping for each signal; recent_events shape + appUserId join) + e2e (`GET .../metrics/summary` 200 viewer with the documented shape on an empty project → zeros; 401/403/400). Mirror the existing `metrics.e2e-spec.ts`.

## §2. Dashboard

- `features/revenuecat/purchase-metrics-api.ts` — add `useRcSummary(projectId, from, to, opts?)` over `purchaseApiFetch<SubscriptionsSummaryResponse>` to `/api/v1/projects/${projectId}/metrics/summary?from=&to=`, keyed `rcMetricsKey(projectId, 'summary', from, to, 'day')`, enabled once the range is set (mirrors `useRcRevenue`).
- **`RcOverviewPage`** — replace `useSubscriptionsSummary(projectId, from, to, filters)` with `useRcSummary(projectId, from, to)`; **remove `useRcEnabled`/`RcConnectPage`** and the `if (!rcEnabled) return <RcConnectPage/>` branch (gate-then-mount on `useProjects()` only); drop the `useGlobalFilters`/`mergeGlobalFilters` argument (the summary is unfiltered, like Charts). All KPI/chart rendering (MRR, active, in_trial, new, churned, trial→paid, New-subscriptions ComparisonTrend, Churn-reasons DonutChart, By-product/By-store tables, Recent events) is UNCHANGED — same `SubscriptionsSummaryResponse` fields.
- **`RcConversionPage`** — **remove `useRcEnabled`/`RcConnectPage`** and the gate branch only; keep `useSubscriptionAttribution` (mobile_analytics) unchanged. Gate-then-mount on `useProjects()`.
- **Router:** no change — `/rc/overview` and `/rc/conversion` already point at these components.

## §3. Data flow & error handling

Overview: `useRcSummary` → `purchaseApiFetch` GET → the existing loading/error/empty ChartCard states render off the query flags (unchanged). Conversion: unchanged (`apiFetch` → mobile_analytics). Errors surface as `ApiError`; the pages' existing alert/error slots handle them. A project with no subscriptions yet renders zeros/empty states (not a connect wall).

## §4. Testing

- **Server:** Testcontainers `SummaryService` + e2e (§1.3).
- **Dashboard:** update the existing Overview/Conversion page tests (`rc-pages.test.tsx` + any `rc-overview`/`rc-conversion` specs): point Overview's MSW mock at `GET /api/v1/projects/:projectId/metrics/summary` (same-origin, so MSW intercepts) returning a `SubscriptionsSummaryResponse`; keep Conversion's attribution mock; REMOVE the "not connected → RcConnectPage" assertions for both; add a "renders directly without a connect gate" assertion.

## §5. Build order (for the plan)

1. **C1** — server summary endpoint (`SummaryService` + controller + Zod query) + Testcontainers + e2e.
2. **C2** — dashboard `useRcSummary` hook + MSW hook test.
3. **C3** — repoint + de-gate `RcOverviewPage`; update its tests.
4. **C4** — de-gate `RcConversionPage`; update its tests.
5. **C5** — verify gate (both backends tsc 0; mobile_purchase summary + e2e green; dashboard tsc 0 + revenuecat suite green; WIP-safety `git status`).

## §6. Out of scope (explicit)

- **Conversion's subscription source** stays on `mobile_analytics` (its correlation with the analytics event stream is inherent; moving its subscription side to `mobile_purchase` is a deferred cross-service task).
- **Global filters** on Overview (the mirror hook accepted a filters arg) — the `mobile_purchase` summary is unfiltered, matching the Charts page; per-filter breakdowns are deferred.
- The legacy `mobile_analytics` RC-mirror integration + its endpoints stay in place (untouched) — this sub-project just stops MyRevenueCat's Overview from depending on them.
- No `nav-model`/navigation change; no schema/migration.

## §7. Response shape (reference)

`GET .../metrics/summary` → `SubscriptionsSummaryResponse` (§1.1), field-for-field identical to `dashboard/src/lib/api/types.ts`'s existing interface so `RcOverviewPage` consumes it unchanged.
