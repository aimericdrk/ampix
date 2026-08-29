import type { Interval } from '../queries/insights/insights-query.schema';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * ClickHouse expression that buckets `timestamp` for each interval (contracts §14). Values come
 * from this fixed record only — selected by the validated `interval` enum, never by raw user
 * text — so there is no injection surface here.
 */
export const BUCKET_EXPR: Readonly<Record<Interval, string>> = Object.freeze({
  hour: 'toStartOfHour(timestamp)',
  day: 'toStartOfDay(timestamp)',
  week: 'toMonday(timestamp)',
  month: 'toStartOfMonth(timestamp)',
  // The range's own lower bound, already bound as a param by every series query — a constant, so
  // every row lands in one bucket and `uniqExact` dedupes across the whole range instead of per
  // day. Not `min(timestamp)`: that is an aggregate and cannot appear in a GROUP BY key.
  range: '{from:DateTime64}',
});

export interface Bucket {
  /** Unix seconds (UTC) — joins against ClickHouse's `toUnixTimestamp(<BUCKET_EXPR>)`. */
  ts: number;
  /** Response label: `YYYY-MM-DD` for day/week/month, a full ISO instant for hour. */
  t: string;
}

/** Parses a `YYYY-MM-DD` date-only string as a UTC-midnight instant (ms epoch). */
export function parseDateOnlyUTC(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateOnlyUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC Monday-aligned start of the ISO week containing `ms` (matches ClickHouse's `toMonday`). */
function toMondayUTC(ms: number): number {
  const dayOfWeek = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return ms - daysSinceMonday * MS_PER_DAY;
}

function firstOfMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function addMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * The zero-fill bucket grid for `[from, to]` (inclusive UTC dates) at `interval` granularity —
 * every series in an insights response is reindexed onto exactly this grid, so a bucket with no
 * matching rows reads as `{ value: 0 }` rather than being silently omitted.
 */
export function buildBucketGrid(from: string, to: string, interval: Interval): Bucket[] {
  const fromMs = parseDateOnlyUTC(from);
  const toMs = parseDateOnlyUTC(to);
  const buckets: Bucket[] = [];

  if (interval === 'range') {
    // One bucket for the whole range, labelled with its first day.
    return [{ ts: fromMs / 1000, t: from }];
  }

  if (interval === 'hour') {
    const endExclusive = toMs + MS_PER_DAY; // `to`'s entire day is included -> hours 0..23
    for (let t = fromMs; t < endExclusive; t += MS_PER_HOUR) {
      buckets.push({ ts: t / 1000, t: new Date(t).toISOString() });
    }
  } else if (interval === 'day') {
    for (let t = fromMs; t <= toMs; t += MS_PER_DAY) {
      buckets.push({ ts: t / 1000, t: formatDateOnlyUTC(t) });
    }
  } else if (interval === 'week') {
    const start = toMondayUTC(fromMs);
    const end = toMondayUTC(toMs);
    for (let t = start; t <= end; t += 7 * MS_PER_DAY) {
      buckets.push({ ts: t / 1000, t: formatDateOnlyUTC(t) });
    }
  } else {
    const end = firstOfMonthUTC(toMs);
    for (let t = firstOfMonthUTC(fromMs); t <= end; t = addMonthUTC(t)) {
      buckets.push({ ts: t / 1000, t: formatDateOnlyUTC(t) });
    }
  }
  return buckets;
}
