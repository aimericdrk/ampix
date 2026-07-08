import { describe, expect, it } from 'vitest';
import { detectAnomalies, type AnomalyPoint } from './anomaly';

/** Builds `{t, value}` points with stable, distinguishable `t` labels (`d0`, `d1`, ...). */
function points(values: number[]): AnomalyPoint[] {
  return values.map((value, index) => ({ t: `d${index}`, value }));
}

describe('detectAnomalies', () => {
  it('flags an obvious spike at the right index', () => {
    // A mildly noisy baseline (mean ~10.6, stdev ~1.4), then a point wildly above it.
    const series = points([10, 12, 9, 11, 10, 13, 9, 50]);
    const anomalies = detectAnomalies(series);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ index: 7, t: 'd7', value: 50, direction: 'spike' }),
    );
  });

  it('flags an obvious dip at the right index', () => {
    const series = points([10, 12, 9, 11, 10, 13, 9, -20]);
    const anomalies = detectAnomalies(series);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ index: 7, t: 'd7', value: -20, direction: 'dip' }),
    );
  });

  it('never flags a perfectly flat series (zero variance)', () => {
    const series = points(new Array(8).fill(42));
    expect(detectAnomalies(series)).toEqual([]);
  });

  it('never flags a near-flat series with only floating-point-scale jitter', () => {
    const series = points([100, 100.0001, 99.9999, 100.0002, 99.9998, 100.0001, 100, 99.9999, 100.0001, 100]);
    expect(detectAnomalies(series)).toEqual([]);
  });

  it('is graceful with fewer points than the guard requires (< 4)', () => {
    expect(detectAnomalies(points([1, 2, 3]))).toEqual([]);
    expect(detectAnomalies([])).toEqual([]);
  });

  it('still flags with fewer points than the rolling window, using the available prefix', () => {
    // Only 5 points total, well under the default 7-point window.
    const series = points([10, 11, 9, 10, 100]);
    const anomalies = detectAnomalies(series);
    expect(anomalies).toContainEqual(
      expect.objectContaining({ index: 4, t: 'd4', value: 100, direction: 'spike' }),
    );
  });

  it('respects the k threshold — a borderline point only flags once k is lowered', () => {
    const series = points([10, 14, 6, 12, 8, 15, 5, 18]);
    const defaultResult = detectAnomalies(series);
    expect(defaultResult.some((a) => a.index === 7)).toBe(false);

    const looserResult = detectAnomalies(series, { k: 2 });
    expect(looserResult).toContainEqual(expect.objectContaining({ index: 7, direction: 'spike' }));
  });

  it('is deterministic — repeated calls on the same input produce the same output', () => {
    const series = points([10, 12, 9, 11, 10, 13, 9, 50, 12, 11]);
    expect(detectAnomalies(series)).toEqual(detectAnomalies(series));
  });

  it('reports the trailing-window baseline mean used to flag each anomaly', () => {
    const series = points([10, 12, 9, 11, 10, 13, 9, 50]);
    const anomaly = detectAnomalies(series).find((a) => a.index === 7);
    expect(anomaly?.baselineMean).toBeCloseTo(10.571, 2);
  });
});
