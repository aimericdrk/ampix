# Feature 11 — Lifecycle Chart (new vs returning)

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — uses existing engagement data

## 1. What it is
A stacked chart of active-user composition over time — **new** users (first-ever event this period) vs
**returning** users (active this period, seen before) — so you see whether growth is fresh acquisition
or retained base. Built from the engagement endpoint's `new_vs_returning` series that the frontend
already receives but doesn't visualize.

## 2. Why
- "DAU went up" doesn't say *why* — new vs returning does. It's the standard growth-composition view.
- Zero backend: `GET metrics/engagement` already returns `new_vs_returning: [{t, new, returning}]`.

## 3. Design
- A `LifecycleChart.tsx`: a **stacked area/bar** (Recharts) with two series, `new` (accent) and
  `returning` (a second palette color), x = bucket `t`, plus the accessible data table (t, new,
  returning, total) and a legend. Reuse `SeriesCharts`/palette conventions + `ChartCard`.
- A summary `KpiTile` row: total active (new+returning over range), % new vs % returning, and the
  new-user delta vs the previous period.
- Surface it on the **Retention page** (which already calls `useEngagement`) as a "User lifecycle"
  `ChartCard`, time-scoped by the global range + global filters (engagement already accepts filters
  from feature 02). Optionally also a compact version on Home.

## 4. States & edge cases
- Empty engagement (no data) → empty state in the ChartCard.
- A bucket with 0 new and 0 returning → renders as an empty stack (no crash).
- Global filters + date range flow through `useEngagement(projectId, from, to, interval, filters)`.
- Percent split guards divide-by-zero (0 active → "—").

## 5. Testing
- `LifecycleChart` test: renders both stacked series + the table from a `new_vs_returning` fixture.
- Retention page test: the User lifecycle card renders from the engagement fixture; the summary shows
  the new/returning split.

## 6. Tasks
- T1: `LifecycleChart.tsx` (+test) + a `lifecycleSummary()` pure helper (totals + % split + new delta,
  tested) + wire the Retention page's engagement data into it. (One commit.)

## 7. Later (needs backend)
- Full 4-state lifecycle (add **resurrected** = active now, previously active but not last period;
  **dormant** = active last period, not now) — requires extending the engagement compiler with per-user
  cross-bucket activity classification. Documented as a backend follow-up; this feature ships the
  new/returning composition from existing data.
