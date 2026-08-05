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

  /**
   * Revokes a promotional grant (design §1.4). Double-scoped: the customer must belong to
   * `projectId`, and the grant must belong to that customer — either mismatch 404s. Idempotent:
   * revoking an already-revoked grant is a silent no-op (no second `revokedAt` write).
   */
  async revoke(projectId: string, customerId: string, grantId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } });
    if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });

    const grant = await this.prisma.promotionalEntitlement.findFirst({
      where: { id: grantId, customerId },
      select: { id: true, revokedAt: true },
    });
    if (!grant) throw new ProblemException({ status: 404, title: 'Promotional entitlement grant not found' });
    if (grant.revokedAt) return;

    await this.prisma.promotionalEntitlement.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
  }
}
