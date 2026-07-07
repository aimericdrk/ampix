# Dashboard v4 — Phase 2 (graphs on pages) + Phase 3 (Home revamp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Compose the Phase-1 foundation primitives onto the analytics pages and rebuild Home into a data-dense overview — the visible half of the rework.

**Architecture:** Add small query-style data hooks + pure derive helpers (previous-period, deltas, series→trend/breakdown shaping), then compose `KpiTile`/`ChartCard`/`SectionGrid`/`DataTable`/`ComparisonTrend`/`BreakdownChart`/`DonutChart` (built in the foundation) onto pages, all time-scoped by the global `useDateRange`. Wire the already-existing `GET metrics/engagement` (DAU/WAU/MAU + stickiness + new-vs-returning) which the frontend didn't consume.

**Tech Stack:** React 18, TS, TanStack Query, Recharts, vitest + Testing Library + msw. No backend changes; no new deps.

## Global Constraints
- No new npm deps; no backend changes (all endpoints exist).
- Do NOT touch the in-tree `MyAmpMix→MyAmpix` rebrand / formatter drift; stage only each task's files (targeted hunks if a file also carries rebrand lines; never `sdk/` or `pnpm-lock.yaml`).
- No co-author trailer; `feat/fix(...)` messages, scoped per task.
- Verify each task: `cd dashboard && pnpm exec tsc --noEmit` clean + the task's vitest green + full `pnpm test` green before commit.
- Reuse the foundation primitives + `palette.ts`; do not add new chart types.
- Time-scoped pages read the global range via `useDateRange()` (from `features/analytics/date-range.tsx`) and render `<DateRangeControl/>` in the `PageShell` header (`dateRangeControl` prop added in Phase 1). Keep each page's builder/advanced controls; seed them from the global range.
- Auto-loading data uses query-style hooks (never a mutation for data that should load on view). Keep charts' accessible tables intact.

---

## File Structure

Create:
- `dashboard/src/features/analytics/derive.ts` — pure helpers: `previousRange`, `pctDelta`, `sumSeries`, `seriesTrendRows`, `breakdownBars`.
- `dashboard/src/features/analytics/components/OverviewCards.tsx` — a shared KPI-row + trend composition used by Home and (optionally) Insights (only if it stays genuinely shared; otherwise inline).
- Tests co-located (`derive.test.ts`, page tests updated).

Modify:
- `dashboard/src/features/analytics/api.ts` — add `useEngagement` + a query-style `useInsightsQuery`.
- `dashboard/src/lib/api/types.ts` — add `EngagementMetric`, `EngagementActivePoint`, `EngagementStickinessPoint`, `EngagementNewReturningPoint`, `EngagementResponse` (mirror backend `analytics.types.ts`).
- `dashboard/src/test/msw/handlers.ts` (or `phase5-handlers.ts`) — add a `metrics/engagement` handler; ensure `query/insights` handler supports breakdown fixtures.
- Pages: `HomePage.tsx`, `InsightsPage.tsx`, `FunnelsPage.tsx`, `RetentionPage.tsx`, `FlowsPage.tsx`, `PathsPage.tsx`, `HeatmapPage.tsx` + their tests.

---

### Task 1: Data hooks + derive helpers

**Files:**
- Create: `dashboard/src/features/analytics/derive.ts`, `dashboard/src/features/analytics/derive.test.ts`
- Modify: `dashboard/src/features/analytics/api.ts`, `dashboard/src/lib/api/types.ts`, `dashboard/src/test/msw/handlers.ts`

**Interfaces (Produces):**
- Types (in `types.ts`, mirroring backend `analytics.types.ts` §19):
  `EngagementMetric = 'dau'|'wau'|'mau'`; `EngagementActivePoint = { t: string; metric: EngagementMetric; value: number }`; `EngagementStickinessPoint = { t: string; value: number }`; `EngagementNewReturningPoint = { t: string; new: number; returning: number }`; `EngagementResponse = { active: EngagementActivePoint[]; stickiness: EngagementStickinessPoint[]; new_vs_returning: EngagementNewReturningPoint[] }`.
- Hooks (in `api.ts`):
  - `useEngagement(projectId, from, to, interval)` — `useQuery` GET `${base}/metrics/engagement?from=&to=&interval=` → `EngagementResponse`; `enabled` when from & to set.
  - `useInsightsQuery(projectId, definition, enabled=true)` — `useQuery` POST `${base}/query/insights` (body = `InsightsQueryDefinition`) → `InsightsResponse`; `queryKey` includes `JSON.stringify(definition)`; auto-loads (this is the query-style counterpart of the existing `useRunInsights` mutation).
