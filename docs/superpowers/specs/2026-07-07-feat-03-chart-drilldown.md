# Feature 03 — Chart Drill-down / Cross-filter

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend) — builds on Feature 02

## 1. What it is
Click a value on a chart to scope the whole workspace to it. Click the **iOS** bar in the "by OS"
breakdown → the Global Filter bar gains `os is iOS` and every chart on every page re-scopes. Click it
again → the filter clears (toggle). Turns static charts into an exploration surface: see an outlier,
click it, everything drills in.

## 2. Why
- The Global Filters bar (Feature 02) is powerful but requires manually picking property + value.
  Drill-down makes the charts themselves the fastest way to set that filter — point at what's
  interesting instead of typing it.
- Reuses the entire Feature-02 pipeline (`useGlobalFilters().addFilter/removeFilter`,
  `mergeGlobalFilters`, the metric-endpoint filters) — a chart click is just a filter mutation.

## 3. Design

### 3.1 Make categorical charts selectable
Add an optional `onSelectValue?(label: string)` to the charts whose marks map cleanly to a property
value:
- `BreakdownChart` (single-series: each bar → its `label`; stacked: each segment → its segment key or
  bar label — pick the bar label for the row, or make only single-series selectable for v1).
- `DonutChart` (each slice → its `label`).
When `onSelectValue` is provided:
- marks get `cursor-pointer`, a hover emphasis, and an `onClick`;
- the accessible data-table rows for that chart ALSO become activatable (a `<button>` in the label
  cell, or the row is a button) so keyboard + screen-reader users can drill too — not mouse-only;
- nothing changes when `onSelectValue` is absent (fully backward-compatible).

### 3.2 Consumers wire click → global filter
A chart that renders a breakdown of a known **property** passes:
```
onSelectValue={(value) => toggleGlobalFilter({ property: <dimension>, op: 'eq', value })}
```
where `<dimension>` is the property that chart breaks down by (`os`, `app_version`, `network`, …).
Add a `toggleGlobalFilter(filter)` to `useGlobalFilters()` (add if not present, remove if an identical
`{property,op,value}` is already active) so a second click clears it. The Global Filter bar chip is the
visible feedback.

Wire it on:
- **Home** — the "by OS" and "by app version" `BreakdownChart`s (dimension known: `os`, `app_version`),
  and optionally the Events-by-type donut → NOT a property filter (an event isn't a global property
  filter), so leave the donut non-drilling in v1 unless a clean "filter to event" semantic is added
  later. Keep v1 to the property breakdowns.
- **Insights** — when a breakdown is active, the breakdown chart's values drill into
  `{property: breakdownProperty, op:'eq', value}`.
- Any future property-breakdown chart inherits it for free.

### 3.3 Visual + interaction detail (make it great)
- Hover: the hovered bar/slice lifts (opacity/stroke) and a tooltip hints "Click to filter by <value>".
- Active state: if a value is currently the active global filter, its mark shows a selected treatment
  (ring/checkmark) and the tooltip reads "Click to clear".
- The cursor is `pointer` only when selectable.
- Respect reduced-motion (no fancy transitions if the user prefers reduced motion).

## 4. States & edge cases
- Clicking `$other`/aggregated buckets (top-N rollup) → either no-op (can't filter to "other") with a
  subtle "can't drill into Other" affordance, or omit the click on synthetic buckets. Choose no-op +
  not-selectable styling for synthetic labels.
- Toggling: exact `{property,op:'eq',value}` match removes; otherwise adds. Two different values of the
  same property are two chips (OR-ish is not supported — global filters AND-join, so filtering os=ios
  then clicking os=android yields an impossible AND → empty; detect same-property `eq` and REPLACE
  rather than add a contradictory second one). Implement `toggleGlobalFilter` to: if same
  {property,op,value} exists → remove; else if a same-`property`+`eq` filter exists → replace its value;
  else → add. This makes clicking across a breakdown feel like "select one".
- No global-filter provider in scope (shouldn't happen on analytics pages) → charts simply don't drill.
- Accessibility: keyboard activation on the table rows; `aria-pressed` reflects active selection.

## 5. Testing
- `BreakdownChart`/`DonutChart` tests: with `onSelectValue`, clicking a bar/slice (or its table row)
  calls it with the label; synthetic `$other` is not selectable; without the prop, no click handler.
- `useGlobalFilters` test: `toggleGlobalFilter` add/remove/replace-same-property semantics.
- Home test: clicking an OS breakdown value adds the `os is <v>` global filter (assert the bar/bar-row
  click → the filter chip appears / the next query carries it); clicking again clears it.

## 6. Tasks
- T1: `onSelectValue` on `BreakdownChart` + `DonutChart` (marks + table rows, a11y, synthetic-bucket
  handling) + `toggleGlobalFilter` in `useGlobalFilters` + wire Home's OS/app_version breakdowns +
  Insights breakdown. Tests. (One commit.)

## 7. Later
- Drill from a trend point (click a date → set the range to that bucket).
- Multi-select drill (shift-click to build an IN filter) once the filter model supports `in`.
- "Filter to this event" from the events donut (needs an event-scoped global filter concept).
