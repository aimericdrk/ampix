import type { PrismaService } from '../prisma/prisma.service';
import type { AnalysisRunnerService } from '../reports/analysis-runner.service';
import { DashboardsService } from './dashboards.service';

const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';
const DASH_ID = '018f6b2e-0000-7000-8000-0000000000e1';
const TILE_ID = '018f6b2e-0000-7000-8000-0000000000f1';
const REPORT_ID = '018f6b2e-0000-7000-8000-0000000000d1';
const USER = 'user-1';

const insightsDef = {
  events: [{ name: 'checkout_completed', aggregation: 'total' }],
  date_range: { from: '2026-06-01', to: '2026-07-01' },
  interval: 'day',
};

function dashboardRow(overrides: Record<string, unknown> = {}) {
  return { id: DASH_ID, projectId: PROJECT, name: 'Overview', updatedAt: new Date('2026-07-02T00:00:00Z'), ...overrides };
}
function tileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TILE_ID,
    dashboardId: DASH_ID,
    title: 'Checkouts',
    kind: 'insights',
    savedReportId: null,
    inlineDefinition: insightsDef,
    x: 0,
    y: 0,
    w: 6,
    h: 4,
    position: 0,
    ...overrides,
  };
}

function make() {
  const dashboard = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue(dashboardRow()),
    delete: jest.fn(),
    count: jest.fn(),
  };
  const dashboardTile = {
    aggregate: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const savedReport = { findUnique: jest.fn() };
  const $transaction = jest.fn().mockResolvedValue(undefined);
  const prisma = { dashboard, dashboardTile, savedReport, $transaction } as unknown as PrismaService;
  const run = jest.fn().mockResolvedValue({ series: [{ name: 'checkout_completed' }] });
  const runner = { run } as unknown as AnalysisRunnerService;
  return { service: new DashboardsService(prisma, runner), dashboard, dashboardTile, savedReport, run };
}

describe('DashboardsService (contracts §16)', () => {
  describe('createTile', () => {
    it('validates an inline definition by kind, assigns the next position, and touches the dashboard', async () => {
      const { service, dashboard, dashboardTile } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());
      dashboardTile.aggregate.mockResolvedValue({ _max: { position: 2 } });
      dashboardTile.create.mockResolvedValue(tileRow({ position: 3 }));

      const view = await service.createTile(PROJECT, DASH_ID, {
        title: 'Checkouts',
        kind: 'insights',
        inline_definition: insightsDef,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
      } as never);

      expect(dashboardTile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ position: 3, kind: 'insights', savedReportId: null }),
      });
      expect(view.position).toBe(3);
      expect(dashboard.update).toHaveBeenCalled(); // touch()
    });

    it('for a report-backed tile, takes the tile kind from the referenced report', async () => {
      const { service, dashboard, dashboardTile, savedReport } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());
      savedReport.findUnique.mockResolvedValue({ id: REPORT_ID, projectId: PROJECT, kind: 'funnel' });
      dashboardTile.aggregate.mockResolvedValue({ _max: { position: null } });
      dashboardTile.create.mockResolvedValue(tileRow({ savedReportId: REPORT_ID, kind: 'funnel', position: 0 }));

      await service.createTile(PROJECT, DASH_ID, {
        title: 'Funnel',
        kind: 'insights', // deliberately wrong; the report's kind wins
        saved_report_id: REPORT_ID,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
      } as never);

      expect(dashboardTile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'funnel', savedReportId: REPORT_ID, position: 0 }),
      });
    });

    it('rejects a tile referencing BOTH a report and an inline definition (400)', async () => {
      const { service, dashboard, dashboardTile } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());

      await expect(
        service.createTile(PROJECT, DASH_ID, {
          title: 't',
          kind: 'insights',
          saved_report_id: REPORT_ID,
          inline_definition: insightsDef,
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        } as never),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(dashboardTile.create).not.toHaveBeenCalled();
    });
  });

  describe('updateTile', () => {
    it('rejects a resize whose merged x + w overflows the 12-column grid', async () => {
      const { service, dashboard, dashboardTile } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());
      dashboardTile.findUnique.mockResolvedValue(tileRow({ x: 8, w: 4 }));

      // existing x=8; new w=6 → 8+6=14 > 12.
      await expect(
        service.updateTile(PROJECT, DASH_ID, TILE_ID, { w: 6 } as never),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(dashboardTile.update).not.toHaveBeenCalled();
    });
  });

  describe('saveLayout', () => {
    it('404s when a batch references a tile that is not on the dashboard', async () => {
      const { service, dashboard, dashboardTile } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());
      dashboardTile.findMany.mockResolvedValue([{ id: TILE_ID }]);

      await expect(
        service.saveLayout(PROJECT, DASH_ID, {
          tiles: [{ id: '018f6b2e-0000-7000-8000-000000009999', x: 0, y: 0, w: 6, h: 4, position: 0 }],
        } as never),
      ).rejects.toMatchObject({ problem: { status: 404 } });
    });
  });

  describe('getData', () => {
    it('runs every tile and isolates a single failing tile into { error } (never fails the dashboard)', async () => {
      const { service, dashboard, dashboardTile, savedReport, run } = make();
      dashboard.findUnique.mockResolvedValue(dashboardRow());
      const okTile = tileRow({ id: TILE_ID, position: 0 });
      const brokenTile = tileRow({
        id: '018f6b2e-0000-7000-8000-000000009999',
        savedReportId: REPORT_ID,
        inlineDefinition: null,
        position: 1,
      });
      dashboardTile.findMany.mockResolvedValue([okTile, brokenTile]);
      // The broken tile's referenced report no longer exists → per-tile error.
      savedReport.findUnique.mockResolvedValue(null);

      const data = await service.getData(USER, PROJECT, DASH_ID);

      expect(run).toHaveBeenCalledTimes(1); // only the healthy inline tile reached the engine
      const ok = data.tiles.find((t) => t.id === okTile.id)!;
      const broken = data.tiles.find((t) => t.id === brokenTile.id)!;
      expect(ok.result).toEqual({ series: [{ name: 'checkout_completed' }] });
      expect(broken.result).toEqual({ error: 'Saved report not found' });
    });
  });
});
