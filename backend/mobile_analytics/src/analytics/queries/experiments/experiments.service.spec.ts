import type { ClickHouseService } from '../../../clickhouse/clickhouse.service';
import type { CohortsService } from '../../../cohorts/cohorts.service';
import type { ProjectsService } from '../../../projects/core/projects.service';
import { ExperimentsService } from './experiments.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

const BASE_QUERY = {
  variant_property: 'experiment_variant',
  exposure_event: 'paywall_viewed',
  goal_event: 'subscription_started',
  date_range: { from: '2026-06-01', to: '2026-06-30' },
  conversion_window_days: 7,
};

function make(rows: Array<{ variant: string; exposed: number; converted: number }>) {
  const clickhouse = { query: jest.fn().mockResolvedValue(rows) };
  const projects = { assertMembership: jest.fn().mockResolvedValue(undefined) };
  const cohorts = { resolveCohortPredicate: jest.fn() };
  const service = new ExperimentsService(
    clickhouse as unknown as ClickHouseService,
    projects as unknown as ProjectsService,
    cohorts as unknown as CohortsService,
  );
  return { service, clickhouse, projects, cohorts };
}

describe('ExperimentsService', () => {
  it('asserts project membership before querying', async () => {
    const { service, projects } = make([]);
    await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    expect(projects.assertMembership).toHaveBeenCalledWith(USER, PROJECT);
  });

  it('rejects a malformed definition with a 400 instead of reaching ClickHouse', async () => {
    const { service, clickhouse } = make([]);
    await expect(
      service.runExperimentQuery(USER, PROJECT, { ...BASE_QUERY, exposure_event: '' }),
    ).rejects.toMatchObject({ problem: { status: 400 } });
    expect(clickhouse.query).not.toHaveBeenCalled();
  });

  it('computes per-variant rates and compares each arm against the control', async () => {
    const { service } = make([
      { variant: 'control', exposed: 2000, converted: 200 },
      { variant: 'treatment', exposed: 2000, converted: 300 },
    ]);
    const result = await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);

    expect(result.total_exposed).toBe(4000);
    expect(result.total_converted).toBe(500);
    expect(result.control_variant).toBe('control');
    expect(result.has_enough_data).toBe(true);

    const [control, treatment] = result.variants;
    expect(control.is_control).toBe(true);
    // The control has nothing to be compared against — null, not a self-comparison of zeroes.
    expect(control.comparison).toBeNull();
    expect(control.conversion_rate).toBeCloseTo(0.1, 10);

    expect(treatment.is_control).toBe(false);
    expect(treatment.conversion_rate).toBeCloseTo(0.15, 10);
    expect(treatment.comparison!.relative_uplift).toBeCloseTo(0.5, 10);
    expect(treatment.comparison!.significant).toBe(true);
  });

  it('uses the largest arm as the control when none is named', async () => {
    // Rows arrive ordered by exposure DESC (the compiled query's ORDER BY).
    const { service } = make([
      { variant: 'b', exposed: 900, converted: 90 },
      { variant: 'a', exposed: 100, converted: 10 },
    ]);
    const result = await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    expect(result.control_variant).toBe('b');
  });

  it('honours an explicitly named control', async () => {
    const { service } = make([
      { variant: 'b', exposed: 900, converted: 90 },
      { variant: 'a', exposed: 100, converted: 10 },
    ]);
    const result = await service.runExperimentQuery(USER, PROJECT, {
      ...BASE_QUERY,
      control_variant: 'a',
    });
    expect(result.control_variant).toBe('a');
    expect(result.variants.find((v) => v.variant === 'a')!.is_control).toBe(true);
    expect(result.variants.find((v) => v.variant === 'b')!.comparison).not.toBeNull();
  });

  it('falls back to the largest arm when the named control has no participants', async () => {
    const { service } = make([{ variant: 'b', exposed: 900, converted: 90 }]);
    const result = await service.runExperimentQuery(USER, PROJECT, {
      ...BASE_QUERY,
      control_variant: 'never-shipped',
    });
    // Comparing every arm against an arm that does not exist would report the whole test as
    // "cannot tell"; falling back keeps the readout meaningful.
    expect(result.control_variant).toBe('b');
  });

  it('flags an underpowered arm without withholding its numbers', async () => {
    const { service } = make([
      { variant: 'control', exposed: 500, converted: 50 },
      { variant: 'treatment', exposed: 12, converted: 4 },
    ]);
    const result = await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    const treatment = result.variants.find((v) => v.variant === 'treatment')!;
    expect(treatment.underpowered).toBe(true);
    expect(treatment.conversion_rate).toBeCloseTo(4 / 12, 10);
    expect(result.has_enough_data).toBe(false);
  });

  it('reports an experiment with no participants as empty, not as a passing test', async () => {
    const { service } = make([]);
    const result = await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    expect(result.control_variant).toBeNull();
    expect(result.variants).toEqual([]);
    expect(result.total_exposed).toBe(0);
    // Vacuous truth would render as "decision-grade" in the UI.
    expect(result.has_enough_data).toBe(false);
  });

  it('resolves a cohort predicate only when a cohort_id is given', async () => {
    const { service, cohorts } = make([]);
    await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    expect(cohorts.resolveCohortPredicate).not.toHaveBeenCalled();

    cohorts.resolveCohortPredicate.mockResolvedValue({ sql: 'SELECT 1', params: {} });
    await service.runExperimentQuery(USER, PROJECT, {
      ...BASE_QUERY,
      cohort_id: '018f6b2e-0000-7000-8000-0000000000ff',
    });
    expect(cohorts.resolveCohortPredicate).toHaveBeenCalledWith(
      PROJECT,
      '018f6b2e-0000-7000-8000-0000000000ff',
    );
  });

  it('coerces ClickHouse string counts to numbers', async () => {
    const { service, clickhouse } = make([]);
    clickhouse.query.mockResolvedValue([{ variant: 'a', exposed: '250', converted: '25' }]);
    const result = await service.runExperimentQuery(USER, PROJECT, BASE_QUERY);
    expect(result.variants[0].exposed).toBe(250);
    expect(result.variants[0].converted).toBe(25);
    expect(result.total_exposed).toBe(250);
  });
});
