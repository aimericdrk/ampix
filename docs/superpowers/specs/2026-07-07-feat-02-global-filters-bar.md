# Feature 02 — Global Filters Bar

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) + small backend extension

## 1. What it is
A persistent **filter bar** at the top of the app that applies property filters — OS, app version,
country/locale, network, any custom property — to **every** analysis at once, like an app-wide
segment. Set "OS = iOS, app_version = 1.4.0" once and Home, Insights, Funnels, Retention, Flows,
Paths, Heatmap, and the Revenue/engagement KPIs all re-scope to that slice. One place to answer "how
does everything look for *this* audience?".

## 2. Why it's worth doing well
- Today filters live per-builder; there's no way to hold one lens across the product.
- It's the fastest path to segment-style exploration without saving a cohort.
- Composes with Shareable URLs (the global filter is part of the shareable state) and Drill-down
  (clicking a chart value adds a global filter).

## 3. Design

### 3.1 State — `GlobalFiltersProvider` (mirrors `DateRangeProvider`)
- Context holding `filters: InsightsFilter[]` (reuse the existing §14 filter shape: `{property, op, value?}`),
  persisted per project in `localStorage` key `myampix:globalfilters:<projectId>`.
- `useGlobalFilters(): { filters, setFilters, addFilter, removeFilter, clearAll }`.
- Mounted in `AppLayout` inside the project scope (like `DateRangeProvider`), so it's available to
  every page and updates the URL/localStorage only on explicit user action.

### 3.2 The bar UI — `GlobalFilterBar`
- A slim bar under the page header (or in the header row) showing active filters as **removable chips**
  ("OS is iOS ✕", "app_version is 1.4.0 ✕"), an **＋ Add filter** button, and a **Clear all** when any
  are set. Reuse the existing filter editor primitives: property picker (from `meta/properties` via
  `useMetaProperties`), operator select, and the value combobox (`FilterValueInput` — already backed by
  `meta/property-values` suggestions + format example). When empty, the bar is a single subtle
  "＋ Add a filter to scope the whole workspace" affordance (doesn't take much space).
- Accessible: chips are buttons with clear labels ("Remove filter OS is iOS"); the add-filter popover
  traps focus; the whole bar has a labelled region.

### 3.3 Threading filters into queries
Global filters AND-join with each page's own filters. Provide a helper
`mergeGlobalFilters(local: InsightsFilter[]): InsightsFilter[]` (dedupe exact duplicates) that every
query builder uses. Apply to the **filter-capable** queries:
- Insights (`useInsightsQuery`/`useRunInsights`), Funnels, Retention, Flows, Screen-paths, Click-heatmap
  — all already accept `filters`. Merge global + local before sending.
- Home's insights-based charts (top events, OS/version breakdowns, the events trend via
  `useInsightsQuery`) merge the global filters too.

### 3.4 Backend extension — filters on the metric endpoints (make it coherent)
So the global filter isn't silently ignored on the headline KPIs, extend the metric endpoints to accept
an optional `filters` param (reuse the §14 filter compiler `compileFilterClauses`, bound params):
- `GET metrics/engagement` (+ its service) — add optional filters (query as JSON in a `filters` query
  param, or POST-ify; keep it a GET with a compact encoded `filters` param, validated with the §14
  filter schema).
- `GET metrics/revenue` — same.
- `GET sessions/summary` — same.
Each compiles the filters into its WHERE (AND-joined, bound). When no filters, behavior is unchanged.
Document in §19. If encoding filters on a GET is awkward, these can accept the filters as a
base64/JSON query param decoded + zod-validated server-side (never interpolated). Frontend hooks
(`useEngagement`/`useRevenue`/`useSessionsSummary`) gain an optional `filters` arg.

> Scope note: if the backend extension proves large, ship the frontend (§3.1–3.3, filter-capable
> queries) as part 1 and the metric-endpoint filters as part 2 — but the KPI cards must clearly
> indicate when they do NOT reflect the active global filter (a small "unfiltered" note) until part 2
> lands, so the UI never lies about what it's showing.

### 3.5 Interaction with existing features
- **Shareable URLs**: include the global filters in the encoded `?s=` state (or a separate `gf=` param)
  so a shared link carries the workspace filter. (Coordinate with feature 01's codec.)
- **Segment picker / cohort_id**: global filters and a segment can both be active — global filters
  AND-join on top of the cohort predicate. Show both in the bar.
- **Date range**: independent; the bar sits alongside `DateRangeControl`.

## 4. States & edge cases
- No filters → minimal affordance, zero query impact.
- A filter on a property that has no data → results empty; that's correct, not an error.
- A stale/removed custom property still in localStorage → still sent (harmless) or validated out; don't crash.
- `is_set`/`is_not_set` value-less ops supported (reuse `VALUELESS_OPS`).
- Switching projects → the bar loads that project's saved filters (keyed by projectId); never leak
  across projects.
- Clear all → one action, immediate re-query everywhere.
- Performance: changing a global filter invalidates/re-runs the visible queries; debounce chip edits.

## 5. Testing
- `global-filters.test.tsx`: provider persists per project; add/remove/clear; `mergeGlobalFilters` dedupe.
- A page test (Insights or Home): with a global filter set, the posted query body includes the merged
  filter; removing it reverts.
- Backend (part 2): engagement/revenue/sessions compile the optional filters into WHERE (bound), and
  omit when absent — unit tests + the injection regression.

## 6. Tasks
- T1 (frontend core): `GlobalFiltersProvider` + `useGlobalFilters` + `GlobalFilterBar` mounted in
  AppLayout + `mergeGlobalFilters` threaded into the filter-capable queries (Insights + Home +
  Funnels/Retention/Flows/Paths/Heatmap). Include global filters in the shareable `?s=`/`gf=` state.
  KPI cards not yet filter-aware get a small "not filtered" note.
- T2 (backend + wiring): optional `filters` on `metrics/engagement`, `metrics/revenue`,
  `sessions/summary` (compiler reuse, bound, zod-validated) + the frontend hooks pass the global
  filters; remove the "not filtered" notes. Docs §19.

## 7. Later extensions
- Save the current global filter set as a cohort/segment in one click (bridge to Segment comparison).
- Per-page "ignore global filters" toggle for the rare case.
