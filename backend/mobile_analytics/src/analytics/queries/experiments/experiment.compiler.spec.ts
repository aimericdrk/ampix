import { compileExperimentQuery } from './experiment.compiler';
import { experimentQuerySchema, type ExperimentQuery } from './experiment.schema';

const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

function build(overrides: Partial<ExperimentQuery> = {}): ExperimentQuery {
  return experimentQuerySchema.parse({
    variant_property: 'experiment_variant',
    exposure_event: 'paywall_viewed',
    goal_event: 'subscription_started',
    date_range: { from: '2026-06-01', to: '2026-06-30' },
    conversion_window_days: 7,
    ...overrides,
  });
}

describe('compileExperimentQuery', () => {
  it('binds every event name as a query param, never as SQL text', () => {
    const { sql, params } = compileExperimentQuery(build(), PROJECT);
    expect(params.exposureEvent).toBe('paywall_viewed');
    expect(params.goalEvent).toBe('subscription_started');
    expect(sql).not.toContain('paywall_viewed');
    expect(sql).not.toContain('subscription_started');
  });

  it('binds a custom variant property as a key param rather than embedding it', () => {
    const { sql, params } = compileExperimentQuery(
      build({ variant_property: 'my_test_arm' }),
      PROJECT,
    );
    expect(params.variantKey).toBe('my_test_arm');
    expect(sql).not.toContain('my_test_arm');
    expect(sql).toContain('{variantKey:String}');
  });

  it('treats an injection attempt in the variant property as inert data', () => {
    const evil = "x'); DROP TABLE events; --";
    const { sql, params } = compileExperimentQuery(build({ variant_property: evil }), PROJECT);
    expect(params.variantKey).toBe(evil);
    expect(sql).not.toContain('DROP TABLE');
  });

  it('resolves a whitelisted column variant to the bare column identifier', () => {
    // `app_version` is on the §14 column whitelist, so it is OUR constant, not the caller's string.
    const { sql } = compileExperimentQuery(build({ variant_property: 'app_version' }), PROJECT);
    expect(sql).toContain('argMin(app_version, e.timestamp)');
  });

  it('attributes a user to their FIRST exposure, not their latest', () => {
    const { sql } = compileExperimentQuery(build(), PROJECT);
    // The variant is picked by argMin over the exposure timestamps. (The identity CTE's own
    // argMax(canonical_id, created_at) is unrelated — that one picks the LATEST alias link.)
    expect(sql).toContain('AS variant');
    expect(sql).toMatch(/argMin\([\s\S]*?, e\.timestamp\) AS variant/);
    expect(sql).toContain('min(e.timestamp) AS exposed_at');
  });

  it('drops participants carrying no variant assignment', () => {
    const { sql } = compileExperimentQuery(build(), PROJECT);
    expect(sql).toContain("HAVING variant != ''");
  });

  it('measures the conversion window per user, from their own exposure', () => {
    const { sql, params } = compileExperimentQuery(build({ conversion_window_days: 14 }), PROJECT);
    expect(params.conversionWindowDays).toBe(14);
    expect(sql).toContain('g.timestamp > x.exposed_at');
    expect(sql).toContain('x.exposed_at + toIntervalDay({conversionWindowDays:UInt16})');
  });

  it('extends the goal scan past the range end by the conversion window', () => {
    // Range ends 2026-06-30 (exclusive bound 2026-07-01) + a 7-day window = 2026-07-08.
    const { params } = compileExperimentQuery(build({ conversion_window_days: 7 }), PROJECT);
    expect(params.toExclusive).toContain('2026-07-01');
    expect(params.goalToExclusive).toContain('2026-07-08');
  });

  it('counts converters, not every participant, via the null-aware LEFT JOIN', () => {
    const { sql, settings } = compileExperimentQuery(build(), PROJECT);
    expect(sql).toContain('countIf(c.converted_at IS NOT NULL) AS converted');
    // Without join_use_nulls the unmatched cell is epoch-zero, not NULL, and every participant
    // would count as converted.
    expect(settings).toMatchObject({ join_use_nulls: 1 });
  });

  it('canonicalizes both scans so an anon→identified user is one participant', () => {
    const { sql } = compileExperimentQuery(build(), PROJECT);
    expect(sql).toContain('coalesce(aliases.canonical_id, e.distinct_id)');
    expect(sql).toContain('coalesce(aliases.canonical_id, g.distinct_id)');
  });

  it('offsets goal filter param names past the exposure ones so they cannot collide', () => {
    const { params } = compileExperimentQuery(
      build({
        exposure_filters: [{ property: 'os', op: 'eq', value: 'ios' }],
        goal_filters: [{ property: 'plan', op: 'eq', value: 'pro' }],
      }),
      PROJECT,
    );
    expect(params.filterVal0).toBe('ios');
    expect(params.filterVal1).toBe('pro');
  });

  it('reads a profile-target variant off user_profiles instead of the exposure event', () => {
    const { sql } = compileExperimentQuery(
      build({ variant_property: 'assigned_arm', variant_target: 'profile' }),
      PROJECT,
    );
    expect(sql).toContain('user_profiles FINAL');
    expect(sql).toContain('exposures_raw');
    expect(sql).not.toContain('argMin(JSONExtractString(toJSONString(properties)');
  });

  it('AND-joins a cohort predicate into the exposure scan only', () => {
    const cohort = {
      sql: 'SELECT distinct_id FROM events WHERE project_id = {cohortProjectId:UUID}',
      params: { cohortProjectId: PROJECT },
    };
    const { sql, params } = compileExperimentQuery(build(), PROJECT, cohort);
    expect(params.cohortProjectId).toBe(PROJECT);
    // Once, in `exposures` — the goal scan is already restricted by its INNER JOIN.
    expect(sql.split('distinct_id IN (').length - 1).toBe(1);
  });
});
