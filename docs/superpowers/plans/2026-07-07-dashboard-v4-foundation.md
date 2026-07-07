# Dashboard v4 — Foundation (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data-dense quick wins (visible filter combobox, collapsible user sections) and the reusable UI + chart primitives that every later page composes.

**Architecture:** Foundation-first. Build small, single-purpose primitives (date-range context, KpiTile, ChartCard, SectionGrid, DataTable, CollapsibleSection, Skeleton, icons) and new chart components (ComparisonTrend, BreakdownChart, DonutChart) on top of the existing OKLCH token system + `palette.ts` + Recharts. No new dependencies, no design-token rewrite.

**Tech Stack:** React 18, TypeScript, Vite, TanStack Router/Query, Tailwind v4 (`@theme inline` tokens in `src/index.css`), Recharts, vitest + Testing Library + msw.

## Global Constraints
- No new npm dependencies; reuse `palette.ts`, existing `charts/*`, and design tokens.
- Every user value stays a bound param on any backend touch (none in this plan).
- Do NOT touch the in-tree `MyAmpMix→MyAmpix` rebrand / formatter drift; stage only each task's files (targeted hunks if a file also carries rebrand lines).
- No co-author / Co-Authored-By trailer on commits. `feat/fix(...)` messages, scoped per task.
- Verify each task: `cd dashboard && pnpm exec tsc --noEmit` clean + the task's vitest green; full `pnpm test` green before commit.
- Accessibility: charts keep an accessible table/legend; decorative visuals `aria-hidden`; tables are real `<table>`s with `scope`.
- Follow existing component conventions (see `charts/SeriesCharts.tsx`, `explore-controls.tsx`, `components/ui/*`). Match their prop-doc style and Tailwind class usage.

---

## File Structure

Created under `dashboard/src/`:
- `components/ui/Skeleton.tsx` — shimmer block.
- `components/ui/CollapsibleSection.tsx` — accessible disclosure.
- `features/analytics/date-range.tsx` — `DateRangeProvider`, `useDateRange`, `DateRangeControl`.
- `features/analytics/components/charts/KpiTile.tsx` — big number + sparkline + %-delta.
- `features/analytics/components/charts/ChartCard.tsx` — titled chart container + states.
- `components/ui/SectionGrid.tsx` — responsive density grid.
- `components/ui/DataTable.tsx` — sortable accessible table.
- `components/ui/icons.tsx` — inline-SVG icon set.
- `features/analytics/components/charts/ComparisonTrend.tsx` — trend + prev-period overlay.
- `features/analytics/components/charts/BreakdownChart.tsx` — grouped/stacked horizontal bars.
- `features/analytics/components/charts/DonutChart.tsx` — donut composition.

Modified:
- `features/analytics/components/builder-controls.tsx` — `FilterValueInput` → combobox + example.
- `features/analytics/components/UserProfilePage.tsx` — wrap sections in `CollapsibleSection`.
- `src/main.tsx` (or the app root that wraps providers) — mount `DateRangeProvider`.
- `components/layout/PageShell.tsx` — header slot for `DateRangeControl` (used later; wired here).

Each new file has a co-located `*.test.tsx` (or a test in the existing page test).

---

### Task 1: Filter value combobox + format example (Phase 0.1)

**Files:**
- Modify: `dashboard/src/features/analytics/components/builder-controls.tsx` (the `FilterValueInput` component)
- Modify/Create test: `dashboard/src/features/analytics/components/builder-controls.test.tsx`

**Interfaces:**
- Consumes: `useMetaPropertyValues(projectId, property, event?)` (returns `{ data?: { values: string[] }, isLoading }`); the `EventSelectField` combobox pattern from `explore-controls.tsx` (a searchable listbox trigger — reuse it, or its underlying combobox, rather than a raw `<datalist>`).
- Produces: unchanged public props of `FilterValueInput` (`{ id, ariaLabel, projectId?, property, event?, value, onChange }`), so `FilterRows` callers are untouched.

