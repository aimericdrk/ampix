import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { createAppSchema } from '../support/catalog.schemas';
import { AppsService } from '../services/apps.service';

@Controller('api/v1/projects/:projectId/catalog/apps')
@UseGuards(JwtAuthGuard)
export class AppsController {
  constructor(private readonly service: AppsService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createAppSchema, body));
  }

  @Delete(':appId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  remove(@Param('projectId') projectId: string, @Param('appId') appId: string) {
    return this.service.remove(projectId, appId);
  }
}
