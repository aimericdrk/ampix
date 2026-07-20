import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../common/zod';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { grantPromotionalEntitlementSchema } from '../support/promotional-entitlement.schemas';
import { PromotionalEntitlementsService } from '../services/promotional-entitlements.service';

@Controller('api/v1/projects/:projectId/customers/:customerId/promotional-entitlements')
@UseGuards(ProjectAccessGuard)
export class PromotionalEntitlementsController {
  constructor(private readonly service: PromotionalEntitlementsService) {}

  @Post()
  @RequireProjectRole('admin')
  grant(
    @Param('projectId') projectId: string,
    @Param('customerId') customerId: string,
    @Body() body: unknown,
  ) {
    return this.service.grant(projectId, customerId, parseOrThrow(grantPromotionalEntitlementSchema, body));
  }
}
