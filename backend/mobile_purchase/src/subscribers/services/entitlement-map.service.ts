import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { EntitlementLookup } from '../../entitlements/customer-info.types';

/**
 * Resolves the `entitlementsByStoreProductId` map `computeCustomerInfo` (M4b) needs: walks the
 * catalog `Product -> ProductEntitlement -> Entitlement` join (design §2: "Entitlements flow
 * `Product -> ProductEntitlement -> Entitlement`") for a single App and returns
 * `storeProductId -> entitlement identifier[]`. Read-only, no writes. A `storeProductId` with no
 * mapped entitlement is simply absent from the map — `computeCustomerInfo` treats a missing key
 * as "grants nothing" (design §4 rule 5), so an unimported/unmapped product needs no special
 * casing here.
 */
@Injectable()
export class EntitlementMapService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEntitlementMap(appId: string): Promise<EntitlementLookup> {
    const products = await this.prisma.product.findMany({
      where: { appId },
      select: {
        storeProductId: true,
        entitlements: { select: { entitlement: { select: { identifier: true } } } },
      },
    });

    const map: Map<string, string[]> = new Map();
    for (const product of products) {
      const identifiers = product.entitlements.map((pe) => pe.entitlement.identifier);
      if (identifiers.length === 0) continue;
      map.set(product.storeProductId, identifiers);
    }
    return map;
  }
}
