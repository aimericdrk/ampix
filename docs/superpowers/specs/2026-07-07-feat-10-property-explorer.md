# Feature 10 — Property Value Explorer

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — reuses insights breakdown

## 1. What it is
Pick any property (OS, plan, country, a custom property) and instantly see: its top values with counts
and share, how each value trends over time, and a full value table. The "what values does this
property take, and how are they moving?" view — without building an Insights query by hand.

## 2. Why
- Metadata (`meta/property-values`) tells you the values exist; this shows their *magnitude and trend*.
- Pure composition of the existing insights breakdown engine + the v4 chart primitives — no backend.

## 3. Design — a Property Explorer page
Route `/projects/$projectId/properties` + nav link (mirror the Revenue/Distributions wiring).
Controls: a **property picker** (from `useMetaProperties`), an **event scope** (All events, or a
specific event via the event picker — optional; default all), a top-N control (5/10/20), the global
date range + global filters.

Runs `useInsightsQuery` with `breakdown: { property }` (aggregation `total`, and optionally a second run
with `unique_users`) over the scope → per-value series. From that:
- **Top values `BreakdownChart`** (value → count), sorted desc, top-N + rest folded to "Other". Each bar
  drills into a global filter (reuse feature 03 `onSelectValue` → `{property, op:'eq', value}`).
- **Share `DonutChart`** of the top values (center = total).
- **Trend `InsightsChart`/multi-line** of the top-N values over time (the breakdown series), with a
  legend; anomaly markers (feature 07) optional.
- **Value table** (`DataTable`): value, count, unique users (if run), share %, sortable, CSV-exportable
  (feature D `exportFilename`).
- A summary `KpiTile` row: distinct values (count from `meta/property-values` or the breakdown series
  count), total events, top value + its share.

`useMetaPropertyValues` can seed the distinct-value count / value list for the picker context.

## 4. States & edge cases
- High-cardinality property (hundreds of values) → the breakdown engine caps at top-20; show "showing
  top N of many" and rely on the folded "Other". Don't try to render hundreds of bars.
- Property with no data in range → empty state ("No values for <property> in this range").
- Column vs custom property both work (the breakdown engine + `resolveProperty` already handle both).
- Global filters + date range applied; drilling a value adds to global filters (which then also scopes
  this very page — that's fine/expected).

## 5. Testing
- `property-explorer.test.tsx`: picking a property issues an insights breakdown query for it (assert the
  `breakdown.property` in the posted body), renders the top-values bars + donut + trend + table; empty
  state; drilling a bar adds the global filter.
- Reuse existing insights msw handler (returns breakdown-shaped series when `breakdown` present).

## 6. Tasks
- T1: `PropertyExplorerPage.tsx` (+test) composing the pickers + insights breakdown run + the four
  visualizations + summary; route + nav (+ NavIcon). (One commit.)

## 7. Later
- Value co-occurrence / correlation; "compare two properties"; save an explored property as a report.
