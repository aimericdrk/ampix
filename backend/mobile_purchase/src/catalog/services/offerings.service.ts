import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import type { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';

type CreateOffering = z.infer<typeof createOfferingSchema>;
type CreatePackage = z.infer<typeof createPackageSchema>;

@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateOffering) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.offering.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } });
      }
      try {
        return await tx.offering.create({
          data: {
            projectId,
            identifier: input.identifier,
            displayName: input.displayName,
            isCurrent: input.isCurrent ?? false,
            metadata: (input.metadata ?? undefined) as never,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Offering identifier already exists' });
        throw e;
      }
    });
  }

  async setCurrent(projectId: string, offeringId: string) {
    const offering = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.$transaction([
      this.prisma.offering.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } }),
      this.prisma.offering.update({ where: { id: offeringId }, data: { isCurrent: true } }),
    ]);
  }

  list(projectId: string) {
    return this.prisma.offering.findMany({ where: { projectId }, include: { packages: true }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, offeringId: string) {
    const o = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!o) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.offering.delete({ where: { id: offeringId } });
  }

  async addPackage(projectId: string, offeringId: string, input: CreatePackage) {
    const [offering, product] = await Promise.all([
      this.prisma.offering.findFirst({ where: { id: offeringId, projectId } }),
      this.prisma.product.findFirst({ where: { id: input.productId, projectId } }),
    ]);
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    if (!product) throw new ProblemException({ status: 400, title: 'Product does not belong to this project' });
    try {
      return await this.prisma.package.create({
        data: {
          offeringId,
          identifier: input.identifier,
          packageType: input.packageType,
          productId: input.productId,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Package identifier already exists in this offering' });
      throw e;
    }
  }

  async removePackage(projectId: string, offeringId: string, packageId: string) {
    const offering = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.package.deleteMany({ where: { id: packageId, offeringId } });
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
