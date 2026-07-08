import { describe, expect, it } from 'vitest';
import { shiftRange, zipByIndex } from './range-compare';

describe('shiftRange', () => {
  describe("unit: 'previous'", () => {
    it('matches previousRange for a 30-day window (June -> May)', () => {
      expect(shiftRange('2026-06-01', '2026-06-30', 'previous')).toEqual({
        from: '2026-05-02',
        to: '2026-05-31',
      });
    });

    it('handles a single-day range', () => {
      expect(shiftRange('2026-06-01', '2026-06-01', 'previous')).toEqual({
        from: '2026-05-31',
        to: '2026-05-31',
      });
    });
  });

  describe("unit: 'week'", () => {
    it('shifts both bounds back exactly 7 days', () => {
      expect(shiftRange('2026-06-08', '2026-06-14', 'week')).toEqual({
        from: '2026-06-01',
        to: '2026-06-07',
      });
    });

    it('crosses a month boundary correctly', () => {
      expect(shiftRange('2026-07-01', '2026-07-03', 'week')).toEqual({
        from: '2026-06-24',
        to: '2026-06-26',
      });
    });
  });

  describe("unit: 'month'", () => {
    it('shifts both bounds back one calendar month', () => {
      expect(shiftRange('2026-06-01', '2026-06-30', 'month')).toEqual({
        from: '2026-05-01',
        to: '2026-05-30',
      });
    });

    it('clamps the day when the target month is shorter (Mar 31 -> Feb 28, non-leap year)', () => {
      expect(shiftRange('2026-03-31', '2026-03-31', 'month')).toEqual({
        from: '2026-02-28',
        to: '2026-02-28',
      });
    });

    it('clamps to Feb 29 in a leap year', () => {
      expect(shiftRange('2024-03-31', '2024-03-31', 'month')).toEqual({
        from: '2024-02-29',
        to: '2024-02-29',
      });
    });

    it('rolls back across a year boundary (Jan -> Dec of prior year)', () => {
      expect(shiftRange('2026-01-15', '2026-01-20', 'month')).toEqual({
        from: '2025-12-15',
        to: '2025-12-20',
      });
    });
  });

  describe("unit: 'year'", () => {
    it('shifts both bounds back exactly one calendar year', () => {
      expect(shiftRange('2026-06-01', '2026-06-30', 'year')).toEqual({
        from: '2025-06-01',
        to: '2025-06-30',
      });
    });

    it('clamps a leap-day (Feb 29) back to Feb 28 in a non-leap target year', () => {
      expect(shiftRange('2024-02-29', '2024-02-29', 'year')).toEqual({
        from: '2023-02-28',
        to: '2023-02-28',
      });
    });
  });

  describe('invalid input', () => {
    it('returns the input unchanged (no throw) when either bound is empty', () => {
      expect(shiftRange('', '', 'week')).toEqual({ from: '', to: '' });
      expect(shiftRange('', '2026-06-30', 'month')).toEqual({ from: '', to: '2026-06-30' });
      expect(shiftRange('2026-06-01', '', 'year')).toEqual({ from: '2026-06-01', to: '' });
    });

    it('returns the input unchanged (no throw) when either bound is not a valid YYYY-MM-DD date', () => {
      expect(shiftRange('not-a-date', '2026-06-30', 'week')).toEqual({
        from: 'not-a-date',
        to: '2026-06-30',
      });
      expect(shiftRange('2026-06-01', '2026/06/30', 'month')).toEqual({
        from: '2026-06-01',
        to: '2026/06/30',
      });
    });
  });
});

describe('zipByIndex', () => {
  it('pairs elements by position', () => {
    expect(zipByIndex([1, 2, 3], ['a', 'b', 'c'])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('zips to the shorter array when lengths differ', () => {
    expect(zipByIndex([1, 2, 3], ['a'])).toEqual([[1, 'a']]);
    expect(zipByIndex([1], ['a', 'b', 'c'])).toEqual([[1, 'a']]);
  });

  it('returns an empty array when either input is empty', () => {
    expect(zipByIndex([], ['a', 'b'])).toEqual([]);
    expect(zipByIndex([1, 2], [])).toEqual([]);
  });
});
