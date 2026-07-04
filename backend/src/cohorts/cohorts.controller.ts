import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { Roles } from '../authz/roles.decorator';
import { RolesGuard } from '../authz/roles.guard';
import { createCohortSchema, updateCohortSchema } from './cohort.schema';
import type { CohortDetail, CohortListItem, CohortPreview } from './cohort.types';
import { CohortsService } from './cohorts.service';

/**
 * Cohorts management API (contracts §16). Mounted under `/api/v1/projects/:projectId/cohorts`.
 * JWT + RolesGuard: reads viewer+, writes analyst+ (the guard resolves the org from `:projectId`).
 */
@Controller('api/v1/projects/:projectId/cohorts')
@UseGuards(JwtAuthGuard)
export class CohortsController {
  constructor(private readonly cohorts: CohortsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('viewer')
  async list(@Param('projectId') projectId: string): Promise<{ cohorts: CohortListItem[] }> {
    const cohorts = await this.cohorts.list(projectId);
    return { cohorts };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('analyst')
  async create(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<CohortDetail> {
    const dto = parseOrThrow(createCohortSchema, body);
    return this.cohorts.create(projectId, req.user!.id, dto);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('viewer')
  async get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<CohortDetail> {
    return this.cohorts.get(projectId, id);
  }

  @Get(':id/preview')
  @UseGuards(RolesGuard)
  @Roles('viewer')
  async preview(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<CohortPreview> {
    return this.cohorts.preview(projectId, id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('analyst')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CohortDetail> {
    const dto = parseOrThrow(updateCohortSchema, body);
    return this.cohorts.update(projectId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('analyst')
  @HttpCode(204)
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.cohorts.remove(projectId, id);
  }
}
