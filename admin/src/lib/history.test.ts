import { describe, expect, it } from 'vitest';
import { bucketSeries, fmtValue, niceTicks, timeTickLabel } from './history';

const NOW = new Date('2026-08-24T12:00:00Z').getTime();

describe('bucketSeries', () => {
  it('averages rows inside a bucket and skips empty buckets', () => {
    const rows = [
      { at: new Date(NOW - 3599_000), value: 10 },
      { at: new Date(NOW - 3598_000), value: 20 },
      { at: new Date(NOW - 60_000), value: 50 },
    ];
    const pts = bucketSeries(rows, 1, NOW, 60); // 1h → 60 one-minute buckets
    expect(pts).toHaveLength(2);
    expect(pts[0].v).toBe(15);
    expect(pts[1].v).toBe(50);
    expect(pts[0].t).toBeLessThan(pts[1].t);
  });
  it('drops rows outside the window', () => {
    expect(bucketSeries([{ at: new Date(NOW - 10 * 3600_000), value: 1 }], 1, NOW)).toHaveLength(0);
  });
});

describe('niceTicks', () => {
  it('produces round steps that cover the max', () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(3.2)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(0)).toContain(0);
    expect(niceTicks(1, 4, 0, true)).toEqual([0, 1]);
    expect(niceTicks(8, 4, 0, true)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('formatters', () => {
  it('formats per unit', () => {
    expect(fmtValue(1536 * 1024 * 1024, 'B')).toBe('1.5 GiB');
    expect(fmtValue(42.3, '%')).toBe('42%');
    expect(fmtValue(0.25, 'cores')).toBe('250m');
    expect(fmtValue(123.4, 'ms')).toBe('123 ms');
    expect(fmtValue(9, '')).toBe('9');
    expect(fmtValue(2.5, '')).toBe('2.5');
  });
  it('time labels switch to dates past 48h', () => {
    expect(timeTickLabel(NOW, 24)).toMatch(/^\d{2}:\d{2}$/);
    expect(timeTickLabel(NOW, 168)).toMatch(/^\d{2}-\d{2} \d{2}h$/);
  });
});
