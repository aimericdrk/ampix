# Feature 04 — Segment Comparison (overlay cohorts)

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — builds on cohorts + Insights

## 1. What it is
Compare segments side by side on one chart: pick "All users", "Power users", "Trialists" and the
Insights trend draws one colored line per segment. Answer "how does this metric differ across
audiences?" in a single view instead of running three separate queries. Reuses the existing
`cohort_id` query filter — each segment is the same query run with a different cohort.

## 2. Why
- The Segment picker (shipped) scopes a query to ONE cohort. Comparison shows several at once — the
  natural next step for audience analysis.
- Zero backend: the insights engine already accepts `cohort_id`; we just run it per segment and
  overlay the series.

## 3. Design (Insights first)

### 3.1 The control — `SegmentCompareControl`
- A multi-select on InsightsPage: choose up to **4** segments to compare. Options: **All users** (no
  cohort) + the project's cohorts (`useCohorts`). Default = just "All users" (i.e. normal single-series
  behavior — comparison is opt-in and adding a 2nd segment turns it on).
- Shown near the Segment picker; when ≥2 are selected the page enters "compare mode".
- Reuse the combobox/checklist patterns; each selected segment is a removable chip with its assigned
  color swatch.

### 3.2 Running & overlaying
- In compare mode, run the SAME Insights query definition once per selected segment via
  `useInsightsQuery` (each with that segment's `cohort_id`, or none for "All users"). Run them
  concurrently (independent queries; React Query dedupes/caches).
- Each segment gets a stable color (assign by segment index from `palette.ts`). Combine the per-segment
  responses into ONE multi-series dataset: each series is labelled `"<segment name> · <event/metric>"`
  (when the base query has one event, just the segment name). Feed the combined series into the
  existing multi-series chart (`InsightsChart` line/area, or `ComparisonTrend`-style overlay) with a
  legend mapping color → segment, plus the always-present accessible data table (one column per
  segment).
- A per-segment **summary row** (`KpiTile`s or a small table): each segment's total + %-delta vs "All
  users" (or vs the first segment) so you can read the gap numerically, not just visually.

### 3.3 Interaction with existing state
- Compare mode is part of the shareable `?s=` state where feasible (list of segment ids) — coordinate
  with feature 01; if it complicates, note as follow-up.
- Global filters (feature 02) AND-join into every segment's query (compare *within* the current
  workspace filter). Date range applies to all segments.
- The single-segment `SegmentPicker` and compare-mode are mutually exclusive presentations of the same
  underlying `cohort_id[]` — keep the state coherent (compare list of length 1 == the single picker).

## 4. States & edge cases
- 0–1 segments selected → normal single-series Insights (no compare chrome). 2–4 → compare mode.
- A segment that returns empty (no users match) → its line is flat/absent but still legended, labelled
  "(no data)" in the summary. Don't drop it silently.
- A stale cohort id (deleted) → removed from the selection with a toast, not a crash.
- Color stability: segment colors are assigned by the segment's position in the selection so they don't
  swap as you add/remove.
- Loading: show a per-segment loading state; the chart renders as segments resolve (don't block the
  whole chart on the slowest segment — or block with one skeleton; pick block-until-all for a coherent
  comparison and show a single "Comparing N segments…").
- Cap at 4 segments (palette clarity + query cost); disable adding beyond that with a hint.

## 5. Testing
- A pure `combineSegmentSeries(perSegment: Array<{ name; color; response }>)` helper → the merged
  multi-series + per-segment totals; unit-test it (labels, colors, empty segment handling).
- Insights page test: selecting 2 segments issues 2 insights queries (assert both `cohort_id`s posted
  via msw), the chart shows both series (legend has both segment names), and the summary shows each
  segment's total.

## 6. Tasks
- T1: `combineSegmentSeries` helper (+test); `SegmentCompareControl` (multi-select up to 4, "All users"
  + cohorts, colored chips); compare mode on InsightsPage (run per-segment, overlay in the multi-series
  chart + legend + per-segment summary). Global filters + date range flow into each segment. Tests.
  (One commit.)

## 7. Later
- Extend comparison to Funnels (overlay conversion per segment) and Retention (curve per segment).
- Save a comparison as a report; compare-in-URL via feature 01.
- "Compare by property" (auto-split by a property's top values, not just saved cohorts).
