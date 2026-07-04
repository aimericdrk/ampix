import { compileFunnelQuery } from './funnels.compiler';
import type { FunnelsQuery } from './funnels.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<FunnelsQuery> = {}): FunnelsQuery {
  return {
    steps: [{ event: 'app_open', filters: [] }, { event: 'checkout_completed', filters: [] }],
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    window_days: 7,
    order: 'any',
    ...overrides,
  };
}

describe('compileFunnelQuery (contracts §15)', () => {
  it('scopes by project + date range and restricts to the step events, all bound', () => {
    const { sql, params } = compileFunnelQuery(baseQuery(), PROJECT_ID);
    expect(sql).toContain('project_id = {projectId:UUID}');
    expect(sql).toContain('timestamp >= {from:DateTime64}');
    expect(sql).toContain('timestamp < {toExclusive:DateTime64}');
    expect(sql).toContain('event IN {stepEvents:Array(String)}');
    expect(params.projectId).toBe(PROJECT_ID);
    expect(params.stepEvents).toEqual(['app_open', 'checkout_completed']);
  });

  it('uses windowFunnel over toDateTime(timestamp) with window_seconds = window_days*86400 bound as a param', () => {
    const { sql, params } = compileFunnelQuery(baseQuery({ window_days: 7 }), PROJECT_ID);
    expect(sql).toContain('windowFunnel({windowSeconds:UInt32})(');
    // windowFunnel's time argument is the event DateTime; toDateTime(timestamp) narrows the
    // DateTime64 column to second resolution so the window (bound in seconds) is in the same unit.
    expect(sql).toContain('toDateTime(timestamp)');
    expect(params.windowSeconds).toBe(7 * 86_400);
    expect(sql).toContain('GROUP BY distinct_id');
  });

  it('emits countIf(level >= k+1) per step and groups per user', () => {
    const { sql } = compileFunnelQuery(
      baseQuery({ steps: [{ event: 'a', filters: [] }, { event: 'b', filters: [] }, { event: 'c', filters: [] }] }),
      PROJECT_ID,
    );
    expect(sql).toContain('countIf(level >= 1) AS step_0');
    expect(sql).toContain('countIf(level >= 2) AS step_1');
    expect(sql).toContain('countIf(level >= 3) AS step_2');
  });

  it('strict_order injects the mode from the frozen map, not from input', () => {
    const strict = compileFunnelQuery(baseQuery({ order: 'strict_order' }), PROJECT_ID);
    expect(strict.sql).toContain("windowFunnel({windowSeconds:UInt32}, 'strict_order')(");
    const any = compileFunnelQuery(baseQuery({ order: 'any' }), PROJECT_ID);
    expect(any.sql).toContain('windowFunnel({windowSeconds:UInt32})(');
    expect(any.sql).not.toContain('strict_order');
  });

  it('each step event name is bound as its own param, never inlined', () => {
    const { sql, params } = compileFunnelQuery(baseQuery(), PROJECT_ID);
    expect(sql).toContain('event = {step0Event:String}');
    expect(sql).toContain('event = {step1Event:String}');
    expect(params.step0Event).toBe('app_open');
    expect(params.step1Event).toBe('checkout_completed');
    expect(sql).not.toContain("'app_open'");
    expect(sql.includes('checkout_completed')).toBe(false);
  });

  it('per-step filters get globally-unique param names (offset threaded across steps)', () => {
    const { sql, params } = compileFunnelQuery(
      baseQuery({
        steps: [
          { event: 'a', filters: [{ property: 'os', op: 'eq', value: 'ios' }] },
          {
            event: 'b',
            filters: [
              { property: 'plan', op: 'eq', value: 'pro' },
              { property: 'country', op: 'neq', value: 'US' },
            ],
          },
        ],
      }),
      PROJECT_ID,
    );
    // step 0 filter -> index 0; step 1 filters -> indexes 1,2. No collisions.
    expect(params.filterVal0).toBe('ios');
    expect(params.filterKey1).toBe('plan');
    expect(params.filterVal1).toBe('pro');
    expect(params.filterKey2).toBe('country');
    expect(params.filterVal2).toBe('US');
    // The condition for step 0 is a parenthesized AND of the event match + its filter.
    expect(sql).toContain('(event = {step0Event:String} AND os = {filterVal0:String})');
  });

  it('breakdown groups the subquery by the breakdown expr and orders by step_0 desc', () => {
    const { sql, params, hasBreakdown } = compileFunnelQuery(
      baseQuery({ breakdown: { property: 'os' } }),
      PROJECT_ID,
    );
    expect(hasBreakdown).toBe(true);
    expect(sql).toContain('os AS breakdown_value');
    expect(sql).toContain('GROUP BY distinct_id, breakdown_value');
    expect(sql).toContain('GROUP BY breakdown_value');
    expect(sql).toContain('ORDER BY step_0 DESC');
    expect(params).not.toHaveProperty('breakdownKey'); // whitelisted column, no bound key needed
  });

  it('a custom breakdown property binds the key as a param, never inlined', () => {
    const { sql, params } = compileFunnelQuery(
      baseQuery({ breakdown: { property: 'campaign_id' } }),
      PROJECT_ID,
    );
    expect(sql).toContain(
      'JSONExtractString(toJSONString(properties), {breakdownKey:String}) AS breakdown_value',
    );
    expect(params.breakdownKey).toBe('campaign_id');
    expect(sql).not.toContain('campaign_id');
  });

  describe('INJECTION', () => {
    it('a malicious step event name is bound, never present as raw SQL text', () => {
      const attack = "evt'; DROP TABLE events; --";
      const { sql, params } = compileFunnelQuery(
        baseQuery({ steps: [{ event: attack, filters: [] }, { event: 'b', filters: [] }] }),
        PROJECT_ID,
      );
      expect(params.step0Event).toBe(attack);
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });

    it('a malicious filter value and Object.prototype property name are bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { sql, params } = compileFunnelQuery(
        baseQuery({
          steps: [
            { event: 'a', filters: [{ property: '__proto__', op: 'eq', value: attack }] },
            { event: 'b', filters: [] },
          ],
        }),
        PROJECT_ID,
      );
      // Object.prototype-inherited name resolves as a bound custom key (never a column).
      expect(params.filterKey0).toBe('__proto__');
      expect(params.filterVal0).toBe(attack);
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {filterKey0:String})');
      expect(sql).not.toContain(attack);
      expect(sql).not.toContain('DROP TABLE');
    });
  });
});
