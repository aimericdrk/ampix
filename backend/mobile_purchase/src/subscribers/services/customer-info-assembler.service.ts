import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Customer } from '../../../generated/client';
import { computeCustomerInfo } from '../../entitlements/compute-customer-info';
import type { CustomerInfo } from '../../entitlements/customer-info.types';
import { EntitlementMapService } from './entitlement-map.service';
import {
  projectCustomer,
  projectPromotionalEntitlement,
  projectSubscription,
  projectTransaction,
} from '../support/prisma-projections';

export interface AssembleCustomerInfoParams {
  projectId: string;
  /** Optional (MyRevenueCat Customers design §1.3 — dashboard detail read): when provided,
   * entitlement resolution is scoped to that single App (the SDK's existing single-App request
   * context). When omitted, the customer's entitlements are resolved PROJECT-WIDE (every App in
   * the project) — the shape a dashboard customer detail read needs, since Customer has no single
   * `appId` of its own (a customer can hold subscriptions across every App in a project, e.g. the
   * same app_user_id used on both the iOS and Android build of one mobile app). */
  appId?: string;
  customer: Customer;
}

/**
 * Loads a Customer's `Subscription`/`Transaction`/non-revoked `PromotionalEntitlement` rows and
 * the App's catalog entitlement mapping, projects them into M4b's pure input shape, and calls
 * `computeCustomerInfo`. This is the "CustomerInfo assembly" step design §5 assigns to the
 * SDK-facing endpoints — the impurity (DB I/O, `nowMs` as an injected argument) lives here so
 * `computeCustomerInfo` itself stays pure. Shared by every endpoint that needs a customer's
 * current CustomerInfo: M5a's read today, M5b's receipt intake, and design §1.2's dashboard
 * customer-detail read (`appId` omitted — project-wide resolution) — promotional grants
 * automatically apply to all of them.
 */
@Injectable()
export class CustomerInfoAssemblerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementMap: EntitlementMapService,
  ) {}

  async assemble(params: AssembleCustomerInfoParams, nowMs: number): Promise<CustomerInfo> {
    const { projectId, appId, customer } = params;

    const [subscriptions, transactions, promotionalGrants, entitlementsByStoreProductId] = await Promise.all([
      this.prisma.subscription.findMany({ where: { projectId, customerId: customer.id } }),
      this.prisma.transaction.findMany({ where: { projectId, customerId: customer.id } }),
      this.prisma.promotionalEntitlement.findMany({
        where: { projectId, customerId: customer.id, revokedAt: null },
        include: { entitlement: { select: { identifier: true } } },
      }),
      appId ? this.entitlementMap.resolveEntitlementMap(appId) : this.entitlementMap.resolveEntitlementMapForProject(projectId),
    ]);

    return computeCustomerInfo(
      {
        customer: projectCustomer(customer),
        subscriptions: subscriptions.map(projectSubscription),
        transactions: transactions.map(projectTransaction),
        promotionalEntitlements: promotionalGrants.map(projectPromotionalEntitlement),
        entitlementsByStoreProductId,
      },
      nowMs,
    );
  }
}
