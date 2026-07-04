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
import { createTokenSchema, updateProjectSchema } from './project-management.schemas';
import { ProjectManagementService } from './project-management.service';
import type { CreatedToken, SdkTokenListItem, UpdatedProject } from './project-management.types';
import { ProjectsService } from './projects.service';
import type { EventsSummary, ProjectListItem } from './projects.types';

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

  @Get(':projectId/events/summary')
  async eventsSummary(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
  ): Promise<EventsSummary> {
    return this.projects.getEventsSummary(req.user!.id, projectId);
  }

  @Patch(':projectId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<UpdatedProject> {
    const dto = parseOrThrow(updateProjectSchema, body);
    return this.projectManagement.update(projectId, dto);
  }

  @Delete(':projectId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('projectId') projectId: string): Promise<void> {
    await this.projectManagement.remove(projectId);
  }

  @Get(':projectId/tokens')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async listTokens(@Param('projectId') projectId: string): Promise<{ tokens: SdkTokenListItem[] }> {
    const tokens = await this.projectManagement.listTokens(projectId);
    return { tokens };
  }

  @Post(':projectId/tokens')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async createToken(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<CreatedToken> {
    const dto = parseOrThrow(createTokenSchema, body);
    return this.projectManagement.createToken(projectId, dto.label);
  }

  @Delete(':projectId/tokens/:tokenId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(204)
  async revokeToken(
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.projectManagement.revokeToken(projectId, tokenId);
  }
}
