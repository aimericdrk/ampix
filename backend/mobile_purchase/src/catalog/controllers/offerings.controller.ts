import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';
import { OfferingsService } from '../services/offerings.service';

@Controller('api/v1/projects/:projectId/catalog/offerings')
@UseGuards(ProjectAccessGuard)
export class OfferingsController {
  constructor(private readonly service: OfferingsService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createOfferingSchema, body));
  }

  @Post(':offeringId/current')
  @HttpCode(204)
  @RequireProjectRole('admin')
  setCurrent(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string) {
    return this.service.setCurrent(projectId, offeringId);
  }

  @Delete(':offeringId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string) {
    return this.service.remove(projectId, offeringId);
  }

  @Post(':offeringId/packages')
  @RequireProjectRole('admin')
  addPackage(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string, @Body() body: unknown) {
    return this.service.addPackage(projectId, offeringId, parseOrThrow(createPackageSchema, body));
  }

  @Delete(':offeringId/packages/:packageId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  removePackage(
    @Param('projectId') projectId: string,
    @Param('offeringId') offeringId: string,
    @Param('packageId') packageId: string,
  ) {
    return this.service.removePackage(projectId, offeringId, packageId);
  }
}
