# Feature 09 — Distribution Histograms

Date: 2026-07-07 · Status: spec ready · Surface: backend (new query) + dashboard (new viz)

## 1. What it is
See the *shape* of a metric, not just its average: a histogram of **session length**, **purchase
value**, or any numeric event property. Reveals bimodal behavior, long tails, and outliers that a mean
hides ("most sessions are 20s, but a cluster runs 10min").

## 2. Why
- Averages lie about distributions. A histogram is the honest view of spread.
- One new backend query + one new chart component unlocks distributions for every numeric property.

## 3. Design

### 3.1 Backend — `POST /query/histogram`
Body: `{ event: string; property: string; bins?: number (default 20, 2..50); date_range: {from,to}; filters?: InsightsFilter[] }`.
- `event` and `property` are caller-supplied → `property` resolved via `resolveProperty` (bound/whitelist,
  never interpolated — same doctrine as everywhere), extracted as a float
  (`JSONExtractFloat(toJSONString(properties), {key})` for custom, or the column for whitelisted numerics).
  `event` bound as a param. Filters via the shared compiler (bound).
- Use ClickHouse `histogram(bins)(value)` over the matching events in range where the value is
  non-null/finite → returns adaptive `(lower, upper, height)` tuples. Response:
  `{ buckets: Array<{ lower: number; upper: number; count: number }>; total: number; min: number; max: number; mean: number; p50: number; p90: number }`
  (compute total/min/max/mean/quantiles alongside via `count()/min()/max()/avg()/quantile(0.5)/quantile(0.9)`).
- Empty (no matching events) → `{ buckets: [], total: 0, ... zeros }`.
- Zod schema `histogramQuerySchema`; controller route mirrors the other `query/*` POSTs (viewer+).
  Document §19. Backend unit tests (SQL shape + injection-safety on property/filters + empty).

### 3.2 Frontend — `HistogramChart` + a Distribution surface
- `HistogramChart.tsx`: a Recharts bar chart over the buckets (x = bucket range label, y = count),
  reusing palette + `ChartCard` conventions + the accessible data table (bucket range, count, %). A
  summary strip of `KpiTile`s: total, mean, p50, p90 (formatted by the metric's unit — ms→duration,
  currency for price).
- A **Distributions** page (route `/projects/$projectId/distributions` + nav link, mirror the Revenue
  page wiring) with:
  - a preset picker (Session length = `$session_end`/`$duration_ms` as duration; Purchase value =
    `$in_app_purchase`/`$price` as currency) PLUS a custom (event + numeric property) mode reusing the
    event picker + property picker,
  - bins control (10/20/50), the global date range + global filters,
  - the `HistogramChart` + summary.
- `useHistogram(projectId, query)` query hook (POST /query/histogram).

## 4. States & edge cases
- Non-numeric property (mostly nulls) → few/empty buckets; show "No numeric data for this property".
- All values identical → a single bucket; render it, don't divide-by-zero on bin width.
- Huge outliers stretching the axis → ClickHouse adaptive `histogram()` handles this reasonably; note
  p90/p50 so the summary isn't dominated by the tail.
- Bins out of range → clamped/validated (2..50).
- Filters + date range + (global filters) applied.

## 5. Testing
- Backend: histogram compiler/service — SQL uses `histogram({bins})(...)` over the bound event/property
  in range; property resolved via `resolveProperty` (injection case); empty result path; quantiles present.
- Frontend: `HistogramChart` renders bars + summary + table from a fixture; the Distributions page runs
  a preset (asserts the POST body: event/property/bins) and renders the histogram; empty state.

## 6. Tasks
- T1 (backend): `histogram.schema.ts` + compiler/service + controller route + docs §19 + tests.
- T2 (frontend): types + `useHistogram` hook + `HistogramChart` + Distributions page + route/nav + msw + tests.

## 7. Later
- Time-to-convert distribution (per-user first-A→first-B latency — needs a windowed query).
- Overlay a segment/compare distribution; log-scale x for heavy tails; cumulative (CDF) toggle.
