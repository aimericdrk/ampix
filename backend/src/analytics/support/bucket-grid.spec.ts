import { buildBucketGrid, parseDateOnlyUTC } from './bucket-grid';

describe('parseDateOnlyUTC', () => {
  it('parses a YYYY-MM-DD string as UTC midnight', () => {
    expect(parseDateOnlyUTC('2026-06-01')).toBe(Date.UTC(2026, 5, 1));
  });
});

describe('buildBucketGrid', () => {
  it('day interval: one bucket per calendar day, inclusive of both ends', () => {
    const buckets = buildBucketGrid('2026-06-01', '2026-06-03', 'day');
    expect(buckets.map((b) => b.t)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(buckets[0].ts).toBe(Date.UTC(2026, 5, 1) / 1000);
  });

  it('day interval: a single-day range produces exactly one bucket', () => {
    const buckets = buildBucketGrid('2026-06-01', '2026-06-01', 'day');
    expect(buckets).toHaveLength(1);
    expect(buckets[0].t).toBe('2026-06-01');
  });

  it('hour interval: 24 buckets per day in range, full ISO instants', () => {
    const buckets = buildBucketGrid('2026-06-01', '2026-06-01', 'hour');
    expect(buckets).toHaveLength(24);
    expect(buckets[0].t).toBe('2026-06-01T00:00:00.000Z');
    expect(buckets[23].t).toBe('2026-06-01T23:00:00.000Z');
  });

  it('hour interval: spans multiple days correctly (48 buckets for a 2-day range)', () => {
    const buckets = buildBucketGrid('2026-06-01', '2026-06-02', 'hour');
    expect(buckets).toHaveLength(48);
    expect(buckets[24].t).toBe('2026-06-02T00:00:00.000Z');
  });

  it('week interval: Monday-aligned buckets covering the range', () => {
    // 2026-06-01 is a Monday; 2026-06-10 is a Wednesday in the following week.
    const buckets = buildBucketGrid('2026-06-01', '2026-06-10', 'week');
    expect(buckets.map((b) => b.t)).toEqual(['2026-06-01', '2026-06-08']);
  });

  it("week interval: a `from` mid-week is floored to that week's Monday", () => {
    // 2026-06-03 is a Wednesday -> floors to Monday 2026-06-01.
    const buckets = buildBucketGrid('2026-06-03', '2026-06-03', 'week');
    expect(buckets.map((b) => b.t)).toEqual(['2026-06-01']);
  });

  it('month interval: one bucket per calendar month overlapping the range', () => {
    const buckets = buildBucketGrid('2026-06-15', '2026-08-02', 'month');
    expect(buckets.map((b) => b.t)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('month interval: a same-month range produces exactly one bucket', () => {
    const buckets = buildBucketGrid('2026-06-01', '2026-06-20', 'month');
    expect(buckets.map((b) => b.t)).toEqual(['2026-06-01']);
  });

  it('bucket `ts` values are strictly increasing and unique', () => {
    const buckets = buildBucketGrid('2026-01-01', '2026-12-31', 'day');
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].ts).toBeGreaterThan(buckets[i - 1].ts);
    }
  });
});
