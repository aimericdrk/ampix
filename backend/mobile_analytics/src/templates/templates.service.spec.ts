import { ProblemException } from '../common/problem-details';
import type { DashboardsService } from '../dashboards/dashboards.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReportsService } from '../reports/reports.service';
import { TemplatesService } from './templates.service';

const USER = 'user-1';
const PROJECT = '018f6b2e-0000-7000-8000-0000000000a1';

function makeService(existingDashboard: { id: string } | null) {
  const findFirst = jest.fn().mockResolvedValue(existingDashboard);
  const prisma = { dashboard: { findFirst } } as unknown as PrismaService;

  let reportSeq = 0;
  const reportCreate = jest.fn(async () => ({ id: `report-${reportSeq++}` }));
  const reports = { create: reportCreate } as unknown as ReportsService;

  const dashCreate = jest.fn(async () => ({ id: 'dash-1' }));
  const createTile = jest.fn(async () => ({ id: 'tile' }));
  const dashboards = { create: dashCreate, createTile } as unknown as DashboardsService;

  return {
    service: new TemplatesService(prisma, reports, dashboards),
    findFirst,
    reportCreate,
    dashCreate,
    createTile,
  };
}

describe('TemplatesService', () => {
  describe('listCatalog', () => {
    it('returns all 7 templates with kind_counts', () => {
      const { service } = makeService(null);
      const { templates } = service.listCatalog();
      expect(templates).toHaveLength(7);
      const acquisition = templates.find((t) => t.id === 'acquisition');
      expect(acquisition?.kind_counts).toEqual({ insights: 2 });
    });
  });

  describe('apply', () => {
    it('404s an unknown template', async () => {
      const { service } = makeService(null);
      await expect(service.apply(USER, PROJECT, 'nope')).rejects.toBeInstanceOf(ProblemException);
    });

    it('materializes reports + dashboard + tiles and injects a default date_range', async () => {
      const { service, reportCreate, dashCreate, createTile } = makeService(null);
      const res = await service.apply(USER, PROJECT, 'acquisition', Date.UTC(2026, 6, 5));

      expect(res).toEqual({ dashboard_id: 'dash-1' });
      // Acquisition bundles 2 insights reports + a 2-tile dashboard.
      expect(reportCreate).toHaveBeenCalledTimes(2);
      expect(dashCreate).toHaveBeenCalledTimes(1);
      expect(createTile).toHaveBeenCalledTimes(2);

      // Every materialized report gets the injected last-30-days range.
      const firstReport = (reportCreate.mock.calls[0] as unknown[])[2] as {
        definition: { date_range: { from: string; to: string } };
      };
      expect(firstReport.definition.date_range).toEqual({ from: '2026-06-06', to: '2026-07-05' });

      // Tiles reference the created report ids (report-backed, not inline).
      const firstTile = (createTile.mock.calls[0] as unknown[])[2] as { saved_report_id: string };
      expect(firstTile.saved_report_id).toBe('report-0');
    });

    it('is idempotent: an existing dashboard of the same name is reused, nothing recreated', async () => {
      const { service, reportCreate, dashCreate, createTile } = makeService({ id: 'existing-dash' });
      const res = await service.apply(USER, PROJECT, 'acquisition');

      expect(res).toEqual({ dashboard_id: 'existing-dash' });
      expect(reportCreate).not.toHaveBeenCalled();
      expect(dashCreate).not.toHaveBeenCalled();
      expect(createTile).not.toHaveBeenCalled();
    });
  });
});
