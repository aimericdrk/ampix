import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { RefundService } from '../services/refund.service';

/**
 * D1 (design §1.1): the admin-initiated Google Play refund action. Double-scoped under
 * `customers/:customerId` like B's write endpoints; no request body; 200 with the updated
 * subscription state `{ id, status, refundedAt }` (the dashboard refetches detail anyway).
 */
@Controller('api/v1/projects/:projectId/customers/:customerId/subscriptions')
@UseGuards(ProjectAccessGuard)
export class RefundController {
  constructor(private readonly service: RefundService) {}

  @Post(':subscriptionId/refund')
  @HttpCode(200)
  @RequireProjectRole('admin')
  refund(
    @Param('projectId') projectId: string,
    @Param('customerId') customerId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.service.refund(projectId, customerId, subscriptionId);
  }
}
