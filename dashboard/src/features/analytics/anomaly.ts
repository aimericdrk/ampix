/**
 * Client-side anomaly detection over a time series — no ML service, just a rolling mean/stdev
 * z-score (feat-07 §3). For each point, the trailing window (excluding the point itself) supplies
 * a local mean + population stdev; a point is flagged when its absolute deviation exceeds
 * `k * stdev`. Deterministic and pure: same input always yields the same output.
 */

export interface AnomalyPoint {
  t: string;
  value: number;
}

export interface Anomaly {
  index: number;
  t: string;
  value: number;
  direction: 'spike' | 'dip';
  score: number;
  /** The trailing-window mean used to flag this point — the "local baseline" for %-vs-baseline
   * callouts (`AnomalyCallout`), computed once here so callers never need to recompute it. */
  baselineMean: number;
}

export interface DetectAnomaliesOptions {
  /** Trailing window size (excludes the point itself). @defaultValue 7 */
  window?: number;
  /** Flag when `|value - mean| > k * stdev`. @defaultValue 2.5 */
  k?: number;
}

/** Never flag noise in a too-short series — there isn't enough history to trust a baseline. */
const MIN_POINTS = 4;

const DEFAULT_WINDOW = 7;
const DEFAULT_K = 2.5;

/**
 * A trailing window whose stdev is this negligible (relative to its own mean's magnitude, floored
 * so a mean of 0 doesn't zero out the guard) is treated as flat — real-world "flat" data rarely
 * lands on an exact repeated value once it's passed through floating-point math (summed, averaged,
 * rounded), and a naive `stdev > 0` check would otherwise turn that noise into a hair-trigger z-score.
 */
const STDEV_EPSILON_RELATIVE = 1e-6;
const STDEV_EPSILON_ABSOLUTE = 1e-9;

/**
 * Flags unusually high (`spike`) or low (`dip`) points against a rolling trailing-window
 * mean/population-stdev baseline. The window is bounded by however much history is actually
 * available — the first few points simply use a shorter prefix rather than being skipped
 * outright. A flat/zero-variance trailing window (stdev === 0) never flags, so a constant series
 * never produces false positives no matter how it's nudged by floating-point noise.
 */
export function detectAnomalies(
  points: AnomalyPoint[],
  opts: DetectAnomaliesOptions = {},
): Anomaly[] {
  const window = opts.window ?? DEFAULT_WINDOW;
  const k = opts.k ?? DEFAULT_K;

  if (points.length < MIN_POINTS) return [];

  const anomalies: Anomaly[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - window);
    const trailing = points.slice(start, i).map((p) => p.value);
    if (trailing.length === 0) continue;

    const mean = trailing.reduce((sum, v) => sum + v, 0) / trailing.length;
    const variance =
      trailing.reduce((sum, v) => sum + (v - mean) ** 2, 0) / trailing.length;
    const stdev = Math.sqrt(variance);
    const stdevEpsilon = Math.max(STDEV_EPSILON_ABSOLUTE, Math.abs(mean) * STDEV_EPSILON_RELATIVE);
    if (stdev <= stdevEpsilon) continue;

    const point = points[i]!;
    const diff = point.value - mean;
    const score = Math.abs(diff) / stdev;
    if (score > k) {
      anomalies.push({
        index: i,
        t: point.t,
        value: point.value,
        direction: diff > 0 ? 'spike' : 'dip',
        score,
        baselineMean: mean,
      });
    }
  }
  return anomalies;
}
