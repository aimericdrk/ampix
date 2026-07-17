import { monthlyMultiplier } from './duration';

describe('monthlyMultiplier', () => {
  it('normalizes common subscription periods to a monthly multiplier (month = 30 days)', () => {
    expect(monthlyMultiplier('P1M')).toBeCloseTo(1, 10);
    expect(monthlyMultiplier('P1Y')).toBeCloseTo(1 / 12, 10);
    expect(monthlyMultiplier('P3M')).toBeCloseTo(1 / 3, 10);
    expect(monthlyMultiplier('P6M')).toBeCloseTo(1 / 6, 10);
    expect(monthlyMultiplier('P1W')).toBeCloseTo(30 / 7, 10);
    expect(monthlyMultiplier('P7D')).toBeCloseTo(30 / 7, 10);
    expect(monthlyMultiplier('P1D')).toBeCloseTo(30, 10);
  });

  it('multiplies a weekly price cleanly to a monthly figure (700c/week -> 3000c/month)', () => {
    expect(Math.round(700 * (monthlyMultiplier('P1W') as number))).toBe(3000);
  });

  it('returns null for null / empty / unparseable / zero-length durations', () => {
    expect(monthlyMultiplier(null)).toBeNull();
    expect(monthlyMultiplier(undefined)).toBeNull();
    expect(monthlyMultiplier('')).toBeNull();
    expect(monthlyMultiplier('1M')).toBeNull();
    expect(monthlyMultiplier('P')).toBeNull();
    expect(monthlyMultiplier('lifetime')).toBeNull();
  });
});
