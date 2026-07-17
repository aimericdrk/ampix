import type { Subscription } from '../../../generated/client';
import type { SubscriptionState } from '../../subscriptions/lifecycle/subscription-lifecycle.types';

/**
 * Projects a persisted `Subscription` row into the M4a `SubscriptionState` shape the reducer
 * (`applyLifecycleEvent`) expects — the mutable lifecycle fields only, none of the
 * identity/customer/app/store columns (design §2; see `subscription-lifecycle.types.ts`'s own
 * docstring for why those are excluded). M2b owns resolving *which* row an event applies to and
 * merging the reducer's output back with those excluded columns — this is the read-side half of
 * that job.
 *
 * `lastEventAt` is nullable in the schema (a defensive DB-level allowance) but always populated by
 * this handler's own write path (`createInitialState` in the reducer always sets it on the first
 * persisted row). Falls back to the epoch when somehow null so the reducer's ordering guard never
 * spuriously blocks an otherwise-valid event against such a row, rather than mis-comparing against
 * `undefined`.
 */
export function toSubscriptionState(row: Subscription): SubscriptionState {
  return {
    status: row.status,
    expiresAt: row.expiresAt,
    autoRenewStatus: row.autoRenewStatus,
    autoRenewProductId: row.autoRenewProductId,
    unsubscribeDetectedAt: row.unsubscribeDetectedAt,
    billingIssueDetectedAt: row.billingIssueDetectedAt,
    gracePeriodExpiresAt: row.gracePeriodExpiresAt,
    refundedAt: row.refundedAt,
    periodType: row.periodType,
    lastEventAt: row.lastEventAt ?? new Date(0),
    storeProductId: row.storeProductId,
    purchasedAt: row.purchasedAt,
    originalPurchasedAt: row.originalPurchasedAt,
  };
}
