import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Customer } from '../../../generated/client';
import { computeCustomerInfo } from '../../entitlements/compute-customer-info';
import type { CustomerInfo } from '../../entitlements/customer-info.types';
import { EntitlementMapService } from './entitlement-map.service';
import { projectCustomer, projectSubscription, projectTransaction } from '../support/prisma-projections';

export interface AssembleCustomerInfoParams {
  projectId: string;
  appId: string;
  customer: Customer;
}

/**
 * Loads a Customer's `Subscription`/`Transaction` rows and the App's catalog entitlement mapping,
 * projects them into M4b's pure input shape, and calls `computeCustomerInfo`. This is the
 * "CustomerInfo assembly" step design §5 assigns to the SDK-facing endpoints — the impurity
 * (DB I/O, `nowMs` as an injected argument) lives here so `computeCustomerInfo` itself stays pure.
 * Shared by every endpoint that needs a customer's current CustomerInfo: M5a's read today, M5b's
 * receipt intake next (which recomputes CustomerInfo after upserting a Transaction/Subscription).
 */
@Injectable()
export class CustomerInfoAssemblerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementMap: EntitlementMapService,
  ) {}

  async assemble(params: AssembleCustomerInfoParams, nowMs: number): Promise<CustomerInfo> {
    const { projectId, appId, customer } = params;

    const [subscriptions, transactions, entitlementsByStoreProductId] = await Promise.all([
      this.prisma.subscription.findMany({ where: { projectId, customerId: customer.id } }),
      this.prisma.transaction.findMany({ where: { projectId, customerId: customer.id } }),
      this.entitlementMap.resolveEntitlementMap(appId),
    ]);

    return computeCustomerInfo(
      {
        customer: projectCustomer(customer),
        subscriptions: subscriptions.map(projectSubscription),
        transactions: transactions.map(projectTransaction),
        entitlementsByStoreProductId,
      },
      nowMs,
    );
  }
}
