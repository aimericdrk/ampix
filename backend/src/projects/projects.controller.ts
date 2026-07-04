import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectsService } from './projects.service';
import type { EventsSummary, ProjectListItem } from './projects.types';

@Controller('api/v1/projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

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
}
