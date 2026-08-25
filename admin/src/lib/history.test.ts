import { describe, expect, it } from 'vitest';
import { bucketSeries, clientXToViewBoxX, fmtValue, niceTicks, timeTickLabel } from './history';

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

describe('clientXToViewBoxX', () => {
  const VB_W = 640;
  const VB_H = 240;
  // The real case: a chart in a two-column grid. 700px wide, 240px tall, viewBox 640x240.
  // meet → scale = min(700/640, 240/240) = 1, so the drawing is 640 wide and centred with 30px
  // of dead space on each side.
  const wide = { left: 100, width: 700, height: 240 };

  it('maps the left edge of the DRAWING (not the element) to x=0', () => {
    expect(clientXToViewBoxX(100 + 30, wide, VB_W, VB_H)).toBeCloseTo(0, 6);
  });

  it('maps the right edge of the drawing to x=vbW', () => {
    expect(clientXToViewBoxX(100 + 30 + 640, wide, VB_W, VB_H)).toBeCloseTo(VB_W, 6);
  });

  it('maps the centre to the middle of the viewBox', () => {
    expect(clientXToViewBoxX(100 + 350, wide, VB_W, VB_H)).toBeCloseTo(VB_W / 2, 6);
  });

  /**
   * Regression: the previous implementation used (clientX - rect.left) / rect.width * vbW, which
   * ignores the letterbox. At the drawing's left edge it produced 30/700*640 ≈ 27.4 instead of 0 —
   * the crosshair rendering ~30px right of the pointer.
   */
  it('does not reproduce the naive element-fraction result', () => {
    const naive = ((100 + 30 - wide.left) / wide.width) * VB_W;
    expect(naive).toBeCloseTo(27.43, 1);
    expect(clientXToViewBoxX(100 + 30, wide, VB_W, VB_H)).toBeCloseTo(0, 6);
  });

  it('agrees with the naive result when there is no letterbox', () => {
    // Exactly the viewBox aspect ratio → scale fits both axes, no dead space.
    const exact = { left: 0, width: 640, height: 240 };
    for (const cx of [0, 160, 320, 640]) {
      expect(clientXToViewBoxX(cx, exact, VB_W, VB_H)).toBeCloseTo((cx / 640) * VB_W, 6);
    }
  });

  it('handles a box constrained by WIDTH (taller than the viewBox aspect)', () => {
    // 320 wide, 240 tall → scale = min(0.5, 1) = 0.5; drawing is 320 wide, no horizontal dead space.
    const narrow = { left: 0, width: 320, height: 240 };
    expect(clientXToViewBoxX(0, narrow, VB_W, VB_H)).toBeCloseTo(0, 6);
    expect(clientXToViewBoxX(320, narrow, VB_W, VB_H)).toBeCloseTo(VB_W, 6);
  });

  it('returns negative x over the left letterbox rather than clamping silently', () => {
    expect(clientXToViewBoxX(100, wide, VB_W, VB_H)).toBeLessThan(0);
  });

  it('survives a zero-sized box (element not laid out yet)', () => {
    expect(clientXToViewBoxX(50, { left: 0, width: 0, height: 0 }, VB_W, VB_H)).toBe(0);
  });
});
