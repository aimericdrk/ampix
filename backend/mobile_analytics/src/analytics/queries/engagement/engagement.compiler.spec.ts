import { ENGAGEMENT_METRIC, compileEngagement } from './engagement.compiler';

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
const FROM = '2026-06-01';
const TO = '2026-06-30';

describe('compileEngagement (contracts §19)', () => {
  it('counts new vs returning by canonical uid, bucketed by the interval fn (day)', () => {
    const { newReturningQuery, settings } = compileEngagement(PROJECT_ID, FROM, TO, 'day');
    const sql = newReturningQuery.sql;

    // Canonicalization (§17): aliases CTE + coalesce uid + join_use_nulls.
    expect(sql).toContain('WITH aliases AS');
    expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id) AS uid');
    expect(settings).toEqual({ join_use_nulls: 1 });

    // per-user first-ever event decides new vs returning.
    expect(sql).toContain('per_user AS');
    expect(sql).toContain('min(e.timestamp) AS first_ts');
    expect(sql).toContain('uniqExactIf(uid, toStartOfDay(first_ts) = bucket_start) AS new_users');
    expect(sql).toContain('uniqExactIf(uid, toStartOfDay(first_ts) < bucket_start) AS returning_users');
    expect(sql).toContain('toStartOfDay(e.timestamp) AS bucket_start');

    // Everything caller-derived is a bound param.
    expect(newReturningQuery.params.projectId).toBe(PROJECT_ID);
    expect(sql).toContain('{projectId:UUID}');
    expect(sql).toContain('e.timestamp >= {from:DateTime64}');
    expect(sql).toContain('e.timestamp < {toExclusive:DateTime64}');
  });

  it('range MAU is uniqExact of the canonical uid over the whole window', () => {
    const { rangeActiveQuery } = compileEngagement(PROJECT_ID, FROM, TO, 'day');
    expect(rangeActiveQuery.sql).toContain('uniqExact(coalesce(aliases.canonical_id, e.distinct_id)) AS mau');
    expect(rangeActiveQuery.sql).toContain('e.timestamp >= {from:DateTime64}');
  });

  it('selects the bucket fn from the frozen map per interval', () => {
    expect(compileEngagement(PROJECT_ID, FROM, TO, 'week').newReturningQuery.sql).toContain('toMonday(');
    expect(compileEngagement(PROJECT_ID, FROM, TO, 'month').newReturningQuery.sql).toContain('toStartOfMonth(');
  });

  it('labels the active metric per interval', () => {
    expect(ENGAGEMENT_METRIC.day).toBe('dau');
    expect(ENGAGEMENT_METRIC.week).toBe('wau');
    expect(ENGAGEMENT_METRIC.month).toBe('mau');
  });

  // feat-02 §3.4/T2: optional global filters AND-join onto both queries, bound (shared filter-compiler).
  describe('optional filters (feat-02 §3.4/T2)', () => {
    it('compiles a filter into both the active AND range-MAU queries, sharing one bound param object', () => {
      const { newReturningQuery, rangeActiveQuery } = compileEngagement(PROJECT_ID, FROM, TO, 'day', [
        { property: 'os', op: 'eq', value: 'ios' },
      ]);

      expect(newReturningQuery.sql).toContain('AND os = {filterVal0:String}');
      expect(rangeActiveQuery.sql).toContain('AND os = {filterVal0:String}');
      // Both queries reference the SAME params object (existing compiler precedent).
      expect(newReturningQuery.params).toBe(rangeActiveQuery.params);
      expect(newReturningQuery.params).toMatchObject({ filterVal0: 'ios' });
    });

    it('an absent/empty filters list leaves the queries unchanged (no filter clause/param)', () => {
      const { newReturningQuery, rangeActiveQuery } = compileEngagement(PROJECT_ID, FROM, TO, 'day');
      expect(newReturningQuery.sql).not.toContain('filterVal0');
      expect(rangeActiveQuery.sql).not.toContain('filterVal0');
      expect(newReturningQuery.params).not.toHaveProperty('filterVal0');
    });

    it('INJECTION: a malicious property/value is only ever bound, never inlined', () => {
      const attack = "'; DROP TABLE events; --";
      const { newReturningQuery, rangeActiveQuery } = compileEngagement(PROJECT_ID, FROM, TO, 'day', [
        { property: attack, op: 'eq', value: attack },
      ]);

      for (const sql of [newReturningQuery.sql, rangeActiveQuery.sql]) {
        expect(sql).not.toContain(attack);
        expect(sql).not.toContain('DROP TABLE');
      }
      expect(newReturningQuery.params.filterKey0).toBe(attack);
      expect(newReturningQuery.params.filterVal0).toBe(attack);
    });
  });

  it('counts DEVICE events only — a backend write cannot make someone active', () => {
    const { newReturningQuery, rangeActiveQuery } = compileEngagement(
      PROJECT_ID,
      '2026-06-01',
      '2026-06-30',
      'day',
    );
    // Measured on a real project: 15,484 "daily active users" against 3 devices, because a backend
    // emitting one event per recipient marked every recipient active.
    expect(rangeActiveQuery.sql).toContain("= 'client'");
    // Both the in-bucket activity scan AND the all-time first-seen scan: otherwise a user's "new"
    // bucket would be the day a backend first mentioned them, not the day their device appeared.
    expect(newReturningQuery.sql.match(/= 'client'/g) ?? []).toHaveLength(2);
  });
});
