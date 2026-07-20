import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { computePromotionalExpiresAt } from '../support/promotional-duration';
import type { grantPromotionalEntitlementSchema } from '../support/promotional-entitlement.schemas';

type GrantPromotionalEntitlement = z.infer<typeof grantPromotionalEntitlementSchema>;

export interface PromotionalEntitlementGrant {
  id: string;
  entitlementIdentifier: string;
  grantedAt: Date;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
}

/**
 * Promotional-entitlement grant/revoke writes (design §1.4). `grant` validates the customer AND
 * the entitlement both belong to `projectId` (404 otherwise, ownership-404 pattern), computes
 * `expiresAt` from `duration` via the pure `promotional-duration` helper, and creates the grant.
 */
@Injectable()
export class PromotionalEntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    projectId: string,
    customerId: string,
    input: GrantPromotionalEntitlement,
  ): Promise<PromotionalEntitlementGrant> {
    const [customer, entitlement] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } }),
      this.prisma.entitlement.findFirst({
        where: { id: input.entitlementId, projectId },
        select: { id: true, identifier: true },
      }),
    ]);
    if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });
    if (!entitlement) throw new ProblemException({ status: 404, title: 'Entitlement not found' });

    const grantedAt = new Date();
    const expiresAt = computePromotionalExpiresAt(grantedAt, input.duration);

    const grant = await this.prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId,
        entitlementId: entitlement.id,
        grantedAt,
        startsAt: grantedAt,
        expiresAt,
        note: input.note ?? null,
      },
    });

    return {
      id: grant.id,
      entitlementIdentifier: entitlement.identifier,
      grantedAt: grant.grantedAt,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      note: grant.note,
    };
  }
}