- [ ] **Step 1: Write failing tests.** In `builder-controls.test.tsx`, add cases: (a) with a suggestable property (`os`) whose msw handler returns `['ios','android']`, the value control opens a **visible listbox** (role `listbox`/`option`, not a hidden datalist) listing those values, and picking one calls `onChange('ios')`; (b) a free-text entry still calls `onChange` with an arbitrary typed value; (c) with a free-form property (`email`, msw returns `[]`) a format-example hint renders (e.g. text matching `/e\.g\./`) and free text still works. Reuse the existing msw `meta/property-values` handler (extend fixtures if needed).
- [ ] **Step 2: Run tests, verify they fail** (`cd dashboard && pnpm exec vitest run src/features/analytics/components/builder-controls.test.tsx`). Expected: the listbox/example assertions fail (still a datalist).
- [ ] **Step 3: Implement.** Replace the `<Input list=…>`/`<datalist>` in `FilterValueInput` with a searchable combobox built on the same primitive as `EventSelectField`/`EventPicker` (extract/reuse it; do not duplicate the listbox logic). Show fetched `values` as options; allow committing free text (Enter or a "use \"X\"" affordance) so arbitrary values remain valid. When `values` is empty and not loading, render a format-example hint from a small `PROPERTY_VALUE_EXAMPLES: Record<string,string>` map (`locale:'en_US'`, `app_version:'1.4.0'`, `os_version:'17.2'`, `timezone:'Europe/Paris'`; default `'a value'`) shown as `e.g. <example>`. Keep `is_set`/`is_not_set` handled by `FilterRows` (value hidden) unchanged.
- [ ] **Step 4: Run tests, verify pass**; then `pnpm exec tsc --noEmit` clean and full `pnpm test` green.
- [ ] **Step 5: Commit** (stage only the two files): `feat(dashboard): visible value combobox + format example in filter editor`.

---

### Task 2: Skeleton + CollapsibleSection primitives, applied to the user page (Phase 0.2)

**Files:**
- Create: `dashboard/src/components/ui/Skeleton.tsx`, `dashboard/src/components/ui/CollapsibleSection.tsx`
- Create test: `dashboard/src/components/ui/collapsible-section.test.tsx`
- Modify: `dashboard/src/features/analytics/components/UserProfilePage.tsx` (wrap Activity timeline / Screen path / Tap heatmap in `CollapsibleSection`)
- Modify test: `dashboard/src/features/analytics/components/user-profile.test.tsx`

**Interfaces:**
- Produces:
  - `Skeleton({ className? }): JSX` — a `bg-border/40 animate-pulse rounded` block.
  - `CollapsibleSection({ title, defaultOpen?, children, id? }): JSX` — renders a `<button aria-expanded aria-controls>` heading toggling a region; content hidden when closed.

- [ ] **Step 1: Write failing tests.** `collapsible-section.test.tsx`: renders `title`; content visible when `defaultOpen` (default true); clicking the toggle hides content and flips `aria-expanded` to `false`; `aria-controls` matches the region `id`. In `user-profile.test.tsx`: the "Activity timeline" content is inside a collapsible and can be collapsed (toggle by its accessible button hides the events list).
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `Skeleton` and `CollapsibleSection` (accessible disclosure: `useState(defaultOpen)`, `useId` for `aria-controls`, button with chevron icon — a plain `▸/▾` glyph is fine to avoid Task 7 dependency). Wrap the three `UserProfilePage` sections; keep their titles as the section headers.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit** (Skeleton, CollapsibleSection, their test, UserProfilePage, user-profile.test): `feat(dashboard): collapsible user-profile sections + Skeleton/CollapsibleSection primitives`.

---

### Task 3: Global date-range context + control

**Files:**
- Create: `dashboard/src/features/analytics/date-range.tsx`
- Create test: `dashboard/src/features/analytics/date-range.test.tsx`
- Modify: the app root that composes providers (find where `QueryClientProvider`/router are mounted, e.g. `src/main.tsx` or an `App` wrapper) to add `DateRangeProvider`.
- Modify: `dashboard/src/components/layout/PageShell.tsx` to accept and render a header control area (if it doesn't already via `actions`).

**Interfaces:**
- Consumes: `defaultDate(days)` and `DateRangePresets` from `explore-controls.tsx`/`builder-controls.tsx`.
- Produces:
  - `DateRangeProvider({ projectId, children })` — persists `{from,to,preset}` in `localStorage` keyed by project; default preset `30`.
  - `useDateRange(): { from: string; to: string; preset: string; setRange(from,to,preset): void }`.
  - `DateRangeControl({ className? })` — the segmented 7/30/90/Custom control bound to the context (reuse `DateRangePresets`).

- [ ] **Step 1: Write failing tests.** `date-range.test.tsx`: a test component under `DateRangeProvider` reads `useDateRange()` and shows `from/to`; default preset is Last 30 days (`from === defaultDate(30)`, `to === defaultDate(0)`); rendering `DateRangeControl` and choosing "Last 7 days" updates the context to `defaultDate(7)`; the value persists to `localStorage`.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the context/provider (with `localStorage` read on init, write on change, key `myampix:daterange:<projectId>`), the hook, and `DateRangeControl` (wrap `DateRangePresets`, mapping its `onChange(from,to)` to `setRange` with the matched preset id via `presetIdForRange`). Mount `DateRangeProvider` at the app root inside the router/project scope. Do NOT yet migrate pages off local state (that is Phase 2) — just make it available and render `DateRangeControl` in the `PageShell` header slot.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): global date-range context + control`.

---

### Task 4: KpiTile (sparkline + %-delta)

**Files:**
- Create: `dashboard/src/features/analytics/components/charts/KpiTile.tsx`
- Create test: `dashboard/src/features/analytics/components/charts/kpi-tile.test.tsx`

**Interfaces:**
- Consumes: `formatExactNumber`/`formatDurationMs` from `../format` for value formatting (caller passes a preformatted `value` string OR a number; support `value: string | number`). The existing `StatTile` `spark` sparkline approach (reuse its sparkline rendering if it has one; else a tiny inline SVG polyline).
- Produces: `KpiTile({ label, value, unit?, hint?, spark?, delta?, loading? })` where `delta?: { pct: number }` (positive = up). Renders label, big `tabular-nums` value, optional sparkline, and a delta chip: up = accent/green with `▲`, down = danger with `▼`, colour-blind-safe via the glyph. `loading` shows a `Skeleton`.

- [ ] **Step 1: Write failing tests.** Renders label + value; a positive `delta.pct` shows `▲` and the `+X%`; a negative shows `▼` and `-X%`; `loading` renders a skeleton (query `Skeleton` by test id or role); `spark` of numbers renders an SVG (`role="img"` or an `<svg>`).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `KpiTile` (compose `Card`/`CardContent` or a bare tile matching `StatTile`'s look; reuse `StatTile`'s sparkline if present). Delta chip colours from tokens (`text-accent`/`text-danger`), always paired with the arrow glyph.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): KpiTile with sparkline and period delta`.

