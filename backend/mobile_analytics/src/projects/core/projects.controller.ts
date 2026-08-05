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
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import type { AuthRequest } from '../../auth/auth.types';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { createTokenSchema, purgeDataSchema, updateProjectSchema } from '../management/project-management.schemas';
import { ProjectManagementService } from '../management/project-management.service';
import type {
  CreatedToken,
  PurgeDataResult,
  SdkTokenListItem,
  UpdatedProject,
} from '../management/project-management.types';
import { ProjectsService } from './projects.service';
import type { EventsSummary, ProjectListItem, ProjectStat } from './projects.types';

@Controller('api/v1/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly projectManagement: ProjectManagementService,
  ) {}

  @Get()
  async list(@Req() req: AuthRequest): Promise<{ projects: ProjectListItem[] }> {
    const projects = await this.projects.listForUser(req.user!.id);
    return { projects };
  }

  @Get('stats')
  async stats(@Req() req: AuthRequest): Promise<{ stats: ProjectStat[] }> {
    const stats = await this.projects.getProjectStats(req.user!.id);
    return { stats };
  }

  @Get(':projectId/events/summary')
  async eventsSummary(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<EventsSummary> {
    return this.projects.getEventsSummary(req.user!.id, projectId);
  }

  @Patch(':projectId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async update(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<UpdatedProject> {
    const dto = parseOrThrow(updateProjectSchema, body);
    return this.projectManagement.update(projectId, dto);
  }

  @Delete(':projectId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('owner')
  @HttpCode(204)
  async remove(@Param('projectId') projectId: string): Promise<void> {
    await this.projectManagement.remove(projectId);
  }

  @Post(':projectId/data/purge')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('owner')
  async purgeData(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<PurgeDataResult> {
    const dto = parseOrThrow(purgeDataSchema, body);
    return this.projectManagement.purgeData(projectId, dto);
  }

  @Get(':projectId/tokens')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async listTokens(@Param('projectId') projectId: string): Promise<{ tokens: SdkTokenListItem[] }> {
    const tokens = await this.projectManagement.listTokens(projectId);
    return { tokens };
  }

  @Post(':projectId/tokens')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async createToken(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<CreatedToken> {
    const dto = parseOrThrow(createTokenSchema, body);
    return this.projectManagement.createToken(projectId, dto.label);
  }

  @Delete(':projectId/tokens/:tokenId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(204)
  async revokeToken(
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.projectManagement.revokeToken(projectId, tokenId);
  }
}
