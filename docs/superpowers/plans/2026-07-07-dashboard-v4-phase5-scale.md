# Dashboard v4 — Phase 5 (Scale Features) Roadmap + Feature Plans

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Build the scale-appropriate features (100k MAU / 20k DAU) that are achievable on the current architecture, in value order.

## Scope reality (what's buildable vs blocked)

**Buildable now (this roadmap builds these, in order):**
- **A. Revenue / LTV** — off existing `$in_app_purchase` events (`$price`/`$product_id`/`$currency`/`$store`). New backend metric + Revenue page.
- **B. Saved Segments** — first-class reusable audiences applied across Insights/Funnels/Retention (leverages the existing cohort-as-filter `cohort_id` machinery).
- **C. Real-time Live view** — a live page over the existing live-events feed + a rolling active-users count.
- **D. Data export (CSV)** — client-side CSV export of query results / tables (no backend).
- **E. Metric alerts (in-app)** — thresholds on saved metrics with in-app surfacing (no email provider, so in-app only).
- **F. Dashboard sharing (read-only link)** — a per-dashboard share token + an authenticated "shared" read view.

**Blocked on infrastructure — NOT built here (documented, not faked):**
- **Scheduled report emails / digests** — the app has NO email provider (contracts §: invitations use shareable links precisely because there's no email). Requires provisioning an email service first.
- **Crash / ANR / slow-screen performance** — requires new Flutter SDK autocapture (error/ANR/frame timing) + ingestion + schema. A large separate SDK initiative, out of scope for a dashboard-side change.

## Global Constraints (all features)
- No new deps unless a feature's plan explicitly justifies one. Backend changes additive; every user value a bound ClickHouse param / Prisma arg.
- Do NOT touch the `MyAmpMix→MyAmpix` rebrand / formatter drift; stage only each task's files (targeted hunks where a file also carries rebrand lines; never `sdk/`/`pnpm-lock.yaml`).
- No co-author trailer; `feat/fix(...)` per task. Implementers LEAVE changes in the working tree; the orchestrator commits with rebrand-clean staging.
- Verify per task: backend `pnpm build` + `pnpm test` green; frontend `tsc --noEmit` + `pnpm test` green.
- Reuse the v4 primitives (`KpiTile`, `ChartCard`, `SectionGrid`, `DataTable`, `ComparisonTrend`, `BreakdownChart`, `DonutChart`, `useDateRange`).

Features B–F get their own detailed plans as they are reached (each its own spec→plan→build cycle). Feature A is detailed below.

---

## Feature A — Revenue / LTV

Mirrors the sessions-summary pattern (`getSessionsSummary`): a numeric JSON-property (`$price`) sum over `$in_app_purchase` events, with a `by_day` grid and canonicalized paying-user counts.

### A1: Backend — revenue metric endpoint

**Files:** Modify `backend/src/analytics/analytics.service.ts` (+ types), `v2-analytics.controller.ts` (+ its service if it delegates) OR add a route on the existing analytics controller; `analytics.types.ts`; tests `analytics.service.spec.ts` / controller spec; docs §19.

**Interfaces (Produces):**
- `GET api/v1/projects/:projectId/metrics/revenue?from=<date>&to=<date>` → `RevenueSummaryResponse`:
  `{ total_revenue: number; purchases: number; paying_users: number; arppu: number; avg_purchase_value: number; by_day: Array<{ t: string; revenue: number; purchases: number }>; by_product: Array<{ product_id: string; revenue: number; purchases: number }> }`.
- Revenue = `sum(JSONExtractFloat(toJSONString(properties), '$price'))` over `event = '$in_app_purchase'` in range; purchases = `count(DISTINCT insert_id)`; paying_users = `uniqExact(canonical uid)` (use `canonicalization()`); arppu = revenue/paying_users (0 when 0); avg_purchase_value = revenue/purchases (0 when 0). `by_product` = top 10 by revenue on `$product_id` (JSONExtractString), rest foldable. `$in_app_purchase`/`$price`/`$product_id` are OUR reserved literals (SQL literals, never bound); the only bound values are projectId + date range.

- [ ] **Step 1: Write failing tests** (`analytics.service.spec.ts`, mock clickhouse): assert the compiled SQL sums `JSONExtractFloat(...'$price')` over `event = '$in_app_purchase'` within the bound date range, counts paying users via the canonical uid (canonicalization CTE present), groups `by_day` and `by_product` (`$product_id`); mapped response computes arppu/avg correctly incl. divide-by-zero → 0.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `getRevenueSummary(userId, projectId, from?, to?)` mirroring `getSessionsSummary` (membership check, `resolveDateOnlyRange`, `buildBucketGrid` for `by_day` zero-fill, `canonicalization()` for paying users). Add the `RevenueSummaryResponse` + row types. Wire a controller route (mirror `metrics/engagement` on `v2-analytics.controller.ts`, or `sessions/summary` on the main controller — match whichever owns metric GETs).
- [ ] **Step 4: Run tests + `pnpm build`.**
- [ ] **Step 5: Docs** §19 — `GET metrics/revenue` shape + engine note.
- [ ] **Step 6: Commit** (orchestrator): `feat(analytics): revenue metric endpoint (in_app_purchase $price sum, paying users, by product)`.

### A2: Frontend — Revenue page

**Files:** Create `dashboard/src/features/analytics/components/RevenuePage.tsx` + test; modify `api.ts` (`useRevenue` hook), `lib/api/types.ts` (`RevenueSummaryResponse`), the router to add the `/projects/$projectId/revenue` route + a nav link (find the route table + sidebar), `test/msw/handlers.ts` (revenue fixture).

**Interfaces (Consumes):** `useDateRange`, `KpiTile`, `ChartCard`, `SectionGrid`, `ComparisonTrend`, `BreakdownChart`, `DataTable`, `formatExactNumber` + a currency formatter.

- [ ] **Step 1: Write failing test.** Revenue page renders a KPI row (Total revenue, Purchases, Paying users, ARPPU, Avg purchase value), a revenue `ComparisonTrend` (by_day), and a `by_product` `BreakdownChart`/`DataTable`; time-scoped by the global range; empty state when no purchases.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `RevenueSummaryResponse` type; `useRevenue(projectId, from, to)` query hook (GET metrics/revenue); a Revenue page composing the primitives (currency-format revenue values — a small `formatCurrency` helper, default USD or the dominant `$currency` if surfaced later). Add the route + a sidebar nav entry ("Revenue", under a Revenue/Monetization group or Explore). Add the msw handler + fixture.
- [ ] **Step 4: Run tests + `tsc`.**
- [ ] **Step 5: Commit** (orchestrator): `feat(dashboard): Revenue page (revenue KPIs, trend, by-product)`.

(LTV curve — cumulative revenue per signup cohort — is a follow-up if the simple revenue view proves insufficient; not in this feature to keep it shippable.)
