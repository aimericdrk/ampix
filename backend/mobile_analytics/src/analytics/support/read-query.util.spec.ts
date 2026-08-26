import {
  clampLimit,
  clampPropertyValuesLimit,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseEventSourceParam,
  parseFiltersParam,
  parseIsoInstantParam,
  PROPERTY_VALUES_DEFAULT_LIMIT,
  PROPERTY_VALUES_MAX_LIMIT,
  resolveDateOnlyRange,
} from './read-query.util';

function encodeFilters(filters: unknown): string {
  return Buffer.from(JSON.stringify(filters)).toString('base64url');
}

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

describe('clampPropertyValuesLimit', () => {
  it('defaults to PROPERTY_VALUES_DEFAULT_LIMIT when absent', () => {
    expect(clampPropertyValuesLimit(undefined)).toBe(PROPERTY_VALUES_DEFAULT_LIMIT);
  });

  it('passes through an in-range value', () => {
    expect(clampPropertyValuesLimit('75')).toBe(75);
  });

  it('clamps a value above PROPERTY_VALUES_MAX_LIMIT down to the max', () => {
    expect(clampPropertyValuesLimit('1000')).toBe(PROPERTY_VALUES_MAX_LIMIT);
  });

  it('defaults on a zero or negative value rather than clamping to 1', () => {
    expect(clampPropertyValuesLimit('0')).toBe(PROPERTY_VALUES_DEFAULT_LIMIT);
    expect(clampPropertyValuesLimit('-5')).toBe(PROPERTY_VALUES_DEFAULT_LIMIT);
  });

  it('defaults on non-numeric garbage', () => {
    expect(clampPropertyValuesLimit('not-a-number')).toBe(PROPERTY_VALUES_DEFAULT_LIMIT);
  });

  it('floors a fractional value', () => {
    expect(clampPropertyValuesLimit('75.9')).toBe(75);
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

describe('parseFiltersParam (feat-02 §3.4/T2)', () => {
  it('returns [] when the param is absent', () => {
    expect(parseFiltersParam(undefined)).toEqual([]);
  });

  it('returns [] when the param is blank', () => {
    expect(parseFiltersParam('')).toEqual([]);
  });

  it('decodes a valid base64url-encoded filters array', () => {
    const filters = [
      { property: 'os', op: 'eq', value: 'ios' },
      { property: 'app_version', op: 'is_set' },
    ];
    expect(parseFiltersParam(encodeFilters(filters))).toEqual(filters);
  });

  it('rejects malformed base64url/JSON with a 400', () => {
    expect(() => parseFiltersParam('not-valid-base64url-json')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a schema violation (e.g. missing `property`) with a 400', () => {
    expect(() => parseFiltersParam(encodeFilters([{ op: 'eq', value: 'ios' }]))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects more than 20 filters with a 400', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      property: `p${i}`,
      op: 'eq' as const,
      value: 'v',
    }));
    expect(() => parseFiltersParam(encodeFilters(tooMany))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a non-array JSON value with a 400', () => {
    expect(() => parseFiltersParam(encodeFilters({ property: 'os', op: 'eq', value: 'ios' }))).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});

describe('parseEventSourceParam', () => {
  it('returns undefined when absent (no filter)', () => {
    expect(parseEventSourceParam(undefined)).toBeUndefined();
  });

  it.each(['client', 'server'] as const)('passes %s through', (value) => {
    expect(parseEventSourceParam(value)).toBe(value);
  });

  it('rejects any other value with a 400', () => {
    for (const bad of ['backend', '', 'CLIENT', 'sdk']) {
      expect(() => parseEventSourceParam(bad)).toThrow(
        expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
      );
    }
  });
});