---

### Task 5: ChartCard + SectionGrid

**Files:**
- Create: `dashboard/src/features/analytics/components/charts/ChartCard.tsx`, `dashboard/src/components/ui/SectionGrid.tsx`
- Create test: `dashboard/src/features/analytics/components/charts/chart-card.test.tsx`

**Interfaces:**
- Consumes: `Skeleton` (Task 2), `Card`/`CardHeader`/`CardTitle`/`CardContent` from `components/ui/card`.
- Produces:
  - `ChartCard({ title, description?, action?, state?: 'loading'|'empty'|'error'|'ready', emptyText?, errorText?, children }): JSX` — titled card; `state` drives Skeleton/empty/error placeholders; `action` renders top-right (e.g. a breakdown selector).
  - `SectionGrid({ min?: number (px, default 240), children, className? }): JSX` — `grid` with `repeat(auto-fill, minmax(min, 1fr))` and a gap.

- [ ] **Step 1: Write failing tests.** `ChartCard` renders title + children when `state='ready'`; `state='loading'` shows a Skeleton and not children; `state='empty'` shows `emptyText`; `action` renders. `SectionGrid` renders its children (smoke).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** both.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): ChartCard + SectionGrid layout primitives`.

---

### Task 6: DataTable (sortable, accessible)

**Files:**
- Create: `dashboard/src/components/ui/DataTable.tsx`
- Create test: `dashboard/src/components/ui/data-table.test.tsx`

**Interfaces:**
- Produces: `DataTable<T>({ columns, rows, caption, initialSort?, onRowClick?, rowKey }): JSX` where
  `columns: Array<{ key: string; header: string; align?: 'left'|'right'; sortable?: boolean; render?: (row:T)=>ReactNode; sortValue?: (row:T)=>string|number }>`,
  `rowKey: (row:T)=>string`. Real `<table>` with `<caption class="sr-only">`, `scope="col"` headers, `tabular-nums` for right-aligned columns; clicking a sortable header toggles asc/desc (aria-sort); `onRowClick` makes rows keyboard-activatable (`role`/`tabIndex`/Enter).

- [ ] **Step 1: Write failing tests.** Renders headers + rows; clicking a sortable header reorders rows and sets `aria-sort`; `onRowClick` fires on click and on Enter; `render` custom cell shows; empty `rows` shows a `caption`/empty row.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** with a local sort state (`useState<{key,dir}>`), stable comparator using `sortValue ?? row[key]`.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): sortable accessible DataTable`.

---

### Task 7: Icon set

**Files:**
- Create: `dashboard/src/components/ui/icons.tsx`
- Create test: `dashboard/src/components/ui/icons.test.tsx`

**Interfaces:**
- Produces: named inline-SVG icon components (`IconChevron`, `IconTrendUp`, `IconTrendDown`, `IconUsers`, `IconChart`, `IconClock`, `IconSettings`, `IconSearch`, `IconExpand`) each `({ className?, size? })`, `aria-hidden` by default, matching the existing stroke style (`stroke="currentColor"`, `strokeWidth≈1.75`, `viewBox="0 0 24 24"`).

