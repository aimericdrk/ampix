import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import type { z } from 'zod';
import type { createProductSchema } from '../support/catalog.schemas';

type CreateProduct = z.infer<typeof createProductSchema>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateProduct) {
    const app = await this.prisma.app.findFirst({ where: { id: input.appId, projectId } });
    if (!app) throw new ProblemException({ status: 400, title: 'App does not belong to this project' });
    try {
      return await this.prisma.product.create({
        data: {
          projectId,
          appId: input.appId,
          storeProductId: input.storeProductId,
          type: input.type,
          displayName: input.displayName,
          priceCents: input.priceCents ?? null,
          currency: input.currency ?? null,
          durationIso8601: input.durationIso8601 ?? null,
          subscriptionGroupId: input.subscriptionGroupId ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Product already exists for this app' });
      throw e;
    }
  }

  list(projectId: string) {
    return this.prisma.product.findMany({ where: { projectId }, include: { entitlements: true }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!p) throw new ProblemException({ status: 404, title: 'Product not found' });
    try {
      await this.prisma.product.delete({ where: { id: productId } });
    } catch (e) {
      if (isForeignKeyViolation(e)) throw new ProblemException({ status: 409, title: 'Product is referenced by a package' });
      throw e;
    }
  }

  async attachEntitlement(projectId: string, productId: string, entitlementId: string) {
    const [product, ent] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, projectId } }),
      this.prisma.entitlement.findFirst({ where: { id: entitlementId, projectId } }),
    ]);
    if (!product) throw new ProblemException({ status: 404, title: 'Product not found' });
    if (!ent) throw new ProblemException({ status: 404, title: 'Entitlement not found' });
    try {
      await this.prisma.productEntitlement.create({ data: { productId, entitlementId } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Entitlement already attached' });
      throw e;
    }
  }

  async detachEntitlement(projectId: string, productId: string, entitlementId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!product) throw new ProblemException({ status: 404, title: 'Product not found' });
    await this.prisma.productEntitlement.deleteMany({ where: { productId, entitlementId } });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2003';
}
