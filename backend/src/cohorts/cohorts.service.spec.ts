import type { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import type { PrismaService } from '../prisma/prisma.service';
import { CohortsService } from './cohorts.service';

const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';
const OTHER_PROJECT = '018f6b2e-0000-7000-8000-0000000000ff';
const COHORT_ID = '018f6b2e-0000-7000-8000-0000000000c1';
const USER = 'user-1';

const DEFINITION = {
  match: 'all',
  conditions: [{ type: 'behavior', event: 'checkout', op: 'gte', count: 1, within_days: 30 }],
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: COHORT_ID,
    projectId: PROJECT,
    name: 'Power users',
    definition: DEFINITION,
    createdBy: USER,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  };
}

function make(queryImpl?: (sql: string) => unknown[]) {
  const cohort = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { cohort } as unknown as PrismaService;
  const query = jest.fn(async (sql: string) => (queryImpl ? queryImpl(sql) : []));
  const clickhouse = { query } as unknown as ClickHouseService;
  return { service: new CohortsService(prisma, clickhouse), cohort, query };
}

describe('CohortsService (contracts §16)', () => {
  it('create persists the project-scoped cohort and returns its detail incl. definition', async () => {
    const { service, cohort } = make();
    cohort.create.mockResolvedValue(row());

    const result = await service.create(PROJECT, USER, { name: 'Power users', definition: DEFINITION as never });

    expect(cohort.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT, name: 'Power users', definition: DEFINITION, createdBy: USER },
    });
    expect(result).toMatchObject({ id: COHORT_ID, name: 'Power users', created_by: USER });
    expect(result.definition).toEqual(DEFINITION);
  });

  it('get 404s a cohort that belongs to a different project (tenant isolation)', async () => {
    const { service, cohort } = make();
    cohort.findUnique.mockResolvedValue(row({ projectId: OTHER_PROJECT }));

    await expect(service.get(PROJECT, COHORT_ID)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('get 404s a malformed (non-uuid) id without hitting the database', async () => {
    const { service, cohort } = make();
    await expect(service.get(PROJECT, 'not-a-uuid')).rejects.toBeInstanceOf(ProblemException);
    expect(cohort.findUnique).not.toHaveBeenCalled();
  });

  it('preview returns the uniqExact count and an id sample (<=20)', async () => {
    const { service, cohort, query } = make((sql) =>
      sql.includes('uniqExact') ? [{ count: 2 }] : [{ distinct_id: 'a' }, { distinct_id: 'b' }],
    );
    cohort.findUnique.mockResolvedValue(row());

    const preview = await service.preview(PROJECT, COHORT_ID);

    expect(preview).toEqual({ count: 2, sample: ['a', 'b'] });
    // count query uses uniqExact over the cohort subquery.
    expect(query.mock.calls.some(([sql]) => (sql as string).includes('uniqExact(distinct_id)'))).toBe(
      true,
    );
  });

  it('resolveCohortPredicate re-validates the stored definition and compiles a bound subquery', async () => {
    const { service, cohort } = make();
    cohort.findUnique.mockResolvedValue(row());

    const predicate = await service.resolveCohortPredicate(PROJECT, COHORT_ID);

    expect(predicate.sql).toContain('SELECT distinct_id');
    expect(predicate.params.cohortProjectId).toBe(PROJECT);
  });

  it('resolveCohortPredicate rejects a corrupted stored definition with a 400 (never trust stored JSON)', async () => {
    const { service, cohort } = make();
    cohort.findUnique.mockResolvedValue(row({ definition: { match: 'nonsense', conditions: [] } }));

    await expect(service.resolveCohortPredicate(PROJECT, COHORT_ID)).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });
});
