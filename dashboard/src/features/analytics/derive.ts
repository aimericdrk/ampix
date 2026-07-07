import type { InsightsResponse, InsightsSeries } from '../../lib/api/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed `YYYY-MM-DD` string whose parts all parse to finite numbers. */
function isValidDateString(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  return date.split('-').map(Number).every((part) => Number.isFinite(part));
}

/** Parses an inclusive `YYYY-MM-DD` date into a UTC-midnight epoch, avoiding local-TZ drift. */
function toUtcDays(date: string): number {
  const parts = date.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromUtcDays(days: number): string {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The immediately-preceding equal-length window: inclusive day math on `YYYY-MM-DD` dates.
 * Window length = days(to) - days(from) + 1; the previous window ends the day before `from` and
 * spans the same number of days.
 *
 * Guards against a corrupt/cleared range (empty strings, or anything not a valid `YYYY-MM-DD`)
 * by returning the input unchanged rather than feeding `NaN` into `Date.UTC` and throwing during
 * render.
 */
export function previousRange(from: string, to: string): { from: string; to: string } {
  if (!isValidDateString(from) || !isValidDateString(to)) {
    return { from, to };
  }
  const fromDays = toUtcDays(from);
  const toDays = toUtcDays(to);
  const length = toDays - fromDays + 1;
  return {
    from: fromUtcDays(fromDays - length),
    to: fromUtcDays(fromDays - 1),
  };
}

/** Percent change of `current` vs `previous`, rounded to 1 decimal. */
export function pctDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Sum of every point's value across every series. */
export function sumSeries(series: InsightsSeries[]): number {
  return series.reduce(
    (total, s) => total + s.data.reduce((sum, point) => sum + point.value, 0),
    0,
  );
}

/** Per-bucket sum across series, union of `t`, zero-filled, sorted by `t`. */
export function seriesTrendRows(series: InsightsSeries[]): Array<{ t: string; value: number }> {
  const totals = new Map<string, number>();
  for (const s of series) {
    for (const point of s.data) {
      totals.set(point.t, (totals.get(point.t) ?? 0) + point.value);
    }
  }
  return Array.from(totals, ([t, value]) => ({ t, value })).sort((a, b) => a.t.localeCompare(b.t));
}

/** One bar per distinct `breakdown_value` (label = value ?? '(none)'), summed, sorted desc. */
export function breakdownBars(response: InsightsResponse): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const s of response.series) {
    const label = s.breakdown_value ?? '(none)';
    totals.set(label, (totals.get(label) ?? 0) + sumSeries([s]));
  }
  return Array.from(totals, ([label, value]) => ({ label, value })).sort(
    (a, b) => b.value - a.value,
  );
}
