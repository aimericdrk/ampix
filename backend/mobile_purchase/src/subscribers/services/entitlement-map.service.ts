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

  /**
   * Project-wide variant (MyRevenueCat Customers design §1.3's dashboard detail read): merges the
   * catalog entitlement mapping across EVERY App in the project, not just one. A dashboard
   * customer-detail read has no single-App request context — unlike the SDK
   * (`resolveEntitlementMap`, always called with the requesting App's `publicSdkKey`-resolved
   * `appId`), a Customer can hold subscriptions across every App in its project (e.g. the same
   * `app_user_id` purchasing on both the iOS and Android build of one mobile app).
   * `Product.projectId` is a direct column (design §2), so this mirrors `ProductsService.list`'s
   * `where: { projectId }` scoping rather than joining through App. A `storeProductId` reused by
   * two different Apps in the same project (schema allows it — the unique constraint
   * `@@unique([appId, storeProductId])` is per-App) has its last-seen entitlement list win;
   * harmless in practice since store product identifiers are store-specific strings that don't
   * collide across platforms.
   */
  async resolveEntitlementMapForProject(projectId: string): Promise<EntitlementLookup> {
    const products = await this.prisma.product.findMany({
      where: { projectId },
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
