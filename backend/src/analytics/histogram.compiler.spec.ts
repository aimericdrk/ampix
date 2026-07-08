import { compileHistogramQuery } from './histogram.compiler';
import type { HistogramQuery } from './histogram.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<HistogramQuery> = {}): HistogramQuery {
  return {
    event: '$session_end',
    property: '$duration_ms',
    bins: 20,
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    filters: [],
    ...overrides,
  };
}

describe('compileHistogramQuery (contracts §19)', () => {
  it('buckets the bound event/property/range with histogram(bins)(...) + the summary aggregates', () => {
    const { sql, params } = compileHistogramQuery(baseQuery(), PROJECT_ID);

    expect(sql).toContain('project_id = {projectId:UUID}');
    expect(sql).toContain('event = {event:String}');
    expect(sql).toContain('timestamp >= {from:DateTime64}');
    expect(sql).toContain('timestamp < {toExclusive:DateTime64}');
    // bins is OUR validated int (2..50) -> a safe literal, never a bound param.
    expect(sql).toContain('histogram(20)(value)');
    expect(sql).toContain('count() AS cnt');
    expect(sql).toContain('min(value) AS mn');
    expect(sql).toContain('max(value) AS mx');
    expect(sql).toContain('avg(value) AS avgVal');
    expect(sql).toContain('quantile(0.5)(value) AS p50');
    expect(sql).toContain('quantile(0.9)(value) AS p90');
    expect(sql).toContain('WHERE value IS NOT NULL AND isFinite(value)');

    expect(params.projectId).toBe(PROJECT_ID);
    expect(params.event).toBe('$session_end');
  });

  it('resolves a custom property via resolveProperty as a bound {histProp:String} key, cast to float', () => {
    const { sql, params } = compileHistogramQuery(
      baseQuery({ property: '$duration_ms' }),
      PROJECT_ID,
    );
    expect(sql).toContain(
      'toFloat64OrNull(JSONExtractString(toJSONString(properties), {histProp:String}))',
    );
    expect(params.histProp).toBe('$duration_ms');
  });

  it('resolves a whitelisted column property as the bare column identifier, cast to float', () => {
    const { sql, params } = compileHistogramQuery(baseQuery({ property: 'app_build' }), PROJECT_ID);
    expect(sql).toContain('toFloat64OrNull(app_build)');
    expect(params.histProp).toBeUndefined();
  });

  it('compiles §14 filters as bound params', () => {
    const { sql, params } = compileHistogramQuery(
      baseQuery({ filters: [{ property: 'plan', op: 'eq', value: 'pro' }] }),
      PROJECT_ID,
    );
    expect(sql).toContain('{filterKey0:String}');
    expect(sql).toContain('{filterVal0:String}');
    expect(params.filterVal0).toBe('pro');
  });

  it('respects a custom bins value as a literal', () => {
    const { sql } = compileHistogramQuery(baseQuery({ bins: 2 }), PROJECT_ID);
    expect(sql).toContain('histogram(2)(value)');
  });

  describe('INJECTION', () => {
    it('a malicious event / property / filter value is bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileHistogramQuery(
        baseQuery({
          event: attack,
          property: attack,
          filters: [{ property: 'os', op: 'eq', value: attack }],
        }),
        PROJECT_ID,
      );
      expect(params.event).toBe(attack);
      expect(params.histProp).toBe(attack);
      expect(params.filterVal0).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});
