/**
 * Time-series helpers for the metrics charts (pure, unit-tested): server-side bucketing so a
 * 7-day range returns ~180 points per key instead of 2000, and nice axis ticks.
 */

export interface Point {
  t: number; // unix ms (bucket midpoint)
  v: number;
}

export const DEFAULT_BUCKETS = 180;

/** Averages raw rows into fixed time buckets over [now-hours, now]. Empty buckets are skipped. */
export function bucketSeries(
  rows: Array<{ at: Date; value: number }>,
  hours: number,
  nowMs: number,
  buckets = DEFAULT_BUCKETS,
): Point[] {
  const spanMs = hours * 3600_000;
  const start = nowMs - spanMs;
  const width = spanMs / buckets;
  const sums = new Array<number>(buckets).fill(0);
  const counts = new Array<number>(buckets).fill(0);
  for (const r of rows) {
    const idx = Math.floor((r.at.getTime() - start) / width);
    if (idx < 0 || idx >= buckets) continue;
    sums[idx] += r.value;
    counts[idx] += 1;
  }
  const out: Point[] = [];
  for (let i = 0; i < buckets; i++) {
    if (counts[i] > 0)
      out.push({ t: Math.round(start + (i + 0.5) * width), v: sums[i] / counts[i] });
  }
  return out;
}

/** "Nice" y-axis ticks covering [0|min, max]. Always includes the top tick ≥ max. */
export function niceTicks(maxRaw: number, count = 4, minRaw = 0, integer = false): number[] {
  if (!Number.isFinite(maxRaw) || maxRaw <= minRaw) maxRaw = minRaw + 1;
  const span = maxRaw - minRaw;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  let nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= rough)! * mag;
  // Counts get whole-number ticks — nobody runs 0.75 of a pod.
  if (integer) nice = Math.max(1, Math.ceil(nice));
  const ticks: number[] = [];
  const first = Math.floor(minRaw / nice) * nice;
  for (let v = first; v < maxRaw + nice; v += nice) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Compact x-axis time label: time-of-day inside 48 h, date beyond. */
export function timeTickLabel(ms: number, spanHours: number): string {
  const d = new Date(ms);
  if (spanHours <= 48) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h`;
}

/** Value formatter per unit — shared by y-axis and tooltips. */
export function fmtValue(v: number, unit: string): string {
  if (unit === 'B') {
    if (v === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log2(Math.abs(v)) / 10));
    return `${(v / 1024 ** i).toFixed(v >= 1024 ** i * 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }
  if (unit === '%') return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
  if (unit === 'ms') return `${v.toFixed(0)} ms`;
  if (unit === 'cores') return v < 1 ? `${Math.round(v * 1000)}m` : v.toFixed(2);
  if (Number.isInteger(v)) return v.toFixed(0);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/**
 * Pointer clientX → x in SVG user (viewBox) units.
 *
 * An `<svg viewBox="0 0 W H">` sized with `width:100%; height:Hpx` and the DEFAULT
 * `preserveAspectRatio="xMidYMid meet"` does NOT stretch to fill its box: it scales uniformly to
 * fit, then centres, leaving equal dead space left and right whenever the box is wider than the
 * viewBox aspect ratio. Treating the pointer's fraction across the ELEMENT as its fraction across
 * the viewBox therefore overshoots — the crosshair lands to the right of the real pointer by half
 * the letterbox (≈30px in a two-column chart grid).
 *
 * Returns a value in viewBox units; it may fall outside [0, vbW] when the pointer is over the
 * letterboxed margin, which callers clamp via their own snapping.
 */
export function clientXToViewBoxX(
  clientX: number,
  rect: { left: number; width: number; height: number },
  vbW: number,
  vbH: number,
): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;
  // "meet" = fit entirely inside → the smaller of the two scale factors.
  const scale = Math.min(rect.width / vbW, rect.height / vbH);
  if (scale <= 0) return 0;
  // "xMid" = centred horizontally in whatever space is left over.
  const offsetX = (rect.width - vbW * scale) / 2;
  return (clientX - rect.left - offsetX) / scale;
}
