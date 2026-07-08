import { describe, expect, it } from 'vitest';
import type { EngagementNewReturningPoint } from '../../lib/api/types';
import { lifecycleRows, lifecycleSummary } from './lifecycle';

const POINTS: EngagementNewReturningPoint[] = [
  { t: '2026-06-29', new: 30, returning: 90 },
  { t: '2026-06-30', new: 35, returning: 100 },
  { t: '2026-07-01', new: 40, returning: 110 },
];

describe('lifecycleSummary', () => {
  it('sums new/returning across every bucket and derives the active total', () => {
    expect(lifecycleSummary(POINTS)).toEqual({
      totalActive: 405,
      totalNew: 105,
      totalReturning: 300,
      pctNew: 105 / 405,
      pctReturning: 300 / 405,
    });
  });

  it('splits the percent composition correctly for a simple 50/50 case', () => {
    const summary = lifecycleSummary([{ t: '2026-01-01', new: 50, returning: 50 }]);
    expect(summary.totalActive).toBe(100);
    expect(summary.pctNew).toBeCloseTo(0.5);
    expect(summary.pctReturning).toBeCloseTo(0.5);
  });

  it('guards divide-by-zero: an empty series reads as 0 active and 0% split, never NaN', () => {
    expect(lifecycleSummary([])).toEqual({
      totalActive: 0,
      totalNew: 0,
      totalReturning: 0,
      pctNew: 0,
      pctReturning: 0,
    });
  });

  it('guards divide-by-zero: a series of all-zero buckets also reads as 0, not NaN', () => {
    const summary = lifecycleSummary([
      { t: '2026-01-01', new: 0, returning: 0 },
      { t: '2026-01-02', new: 0, returning: 0 },
    ]);
    expect(summary).toEqual({
      totalActive: 0,
      totalNew: 0,
      totalReturning: 0,
      pctNew: 0,
      pctReturning: 0,
    });
  });
});

describe('lifecycleRows', () => {
  it('adds the per-bucket total (new+returning) alongside the stacked series, in input order', () => {
    expect(lifecycleRows(POINTS)).toEqual([
      { t: '2026-06-29', new: 30, returning: 90, total: 120 },
      { t: '2026-06-30', new: 35, returning: 100, total: 135 },
      { t: '2026-07-01', new: 40, returning: 110, total: 150 },
    ]);
  });

  it('returns an empty array for an empty input, without throwing', () => {
    expect(lifecycleRows([])).toEqual([]);
  });
});
