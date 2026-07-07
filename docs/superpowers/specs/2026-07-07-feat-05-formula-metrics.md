# Feature 05 — Formula / Ratio Metrics

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — builds on Insights

## 1. What it is
Define a metric as a relationship between two events: **conversion rate = checkout / app_open**,
**purchases − refunds**, **events per user**. A "Formula" mode on Insights lets you pick metric A, an
operator, and metric B; the chart plots the derived value per time bucket and a headline KPI. Answers
"what's the *rate*, not just the counts".

## 2. Why
- Raw counts don't express ratios/ conversion — the metric analysts most want.
- Zero backend: run the two events through the existing insights engine (one query, 2 event series) and
  derive the formula per bucket client-side.

## 3. Design
- A **Formula** toggle on the Insights builder. When on, the builder shows: metric **A** (event +
  aggregation total|unique_users), an **operator** (`÷ ratio`, `− difference`, `+ sum`), metric **B**
  (event + aggregation). Optional: a "as %" toggle for ratios.
- Run ONE `useInsightsQuery` with both events (A then B) → two series. A pure helper
  `computeFormulaSeries(a: InsightsSeries, b: InsightsSeries, op): { data: {t,value}[]; total }`:
  per-bucket apply the op (ratio → `a/b` with `b===0 → null` gap, not Infinity; formatted as % when
  requested; difference/sum straightforward). Overall `total` = op applied to the summed A and summed B
  (for ratio, sum(A)/sum(B), the correct blended rate — NOT the mean of per-bucket ratios).
- Render the derived series as a single line (percent axis/format for ratio), plus a `KpiTile` with the
  overall formula value and its previous-period delta (run the previous range too).
- Legend/label: "checkout ÷ app_open" (or a user-provided metric name).
- Accessible data table with the A, B, and formula columns.

## 4. States & edge cases
- Divide-by-zero per bucket → null (line gap), never Infinity/NaN into the chart.
- B total 0 for the overall → show "—" not Infinity.
- Same event for A and B (ratio = 1) is allowed (degenerate but valid).
- Formula mode is part of the shareable `?s=` state (op + the two metrics) — coordinate with feature 01
  or note as follow-up.
- Global filters + date range + segment apply to the underlying query.

## 5. Testing
- `formula.test.ts`: `computeFormulaSeries` ratio (incl. divide-by-zero → null), difference, sum,
  percent formatting, blended overall total (sum(A)/sum(B)), bucket alignment when A/B have different
  buckets (union + zero-fill).
- Insights test: enabling Formula mode with two events posts a 2-event query and renders the derived
  line + KPI.

## 6. Tasks
- T1: `formula.ts` (`computeFormulaSeries`) + test; a `FormulaControl` in the Insights builder; wire
  Insights to compute + render the derived series + KPI + delta when Formula mode is on; keep normal
  mode unchanged. (One commit.)

## 7. Later
- Multi-term formulas; save as a report; per-user averages (÷ unique users) as a one-click preset.
