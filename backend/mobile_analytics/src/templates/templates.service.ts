import { Injectable } from '@nestjs/common';
import { ProblemException } from '../common/problem-details';
import { DashboardsService } from '../dashboards/dashboards.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import {
  TEMPLATE_CATALOG,
  TemplateSpec,
  findTemplate,
  kindCounts,
} from './template-catalog';
import type {
  ApplyTemplateResponse,
  TemplateCatalogResponse,
  TemplateSummary,
} from './templates.types';

const MS_PER_DAY = 86_400_000;
/** Applied report definitions get a last-30-days (inclusive, UTC) default range; the analyst edits later. */
const DEFAULT_RANGE_DAYS = 30;

/**
 * Templates (contracts §19): a fixed server-side catalog + an "apply" that materializes a bundle as
 * real §16 SavedReport + Dashboard rows THROUGH the existing §16 services (so the same validation and
 * project scoping apply — a template is never a back door around them).
 *
 * IDEMPOTENCY (stated): **skip-if-exists**, keyed on the template's dashboard name within the
 * project. Re-applying a template returns the SAME `dashboard_id` and creates no duplicate reports
 * or dashboards. (Trade-off: a user-made dashboard that happens to share the name is treated as
 * already-applied.)
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly dashboards: DashboardsService,
  ) {}

  /** GET /api/v1/templates — the fixed catalog with per-kind report counts. */
  listCatalog(): TemplateCatalogResponse {
    const templates: TemplateSummary[] = TEMPLATE_CATALOG.map((spec) => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      kind_counts: kindCounts(spec),
    }));
    return { templates };
  }

  /**
   * POST .../templates/:templateId/apply — materialize the bundle. `now` is injectable for
   * deterministic tests (fixes the default date range).
   */
  async apply(
    userId: string,
    projectId: string,
    templateId: string,
    now: number = Date.now(),
  ): Promise<ApplyTemplateResponse> {
    const spec = findTemplate(templateId);
    if (!spec) {
      throw new ProblemException({
        status: 404,
        title: 'Not Found',
        detail: `Unknown template '${templateId}'`,
      });
    }

    // Idempotency: a dashboard with this template's name already in the project -> reuse it.
    const existing = await this.prisma.dashboard.findFirst({
      where: { projectId, name: spec.dashboardName },
    });
    if (existing) return { dashboard_id: existing.id };

    const dateRange = this.defaultRange(now);

    // Materialize each saved report (definition validated by its kind on create).
    const reportIds: string[] = [];
    for (const report of spec.reports) {
      const created = await this.reports.create(projectId, userId, {
        name: report.name,
        kind: report.kind,
        definition: { ...report.definition, date_range: dateRange },
      });
      reportIds.push(created.id);
    }

    const dashboard = await this.dashboards.create(projectId, userId, {
      name: spec.dashboardName,
    });

    for (const tile of spec.tiles) {
      await this.dashboards.createTile(projectId, dashboard.id, {
        title: tile.title,
        kind: spec.reports[tile.reportRef].kind,
        saved_report_id: reportIds[tile.reportRef],
        x: tile.x,
        y: tile.y,
        w: tile.w,
        h: tile.h,
      });
    }

    return { dashboard_id: dashboard.id };
  }

  /** Last-`DEFAULT_RANGE_DAYS`-days inclusive UTC range as `{ from, to }` `YYYY-MM-DD` strings. */
  private defaultRange(now: number): { from: string; to: string } {
    const todayMs = Math.floor(now / MS_PER_DAY) * MS_PER_DAY;
    const fromMs = todayMs - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY;
    const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
    return { from: iso(fromMs), to: iso(todayMs) };
  }
}

/** Re-export so tests can assert against the catalog constant without a deep import. */
export { TEMPLATE_CATALOG, type TemplateSpec };