- Derive helpers (in `derive.ts`, pure + unit-tested):
  - `previousRange(from: string, to: string): { from: string; to: string }` — the immediately-preceding equal-length window (inclusive day math on `YYYY-MM-DD`; length = days(to)-days(from)+1; previous = [from-length, from-1day]).
  - `pctDelta(current: number, previous: number): number` — `previous === 0 ? (current>0?100:0) : ((current-previous)/previous)*100`, rounded to 1 decimal.
  - `sumSeries(series: InsightsSeries[]): number` — sum of all points across all series.
  - `seriesTrendRows(series: InsightsSeries[]): Array<{ t: string; value: number }>` — per-bucket sum across series (union of `t`, zero-filled), sorted by `t`. For `xKey='t'`/`valueKey='value'` feeding `ComparisonTrend`.
  - `breakdownBars(response: InsightsResponse): Array<{ label: string; value: number }>` — one bar per distinct `breakdown_value` (label = value ?? '(none)'), value = `sumSeries` of that group, sorted desc.

- [ ] **Step 1: Write failing tests** (`derive.test.ts`): `previousRange('2026-06-01','2026-06-30')` → `{from:'2026-05-02',to:'2026-05-31'}` (30-day window); `pctDelta(120,100)===20`, `pctDelta(5,0)===100`, `pctDelta(0,0)===0`; `sumSeries` over two series sums all points; `seriesTrendRows` merges buckets by `t` and zero-fills; `breakdownBars` groups by `breakdown_value` desc. (Add a hooks smoke test only if trivial with the msw setup; the hooks are otherwise exercised by page tests.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the types, hooks (mirror existing `useRunInsights`/`useSessionsSummary` patterns in `api.ts`), and derive helpers. Add the msw `metrics/engagement` handler returning a small deterministic `EngagementResponse`, and ensure the `query/insights` msw handler returns breakdown-shaped series when `breakdown` is present (extend the existing fixture).
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): engagement + query-style insights hooks and derive helpers`.

---

### Task 2: Home revamp (Phase 3 — flagship)

**Files:**
- Modify: `dashboard/src/features/analytics/components/HomePage.tsx`
- Modify test: find/adjust the Home test (search `HomePage` under `dashboard/src/**/*.test.tsx`; create `home.test.tsx` if none)

**Interfaces (Consumes):** Task 1 hooks/helpers; `useDateRange`; `useEventSummary`, `useSessionsSummary`, `useDashboards`, `useReports`; foundation primitives `KpiTile`, `ChartCard`, `SectionGrid`, `DataTable`, `ComparisonTrend`, `DonutChart`, `BreakdownChart`, `ChartThumbnail`.

- [ ] **Step 1: Write failing tests.** With msw returning engagement + insights + summary fixtures: Home renders a KPI row containing tiles for **Total events, DAU, WAU, MAU, Sessions, Avg session, Stickiness** (assert the labels + at least one delta chip); an active-users **ComparisonTrend** (role img); an **Events-by-type** DonutChart; a **top events** DataTable; a **breakdown by OS** chart; and preserves the no-events empty state (total 0 → onboarding copy). Keep it resilient to loading states.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Rebuild `HomePage` time-scoped by `useDateRange` and `<DateRangeControl/>` in the header:
  - **KPI row** (`SectionGrid` of `KpiTile`): Total events (from `useEventSummary` all-time OR insights over range — use `useInsightsQuery` `total` over current range and `previousRange` for the delta), DAU/WAU/MAU (latest `active` point per metric from `useEngagement` with interval `day`/`week`/`month`, or run engagement thrice by interval — pick the simplest correct mapping; the endpoint returns `active` tagged by `metric`), Sessions + Avg session (from `useSessionsSummary` current vs previous range for deltas), Stickiness (latest `stickiness` point).
  - **Main trend:** `ComparisonTrend` of active users (engagement `active` for the day interval → rows `{t,value}`) with the previous-period overlay (`useEngagement` over `previousRange`).
  - **Composition:** `DonutChart` Events-by-type (from `useEventSummary.by_event` top 8, `colorForIndex`), with a center total.
  - **Breakdowns:** `BreakdownChart` by `os` and by `app_version` (via `useInsightsQuery` with `breakdown:{property}` over the range → `breakdownBars`), each in a `ChartCard`.
  - **Acquisition:** top `utm_source` via `useInsightsQuery` breakdown → `BreakdownChart`/`DataTable` (skip gracefully if empty).
  - **Top events** `DataTable` (event, count) sortable.
  - **Recent work:** keep reports/dashboards lists (restyled with `ChartThumbnail` already available) — reuse existing `RecentList`.
  - Preserve the empty (0 events) onboarding branch.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): data-dense Home overview (KPIs, engagement trend, breakdowns)`.

