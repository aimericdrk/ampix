import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import type { createProductSchema, updateProductSchema } from '../support/catalog.schemas';

type CreateProduct = z.infer<typeof createProductSchema>;
type UpdateProduct = z.infer<typeof updateProductSchema>;

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

  async list(projectId: string) {
    const products = await this.prisma.product.findMany({
      where: { projectId },
      include: { entitlements: { include: { entitlement: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // Map the join rows (`ProductEntitlement { productId, entitlementId }`) down to the shape the
    // admin API contract (spec §9, dashboard `RcProduct.entitlements: RcEntitlement[]`) documents:
    // `{ id, identifier, displayName }[]`, sorted deterministically for stable list rendering.
    // Only pick those three fields — the full `Entitlement` row also carries `projectId`/`createdAt`,
    // which are not part of the documented contract.
    return products.map(({ entitlements, ...product }) => ({
      ...product,
      entitlements: entitlements
        .map(({ entitlement }) => ({
          id: entitlement.id,
          identifier: entitlement.identifier,
          displayName: entitlement.displayName,
        }))
        .sort((a, b) => a.identifier.localeCompare(b.identifier)),
    }));
  }

  async update(projectId: string, productId: string, patch: UpdateProduct) {
    const existing = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!existing) throw new ProblemException({ status: 404, title: 'Product not found' });
    return this.prisma.product.update({ where: { id: productId }, data: patch });
  }

  async remove(projectId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!p) throw new ProblemException({ status: 404, title: 'Product not found' });
    try {
      await this.prisma.product.delete({ where: { id: productId } });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new ProblemException({ status: 409, title: 'Product is referenced by a package and cannot be deleted' });
      }
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

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Prisma P2003 = foreign key constraint violation (e.g. deleting a Product whose Package still
 * references it via an onDelete: Restrict relation). */
function isForeignKeyViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2003';
}
