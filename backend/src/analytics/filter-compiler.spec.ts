import { compileDateRange, compileFilterClauses } from './filter-compiler';
import type { InsightsFilter } from './insights-query.schema';

describe('compileFilterClauses (shared, contracts §14/§15)', () => {
  it('defaults indexOffset to 0 (Phase-3 behavior: filterKey0/filterVal0)', () => {
    const params: Record<string, unknown> = {};
    const clauses = compileFilterClauses([{ property: 'plan', op: 'eq', value: 'pro' }], params);
    expect(clauses[0]).toBe(
      'JSONExtractString(toJSONString(properties), {filterKey0:String}) = {filterVal0:String}',
    );
    expect(params).toEqual({ filterKey0: 'plan', filterVal0: 'pro' });
  });

  it('offsets param names so two filter groups in one SQL string never collide', () => {
    const params: Record<string, unknown> = {};
    const groupA: InsightsFilter[] = [{ property: 'os', op: 'eq', value: 'ios' }];
    const groupB: InsightsFilter[] = [
      { property: 'plan', op: 'eq', value: 'pro' },
      { property: 'country', op: 'neq', value: 'US' },
    ];
    compileFilterClauses(groupA, params, 0);
    compileFilterClauses(groupB, params, groupA.length);

    // Group A -> index 0; group B -> indexes 1,2. All param names are globally unique.
    expect(Object.keys(params).sort()).toEqual([
      'filterKey1',
      'filterKey2',
      'filterVal0',
      'filterVal1',
      'filterVal2',
    ]);
    expect(params.filterVal0).toBe('ios');
    expect(params.filterKey1).toBe('plan');
    expect(params.filterVal1).toBe('pro');
    expect(params.filterKey2).toBe('country');
    expect(params.filterVal2).toBe('US');
  });

  it('INJECTION: a malicious property/value across offset groups is only ever bound, never inlined', () => {
    const params: Record<string, unknown> = {};
    const attack = "'; DROP TABLE events; --";
    const clauses = compileFilterClauses([{ property: attack, op: 'eq', value: attack }], params, 5);
    expect(params.filterKey5).toBe(attack);
    expect(params.filterVal5).toBe(attack);
    expect(clauses[0]).not.toContain(attack);
    expect(clauses[0]).not.toContain('DROP TABLE');
  });
});

describe('compileDateRange', () => {
  it('binds inclusive `from` and exclusive `to + 1 day`', () => {
    expect(compileDateRange('2026-06-01', '2026-06-02')).toEqual({
      from: '2026-06-01 00:00:00.000',
      toExclusive: '2026-06-03 00:00:00.000',
    });
  });
});
