import { generateBuckets, nextBucket, truncateUtc } from './buckets';

describe('bucket helpers', () => {
  it('truncateUtc snaps to UTC day / week(Monday) / month starts', () => {
    expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'day').toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'week').toISOString()).toBe('2026-07-13T00:00:00.000Z');
    expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'month').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('nextBucket advances one granularity step (incl. month/year rollover)', () => {
    expect(nextBucket(new Date('2026-07-16T00:00:00Z'), 'day').toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(nextBucket(new Date('2026-07-13T00:00:00Z'), 'week').toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(nextBucket(new Date('2026-12-01T00:00:00Z'), 'month').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('generateBuckets returns inclusive, zero-fill-ready day buckets', () => {
    const buckets = generateBuckets(new Date('2026-07-01T05:00:00Z'), new Date('2026-07-03T23:00:00Z'), 'day');
    expect(buckets.map((b) => b.toISOString())).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z',
      '2026-07-03T00:00:00.000Z',
    ]);
  });
});
