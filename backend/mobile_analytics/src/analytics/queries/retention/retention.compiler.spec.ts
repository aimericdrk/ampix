import { compileRetentionQuery } from './retention.compiler';
import type { RetentionQuery } from './retention.schema';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';

function baseQuery(overrides: Partial<RetentionQuery> = {}): RetentionQuery {
  return {
    born_event: { name: 'signup_completed', filters: [] },
    date_range: { from: '2026-06-01', to: '2026-07-01' },
    interval: 'day',
    periods: 14,
    ...overrides,
  };
}

describe('compileRetentionQuery (contracts §15)', () => {
  it('sizes query: born cohort sizes with uniqExact, scoped + bound', () => {
    const { sizesQuery } = compileRetentionQuery(baseQuery(), PROJECT_ID);
    expect(sizesQuery.sql).toContain('uniqExact(b.distinct_id) AS size');
    expect(sizesQuery.sql).toContain('min(toStartOfDay(timestamp)) AS cohort');
    expect(sizesQuery.sql).toContain('event = {bornEvent:String}');
    expect(sizesQuery.params.bornEvent).toBe('signup_completed');
    expect(sizesQuery.params.projectId).toBe(PROJECT_ID);
    expect(sizesQuery.params.from).toBe('2026-06-01 00:00:00.000');
    expect(sizesQuery.params.toExclusive).toBe('2026-07-02 00:00:00.000');
  });

  it('grid query: dateDiff period with uniqExact cell, HAVING within 1..periods', () => {
    const { gridQuery } = compileRetentionQuery(baseQuery(), PROJECT_ID);
    expect(gridQuery.sql).toContain("dateDiff('day', b.cohort, r.rbucket) AS period");
    expect(gridQuery.sql).toContain('uniqExact(r.distinct_id) AS cnt');
    expect(gridQuery.sql).toContain('HAVING period >= 1 AND period <= {periods:UInt16}');
    expect(gridQuery.params.periods).toBe(14);
  });

  it('interval keywords come from the frozen map (week -> toMonday / dateDiff week)', () => {
    const { sizesQuery, gridQuery } = compileRetentionQuery(baseQuery({ interval: 'week' }), PROJECT_ID);
    expect(sizesQuery.sql).toContain('min(toMonday(timestamp)) AS cohort');
    expect(gridQuery.sql).toContain("dateDiff('week', b.cohort, r.rbucket)");
    expect(gridQuery.sql).toContain('toMonday(timestamp) AS rbucket');
  });

  it('return_event defaults to born_event when omitted', () => {
    const { gridQuery } = compileRetentionQuery(baseQuery(), PROJECT_ID);
    expect(gridQuery.params.returnEvent).toBe('signup_completed');
  });

  it('a distinct return_event is bound separately from the born_event', () => {
    const { gridQuery } = compileRetentionQuery(
      baseQuery({ return_event: { name: 'app_open', filters: [] } }),
      PROJECT_ID,
    );
    expect(gridQuery.params.bornEvent).toBe('signup_completed');
    expect(gridQuery.params.returnEvent).toBe('app_open');
  });

  it('born + return filters share the grid SQL but get globally-unique param names (offset)', () => {
    const { gridQuery } = compileRetentionQuery(
      baseQuery({
        born_event: { name: 'signup_completed', filters: [{ property: 'os', op: 'eq', value: 'ios' }] },
        return_event: { name: 'app_open', filters: [{ property: 'plan', op: 'eq', value: 'pro' }] },
      }),
      PROJECT_ID,
    );
    // born filter -> index 0; return filter -> index 1 (offset = born-filter count).
    expect(gridQuery.params.filterVal0).toBe('ios');
    expect(gridQuery.params.filterKey1).toBe('plan');
    expect(gridQuery.params.filterVal1).toBe('pro');
  });

  describe('INJECTION', () => {
    it('a malicious born/return event name and filter value are bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { gridQuery } = compileRetentionQuery(
        baseQuery({
          born_event: { name: attack, filters: [{ property: 'plan', op: 'eq', value: attack }] },
          return_event: { name: attack, filters: [] },
        }),
        PROJECT_ID,
      );
      expect(gridQuery.params.bornEvent).toBe(attack);
      expect(gridQuery.params.filterVal0).toBe(attack);
      expect(gridQuery.sql).not.toContain(attack);
      expect(gridQuery.sql).not.toContain('DROP TABLE');
    });
  });

  it('counts DEVICE events on both sides — a backend write is not a user coming back', () => {
    const { sizesQuery, gridQuery } = compileRetentionQuery(baseQuery(), PROJECT_ID);
    // Retention claims a person returned to the app. A backend writing about them in week 3 is not
    // them returning, and counting it reported retention for people who never opened the app again.
    for (const sql of [sizesQuery.sql, gridQuery.sql]) {
      expect(sql).toContain("sdk_version = 'revenuecat-webhook'");
      expect(sql).toContain("= 'client'");
    }
    // The return side too, not just the cohort definition.
    expect(gridQuery.sql.match(/= 'client'/g) ?? []).toHaveLength(2);
  });
});
