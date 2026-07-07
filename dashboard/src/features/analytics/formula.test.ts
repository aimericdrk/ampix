import { describe, expect, it } from 'vitest';
import type { InsightsSeries } from '../../lib/api/types';
import { computeFormulaSeries } from './formula';

function series(name: string, points: Array<[string, number]>): InsightsSeries {
  return {
    name,
    breakdown_value: null,
    data: points.map(([t, value]) => ({ t, value })),
  };
}

describe('computeFormulaSeries', () => {
  it('ratio: divides a by b per bucket', () => {
    const a = series('checkout_completed', [['2026-06-01', 25]]);
    const b = series('app_opened', [['2026-06-01', 100]]);

    const result = computeFormulaSeries(a, b, 'ratio');

    expect(result.data).toEqual([{ t: '2026-06-01', value: 0.25 }]);
    expect(result.total).toBe(0.25);
  });

  it('ratio: divide-by-zero yields null (a chart gap), never Infinity/NaN', () => {
    const a = series('checkout_completed', [['2026-06-01', 25]]);
    const b = series('app_opened', [['2026-06-01', 0]]);

    const result = computeFormulaSeries(a, b, 'ratio');

    expect(result.data).toEqual([{ t: '2026-06-01', value: null }]);
  });

  it('ratio: as a percent multiplies by 100', () => {
    const a = series('checkout_completed', [['2026-06-01', 25]]);
    const b = series('app_opened', [['2026-06-01', 100]]);

    const result = computeFormulaSeries(a, b, 'ratio', true);

    expect(result.data).toEqual([{ t: '2026-06-01', value: 25 }]);
    expect(result.total).toBe(25);
  });

  it('difference: subtracts b from a per bucket and for the total, unaffected by asPercent', () => {
    const a = series('purchases', [
      ['2026-06-01', 10],
      ['2026-06-02', 20],
    ]);
    const b = series('refunds', [
      ['2026-06-01', 3],
      ['2026-06-02', 5],
    ]);

    const result = computeFormulaSeries(a, b, 'difference', true);

    expect(result.data).toEqual([
      { t: '2026-06-01', value: 7 },
      { t: '2026-06-02', value: 15 },
    ]);
    expect(result.total).toBe(22);
  });

  it('sum: adds a and b per bucket and for the total', () => {
    const a = series('signups', [['2026-06-01', 4]]);
    const b = series('invites', [['2026-06-01', 6]]);

    const result = computeFormulaSeries(a, b, 'sum');

    expect(result.data).toEqual([{ t: '2026-06-01', value: 10 }]);
    expect(result.total).toBe(10);
  });

  it('overall total is the blended rate sum(a)/sum(b), not the mean of per-bucket ratios', () => {
    // Per-bucket ratios would average to (1/1 + 100/1)/2 = 50.5, but the correct blended total
    // is sum(a)/sum(b) = 101/2 = 50.5... pick numbers where the two diverge clearly instead.
    const a = series('checkout_completed', [
      ['2026-06-01', 1],
      ['2026-06-02', 9],
    ]);
    const b = series('app_opened', [
      ['2026-06-01', 10],
      ['2026-06-02', 10],
    ]);
    // Per-bucket ratios: 0.1 and 0.9 -> mean 0.5. Blended: sum(1,9)=10 / sum(10,10)=20 = 0.5.
    // Use asymmetric bucket sizes so the two would actually differ.
    const a2 = series('checkout_completed', [
      ['2026-06-01', 1],
      ['2026-06-02', 90],
    ]);
    const b2 = series('app_opened', [
      ['2026-06-01', 10],
      ['2026-06-02', 100],
    ]);
    // Per-bucket ratios: 0.1 and 0.9 -> naive mean 0.5. Blended: sum(1,90)=91 / sum(10,100)=110 = 0.827...
    const result = computeFormulaSeries(a2, b2, 'ratio');
    expect(result.total).toBeCloseTo(91 / 110, 10);
    expect(result.total).not.toBeCloseTo(0.5, 1);

    // Sanity check on the plain a/b too.
    const plain = computeFormulaSeries(a, b, 'ratio');
    expect(plain.total).toBe(0.5);
  });

  it('overall total is null for ratio when the summed denominator is 0', () => {
    const a = series('checkout_completed', [['2026-06-01', 5]]);
    const b = series('app_opened', [['2026-06-01', 0]]);

    const result = computeFormulaSeries(a, b, 'ratio');

    expect(result.total).toBeNull();
  });

  it('aligns buckets over the union of a/b timestamps, zero-filling whichever side is missing a bucket', () => {
    const a = series('checkout_completed', [
      ['2026-06-01', 10],
      ['2026-06-02', 20],
    ]);
    const b = series('app_opened', [
      ['2026-06-02', 5],
      ['2026-06-03', 8],
    ]);

    const result = computeFormulaSeries(a, b, 'sum');

    expect(result.data).toEqual([
      { t: '2026-06-01', value: 10 }, // a=10, b=0 (zero-filled)
      { t: '2026-06-02', value: 25 }, // a=20, b=5
      { t: '2026-06-03', value: 8 }, // a=0 (zero-filled), b=8
    ]);
  });

  it('treats an undefined series (no metric picked yet) as all-zero', () => {
    const b = series('app_opened', [['2026-06-01', 4]]);

    expect(computeFormulaSeries(undefined, b, 'sum')).toEqual({
      data: [{ t: '2026-06-01', value: 4 }],
      total: 4,
    });
    expect(computeFormulaSeries(undefined, undefined, 'ratio')).toEqual({
      data: [],
      total: null,
    });
  });
});
