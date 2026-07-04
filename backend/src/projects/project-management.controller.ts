import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authz/roles.decorator';
import { RolesGuard } from '../authz/roles.guard';
import { createProjectSchema } from './project-management.schemas';
import { ProjectManagementService } from './project-management.service';
import type { CreatedProject } from './project-management.types';

/** Org-scoped project creation (contracts §13) — admin only. */
@Controller('api/v1/orgs/:orgId/projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProjectManagementController {
  constructor(private readonly projectManagement: ProjectManagementService) {}

  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: unknown): Promise<CreatedProject> {
    const dto = parseOrThrow(createProjectSchema, body);
    return this.projectManagement.createForOrg(orgId, dto.name, dto.timezone);
  }
}
