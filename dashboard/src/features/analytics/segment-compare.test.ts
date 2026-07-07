import { describe, expect, it } from 'vitest';
import type { InsightsResponse } from '../../lib/api/types';
import { combineSegmentSeries } from './segment-compare';

function response(data: Array<{ t: string; value: number }>, name = 'checkout_completed'): InsightsResponse {
  return { series: [{ name, breakdown_value: null, data }] };
}

describe('combineSegmentSeries', () => {
  it('renames each single-event segment series to just the segment name', () => {
    const result = combineSegmentSeries([
      { name: 'All users', response: response([{ t: '2026-06-29', value: 10 }]) },
      { name: 'Recent buyers', response: response([{ t: '2026-06-29', value: 4 }]) },
    ]);

    expect(result.series).toEqual([
      { name: 'All users', breakdown_value: null, data: [{ t: '2026-06-29', value: 10 }] },
      { name: 'Recent buyers', breakdown_value: null, data: [{ t: '2026-06-29', value: 4 }] },
    ]);
  });

  it('computes a total per segment via sumSeries', () => {
    const result = combineSegmentSeries([
      {
        name: 'All users',
        response: response([
          { t: '2026-06-29', value: 10 },
          { t: '2026-06-30', value: 5 },
        ]),
      },
      { name: 'Recent buyers', response: response([{ t: '2026-06-29', value: 4 }]) },
    ]);

    expect(result.totals).toEqual([
      { name: 'All users', total: 15 },
      { name: 'Recent buyers', total: 4 },
    ]);
  });

  it('prefixes each series with the segment name when a segment resolves to more than one series', () => {
    const multi: InsightsResponse = {
      series: [
        { name: 'checkout_completed', breakdown_value: 'ios', data: [{ t: '2026-06-29', value: 3 }] },
        { name: 'checkout_completed', breakdown_value: 'android', data: [{ t: '2026-06-29', value: 2 }] },
      ],
    };

    const result = combineSegmentSeries([{ name: 'All users', response: multi }]);

    expect(result.series.map((s) => s.name)).toEqual([
      'All users · checkout_completed',
      'All users · checkout_completed',
    ]);
    expect(result.series.map((s) => s.breakdown_value)).toEqual(['ios', 'android']);
    expect(result.totals).toEqual([{ name: 'All users', total: 5 }]);
  });

  it('gives an undefined response a flat empty series and a 0 total, still labelled', () => {
    const result = combineSegmentSeries([{ name: 'Trialists', response: undefined }]);

    expect(result.series).toEqual([{ name: 'Trialists', breakdown_value: null, data: [] }]);
    expect(result.totals).toEqual([{ name: 'Trialists', total: 0 }]);
  });

  it('gives an empty-series response (no matching users) the same flat/labelled treatment', () => {
    const result = combineSegmentSeries([{ name: 'Empty segment', response: { series: [] } }]);

    expect(result.series).toEqual([{ name: 'Empty segment', breakdown_value: null, data: [] }]);
    expect(result.totals).toEqual([{ name: 'Empty segment', total: 0 }]);
  });

  it('preserves the given segment order regardless of which responses resolve first', () => {
    const result = combineSegmentSeries([
      { name: 'Zeta', response: response([{ t: '2026-06-29', value: 1 }]) },
      { name: 'Alpha', response: response([{ t: '2026-06-29', value: 2 }]) },
    ]);

    expect(result.series.map((s) => s.name)).toEqual(['Zeta', 'Alpha']);
    expect(result.totals.map((t) => t.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('returns empty series/totals for no segments', () => {
    expect(combineSegmentSeries([])).toEqual({ series: [], totals: [] });
  });
});
