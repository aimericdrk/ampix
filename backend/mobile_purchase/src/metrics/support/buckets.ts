export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** Truncates `date` to the UTC start of its `granularity` bucket, matching Postgres `date_trunc`
 * semantics (week starts Monday, month on the 1st, all at UTC midnight). */
export function truncateUtc(date: Date, granularity: Granularity): Date {
  if (granularity === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === 'week') {
    const back = (day.getUTCDay() + 6) % 7; // days since Monday (getUTCDay: 0=Sun..6=Sat)
    day.setUTCDate(day.getUTCDate() - back);
  }
  return day;
}

/** Start of the bucket immediately following `bucketStart` for `granularity`. */
export function nextBucket(bucketStart: Date, granularity: Granularity): Date {
  const y = bucketStart.getUTCFullYear();
  const m = bucketStart.getUTCMonth();
  const d = bucketStart.getUTCDate();
  if (granularity === 'day') return new Date(Date.UTC(y, m, d + 1));
  if (granularity === 'week') return new Date(Date.UTC(y, m, d + 7));
  return new Date(Date.UTC(y, m + 1, 1));
}

/** Every bucket start from `truncate(from)` to `truncate(to)` inclusive — used to zero-fill empty
 * buckets so a chart renders gaps as zero, not holes. */
export function generateBuckets(from: Date, to: Date, granularity: Granularity): Date[] {
  const end = truncateUtc(to, granularity);
  const out: Date[] = [];
  let cur = truncateUtc(from, granularity);
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = nextBucket(cur, granularity);
  }
  return out;
}
