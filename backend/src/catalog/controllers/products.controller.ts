import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { attachEntitlementSchema, createProductSchema } from '../support/catalog.schemas';
import { ProductsService } from '../services/products.service';

@Controller('api/v1/projects/:projectId/catalog/products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

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
    return this.service.create(projectId, parseOrThrow(createProductSchema, body));
  }

  @Delete(':productId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  remove(@Param('projectId') projectId: string, @Param('productId') productId: string) {
    return this.service.remove(projectId, productId);
  }

  @Post(':productId/entitlements')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  attachEntitlement(@Param('projectId') projectId: string, @Param('productId') productId: string, @Body() body: unknown) {
    const { entitlementId } = parseOrThrow(attachEntitlementSchema, body);
    return this.service.attachEntitlement(projectId, productId, entitlementId);
  }

  @Delete(':productId/entitlements/:entitlementId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  detachEntitlement(
    @Param('projectId') projectId: string,
    @Param('productId') productId: string,
    @Param('entitlementId') entitlementId: string,
  ) {
    return this.service.detachEntitlement(projectId, productId, entitlementId);
  }
}
