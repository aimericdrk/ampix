import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import type { AnalysisResult } from './analysis-runner.service';
import {
  createReportSchema,
  reportKindSchema,
  runReportOverrideSchema,
  updateReportSchema,
} from './report.schema';
import type { ReportDetail, ReportListItem } from './report.types';
import { ReportsService } from './reports.service';

/**
 * Saved-reports management API (contracts §16). Under `/api/v1/projects/:projectId/reports`.
 * Reads viewer+, writes analyst+ (ProjectRolesGuard resolves the project role from `:projectId`).
 * `/run` is a viewer+ read that executes the stored definition through the engine.
 */
@Controller('api/v1/projects/:projectId/reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async list(
    @Param('projectId') projectId: string,
    @Query('kind') kind?: string,
  ): Promise<{ reports: ReportListItem[] }> {
    const parsedKind = kind !== undefined ? parseOrThrow(reportKindSchema, kind) : undefined;
    const reports = await this.reports.list(projectId, parsedKind);
    return { reports };
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async create(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<ReportDetail> {
    const dto = parseOrThrow(createReportSchema, body);
    return this.reports.create(projectId, req.user!.id, dto);
  }

  @Get(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<ReportDetail> {
    return this.reports.get(projectId, id);
  }

  @Post(':id/run')
  @HttpCode(200)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async run(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AnalysisResult> {
    const override = parseOrThrow(runReportOverrideSchema, body ?? {});
    return this.reports.run(req.user!.id, projectId, id, override);
  }

  @Patch(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReportDetail> {
    const dto = parseOrThrow(updateReportSchema, body);
    return this.reports.update(projectId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  @HttpCode(204)
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.reports.remove(projectId, id);
  }
}
