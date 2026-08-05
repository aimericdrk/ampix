import type { PrismaService } from '../prisma/prisma.service';
import type { AnalysisRunnerService } from './analysis-runner.service';
import { ReportsService } from './reports.service';

const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';
const OTHER_PROJECT = '018f6b2e-0000-7000-8000-0000000000ff';
const REPORT_ID = '018f6b2e-0000-7000-8000-0000000000d1';
const USER = 'user-1';

const insightsDef = {
  events: [{ name: 'checkout_completed', aggregation: 'total' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  interval: 'day',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    projectId: PROJECT,
    name: 'Weekly checkout',
    kind: 'insights',
    definition: insightsDef,
    createdBy: USER,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  };
}

function make() {
  const savedReport = {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { savedReport } as unknown as PrismaService;
  const run = jest.fn().mockResolvedValue({ series: [] });
  const runner = { run } as unknown as AnalysisRunnerService;
  return { service: new ReportsService(prisma, runner), savedReport, run };
}

describe('ReportsService (contracts §16)', () => {
  it('create validates the definition by kind then persists it', async () => {
    const { service, savedReport } = make();
    savedReport.create.mockResolvedValue(row());

    await service.create(PROJECT, USER, {
      name: 'Weekly checkout',
      kind: 'insights',
      definition: insightsDef,
    });

    expect(savedReport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: PROJECT, kind: 'insights', createdBy: USER }),
    });
  });

  it('create rejects a definition that does not match its kind (400)', async () => {
    const { service, savedReport } = make();
    const funnelDef = {
      steps: [{ event: 'a' }, { event: 'b' }],
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      window_days: 7,
    };

    await expect(
      service.create(PROJECT, USER, { name: 'x', kind: 'insights', definition: funnelDef }),
    ).rejects.toMatchObject({ problem: { status: 400 } });
    expect(savedReport.create).not.toHaveBeenCalled();
  });

  it('run executes the stored definition through the engine with the override merged', async () => {
    const { service, savedReport, run } = make();
    savedReport.findUnique.mockResolvedValue(row());
    const override = { cohort_id: '018f6b2e-0000-7000-8000-0000000000c1' };

    await service.run(USER, PROJECT, REPORT_ID, override);

    expect(run).toHaveBeenCalledWith(USER, PROJECT, 'insights', insightsDef, override);
  });

  it('run 404s a report from another project', async () => {
    const { service, savedReport, run } = make();
    savedReport.findUnique.mockResolvedValue(row({ projectId: OTHER_PROJECT }));

    await expect(service.run(USER, PROJECT, REPORT_ID, {})).rejects.toMatchObject({
      problem: { status: 404 },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('update re-validates a new definition against the report’s existing kind', async () => {
    const { service, savedReport } = make();
    savedReport.findUnique.mockResolvedValue(row({ kind: 'funnel' }));

    // An insights definition is invalid for a funnel report → 400, no write.
    await expect(
      service.update(PROJECT, REPORT_ID, { definition: insightsDef }),
    ).rejects.toMatchObject({ problem: { status: 400 } });
    expect(savedReport.update).not.toHaveBeenCalled();
  });
});
