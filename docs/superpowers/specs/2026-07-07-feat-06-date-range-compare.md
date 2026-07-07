# Feature 06 — Date-range Compare Mode

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend)

## 1. What it is
Compare the current date range against another range on the same chart — the previous period, the same
period last month/year, or any custom range you pick. The trend draws a solid "current" line and a
dashed "compare" line, and KPIs show the delta. Extends the previous-period overlay already in
`ComparisonTrend` into an explicit, user-chosen comparison.

## 2. Why
- "Is this up or down, and vs what?" is the core analytics question. Previous-period is one answer;
  users also want week-over-week, YoY, launch-vs-now, etc.
- Reuses `ComparisonTrend`'s `previous` overlay + the query-per-range pattern — no backend.

## 3. Design
- A **Compare** control near `DateRangeControl`: `Off` · `Previous period` · `Previous week` ·
  `Same period last month` · `Same period last year` · `Custom…`. Choosing a preset derives the
  compare `{from,to}` from the current range (`previousRange` already exists for "previous period";
  add `shiftRange(from,to, unit)` helpers for week/month/year offsets — same length window shifted
  back). `Custom…` reveals a `DateRangeFields` pair.
- When compare is active, run the primary query for BOTH ranges (two `useInsightsQuery` calls) and pass
  the compare result as `ComparisonTrend`'s `previous` (aligned by bucket index; label the legend with
  the compare range, e.g. "Jun 1–30" vs "May 1–31"). KPIs show current value + delta vs compare.
- Apply on **Insights** (primary) and the **Home** active-users trend (nice-to-have; wire if clean).
- `shiftRange` pure helpers: previous-period (adjacent equal-length window), previous-week (−7d),
  last-month (same day-of-month window one month back, clamped), last-year (−1y). Deterministic UTC
  date math (no `Date.now()`).

## 4. States & edge cases
- Off → single series, exactly as today.
- Compare range longer/shorter than current (custom) → align by index; label makes the mismatch clear;
  don't crash on unequal lengths (zip to the shorter for the overlay, full data in the table).
- Invalid custom range (from>to or blank) → don't run the compare; show a hint.
- Compare is part of the shareable `?s=` state where feasible (mode + custom range) — coordinate with
  feature 01 or note follow-up.
- Global filters + segment apply equally to both ranges.

## 5. Testing
- `range-compare.test.ts`: `shiftRange` for week/month/year + previous-period; alignment/zip helper.
- Insights test: turning on "Previous period" compare issues a second query over the previous range and
  the chart renders a `previous` overlay (legend shows both ranges); KPI shows the delta.

## 6. Tasks
- T1: `range-compare.ts` (`shiftRange` + presets) + test; a `CompareControl`; wire Insights (two-range
  run + `ComparisonTrend previous` + KPI delta); optional Home trend. (One commit.)

## 7. Later
- Multiple compare ranges; "compare to segment" (bridges to feature 04); compare on Funnels/Retention.
