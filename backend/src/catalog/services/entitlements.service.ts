import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import type { z } from 'zod';
import type { createEntitlementSchema } from '../support/catalog.schemas';

type CreateEntitlement = z.infer<typeof createEntitlementSchema>;

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateEntitlement) {
    try {
      return await this.prisma.entitlement.create({
        data: {
          projectId,
          identifier: input.identifier,
          displayName: input.displayName,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Entitlement already exists' });
      throw e;
    }
  }

  list(projectId: string) {
    return this.prisma.entitlement.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, entitlementId: string) {
    const entitlement = await this.prisma.entitlement.findFirst({ where: { id: entitlementId, projectId } });
    if (!entitlement) throw new ProblemException({ status: 404, title: 'Entitlement not found' });
    await this.prisma.entitlement.delete({ where: { id: entitlementId } });
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