- [ ] **Step 1: Write failing test.** Each icon renders an `<svg>` with `aria-hidden` and respects `className`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the icon set (simple, legible paths).
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): inline SVG icon set`.

---

### Task 8: ComparisonTrend chart

**Files:**
- Create: `dashboard/src/features/analytics/components/charts/ComparisonTrend.tsx`
- Create test: `dashboard/src/features/analytics/components/charts/comparison-trend.test.tsx`

**Interfaces:**
- Consumes: Recharts (as used in `charts/SeriesCharts.tsx`), `palette.ts` (`colorForIndex`), the `SeriesChartProps` conventions (rows/keys/labels/colorFor/ariaLabel/height).
- Produces: `ComparisonTrend({ current, previous?, xKey, valueKey, label, ariaLabel, height? }): JSX` — a line/area chart of `current` with an optional dashed muted `previous` overlay aligned by index; legend ("Current" / "Previous"); an accessible data table underneath (mirror how `SeriesCharts`/`InsightsChart` ship a table). `current`/`previous` are `Array<{ [xKey]: string; [valueKey]: number }>`.

- [ ] **Step 1: Write failing tests.** Renders an SVG chart (`role="img"` w/ `ariaLabel`); with `previous` provided, renders two series (assert a legend entry "Previous" and the accessible table has both columns); without `previous`, only current.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** using Recharts `LineChart`/`AreaChart` + `ResponsiveContainer` (match `SeriesCharts` height/tooltip/axis styling and the accessible-table pattern). Previous series: dashed, `--series-other`/muted.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): ComparisonTrend chart with previous-period overlay`.

---

### Task 9: BreakdownChart

**Files:**
- Create: `dashboard/src/features/analytics/components/charts/BreakdownChart.tsx`
- Create test: `dashboard/src/features/analytics/components/charts/breakdown-chart.test.tsx`

**Interfaces:**
- Consumes: Recharts BarChart, `palette.ts` (`colorForIndex`/`assignSeriesColors`).
- Produces: `BreakdownChart({ data, ariaLabel, stacked?, height? }): JSX` where `data: Array<{ label: string; value: number }>` (single-series horizontal bars, value labels, sorted desc, top-N handled by caller) OR a stacked variant `data: Array<{ label: string; segments: Array<{ key: string; value: number }> }>` when `stacked`. Includes the accessible table.

- [ ] **Step 1: Write failing tests.** Renders bars for each `label` (assert labels present + an SVG `role=img`); values appear in the accessible table; `stacked` renders multiple segment keys in the legend.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** horizontal `BarChart` (layout="vertical") + optional stacking, palette colours by index, accessible table.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): BreakdownChart (grouped/stacked bars)`.

---

### Task 10: DonutChart

**Files:**
- Create: `dashboard/src/features/analytics/components/charts/DonutChart.tsx`
- Create test: `dashboard/src/features/analytics/components/charts/donut-chart.test.tsx`

**Interfaces:**
- Consumes: `CompositionPieChart`'s slice/colour conventions + `palette.ts`.
- Produces: `DonutChart({ slices, colorFor, ariaLabel, centerLabel?, centerValue?, height? }): JSX` — a donut (Recharts `Pie` with `innerRadius`) with an optional center total; slices `Array<{ key; label; value }>`; accessible table (reuse `CompositionPieChart`'s table if extractable).

- [ ] **Step 1: Write failing tests.** Renders slices (SVG `role=img` w/ ariaLabel); center total shows when provided; the accessible table lists each slice's label+value.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (thin variant of `CompositionPieChart` with `innerRadius` + center text). Reuse its table.
- [ ] **Step 4: Run tests + tsc + full suite.**
- [ ] **Step 5: Commit:** `feat(dashboard): DonutChart composition variant`.

---

## Self-Review (against the spec)

**Spec coverage (Phase 0 + 1):**
- 0.1 filter combobox + example → Task 1. ✓
- 0.2 collapsible timeline → Task 2. ✓
- 1.1 global date range → Task 3. ✓
- 1.2 primitives: KpiTile (4), ChartCard/SectionGrid (5), DataTable (6), CollapsibleSection/Skeleton (2), icons (7). ✓
- 1.3 charts: ComparisonTrend (8), BreakdownChart (9), DonutChart (10); TreemapBreakdown was optional → deferred to Phase 2 if needed. ✓
- 1.4 shell polish: PageShell header slot + DateRangeControl in Task 3; broader page density lands in Phase 2 when pages compose the primitives. ✓ (intentionally deferred so Phase 1 stays "build primitives", Phase 2 "apply them").

**Placeholder scan:** none — every task has concrete files, interfaces, tests, and commit.
**Type consistency:** primitive prop names are referenced identically across tasks (`KpiTile.delta.pct`, `DataTable.columns[].sortValue`, `ComparisonTrend.previous`). Charts follow `SeriesChartProps` conventions.
**Deferred to later plans:** migrating existing pages onto `useDateRange` and the KPI/breakdown compositions (Phase 2), Home revamp (Phase 3), users search/path (Phase 4) — each its own plan.
