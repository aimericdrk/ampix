import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { rcUpsertSchema } from './rc-admin.schema';
import { RcAdminService } from './rc-admin.service';

/**
 * RevenueCat integration management (spec §4.7). Mounted under
 * `/api/v1/projects/:projectId/integrations/revenuecat`. Writes (status/connect/disconnect/journal/
 * replay) are admin-only via `ProjectRolesGuard`; the per-user subscription lookup has no role gate
 * because `RcAdminService.getUserSubscription` calls `ProjectsService.assertMembership` (viewer+)
 * itself.
 */
@Controller('api/v1/projects/:projectId/integrations/revenuecat')
@UseGuards(JwtAuthGuard)
export class RcAdminController {
  constructor(private readonly service: RcAdminService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async getStatus(@Param('projectId') projectId: string) {
    return this.service.getStatus(projectId);
  }

  @Put()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async upsert(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.upsert(projectId, parseOrThrow(rcUpsertSchema, body));
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async disconnect(@Param('projectId') projectId: string) {
    await this.service.disconnect(projectId);
  }

  @Get('events')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async listJournal(@Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.service.listJournal(projectId, status);
  }

  @Post('replay')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async replay(@Param('projectId') projectId: string) {
    return this.service.replay(projectId);
  }

  @Get('users/:distinctId')
  async getUserSubscription(
    @Req() req: AuthRequest,
    @Param('projectId') projectId: string,
    @Param('distinctId') distinctId: string,
  ) {
    return this.service.getUserSubscription(req.user!.id, projectId, distinctId);
  }
}
