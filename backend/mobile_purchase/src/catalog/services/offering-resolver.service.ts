import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedOffering } from '../catalog.types';

@Injectable()
export class OfferingResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** The offering the SDK should show right now: the project's single `isCurrent` offering, with
   * packages sorted for display and each product's entitlements flattened to identifier strings. */
  async resolveCurrentOffering(projectId: string): Promise<ResolvedOffering | null> {
    const offering = await this.prisma.offering.findFirst({
      where: { projectId, isCurrent: true },
      include: {
        packages: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { include: { entitlements: { include: { entitlement: true } } } } },
        },
      },
    });
    if (!offering) return null;
    return {
      identifier: offering.identifier,
      metadata: offering.metadata,
      packages: offering.packages.map((pkg) => ({
        identifier: pkg.identifier,
        packageType: pkg.packageType,
        product: {
          storeProductId: pkg.product.storeProductId,
          type: pkg.product.type,
          priceCents: pkg.product.priceCents,
          currency: pkg.product.currency,
          durationIso8601: pkg.product.durationIso8601,
          entitlements: pkg.product.entitlements.map((pe) => pe.entitlement.identifier),
        },
      })),
    };
  }
}