---

### Task 3: Insights page restyle

**Files:** Modify `dashboard/src/features/analytics/components/InsightsPage.tsx` + its test.

**Interfaces (Consumes):** `useDateRange`, `KpiTile`, `ChartCard`, `SectionGrid`, `ComparisonTrend`, `BreakdownChart`, Task-1 derive helpers.

- [ ] **Step 1: Write failing test.** After running a query, the page shows a KPI summary row (Total and/or Unique users with a delta vs previous period), the main chart wrapped in a `ChartCard`, and (when a breakdown is chosen) results usable as a `BreakdownChart`/existing chart; the global `DateRangeControl` renders in the header and seeds the builder's range. Keep existing insights assertions (query body, chart-type toggle) passing.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Seed the builder's date range from `useDateRange` (and expose `<DateRangeControl/>` in the header); add a KPI summary row above the chart computed from the current result + a `previousRange` query (`useInsightsQuery`); wrap the primary chart in `ChartCard`. Keep the existing `InsightsChart` + chart-type toggle + builder.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): data-dense Insights page (KPI row + ChartCard + global range)`.

---

### Task 4: Funnels page restyle

**Files:** Modify `dashboard/src/features/analytics/components/FunnelsPage.tsx` + its test.

- [ ] **Step 1: Write failing test.** After running, a KPI row shows Overall conversion (%), Entered (step-1 count), Converted (last-step count); the funnel chart is wrapped in `ChartCard`; `DateRangeControl` in the header. Keep existing funnel assertions passing.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** KPI tiles from the `FunnelResponse` (`overall_conversion`, first/last step counts); wrap `FunnelChart` in `ChartCard`; seed range from `useDateRange`.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): data-dense Funnels page (conversion KPIs + ChartCard)`.

---

### Task 5: Retention page restyle + engagement surface

**Files:** Modify `dashboard/src/features/analytics/components/RetentionPage.tsx` + its test.

**Interfaces (Consumes):** `useEngagement` (Task 1), `KpiTile`, `ChartCard`, `ComparisonTrend`.

- [ ] **Step 1: Write failing test.** After running, a KPI row shows an average retention headline; the retention chart is wrapped in `ChartCard`; a new **Stickiness** (DAU/MAU) `ComparisonTrend` from `useEngagement.stickiness` renders in its own `ChartCard`; `DateRangeControl` in the header. Keep existing retention assertions passing.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** KPI from `RetentionResponse.averages`; wrap `RetentionChart` in `ChartCard`; add a stickiness trend (`useEngagement` over the global range, `stickiness` → `{t,value}` rows) in a `ChartCard`; seed range from `useDateRange`.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): data-dense Retention page (retention KPI + stickiness trend)`.

---

### Task 6: Flows + Paths + Heatmap restyle (lighter, batched)

**Files:** Modify `FlowsPage.tsx`, `PathsPage.tsx`, `HeatmapPage.tsx` + their tests.

- [ ] **Step 1: Write failing tests.** Each page renders `<DateRangeControl/>` in the header, seeds its range from `useDateRange`, and wraps its primary result visualization in a `ChartCard` (with a summary/KPI tile where a scalar exists — e.g. Heatmap total taps, Flows/Paths total transitions/users). Keep every existing assertion for these pages passing (they have rich tests — do not regress the path-map/heatmap/fullscreen behaviors).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the three pages: `useDateRange` seeding + `<DateRangeControl/>` + `ChartCard` wrapping + a scalar KPI tile each. Preserve all interactive behaviors (path fullscreen, heatmap overlay, screen picker).
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): data-dense Flows/Paths/Heatmap headers (global range + ChartCard + KPI)`.

---

## Self-Review (against the spec)
- Phase 2 (graphs across pages): Insights (T3), Funnels (T4), Retention+engagement (T5), Flows/Paths/Heatmap (T6); KPI rows, comparison trends, breakdowns via the insights engine + `metrics/engagement` (T1). ✓
- Phase 3 (Home revamp): T2, full data-dense overview incl. DAU/WAU/MAU + stickiness. ✓
- Global date range applied to pages (deferred from Phase 1): every time-scoped page migrates to `useDateRange` in T2–T6. ✓ (also validates the Phase-1 per-project provider under real consumption; fix the provider's current-project derivation here if a page reveals a gap.)
- Placeholder scan: none — each task has concrete hooks/helpers, page compositions, tests, commit.
- Type consistency: `EngagementResponse`/`InsightsResponse` field names match backend; derive helper signatures are referenced identically across tasks.
- Deferred: Phase 4 (users search/path) and Phase 5 (scale menu) — separate plans.
