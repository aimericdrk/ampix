# Feature 07 — Anomaly Detection on Trends

Date: 2026-07-07 · Status: spec ready · Surface: dashboard (frontend, client-side stats)

## 1. What it is
Automatically flag unusual points in any time series — a traffic spike, a conversion dip — with a
marker on the chart and a plain-language callout ("2 anomalies: Jun 14 spike +180%, Jun 22 dip −60%").
Pure client-side statistics over the data already fetched; no ML service.

## 2. Why
- Trends hide the moment that matters; anomaly markers point straight at it.
- Reusable across every trend chart (Insights, Home, Revenue) from one helper.

## 3. Design
- Pure `detectAnomalies(points: {t:string; value:number}[], opts?): Anomaly[]` where
  `Anomaly = { index: number; t: string; value: number; direction: 'spike'|'dip'; score: number }`.
  Method: a **rolling** window (default 7) computing the local mean + population stdev over the trailing
  window (excluding the point), flag when `|value − mean| > k*stdev` (default k=2.5) AND stdev > 0.
  Guard: need ≥ ~4 points; ignore near-zero-variance flat series; first `window` points use the
  available prefix. Deterministic, no randomness. Also expose a robust variant note (median/MAD) but
  the mean/stdev default is fine for v1.
- `ComparisonTrend` (and the single-line charts) gain an optional `anomalies?: Anomaly[]` prop → render
  a distinct marker (a ringed dot, `--danger` for dips / `--accent` for spikes, always with a shape so
  it's not color-only) at each anomalous point, with an accessible label; a `<caption>`/legend note
  "△ anomaly".
- An **AnomalyCallout** component: "N anomalies detected" + a short list (date · direction · % vs local
  baseline), rendered under the chart. Empty (renders nothing) when none.
- Wire on: Insights trend, Home active-users trend, Revenue trend. Each computes
  `detectAnomalies(trendRows)` and passes markers + renders the callout.

## 4. States & edge cases
- < 4 points or flat/zero-variance → no anomalies (never flag noise).
- Every point flagged (degenerate) → cap the callout list (top N by score) so it stays readable.
- Percent-vs-baseline in the callout: `(value − mean)/mean`; guard mean 0 → show absolute delta.
- Reduced motion: markers are static (no pulsing).
- Accessibility: markers have `aria-label`; the callout is the screen-reader-friendly summary.

## 5. Testing
- `anomaly.test.ts`: a series with one obvious spike → flagged spike at the right index; an obvious dip →
  dip; a flat series → none; < window points → graceful; k threshold respected; near-zero variance → none.
- A chart/page test: a trend with a planted spike renders an anomaly marker + the callout lists it.

## 6. Tasks
- T1: `anomaly.ts` (`detectAnomalies`) + test; `anomalies` prop on `ComparisonTrend` (markers) +
  `AnomalyCallout.tsx`; wire Insights + Home + Revenue trends. Tests. (One commit.)

## 7. Later
- MAD/robust method toggle; seasonality-aware baseline; click an anomaly → open annotations (feature 08)
  to explain it.
