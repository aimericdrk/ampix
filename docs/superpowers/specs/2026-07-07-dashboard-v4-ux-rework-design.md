# Dashboard v4 — Data-Dense UX Rework & Analytics Depth (Design)

Date: 2026-07-07
Status: Approved shape (phases 0–4 detailed; phase 5 is a prioritized menu)
Owner: aimeric

## 1. Context & problem

The MyAmpix dashboard (React + Vite, `@myampmix/dashboard`) has a solid foundation that is
under-used: an OKLCH design-token system, an 8-colour dataviz palette + retention ramp, light/dark
themes, and a decent chart library (line/area/stacked-bar/pie, funnel, retention heatmap, Sankey
flows, path map, click heatmap, Mermaid). Yet pages read as plain stacked cards with little visual
hierarchy, very few charts per view, invisible affordances (filter values use an HTML `<datalist>`),
and no global time control. Users experience it as "no style, hard to use, missing graphs."

This rework makes the app **data-dense** (PostHog/Amplitude-style) by building a small set of shared
UI primitives once and composing every page from them, then adding the graphs and features the
product is missing — including user search by name/alias and a forward-looking plan for
scale-appropriate features (100k MAU / 20k DAU).

### Backend surface already available (wire-ups, not new work)
- `GET api/v1/projects/:projectId/metrics/engagement?from&to&interval` — **DAU/WAU/MAU + stickiness**
  (`v2-analytics.controller.ts`). Implemented, tested; the frontend has **no hook/type** for it yet.
- `POST query/insights` — supports `breakdown` (top-20 values) and `unique_users` aggregation, so
  most breakdown/trend charts need **no backend**.
- `POST query/funnels|retention|flows`, `POST query/screen-paths`, `POST query/click-heatmap`,
  `GET events/summary`, `GET sessions/summary`, `GET meta/property-values` (shipped in v3).

## 2. Goals / non-goals

**Goals**
- A data-dense visual system applied consistently across all pages via reusable primitives.
- Global date-range control feeding every time-scoped view.
- Many more, and more interesting, graphs — reusing the existing palette + Recharts; new chart
  *types* only where genuinely missing.
- Filter values: a visible dropdown of suggested values + a format example for free-form fields.
- User search by name/profile/aliases with a disambiguation **results table**; per-user path map;
  collapsible activity timeline.
- A revamped, interesting Home overview.
- A prioritized written menu of scale-appropriate features (Phase 5) for later phases.

