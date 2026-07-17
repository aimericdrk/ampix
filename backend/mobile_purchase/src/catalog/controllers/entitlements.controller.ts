import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { createEntitlementSchema } from '../support/catalog.schemas';
import { EntitlementsService } from '../services/entitlements.service';

@Controller('api/v1/projects/:projectId/catalog/entitlements')
@UseGuards(ProjectAccessGuard)
export class EntitlementsController {
  constructor(private readonly service: EntitlementsService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createEntitlementSchema, body));
  }

  @Delete(':entitlementId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('entitlementId') entitlementId: string) {
    return this.service.remove(projectId, entitlementId);
  }
}
