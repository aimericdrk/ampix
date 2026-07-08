import type { EngagementNewReturningPoint } from '../../lib/api/types';

/** Totals + composition split derived from an engagement response's `new_vs_returning` series. */
export interface LifecycleSummary {
  totalActive: number;
  totalNew: number;
  totalReturning: number;
  /** Share of `totalActive` that's `new`, in [0,1]. `0` (not `NaN`) when there's no active user. */
  pctNew: number;
  /** Share of `totalActive` that's `returning`, in [0,1]. `0` when there's no active user. */
  pctReturning: number;
}

/**
 * Sums `new`/`returning` across every bucket (feat-11 §3): "total active" for the range is the
 * new+returning composition, not a distinct-user count the engagement endpoint doesn't expose here.
 * Guards the percent split against divide-by-zero (§4: an empty range reads as `0`, not `NaN`).
 */
export function lifecycleSummary(points: EngagementNewReturningPoint[]): LifecycleSummary {
  const totalNew = points.reduce((sum, p) => sum + p.new, 0);
  const totalReturning = points.reduce((sum, p) => sum + p.returning, 0);
  const totalActive = totalNew + totalReturning;

  return {
    totalActive,
    totalNew,
    totalReturning,
    pctNew: totalActive === 0 ? 0 : totalNew / totalActive,
    pctReturning: totalActive === 0 ? 0 : totalReturning / totalActive,
  };
}

/** One row per bucket, shaped for a stacked chart + its accessible table: `t`, `new`, `returning`, `total`. */
export interface LifecycleRow {
  t: string;
  new: number;
  returning: number;
  total: number;
}

/** Adds the per-bucket `total` (new+returning) alongside the two stacked series, in input order. */
export function lifecycleRows(points: EngagementNewReturningPoint[]): LifecycleRow[] {
  return points.map((p) => ({ t: p.t, new: p.new, returning: p.returning, total: p.new + p.returning }));
}