**Non-goals (this program)**
- No new chart library; no design-token rewrite (extend, don't replace).
- No implementation of Phase 5 features — Phase 5 is planning only.
- No change to ingestion/SDK.
- Not touching the unrelated in-flight `MyAmpMix→MyAmpix` rebrand / formatter drift in the working
  tree.

## 3. Cross-cutting decisions
1. **Foundation-first.** Build the shell + primitives once; re-skin pages by composing them. Avoids
   the duplicated chart code that causes today's inconsistency.
2. **Reuse palette + Recharts.** `palette.ts` (`colorForIndex`, `assignSeriesColors`,
   `SERIES_COLOR_VARS`, retention ramp) and existing chart components stay the source of truth. New
   components (`BreakdownChart`, `ComparisonTrend`, `DonutChart`, `KpiTile`, `DataTable`) build on
   the same primitives. Follow the `dataviz` skill for any new viz.
3. **Global date range** app-wide via a context/provider; the all-time `events/summary` endpoint
   still backs explicit "all-time" tiles. Default **Last 30 days**; presets 7/30/90/custom (reuse
   `DateRangePresets` from `explore-controls.tsx`).
4. **Backend changes minimal & additive**, mirroring existing patterns: user-search extension and a
   `distinct_ids` filter on screen-paths (identical to the heatmap `distinct_ids` shipped in v3 T3).
   Every user-supplied value stays a bound ClickHouse `query_param`.
5. **Accessibility kept**: every chart keeps its accessible table/legend; new tables are real
   `<table>`s; decorative visuals are `aria-hidden`.
6. **Testing**: vitest for every new component + page (msw-backed); jest for backend additions;
   `tsc --noEmit` clean; no regressions.

---

## Phase 0 — Quick wins

### 0.1 Filter values: visible combobox + format example
`builder-controls.tsx` `FilterValueInput` currently renders an `<Input list=…>` (an HTML
`<datalist>`), which only surfaces suggestions on typing — users don't perceive a dropdown.

**Change:** render a visible combobox (reuse the `EventPicker`/`EventSelectField` pattern from
`explore-controls.tsx`) that shows the suggested values from `useMetaPropertyValues` up front, with a
type-to-filter search and a "type a custom value" escape hatch (free text is always allowed —
contracts §14 filters accept arbitrary values).
- When the property resolves to suggestions (e.g. `os`, `app_version`, `network`): show them in the
  dropdown; picking one sets the value.
- When suggestions are empty (high-cardinality / free-form, e.g. `email`): show a **format example**
  derived from the property name (a small map: `locale → "e.g. en_US"`, `app_version → "e.g. 1.4.0"`,
  default `"e.g. a value"`), plus the free-text input. Replaces today's bare "Type any value" hint.
- Keep the numeric/`is_set`/`is_not_set` behaviours unchanged.

### 0.2 Collapsible activity timeline (user page)
`UserProfilePage.tsx` "Activity timeline" becomes a collapsible section (a reusable
`CollapsibleSection` primitive — see Phase 1) defaulting **open**, with an accessible
disclosure button (`aria-expanded`, `aria-controls`). Same for Screen path / Tap heatmap sections so
the page is scannable.

---

## Phase 1 — Foundation (the multiplier)

New/edited files under `dashboard/src/features/analytics/` and `dashboard/src/components/`.

### 1.1 Global date-range context
- `DateRangeProvider` + `useDateRange()` (context) holding `{ from, to, preset, setRange }`, defaulting
  to Last 30 days, persisted per project in `localStorage`.
- A `DateRangeControl` (segmented 7/30/90/Custom, reusing `DateRangePresets`) rendered in the page
  header area (via `PageShell` `actions` or a new header slot).
- Pages read `useDateRange()` instead of local `from/to` state (Insights/Funnels/Flows/Retention/
  Heatmap/Paths keep their own advanced controls but seed from the global range).

### 1.2 UI primitives (each: one purpose, typed props, own vitest)
- `KpiTile` — big number + label + optional unit; `spark?: number[]`; `delta?: { pct: number; direction }`
  (green up / red down, colour-blind-safe with an arrow glyph); loading skeleton state. Powers KPI rows.
- `ChartCard` — titled card wrapper with an optional right-aligned action slot, a description, and a
  consistent chart body height; standard loading/empty/error states.
- `SectionGrid` — responsive grid (`repeat(auto-fill, minmax(…))`) with density variants, so KPI rows
  and chart grids lay out consistently.
- `DataTable` — sortable, keyboard-accessible `<table>` with column defs, right-aligned numerics
  (`tabular-nums`), empty state, and optional row-click navigation. Replaces the ad-hoc tables.
- `CollapsibleSection` — accessible disclosure (used by Phase 0.2 and elsewhere).
- `Skeleton` — shimmer block used by the above loading states.
- Iconography: a tiny inline-SVG icon set (no dep) for nav/actions/deltas, matching the existing
  stroke-icon style already in `ScreenImage`/buttons.

### 1.3 Chart components (new types; reuse palette + Recharts)
- `ComparisonTrend` — line/area trend with an optional **previous-period overlay** (dashed, muted),
  legend, accessible table. Built on the `SeriesCharts` primitives + palette.
- `BreakdownChart` — grouped/stacked horizontal bar for "metric by dimension" (OS/device/version/
  network/UTM), top-N + `$other`, value labels, accessible table.
- `DonutChart` — a compact donut variant of `CompositionPieChart` for share-of-total tiles.
- (Optional, if time) `TreemapBreakdown` — for many-category composition; only if it reads cleanly.

### 1.4 Data-density shell polish
- Denser `PageShell` header: title + description inline with the `DateRangeControl` and page actions;
  consistent vertical rhythm; section spacing tightened.
- Standard **loading skeletons** and **empty states** across pages (replace bare "Loading…" text).

---

## Phase 2 — Graphs everywhere

Compose Phase 1 primitives across existing pages (mostly frontend; breakdowns via the insights
engine). Each page gains, where meaningful:
- A **KPI row** (`KpiTile`s with sparkline + %-delta vs previous period; deltas computed from two
  insights/summary calls over current vs previous range).
- **ComparisonTrend** as the primary time chart (previous-period overlay).
- **BreakdownChart(s)** by OS / device_model / app_version / network / utm_source (driven by
  `POST query/insights` with `breakdown`), each in a `ChartCard`.
- Richer `DataTable`s (top events, top screens, breakdown tables) with sort.

Page-by-page highlights:
- **Insights**: KPI row + comparison trend + a breakdown chip that swaps the breakdown dimension.
- **Funnels / Retention / Flows**: KPI summary tiles + keep their specialised charts, wrapped in
  `ChartCard`, plus a breakdown table.
- **Sessions** (if a page exists / else surface on Home): sessions & avg-duration trends w/ comparison.

## Phase 3 — Home revamp (data-dense overview)

Rebuild `HomePage.tsx` as the flagship data-dense page, all time-scoped by the global range:
- **KPI row**: Total events, **DAU / WAU / MAU** (via the new engagement hook), Sessions, Avg session,
  **Stickiness (DAU/MAU)** — each with sparkline + %-delta.
- **Main trend**: `ComparisonTrend` of active users (or events) with previous-period overlay.
- **Top events** table + **Events-by-type** donut.
- **Breakdown row**: by OS and by app_version (`BreakdownChart`).
- **Acquisition**: top `utm_source`/`utm_campaign` (`BreakdownChart`/table).
- **Recent work**: reports & dashboards (kept, restyled), plus the `ChartThumbnail`s shipped in v3.
- Preserve the empty/no-events onboarding state.

New frontend wiring only: `useEngagement(projectId, from, to, interval)` hook + `EngagementResponse`
type (mirroring the existing `metrics/engagement` contract). No backend.

## Phase 4 — Users: search-by-name, disambiguation, per-user path & timeline

### 4.1 Backend — user search across profile props + aliases
`AnalyticsService.listUsers` today matches `startsWith(canonical_uid, search)` only and returns
`{ distinct_id, last_seen, event_count }`.

**Change (additive):**
- Extend the search to also match **profile properties** and **aliases**: a user matches when the
  search term is a case-insensitive substring of the canonical id, any aliased anon_id, or a
  well-known profile string property (`name`, `email`, `username`, `$name`, `$email` — a small,
  bound whitelist; extracted via `JSONExtractString(toJSONString(properties), {key:String})` from
  `user_profiles`, joined by canonical id). Every term bound as `{search:String}`; never interpolated.
- Return richer rows for disambiguation: add `name?`, `email?` (best-effort from the profile) to each
  user row (extend `UserRow`/`UsersResponse` + the frontend `ListUsersResponse` type). Keep cursor
  pagination on the canonical id.
- Document in shared-contracts §14 (users explorer). Backend jest + build green.

### 4.2 Backend — per-user screen paths
Add an optional `distinct_ids?: string[]` to the screen-paths schema + compiler (identical pattern to
the click-heatmap `distinct_ids` shipped in v3 T3): when present, restrict to
`distinct_id IN {distinctIds:Array(String)}` (bound array). The user page passes the profile's
`distinct_ids` (already returned by `getUserProfile` since v3) → an identity-correct per-user path map.
Document in §19. Backend tests + injection regression.

### 4.3 Frontend — users explorer & profile
- **Users list / search**: a `DataTable` disambiguation view — columns Name, id/email, aliases, last
  seen, events — sortable, row-click → profile. Search box drives the extended backend search.
- **User profile**: add a **per-user path map** section (reuse `PathMap` + the new screen-paths
  `distinct_ids`), alongside the existing timeline (now collapsible, Phase 0.2), screen-path
  mini-diagram, and identity-correct tap heatmap (v3). Optionally a per-user KPI row (events, first/
  last seen, sessions).
- Tests: msw-backed search returning multiple matches → table renders; row-click navigates; per-user
  path posts `distinct_ids`.

## Phase 5 — Scale-features plan (100k MAU / 20k DAU) — PLANNING ONLY

A prioritized menu; each becomes its own spec→plan→build cycle if selected. Recommended tiers:

**Tier 1 — highest leverage at scale**
- **Metric alerts + anomaly detection**: thresholds/auto-baselines on saved metrics (DAU, conversion,
  crash rate) → in-app + email/webhook. Needs a scheduler + alert store.
- **Saved segments** as first-class filters reusable across Insights/Funnels/Retention (extends the
  existing cohort-as-filter machinery).
- **Scheduled report emails / digests** (daily/weekly KPI snapshot).

**Tier 2 — depth & performance**
- **Real-time "live" view** (rolling last-N-minutes active users + event stream; builds on the live
  feed).
- **Crash / ANR / slow-screen performance** analytics (needs SDK error/perf autocapture — larger).
- **Revenue / LTV** analytics off `$in_app_purchase` (revenue trends, ARPU, LTV curves, cohorts).

**Tier 3 — scale hygiene & collaboration**
- **Data export / query API** (CSV + programmatic).
- **Sampling / retention controls** and query-cost guards for high-volume projects.
- **Dashboard sharing / public links**, annotations, and RBAC/audit refinements.

The spec will present this menu; the user selects which graduate into implementation phases.

## 4. Sequencing & independence
Phases are independently shippable and reviewed. Recommended order: **0 → 1 → 2 → 3 → 4**, then pick
Phase 5 items. Phase 1 is a hard prerequisite for 2 and 3. Phase 4 is independent of 1–3 (can run in
parallel) but its frontend benefits from the Phase 1 `DataTable`.

## 5. Testing & rollout
- Per phase: new component/page vitest (msw), backend jest for 4.1/4.2, `tsc --noEmit` clean, full
  suites green, commit per logical unit with `feat/fix(...)` messages (no co-author trailer).
- Keep per-commit scoping clean of the in-tree rebrand (targeted staging, as in v3).
- Each phase verified by driving the real flow where practical.

## 6. Open questions (resolve at spec review)
- Phase 5 selection (which tiers to schedule).
- Whether Sessions deserves its own page or stays a Home/Insights surface.
- Exact profile keys to include in user-search (default whitelist proposed in 4.1).
