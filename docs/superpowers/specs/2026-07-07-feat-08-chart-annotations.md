# Feature 08 — Chart Annotations / Release Markers

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend, localStorage-backed)

## 1. What it is
Mark moments on the timeline — "v1.4 release", "pricing change", "campaign launch" — as dated notes
that render as vertical markers across every trend chart. The context that explains a spike, right on
the chart. Stored per project in the browser now (localStorage); promotable to shared/team storage
later.

## 2. Why
- A spike without context is a mystery. Annotations make trends narratable.
- Pairs with anomaly detection (feature 07): see an anomaly → annotate what caused it.

## 3. Design
- `useAnnotations(projectId)` over `localStorage` key `myampix:annotations:<projectId>`:
  `Annotation = { id: string; date: string /* YYYY-MM-DD */; label: string; color?: string }`, with
  `add({date,label})`, `remove(id)`, `update(id, patch)`, and the sorted list. Ids are derived from a
  counter/label+date (NOT Math.random — deterministic per session; e.g. `${date}-${slug(label)}` with a
  dedupe suffix).
- Trend charts (`ComparisonTrend`, and the single-line charts) gain optional `annotations?: Annotation[]`
  → render a **vertical `ReferenceLine`** at each annotation date that falls within the chart's x-domain,
  with a small label tag (truncated) and an accessible title; lines use a muted/dashed style so they
  don't fight the data. Absent prop → nothing (backward compatible).
- An **AnnotationsManager** control (a popover/panel, e.g. a "Notes" button near the chart): list the
  project's annotations, add one (date picker + label), edit/delete. Reuse `DateRangeFields`'s date
  input + `Input` + `Button`.
- Wire on: Insights trend + Home active-users trend (both pass `annotations` + host the manager). One
  shared set per project shows on all trend charts.

## 4. States & edge cases
- Annotation date outside the current chart range → not rendered on that chart (but still stored/listed).
- Many annotations in a small range → labels overlap; truncate + stagger or show a count marker with a
  tooltip listing them (keep v1 simple: truncate + title tooltip).
- Empty label → rejected. Duplicate date+label → allowed but deduped id.
- localStorage unavailable/corrupt → treat as empty, never crash (guarded parse).
- Per-project isolation (keyed by projectId); switching projects loads that project's notes.

## 5. Testing
- `annotations.test.ts`: add/remove/update, sorting, persistence per project, corrupt-storage → empty,
  id determinism/dedupe.
- A chart/page test: with an annotation in range, `ComparisonTrend` renders a reference line labelled
  with it; the manager adds one and it appears.

## 6. Tasks
- T1: `annotations.ts` (`useAnnotations` + store) + test; `annotations` prop + ReferenceLine rendering
  on `ComparisonTrend`; `AnnotationsManager.tsx`; wire Insights + Home. Tests. (One commit.)

## 7. Later
- Shared/team annotations via a small backend table + route (promote from localStorage).
- Annotation ranges (spans, not just points); auto-annotate from app_version changes in the data.
