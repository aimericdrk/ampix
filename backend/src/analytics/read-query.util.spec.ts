import {
  clampLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseIsoInstantParam,
  resolveDateOnlyRange,
} from './read-query.util';

describe('clampLimit', () => {
  it('defaults to DEFAULT_LIMIT when absent', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('passes through an in-range value', () => {
    expect(clampLimit('10')).toBe(10);
  });

  it('clamps a value above MAX_LIMIT down to MAX_LIMIT', () => {
    expect(clampLimit('1000')).toBe(MAX_LIMIT);
  });

  it('clamps exactly MAX_LIMIT to itself (boundary)', () => {
    expect(clampLimit(String(MAX_LIMIT))).toBe(MAX_LIMIT);
  });

  it('defaults on a zero or negative value rather than clamping to 1', () => {
    expect(clampLimit('0')).toBe(DEFAULT_LIMIT);
    expect(clampLimit('-5')).toBe(DEFAULT_LIMIT);
  });

  it('defaults on non-numeric garbage', () => {
    expect(clampLimit('not-a-number')).toBe(DEFAULT_LIMIT);
  });

  it('floors a fractional value', () => {
    expect(clampLimit('10.9')).toBe(10);
  });
});

describe('parseIsoInstantParam', () => {
  it('returns undefined when the param is absent', () => {
    expect(parseIsoInstantParam(undefined, 'before')).toBeUndefined();
  });

  it('converts a valid ISO instant to a ClickHouse DateTime64 literal', () => {
    expect(parseIsoInstantParam('2026-07-02T12:00:00.000Z', 'before')).toBe(
      '2026-07-02 12:00:00.000',
    );
  });

  it('throws a 400 ProblemException on a malformed value', () => {
    expect(() => parseIsoInstantParam('not-a-date', 'before')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});

describe('resolveDateOnlyRange', () => {
  it('defaults to a trailing 30-day window (inclusive of today) when both are omitted', () => {
    const { from, to } = resolveDateOnlyRange(undefined, undefined);
    const todayMs = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const expectedTo = new Date(todayMs).toISOString().slice(0, 10);
    const expectedFrom = new Date(todayMs - 29 * 86_400_000).toISOString().slice(0, 10);
    expect(to).toBe(expectedTo);
    expect(from).toBe(expectedFrom);
  });

  it('accepts explicit from/to dates', () => {
    expect(resolveDateOnlyRange('2026-06-01', '2026-06-10')).toEqual({
      from: '2026-06-01',
      to: '2026-06-10',
    });
  });

  it('defaults `from` relative to an explicit `to` when only `to` is given', () => {
    const { from, to } = resolveDateOnlyRange(undefined, '2026-06-30');
    expect(to).toBe('2026-06-30');
    expect(from).toBe('2026-06-01');
  });

  it('rejects a malformed date with a 400', () => {
    expect(() => resolveDateOnlyRange('06-01-2026', '2026-06-10')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a syntactically-plausible but non-existent calendar date', () => {
    expect(() => resolveDateOnlyRange('2026-02-30', '2026-06-10')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects from > to', () => {
    expect(() => resolveDateOnlyRange('2026-06-20', '2026-06-10')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});
