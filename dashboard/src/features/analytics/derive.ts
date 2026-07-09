import type { InsightsResponse, InsightsSeries } from '../../lib/api/types';
import { iso3Name, toIso3 } from './geo/country-codes';

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

/** One row of the by-country installs breakdown (feat-18 §3.4): a resolved ISO-3 country, or the
 * `iso3: null` "Unknown" rollup for values `toIso3` couldn't resolve. */
export interface CountryInstallRow {
  iso3: string | null;
  name: string;
  count: number;
  /** Share of the grand total (resolved + unknown), in [0,1]; 0 when the total is 0. */
  share: number;
}

export interface InstallsByCountry {
  /** ISO-3 -> install count, ready for `WorldChoropleth`'s `data` prop. Excludes the Unknown bucket
   * (unresolved country values have no geometry to shade). */
  mapData: Record<string, number>;
  /** Sorted desc by count; an `iso3: null` "Unknown" row (if any installs are unresolved) is
   * always appended last, regardless of its count. */
  rows: CountryInstallRow[];
  /** Grand total across every breakdown value, resolved or not. */
  total: number;
  /** Distinct resolved ISO-3 countries (excludes the Unknown bucket). */
  countryCount: number;
}

/**
 * Derives the Installations-by-country map/table data (feat-18 §3.4) from a `$first_open`
 * breakdown-by-country {@link InsightsResponse}: each series' `sumSeries` is that breakdown
 * value's install count; values are folded through `toIso3` so different SDK-supplied spellings
 * of the same country (ISO-2, ISO-3, name) aggregate into one ISO-3 entry, and anything `toIso3`
 * can't resolve rolls up into a single "Unknown" row.
 */
export function installsByCountry(response: InsightsResponse | undefined): InstallsByCountry {
  const mapData: Record<string, number> = {};
  let unknown = 0;
  for (const s of response?.series ?? []) {
    const count = sumSeries([s]);
    const iso3 = toIso3(s.breakdown_value);
    if (iso3) {
      mapData[iso3] = (mapData[iso3] ?? 0) + count;
    } else {
      unknown += count;
    }
  }

  const total = Object.values(mapData).reduce((sum, value) => sum + value, 0) + unknown;
  const rows: CountryInstallRow[] = Object.entries(mapData)
    .map(([iso3, count]) => ({
      iso3,
      name: iso3Name(iso3),
      count,
      share: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
  if (unknown > 0) {
    rows.push({ iso3: null, name: 'Unknown', count: unknown, share: total > 0 ? unknown / total : 0 });
  }

  return { mapData, rows, total, countryCount: Object.keys(mapData).length };
}
