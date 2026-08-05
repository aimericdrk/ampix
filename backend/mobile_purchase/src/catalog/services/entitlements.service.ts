import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import type { createEntitlementSchema, updateEntitlementSchema } from '../support/catalog.schemas';

type CreateEntitlement = z.infer<typeof createEntitlementSchema>;
type UpdateEntitlement = z.infer<typeof updateEntitlementSchema>;

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

  async update(projectId: string, entitlementId: string, patch: UpdateEntitlement) {
    const existing = await this.prisma.entitlement.findFirst({ where: { id: entitlementId, projectId } });
    if (!existing) throw new ProblemException({ status: 404, title: 'Entitlement not found' });
    return this.prisma.entitlement.update({ where: { id: entitlementId }, data: patch });
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
