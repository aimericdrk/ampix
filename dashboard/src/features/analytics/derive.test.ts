import { describe, expect, it } from 'vitest';
import type { InsightsResponse, InsightsSeries } from '../../lib/api/types';
import { breakdownBars, pctDelta, previousRange, seriesTrendRows, sumSeries } from './derive';

describe('previousRange', () => {
  it('returns the immediately-preceding equal-length window (30-day June -> May)', () => {
    expect(previousRange('2026-06-01', '2026-06-30')).toEqual({
      from: '2026-05-02',
      to: '2026-05-31',
    });
  });

  it('handles a single-day range', () => {
    expect(previousRange('2026-06-01', '2026-06-01')).toEqual({
      from: '2026-05-31',
      to: '2026-05-31',
    });
  });

  it('returns the input unchanged (no throw) when either bound is empty', () => {
    expect(previousRange('', '')).toEqual({ from: '', to: '' });
    expect(previousRange('', '2026-06-30')).toEqual({ from: '', to: '2026-06-30' });
    expect(previousRange('2026-06-01', '')).toEqual({ from: '2026-06-01', to: '' });
  });

  it('returns the input unchanged (no throw) when either bound is not a valid YYYY-MM-DD date', () => {
    expect(previousRange('not-a-date', '2026-06-30')).toEqual({
      from: 'not-a-date',
      to: '2026-06-30',
    });
    expect(previousRange('2026-06-01', '2026/06/30')).toEqual({
      from: '2026-06-01',
      to: '2026/06/30',
    });
  });
});

describe('pctDelta', () => {
  it('computes a positive percent change', () => {
    expect(pctDelta(120, 100)).toBe(20);
  });

  it('treats a zero previous with positive current as +100', () => {
    expect(pctDelta(5, 0)).toBe(100);
  });

  it('treats zero vs zero as 0', () => {
    expect(pctDelta(0, 0)).toBe(0);
  });

  it('rounds to 1 decimal', () => {
    expect(pctDelta(10, 3)).toBeCloseTo(233.3, 1);
  });
});

describe('sumSeries', () => {
  it('sums all points across all series', () => {
    const series: InsightsSeries[] = [
      { name: 'app_open', breakdown_value: null, data: [{ t: '2026-06-29', value: 10 }, { t: '2026-06-30', value: 5 }] },
      { name: 'purchase', breakdown_value: null, data: [{ t: '2026-06-29', value: 2 }] },
    ];
    expect(sumSeries(series)).toBe(17);
  });

  it('returns 0 for an empty series list', () => {
    expect(sumSeries([])).toBe(0);
  });
});

describe('seriesTrendRows', () => {
  it('merges buckets by t and zero-fills missing buckets', () => {
    const series: InsightsSeries[] = [
      {
        name: 'app_open',
        breakdown_value: null,
        data: [
          { t: '2026-06-29', value: 10 },
          { t: '2026-06-30', value: 5 },
        ],
      },
      {
        name: 'purchase',
        breakdown_value: null,
        data: [{ t: '2026-06-30', value: 3 }, { t: '2026-07-01', value: 1 }],
      },
    ];
    expect(seriesTrendRows(series)).toEqual([
      { t: '2026-06-29', value: 10 },
      { t: '2026-06-30', value: 8 },
      { t: '2026-07-01', value: 1 },
    ]);
  });

  it('returns an empty array for no series', () => {
    expect(seriesTrendRows([])).toEqual([]);
  });
});

describe('breakdownBars', () => {
  it('groups by breakdown_value, summed, sorted desc', () => {
    const response: InsightsResponse = {
      series: [
        {
          name: 'app_open',
          breakdown_value: 'ios',
          data: [{ t: '2026-06-29', value: 10 }, { t: '2026-06-30', value: 5 }],
        },
        {
          name: 'app_open',
          breakdown_value: 'android',
          data: [{ t: '2026-06-29', value: 30 }],
        },
        {
          name: 'purchase',
          breakdown_value: 'ios',
          data: [{ t: '2026-06-29', value: 2 }],
        },
      ],
    };
    expect(breakdownBars(response)).toEqual([
      { label: 'android', value: 30 },
      { label: 'ios', value: 17 },
    ]);
  });

  it('labels a null breakdown_value as (none)', () => {
    const response: InsightsResponse = {
      series: [{ name: 'app_open', breakdown_value: null, data: [{ t: '2026-06-29', value: 4 }] }],
    };
    expect(breakdownBars(response)).toEqual([{ label: '(none)', value: 4 }]);
  });
});
