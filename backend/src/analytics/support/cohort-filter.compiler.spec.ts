import type { CohortPredicate } from './filter-compiler';
import { compileFunnelQuery } from '../queries/funnels/funnels.compiler';
import { funnelsQuerySchema } from '../queries/funnels/funnels.schema';
import { compileInsightsQuery } from '../queries/insights/insights.compiler';
import { insightsQuerySchema } from '../queries/insights/insights-query.schema';
import { compileRetentionQuery } from '../queries/retention/retention.compiler';
import { retentionQuerySchema } from '../queries/retention/retention.schema';

/**
 * §16 cohort_id filter wiring: when a compiled cohort predicate is threaded into a §14/§15 compiler,
 * every scan gains an AND-joined `distinct_id IN (<cohort subquery>)` and merges the cohort's bound
 * params — narrowing the result to cohort members, fully parameterized.
 */

const PROJECT_ID = '018f6b2e-0000-7000-8000-0000000000a1';
const RANGE = { from: '2026-06-01', to: '2026-07-01' };

const COHORT: CohortPredicate = {
  sql: 'SELECT distinct_id\nFROM events\nWHERE project_id = {cohortProjectId:UUID}\n  AND event = {c0Event:String}\nGROUP BY distinct_id\nHAVING count(DISTINCT insert_id) >= {c0Count:UInt64}',
  params: { cohortProjectId: PROJECT_ID, c0Event: 'checkout_completed', c0Count: 1 },
};

describe('cohort_id filter integration (contracts §16)', () => {
  describe('insights', () => {
    const query = insightsQuerySchema.parse({
      events: [{ name: 'app_open', aggregation: 'unique_users' }],
      date_range: RANGE,
      interval: 'day',
    });

    it('AND-joins distinct_id IN (<cohort subquery>) into every series and merges cohort params', () => {
      const compiled = compileInsightsQuery(query, PROJECT_ID, COHORT);
      for (const series of compiled.seriesQueries) {
        expect(series.sql).toContain('distinct_id IN (');
        expect(series.sql).toContain('HAVING count(DISTINCT insert_id) >= {c0Count:UInt64}');
        expect(series.params.cohortProjectId).toBe(PROJECT_ID);
        expect(series.params.c0Event).toBe('checkout_completed');
        expect(series.params.c0Count).toBe(1);
      }
    });

    it('emits no cohort predicate when none is supplied', () => {
      const compiled = compileInsightsQuery(query, PROJECT_ID);
      for (const series of compiled.seriesQueries) {
        expect(series.sql).not.toContain('distinct_id IN (');
        expect(series.params).not.toHaveProperty('cohortProjectId');
      }
    });
  });

  it('funnels: injects the cohort predicate into the inner scan', () => {
    const query = funnelsQuerySchema.parse({
      steps: [{ event: 'app_open' }, { event: 'checkout_completed' }],
      date_range: RANGE,
      window_days: 7,
    });
    const compiled = compileFunnelQuery(query, PROJECT_ID, COHORT);
    expect(compiled.sql).toContain('distinct_id IN (');
    expect(compiled.params.cohortProjectId).toBe(PROJECT_ID);
    expect(compiled.params.c0Event).toBe('checkout_completed');
  });

  it('retention: injects the cohort predicate into the born subquery (both size + grid queries)', () => {
    const query = retentionQuerySchema.parse({
      born_event: { name: 'signup_completed' },
      return_event: { name: 'app_open' },
      date_range: RANGE,
      interval: 'day',
      periods: 7,
    });
    const compiled = compileRetentionQuery(query, PROJECT_ID, COHORT);
    expect(compiled.sizesQuery.sql).toContain('distinct_id IN (');
    expect(compiled.gridQuery.sql).toContain('distinct_id IN (');
    expect(compiled.sizesQuery.params.cohortProjectId).toBe(PROJECT_ID);
    expect(compiled.gridQuery.params.c0Event).toBe('checkout_completed');
  });
});
