import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';
import { OfferingsService } from '../services/offerings.service';

@Controller('api/v1/projects/:projectId/catalog/offerings')
@UseGuards(JwtAuthGuard)
export class OfferingsController {
  constructor(private readonly service: OfferingsService) {}

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
    return this.service.create(projectId, parseOrThrow(createOfferingSchema, body));
  }

  @Post(':offeringId/current')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  setCurrent(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string) {
    return this.service.setCurrent(projectId, offeringId);
  }

  @Delete(':offeringId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  remove(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string) {
    return this.service.remove(projectId, offeringId);
  }

  @Post(':offeringId/packages')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  addPackage(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string, @Body() body: unknown) {
    return this.service.addPackage(projectId, offeringId, parseOrThrow(createPackageSchema, body));
  }

  @Delete(':offeringId/packages/:packageId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  removePackage(
    @Param('projectId') projectId: string,
    @Param('offeringId') offeringId: string,
    @Param('packageId') packageId: string,
  ) {
    return this.service.removePackage(projectId, offeringId, packageId);
  }
}
