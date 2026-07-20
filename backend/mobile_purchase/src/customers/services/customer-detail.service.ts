import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';

export interface PromotionalEntitlementRow {
  id: string;
  entitlementIdentifier: string;
  grantedAt: Date;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
}

/**
 * Dashboard-facing customer DETAIL (design §1.3): the customer's PII-bearing profile fields, its
 * assembled `CustomerInfo` (via the shared assembler — entitlements incl. promotional, design
 * §1.2, project-wide resolution since a dashboard read has no single-App context), every
 * Subscription/Transaction row (most-recent first), and its full promotional-entitlement grant
 * history (active + revoked — the dashboard needs revoked grants too, to render history, not just
 * what is currently active).
 */
@Injectable()
export class CustomerDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assembler: CustomerInfoAssemblerService,
  ) {}

  async getDetail(projectId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId } });
    if (!customer) {
      throw new ProblemException({ status: 404, title: 'Customer not found' });
    }

    const [customerInfo, subscriptions, transactions, promotionalGrants] = await Promise.all([
      this.assembler.assemble({ projectId, customer }, Date.now()),
      this.prisma.subscription.findMany({ where: { projectId, customerId }, orderBy: { purchasedAt: 'desc' } }),
      this.prisma.transaction.findMany({ where: { projectId, customerId }, orderBy: { purchasedAt: 'desc' } }),
      this.prisma.promotionalEntitlement.findMany({
        where: { projectId, customerId },
        orderBy: { grantedAt: 'desc' },
        include: { entitlement: { select: { identifier: true } } },
      }),
    ]);

    const promotionalEntitlements: PromotionalEntitlementRow[] = promotionalGrants.map((grant) => ({
      id: grant.id,
      entitlementIdentifier: grant.entitlement.identifier,
      grantedAt: grant.grantedAt,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      note: grant.note,
    }));

    return {
      customer: {
        id: customer.id,
        appUserId: customer.appUserId,
        appleAppAccountToken: customer.appleAppAccountToken,
        googleObfuscatedId: customer.googleObfuscatedId,
        attributes: customer.attributes,
        createdAt: customer.createdAt,
        lastSeenAt: customer.lastSeenAt,
      },
      customerInfo,
      subscriptions,
      transactions,
      promotionalEntitlements,
    };
  }
}
