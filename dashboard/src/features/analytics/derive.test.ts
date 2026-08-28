import { describe, expect, it } from 'vitest';
import type { InsightsResponse, InsightsSeries } from '../../lib/api/types';
import {
  breakdownBars,
  installsByCountry,
  pctDelta,
  previousRange,
  seriesTrendRows,
  sumSeries,
} from './derive';

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

describe('installsByCountry', () => {
  it('folds resolvable breakdown values (ISO-2, ISO-3, name) that share an ISO-3 into one map entry', () => {
    const response: InsightsResponse = {
      series: [
        { name: '$first_open', breakdown_value: 'US', data: [{ t: '2026-06-29', value: 10 }] },
        { name: '$first_open', breakdown_value: 'USA', data: [{ t: '2026-06-30', value: 5 }] },
        {
          name: '$first_open',
          breakdown_value: 'United States of America',
          data: [{ t: '2026-07-01', value: 2 }],
        },
        { name: '$first_open', breakdown_value: 'FR', data: [{ t: '2026-06-29', value: 8 }] },
      ],
    };
    const result = installsByCountry(response);
    expect(result.mapData).toEqual({ USA: 17, FRA: 8 });
    expect(result.total).toBe(25);
    expect(result.countryCount).toBe(2);
  });

  it('buckets unresolvable breakdown values under an Unknown row, listed last regardless of count', () => {
    const response: InsightsResponse = {
      series: [
        { name: '$first_open', breakdown_value: 'FR', data: [{ t: '2026-06-29', value: 48 }] },
        { name: '$first_open', breakdown_value: 'US', data: [{ t: '2026-06-29', value: 33 }] },
        { name: '$first_open', breakdown_value: 'Wakanda', data: [{ t: '2026-06-29', value: 63 }] },
      ],
    };
    const result = installsByCountry(response);
    expect(result.mapData).toEqual({ FRA: 48, USA: 33 });
    expect(result.total).toBe(144);
    expect(result.countryCount).toBe(2);
    expect(result.rows.map((r) => r.name)).toEqual([
      'France',
      'United States',
      'Unknown',
    ]);
    expect(result.rows.map((r) => r.iso3)).toEqual(['FRA', 'USA', null]);
    // Sorted desc by count among resolved rows; Unknown is always last even though it's the
    // largest bucket here (63 > 48 > 33).
    expect(result.rows.map((r) => r.count)).toEqual([48, 33, 63]);
    expect(result.rows.map((r) => Math.round(r.share * 1000) / 1000)).toEqual([
      Math.round((48 / 144) * 1000) / 1000,
      Math.round((33 / 144) * 1000) / 1000,
      Math.round((63 / 144) * 1000) / 1000,
    ]);
  });

  it('omits the Unknown row entirely when every value resolves', () => {
    const response: InsightsResponse = {
      series: [{ name: '$first_open', breakdown_value: 'FR', data: [{ t: '2026-06-29', value: 1 }] }],
    };
    const result = installsByCountry(response);
    expect(result.rows.some((r) => r.iso3 === null)).toBe(false);
  });

  it('returns empty structures for undefined/empty responses', () => {
    expect(installsByCountry(undefined)).toEqual({ mapData: {}, rows: [], total: 0, countryCount: 0 });
    expect(installsByCountry({ series: [] })).toEqual({
      mapData: {},
      rows: [],
      total: 0,
      countryCount: 0,
    });
  });
});
