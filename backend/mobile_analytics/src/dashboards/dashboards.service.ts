import { Injectable } from '@nestjs/common';
import type { Dashboard, DashboardTile, SavedReport } from '@prisma/client';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisRunnerService } from '../reports/analysis-runner.service';
import { validateReportDefinition } from '../reports/report.schema';
import {
  CreateDashboardDto,
  CreateTileDto,
  LayoutDto,
  UpdateDashboardDto,
  UpdateTileDto,
  fitsGrid,
} from './dashboard.schema';
import type {
  DashboardData,
  DashboardDetail,
  DashboardListItem,
  TileResult,
  TileView,
} from './dashboard.types';

/**
 * Custom dashboards (contracts §16): CRUD + nested tiles + batch layout + `/data`. Every row is
 * project-scoped (dashboards by `projectId`, tiles by `dashboardId`), and RolesGuard gates membership
 * + writes at the controller. A tile references exactly one of a saved report / inline definition;
 * `/data` runs every tile through the injection-safe engine, isolating a single tile's failure into
 * `{ error }` so it never fails the whole dashboard.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AnalysisRunnerService,
  ) {}

  async list(projectId: string): Promise<DashboardListItem[]> {
    const dashboards = await this.prisma.dashboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { tiles: true } } },
    });
    return dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      tile_count: d._count.tiles,
      updated_at: d.updatedAt.toISOString(),
    }));
  }

  async create(
    projectId: string,
    userId: string,
    dto: CreateDashboardDto,
  ): Promise<DashboardListItem> {
    const dashboard = await this.prisma.dashboard.create({
      data: { projectId, name: dto.name, createdBy: userId },
    });
    return this.toListItem(dashboard, 0);
  }

  async get(projectId: string, id: string): Promise<DashboardDetail> {
    const dashboard = await this.loadDashboard(projectId, id);
    const tiles = await this.prisma.dashboardTile.findMany({
      where: { dashboardId: id },
      orderBy: { position: 'asc' },
    });
    return { id: dashboard.id, name: dashboard.name, tiles: tiles.map((t) => this.toTileView(t)) };
  }

  async update(projectId: string, id: string, dto: UpdateDashboardDto): Promise<DashboardListItem> {
    await this.loadDashboard(projectId, id);
    const dashboard = await this.prisma.dashboard.update({ where: { id }, data: { name: dto.name } });
    const tileCount = await this.prisma.dashboardTile.count({ where: { dashboardId: id } });
    return this.toListItem(dashboard, tileCount);
  }

  async remove(projectId: string, id: string): Promise<void> {
    await this.loadDashboard(projectId, id);
    await this.prisma.dashboard.delete({ where: { id } }); // cascades tiles
  }

  // --- tiles ---

  async createTile(projectId: string, dashboardId: string, dto: CreateTileDto): Promise<TileView> {
    await this.loadDashboard(projectId, dashboardId);

    // Exactly one of saved_report_id / inline_definition (defense-in-depth beyond the zod refine).
    if ((dto.saved_report_id != null) === (dto.inline_definition != null)) {
      throw this.badRequest('a tile must reference exactly one of saved_report_id or inline_definition');
    }

    let kind = dto.kind;
    if (dto.saved_report_id != null) {
      // A report-backed tile's kind is the report's kind (source of truth for the chart component).
      const report = await this.loadReport(projectId, dto.saved_report_id);
      kind = report.kind;
    } else {
      // Inline definition: validated by its kind with the SAME §14/§15 schema, on write.
      validateReportDefinition(dto.kind, dto.inline_definition);
    }

    const agg = await this.prisma.dashboardTile.aggregate({
      where: { dashboardId },
      _max: { position: true },
    });
    const position = (agg._max.position ?? -1) + 1;

    const tile = await this.prisma.dashboardTile.create({
      data: {
        dashboardId,
        title: dto.title,
        kind,
        savedReportId: dto.saved_report_id ?? null,
        inlineDefinition:
          dto.inline_definition != null ? (dto.inline_definition as object) : undefined,
        x: dto.x,
        y: dto.y,
        w: dto.w,
        h: dto.h,
        position,
      },
    });
    await this.touch(dashboardId);
    return this.toTileView(tile);
  }

  async updateTile(
    projectId: string,
    dashboardId: string,
    tileId: string,
    dto: UpdateTileDto,
  ): Promise<TileView> {
    await this.loadDashboard(projectId, dashboardId);
    const tile = await this.loadTile(dashboardId, tileId);

    // Cross-field grid bound against the merged (existing + patch) placement.
    if (!fitsGrid({ x: dto.x ?? tile.x, w: dto.w ?? tile.w })) {
      throw this.badRequest('x + w must be <= 12 (tile overflows the grid)');
    }

    const updated = await this.prisma.dashboardTile.update({
      where: { id: tileId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.x !== undefined && { x: dto.x }),
        ...(dto.y !== undefined && { y: dto.y }),
        ...(dto.w !== undefined && { w: dto.w }),
        ...(dto.h !== undefined && { h: dto.h }),
      },
    });
    await this.touch(dashboardId);
    return this.toTileView(updated);
  }

  async removeTile(projectId: string, dashboardId: string, tileId: string): Promise<void> {
    await this.loadDashboard(projectId, dashboardId);
    await this.loadTile(dashboardId, tileId);
    await this.prisma.dashboardTile.delete({ where: { id: tileId } });
    await this.touch(dashboardId);
  }

  /** Batch-saves the grid after a drag (contracts §16). Every referenced tile must belong to the
   *  dashboard; the 12-col bounds were validated in the zod schema. */
  async saveLayout(
    projectId: string,
    dashboardId: string,
    dto: LayoutDto,
  ): Promise<DashboardDetail> {
    await this.loadDashboard(projectId, dashboardId);
    const existing = await this.prisma.dashboardTile.findMany({
      where: { dashboardId },
      select: { id: true },
    });
    const validIds = new Set(existing.map((t) => t.id));
    for (const t of dto.tiles) {
      if (!validIds.has(t.id)) throw this.tileNotFound();
    }

    await this.prisma.$transaction([
      ...dto.tiles.map((t) =>
        this.prisma.dashboardTile.update({
          where: { id: t.id },
          data: { x: t.x, y: t.y, w: t.w, h: t.h, position: t.position },
        }),
      ),
      this.prisma.dashboard.update({ where: { id: dashboardId }, data: { updatedAt: new Date() } }),
    ]);
    return this.get(projectId, dashboardId);
  }

  /** Runs every tile, isolating a single tile's failure into `{ error }` (never fails the dashboard). */
  async getData(userId: string, projectId: string, dashboardId: string): Promise<DashboardData> {
    await this.loadDashboard(projectId, dashboardId);
    const tiles = await this.prisma.dashboardTile.findMany({
      where: { dashboardId },
      orderBy: { position: 'asc' },
    });
    const results = await Promise.all(tiles.map((tile) => this.runTile(userId, projectId, tile)));
    return { tiles: results };
  }

  private async runTile(
    userId: string,
    projectId: string,
    tile: DashboardTile,
  ): Promise<TileResult> {
    try {
      if (tile.savedReportId != null) {
        const report = await this.loadReport(projectId, tile.savedReportId);
        const result = await this.runner.run(userId, projectId, report.kind, report.definition);
        return { id: tile.id, result };
      }
      if (tile.inlineDefinition != null) {
        const result = await this.runner.run(userId, projectId, tile.kind, tile.inlineDefinition);
        return { id: tile.id, result };
      }
      throw this.badRequest('tile has neither a saved report nor an inline definition');
    } catch (err) {
      return { id: tile.id, result: { error: this.errorDetail(err) } };
    }
  }

  private errorDetail(err: unknown): string {
    if (err instanceof ProblemException) return err.problem.detail ?? err.problem.title;
    if (err instanceof Error) return err.message;
    return 'Failed to run tile';
  }

  private async loadDashboard(projectId: string, id: string): Promise<Dashboard> {
    if (!isUuidShaped(id)) throw this.dashboardNotFound();
    const dashboard = await this.prisma.dashboard.findUnique({ where: { id } });
    if (!dashboard || dashboard.projectId !== projectId) throw this.dashboardNotFound();
    return dashboard;
  }

  private async loadTile(dashboardId: string, tileId: string): Promise<DashboardTile> {
    if (!isUuidShaped(tileId)) throw this.tileNotFound();
    const tile = await this.prisma.dashboardTile.findUnique({ where: { id: tileId } });
    if (!tile || tile.dashboardId !== dashboardId) throw this.tileNotFound();
    return tile;
  }

  private async loadReport(projectId: string, reportId: string): Promise<SavedReport> {
    const report = await this.prisma.savedReport.findUnique({ where: { id: reportId } });
    if (!report || report.projectId !== projectId) {
      throw new ProblemException({ status: 404, title: 'Not Found', detail: 'Saved report not found' });
    }
    return report;
  }

  private async touch(dashboardId: string): Promise<void> {
    await this.prisma.dashboard.update({
      where: { id: dashboardId },
      data: { updatedAt: new Date() },
    });
  }

  private toListItem(dashboard: Dashboard, tileCount: number): DashboardListItem {
    return {
      id: dashboard.id,
      name: dashboard.name,
      tile_count: tileCount,
      updated_at: dashboard.updatedAt.toISOString(),
    };
  }

  private toTileView(tile: DashboardTile): TileView {
    return {
      id: tile.id,
      title: tile.title,
      kind: tile.kind,
      saved_report_id: tile.savedReportId,
      inline_definition: tile.inlineDefinition ?? null,
      x: tile.x,
      y: tile.y,
      w: tile.w,
      h: tile.h,
      position: tile.position,
    };
  }

  private badRequest(detail: string): ProblemException {
    return new ProblemException({ status: 400, title: 'Bad Request', detail });
  }

  private dashboardNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Dashboard not found' });
  }

  private tileNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Tile not found' });
  }
}
