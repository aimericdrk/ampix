import type { Customer, Subscription, Transaction } from '../../../generated/client';
import type {
  CustomerProjection,
  PromotionalEntitlementProjection,
  SubscriptionProjection,
  TransactionProjection,
} from '../../entitlements/customer-info.types';

/**
 * Narrows the persisted Prisma rows to the exact shapes `computeCustomerInfo` (M4b) accepts —
 * the pure projection step design §4/§5 assigns to the caller ("M5 loads the real rows and
 * narrows them to these shapes before calling the engine"). No I/O, no `Date.now()`: every field
 * here is a straight passthrough from the row. Shared by every endpoint that assembles
 * CustomerInfo from persisted rows: M5a's read today, M5b's receipt intake next.
 */
export function projectCustomer(customer: Customer): CustomerProjection {
  return {
    appUserId: customer.appUserId,
    firstSeenAt: customer.createdAt,
    lastSeenAt: customer.lastSeenAt,
  };
}

export function projectSubscription(subscription: Subscription): SubscriptionProjection {
  return {
    status: subscription.status,
    store: subscription.store,
    storeProductId: subscription.storeProductId,
    periodType: subscription.periodType,
    expiresAt: subscription.expiresAt,
    autoRenewStatus: subscription.autoRenewStatus,
    purchasedAt: subscription.purchasedAt,
    originalPurchasedAt: subscription.originalPurchasedAt,
    unsubscribeDetectedAt: subscription.unsubscribeDetectedAt,
    billingIssueDetectedAt: subscription.billingIssueDetectedAt,
  };
}

export function projectTransaction(transaction: Transaction): TransactionProjection {
  return {
    store: transaction.store,
    storeProductId: transaction.storeProductId,
    type: transaction.type,
    purchasedAt: transaction.purchasedAt,
    expiresAt: transaction.expiresAt,
    revokedAt: transaction.revokedAt,
  };
}

/**
 * Narrows a `PromotionalEntitlement` row (joined with its catalog `Entitlement.identifier`) to
 * the pure shape `computeCustomerInfo` (M4b, extended) accepts — design §1.2's assembler step.
 * Typed structurally against just the fields the caller's `include`/`select` produces, not the
 * full Prisma payload.
 */
export function projectPromotionalEntitlement(grant: {
  expiresAt: Date | null;
  entitlement: { identifier: string };
}): PromotionalEntitlementProjection {
  return {
    entitlementIdentifier: grant.entitlement.identifier,
    expiresAtMs: grant.expiresAt === null ? null : grant.expiresAt.getTime(),
  };
}
