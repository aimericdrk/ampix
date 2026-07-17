import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { createAppSchema } from '../support/catalog.schemas';
import { AppsService } from '../services/apps.service';

@Controller('api/v1/projects/:projectId/catalog/apps')
@UseGuards(ProjectAccessGuard)
export class AppsController {
  constructor(private readonly service: AppsService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createAppSchema, body));
  }

  @Delete(':appId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('appId') appId: string) {
    return this.service.remove(projectId, appId);
  }
}
