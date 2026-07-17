import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { attachEntitlementSchema, createProductSchema } from '../support/catalog.schemas';
import { ProductsService } from '../services/products.service';

@Controller('api/v1/projects/:projectId/catalog/products')
@UseGuards(ProjectAccessGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @RequireProjectRole('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createProductSchema, body));
  }

  @Delete(':productId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  remove(@Param('projectId') projectId: string, @Param('productId') productId: string) {
    return this.service.remove(projectId, productId);
  }

  @Post(':productId/entitlements')
  @RequireProjectRole('admin')
  attachEntitlement(
    @Param('projectId') projectId: string,
    @Param('productId') productId: string,
    @Body() body: unknown,
  ) {
    const { entitlementId } = parseOrThrow(attachEntitlementSchema, body);
    return this.service.attachEntitlement(projectId, productId, entitlementId);
  }

  @Delete(':productId/entitlements/:entitlementId')
  @HttpCode(204)
  @RequireProjectRole('admin')
  detachEntitlement(
    @Param('projectId') projectId: string,
    @Param('productId') productId: string,
    @Param('entitlementId') entitlementId: string,
  ) {
    return this.service.detachEntitlement(projectId, productId, entitlementId);
  }
}
