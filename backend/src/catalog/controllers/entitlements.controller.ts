import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { createEntitlementSchema } from '../support/catalog.schemas';
import { EntitlementsService } from '../services/entitlements.service';

@Controller('api/v1/projects/:projectId/catalog/entitlements')
@UseGuards(JwtAuthGuard)
export class EntitlementsController {
  constructor(private readonly service: EntitlementsService) {}

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
    return this.service.create(projectId, parseOrThrow(createEntitlementSchema, body));
  }

  @Delete(':entId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  remove(@Param('projectId') projectId: string, @Param('entId') entId: string) {
    return this.service.remove(projectId, entId);
  }
}
