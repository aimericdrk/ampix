import type { InsightsSeries } from '../../lib/api/types';
import { sumSeries } from './derive';

/** feat-05 §3: the three supported metric-A vs metric-B relationships. */
export type FormulaOperator = 'ratio' | 'difference' | 'sum';

export interface FormulaSeriesPoint {
  t: string;
  /** `null` marks a chart gap — ratio's divide-by-zero, never `Infinity`/`NaN`. */
  value: number | null;
}

export interface FormulaSeriesResult {
  /** One point per bucket in the union of `a`/`b`'s timestamps, sorted, zero-filled. */
  data: FormulaSeriesPoint[];
  /** The blended overall value: op applied to the RANGE-WIDE sums, not the mean of per-bucket
   * values (a ratio's correct headline is sum(a)/sum(b), never an average-of-ratios). `null` only
   * for `ratio` when the summed denominator is 0. */
  total: number | null;
}

/** `a op b`, `null` for a ratio whose denominator is 0 (never `Infinity`/`NaN`). */
function applyOperator(op: FormulaOperator, a: number, b: number, asPercent: boolean): number | null {
  switch (op) {
    case 'ratio': {
      if (b === 0) return null;
      const ratio = a / b;
      return asPercent ? ratio * 100 : ratio;
    }
    case 'difference':
      return a - b;
    case 'sum':
      return a + b;
  }
}

/**
 * Derives a single formula series from two (optional) event series — feat-05 §3. Buckets are the
 * UNION of `a`'s and `b`'s timestamps, zero-filled where one side has no point for a given bucket
 * (mirrors {@link seriesTrendRows}'s union+zero-fill). `asPercent` only affects `ratio` (×100);
 * `difference`/`sum` are unaffected. A missing series (`undefined`, e.g. no metric picked yet) is
 * treated as an all-zero series.
 */
export function computeFormulaSeries(
  a: InsightsSeries | undefined,
  b: InsightsSeries | undefined,
  op: FormulaOperator,
  asPercent = false,
): FormulaSeriesResult {
  const aPoints = new Map((a?.data ?? []).map((point) => [point.t, point.value]));
  const bPoints = new Map((b?.data ?? []).map((point) => [point.t, point.value]));
  const allTimestamps = new Set([...aPoints.keys(), ...bPoints.keys()]);

  const data: FormulaSeriesPoint[] = Array.from(allTimestamps)
    .sort((x, y) => x.localeCompare(y))
    .map((t) => ({
      t,
      value: applyOperator(op, aPoints.get(t) ?? 0, bPoints.get(t) ?? 0, asPercent),
    }));

  const sumA = a ? sumSeries([a]) : 0;
  const sumB = b ? sumSeries([b]) : 0;
  const total = applyOperator(op, sumA, sumB, asPercent);

  return { data, total };
}
