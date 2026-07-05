import { compileInsightsQuery, MAX_BREAKDOWN_VALUES } from './insights.compiler';
import type { InsightsQuery } from './insights-query.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<InsightsQuery> = {}): InsightsQuery {
  return {
    events: [{ name: 'checkout_completed', aggregation: 'total' }],
    date_range: { from: '2026-06-01', to: '2026-06-02' },
    interval: 'day',
    filters: [],
    ...overrides,
  };
}

describe('compileInsightsQuery', () => {
  describe('project scoping + date range', () => {
    it('always scopes by project_id as a bound UUID param', () => {
      const compiled = compileInsightsQuery(baseQuery(), PROJECT_ID);
      const [series] = compiled.seriesQueries;
      expect(series.sql).toContain('project_id = {projectId:UUID}');
      expect(series.params.projectId).toBe(PROJECT_ID);
    });

    it('binds the inclusive date range as `from` and an exclusive `to + 1 day`', () => {
      const compiled = compileInsightsQuery(baseQuery(), PROJECT_ID);
      const [series] = compiled.seriesQueries;
      expect(series.sql).toContain('timestamp >= {from:DateTime64}');
      expect(series.sql).toContain('timestamp < {toExclusive:DateTime64}');
      expect(series.params.from).toBe('2026-06-01 00:00:00.000');
      expect(series.params.toExclusive).toBe('2026-06-03 00:00:00.000'); // to (06-02) + 1 day
    });

    it('produces a zero-fill bucket grid matching the date range and interval', () => {
      const compiled = compileInsightsQuery(baseQuery(), PROJECT_ID);
      expect(compiled.buckets.map((b) => b.t)).toEqual(['2026-06-01', '2026-06-02']);
    });
  });

  describe('aggregations', () => {
    it('total -> count(DISTINCT insert_id)', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ events: [{ name: 'checkout_completed', aggregation: 'total' }] }),
        PROJECT_ID,
      );
      expect(compiled.seriesQueries[0].sql).toContain('count(DISTINCT insert_id) AS value');
    });

    it('unique_users -> uniqExact of the CANONICAL id (contracts §17), not the raw distinct_id', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ events: [{ name: 'checkout_completed', aggregation: 'unique_users' }] }),
        PROJECT_ID,
      );
      const { sql, settings } = compiled.seriesQueries[0];
      // Canonicalizes via the aliases CTE + LEFT JOIN, aggregating uniqExact(uid).
      expect(sql).toContain('WITH aliases AS (');
      expect(sql).toContain('FROM identity_mappings');
      expect(sql).toContain('LEFT JOIN aliases ON ev.distinct_id = aliases.anon_id');
      expect(sql).toContain('uniqExact(coalesce(aliases.canonical_id, ev.distinct_id)) AS value');
      // Raw, un-canonicalized `uniqExact(distinct_id)` must NOT be what we count.
      expect(sql).not.toContain('uniqExact(distinct_id)');
      // The canonicalizing LEFT JOIN's coalesce is only correct under join_use_nulls=1.
      expect(settings).toEqual({ join_use_nulls: 1 });
      // The inner scan still binds the event name + project as params (never interpolated).
      expect(sql).toContain('event = {eventName:String}');
      expect(sql).toContain('project_id = {projectId:UUID}');
    });

    it('total carries no query settings (single-level scan, default behavior)', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ events: [{ name: 'checkout_completed', aggregation: 'total' }] }),
        PROJECT_ID,
      );
      expect(compiled.seriesQueries[0].settings).toBeUndefined();
      expect(compiled.seriesQueries[0].sql).not.toContain('aliases');
    });
  });

  describe('interval bucketing', () => {
    it.each([
      ['hour', 'toStartOfHour(timestamp)'],
      ['day', 'toStartOfDay(timestamp)'],
      ['week', 'toMonday(timestamp)'],
      ['month', 'toStartOfMonth(timestamp)'],
    ] as const)('interval "%s" buckets via %s', (interval, expr) => {
      const compiled = compileInsightsQuery(baseQuery({ interval }), PROJECT_ID);
      expect(compiled.seriesQueries[0].sql).toContain(`toUnixTimestamp(${expr}) AS bucket_ts`);
    });
  });

  describe('multi-event queries', () => {
    it('compiles one series query per event, each independently scoped and bound', () => {
      const compiled = compileInsightsQuery(
        baseQuery({
          events: [
            { name: 'checkout_completed', aggregation: 'total' },
            { name: 'product_viewed', aggregation: 'unique_users' },
            { name: 'app_open', aggregation: 'total' },
            { name: 'screen_view', aggregation: 'total' },
            { name: 'signup', aggregation: 'unique_users' },
          ],
        }),
        PROJECT_ID,
      );

      expect(compiled.seriesQueries).toHaveLength(5);
      expect(compiled.seriesQueries.map((q) => q.eventName)).toEqual([
        'checkout_completed',
        'product_viewed',
        'app_open',
        'screen_view',
        'signup',
      ]);
      for (const q of compiled.seriesQueries) {
        expect(q.params.eventName).toBe(q.eventName);
        expect(q.sql).toContain('event = {eventName:String}');
      }
      // Aggregation differs per event and must be reflected independently.
      expect(compiled.seriesQueries[1].sql).toContain(
        'uniqExact(coalesce(aliases.canonical_id, ev.distinct_id))',
      );
      expect(compiled.seriesQueries[0].sql).toContain('count(DISTINCT insert_id)');
    });
  });

  describe('property resolution: whitelist column vs custom property', () => {
    it('a whitelisted filter property (e.g. "os") compiles to the bare column, no extra key param', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'os', op: 'eq', value: 'ios' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('os = {filterVal0:String}');
      expect(params.filterVal0).toBe('ios');
      expect(Object.keys(params)).not.toContain('filterKey0');
    });

    it('a custom (non-whitelisted) filter property is bound as a param key, never inlined', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'plan', op: 'eq', value: 'pro' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('JSONExtractString(toJSONString(properties), {filterKey0:String})');
      expect(params.filterKey0).toBe('plan');
      expect(params.filterVal0).toBe('pro');
      // The raw custom property NAME must never appear as literal SQL text.
      expect(sql).not.toContain("'plan'");
      expect(sql.includes('plan')).toBe(false);
    });
  });

  describe('filter operators', () => {
    it('eq binds value by (String) type', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'plan', op: 'eq', value: 'pro' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('= {filterVal0:String}');
      expect(params.filterVal0).toBe('pro');
    });

    it('neq binds value and uses !=', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'os', op: 'neq', value: 'ios' }] }),
        PROJECT_ID,
      );
      expect(compiled.seriesQueries[0].sql).toContain('os != {filterVal0:String}');
    });

    it('contains uses position(...) > 0 with the value bound as String', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'utm_campaign', op: 'contains', value: 'summer' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('position(utm_campaign, {filterVal0:String}) > 0');
      expect(params.filterVal0).toBe('summer');
    });

    it('gt on a numeric value binds as Float64 and casts the expr', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'value', op: 'gt', value: 9.99 }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain(
        'toFloat64OrZero(JSONExtractString(toJSONString(properties), {filterKey0:String})) > {filterVal0:Float64}',
      );
      expect(params.filterVal0).toBe(9.99);
    });

    it('lt on a numeric whitelisted column casts + binds Float64', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'os', op: 'lt', value: 5 }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('toFloat64OrZero(os) < {filterVal0:Float64}');
      expect(params.filterVal0).toBe(5);
    });

    it('eq with a boolean value binds as UInt8 (0/1) and casts the expr', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'is_pro', op: 'eq', value: true }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain('toUInt8OrZero(');
      expect(sql).toContain('{filterVal0:UInt8}');
      expect(params.filterVal0).toBe(1);
    });

    it('is_set compiles to a non-empty-string check with no value param', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'plan', op: 'is_set' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toContain(
        "JSONExtractString(toJSONString(properties), {filterKey0:String}) != ''",
      );
      expect(params.filterVal0).toBeUndefined();
    });

    it('is_not_set compiles to an empty-string check', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'plan', op: 'is_not_set' }] }),
        PROJECT_ID,
      );
      expect(compiled.seriesQueries[0].sql).toContain(
        "JSONExtractString(toJSONString(properties), {filterKey0:String}) = ''",
      );
    });

    it('multiple filters are AND-joined and each gets its own uniquely-indexed params', () => {
      const compiled = compileInsightsQuery(
        baseQuery({
          filters: [
            { property: 'os', op: 'eq', value: 'ios' },
            { property: 'plan', op: 'neq', value: 'free' },
          ],
        }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(sql).toMatch(/AND os = \{filterVal0:String\}/);
      expect(sql).toMatch(/AND JSONExtractString.*!= \{filterVal1:String\}/);
      expect(params).toMatchObject({ filterVal0: 'ios', filterKey1: 'plan', filterVal1: 'free' });
    });
  });

  describe('breakdown', () => {
    it('breakdown by a whitelisted column produces a top-values query grouping by that column', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ breakdown: { property: 'os' } }),
        PROJECT_ID,
      );
      expect(compiled.hasBreakdown).toBe(true);
      expect(compiled.topBreakdownValuesQuery).toBeDefined();
      const top = compiled.topBreakdownValuesQuery!;
      expect(top.sql).toContain('os AS breakdown_value');
      expect(top.sql).toContain(`LIMIT ${MAX_BREAKDOWN_VALUES}`);
      expect(top.sql).toContain('ORDER BY total DESC');
      expect(top.params.eventNames).toEqual(['checkout_completed']);

      const series = compiled.seriesQueries[0];
      expect(series.sql).toContain('os AS breakdown_value');
      expect(series.sql).toContain('os IN {breakdownValues:Array(String)}');
      expect(series.sql).toContain('GROUP BY bucket_ts, breakdown_value');
    });

    it('breakdown by a custom property binds the key as a param, never inlined', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ breakdown: { property: 'utm_source_custom' } }),
        PROJECT_ID,
      );
      const top = compiled.topBreakdownValuesQuery!;
      expect(top.sql).toContain(
        'JSONExtractString(toJSONString(properties), {breakdownKey:String}) AS breakdown_value',
      );
      expect(top.params.breakdownKey).toBe('utm_source_custom');
      expect(top.sql).not.toContain('utm_source_custom');

      const series = compiled.seriesQueries[0];
      expect(series.sql).toContain('IN {breakdownValues:Array(String)}');
      expect(series.params.breakdownKey).toBe('utm_source_custom');
    });

    it('no breakdown -> no topBreakdownValuesQuery and no breakdown_value column', () => {
      const compiled = compileInsightsQuery(baseQuery(), PROJECT_ID);
      expect(compiled.hasBreakdown).toBe(false);
      expect(compiled.topBreakdownValuesQuery).toBeUndefined();
      expect(compiled.seriesQueries[0].sql).not.toContain('breakdown_value');
    });
  });

  describe('INJECTION', () => {
    const ATTACK = "'; DROP TABLE events; --";

    it('a malicious filter VALUE is bound as a param, never present as raw SQL text', () => {
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'os', op: 'eq', value: ATTACK }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(params.filterVal0).toBe(ATTACK);
      expect(sql).not.toContain(ATTACK);
      expect(sql).not.toContain('DROP TABLE');
    });

    it('a malicious custom-property KEY is bound as a param, never present as raw SQL text', () => {
      const maliciousKey = 'prop`); DROP TABLE events; --';
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: maliciousKey, op: 'eq', value: 'x' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(params.filterKey0).toBe(maliciousKey);
      expect(sql).not.toContain(maliciousKey);
      expect(sql).not.toContain('DROP TABLE');
    });

    it('a malicious breakdown property is bound as a param, never present as raw SQL text', () => {
      const maliciousKey = '{evil:String}; --';
      const compiled = compileInsightsQuery(
        baseQuery({ breakdown: { property: maliciousKey } }),
        PROJECT_ID,
      );
      const top = compiled.topBreakdownValuesQuery!;
      expect(top.params.breakdownKey).toBe(maliciousKey);
      expect(top.sql).not.toContain(maliciousKey);
      expect(compiled.seriesQueries[0].sql).not.toContain(maliciousKey);
    });

    it('a malicious event NAME is always bound (event names are never whitelist-checked/inlined)', () => {
      const maliciousEvent = "evt'; DROP TABLE events; --";
      const compiled = compileInsightsQuery(
        baseQuery({ events: [{ name: maliciousEvent, aggregation: 'total' }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(params.eventName).toBe(maliciousEvent);
      expect(sql).not.toContain(maliciousEvent);
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).toContain('event = {eventName:String}');
    });

    it('a malicious value containing braces (param-syntax lookalike) is still just bound data', () => {
      const attack = '{projectId:UUID} OR 1=1';
      const compiled = compileInsightsQuery(
        baseQuery({ filters: [{ property: 'os', op: 'contains', value: attack }] }),
        PROJECT_ID,
      );
      const { sql, params } = compiled.seriesQueries[0];
      expect(params.filterVal0).toBe(attack);
      expect(sql).not.toContain(attack);
    });
  });
});
