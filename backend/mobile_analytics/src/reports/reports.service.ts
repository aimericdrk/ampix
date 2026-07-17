import { Injectable } from '@nestjs/common';
import type { SavedReport } from '@prisma/client';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisRunnerService, AnalysisResult } from './analysis-runner.service';
import {
  CreateReportDto,
  ReportKind,
  RunReportOverride,
  UpdateReportDto,
  validateReportDefinition,
} from './report.schema';
import type { ReportDetail, ReportListItem } from './report.types';

/**
 * Saved-report CRUD + `/run` (contracts §16). Every row is project-scoped (reads/writes filter by
 * `projectId`, so a report from another project is a 404); RolesGuard gates membership + writes at the
 * controller. `definition` is validated by its `kind` on write, and re-validated (inside the engine)
 * before every run.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AnalysisRunnerService,
  ) {}

  async list(projectId: string, kind?: ReportKind): Promise<ReportListItem[]> {
    const reports = await this.prisma.savedReport.findMany({
      where: { projectId, ...(kind !== undefined && { kind }) },
      orderBy: { updatedAt: 'desc' },
    });
    return reports.map((report) => this.toListItem(report));
  }

  async create(projectId: string, userId: string, dto: CreateReportDto): Promise<ReportDetail> {
    const definition = validateReportDefinition(dto.kind, dto.definition);
    const report = await this.prisma.savedReport.create({
      data: {
        projectId,
        name: dto.name,
        kind: dto.kind,
        definition: definition as object,
        createdBy: userId,
      },
    });
    return this.toDetail(report);
  }

  async get(projectId: string, id: string): Promise<ReportDetail> {
    return this.toDetail(await this.load(projectId, id));
  }

  async update(projectId: string, id: string, dto: UpdateReportDto): Promise<ReportDetail> {
    const existing = await this.load(projectId, id);
    // A new definition must still validate against the report's (immutable) kind.
    const definition =
      dto.definition !== undefined
        ? validateReportDefinition(existing.kind, dto.definition)
        : undefined;
    const updated = await this.prisma.savedReport.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(definition !== undefined && { definition: definition as object }),
      },
    });
    return this.toDetail(updated);
  }

  async remove(projectId: string, id: string): Promise<void> {
    await this.load(projectId, id);
    await this.prisma.savedReport.delete({ where: { id } });
  }

  /** Executes the stored definition through the engine (re-validated first), with an optional override. */
  async run(
    userId: string,
    projectId: string,
    id: string,
    override: RunReportOverride = {},
  ): Promise<AnalysisResult> {
    const report = await this.load(projectId, id);
    return this.runner.run(userId, projectId, report.kind, report.definition, override);
  }

  private async load(projectId: string, id: string): Promise<SavedReport> {
    if (!isUuidShaped(id)) throw this.notFound();
    const report = await this.prisma.savedReport.findUnique({ where: { id } });
    if (!report || report.projectId !== projectId) throw this.notFound();
    return report;
  }

  private toListItem(report: SavedReport): ReportListItem {
    return {
      id: report.id,
      name: report.name,
      kind: report.kind,
      created_by: report.createdBy,
      updated_at: report.updatedAt.toISOString(),
    };
  }

  private toDetail(report: SavedReport): ReportDetail {
    return {
      ...this.toListItem(report),
      definition: report.definition,
      created_at: report.createdAt.toISOString(),
    };
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Report not found' });
  }
}
