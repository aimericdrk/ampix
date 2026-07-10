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
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { cohortDefinitionSchema, createCohortSchema, updateCohortSchema } from './cohort.schema';
import type { CohortDetail, CohortListItem, CohortPreview } from './cohort.types';
import { CohortsService } from './cohorts.service';

/**
 * Cohorts management API (contracts §16). Mounted under `/api/v1/projects/:projectId/cohorts`.
 * JWT + ProjectRolesGuard: reads viewer+, writes analyst+ (the guard resolves the project role from
 * `:projectId`).
 */
@Controller('api/v1/projects/:projectId/cohorts')
@UseGuards(JwtAuthGuard)
export class CohortsController {
  constructor(private readonly cohorts: CohortsService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async list(@Param('projectId') projectId: string): Promise<{ cohorts: CohortListItem[] }> {
    const cohorts = await this.cohorts.list(projectId);
    return { cohorts };
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async create(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<CohortDetail> {
    const dto = parseOrThrow(createCohortSchema, body);
    return this.cohorts.create(projectId, req.user!.id, dto);
  }

  /**
   * Previews a not-yet-saved definition (viewer+) → `{ count, sample }` WITHOUT persisting anything.
   * Powers the live builder preview. Declared before `:id` routes and static-pathed (`preview`), so it
   * never shadows / is shadowed by `@Post()` create (path `''`) or the `:id` param routes.
   */
  @Post('preview')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  @HttpCode(200) // a read (runs the definition), not a resource creation
  async previewDefinition(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<CohortPreview> {
    const definition = parseOrThrow(cohortDefinitionSchema, body);
    return this.cohorts.previewDefinition(projectId, definition);
  }

  @Get(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async get(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<CohortDetail> {
    return this.cohorts.get(projectId, id);
  }

  @Get(':id/preview')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async preview(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<CohortPreview> {
    return this.cohorts.preview(projectId, id);
  }

  @Patch(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CohortDetail> {
    const dto = parseOrThrow(updateCohortSchema, body);
    return this.cohorts.update(projectId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('analyst')
  @HttpCode(204)
  async remove(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.cohorts.remove(projectId, id);
  }
}
