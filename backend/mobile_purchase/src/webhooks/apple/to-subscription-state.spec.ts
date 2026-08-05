import type { Subscription } from '../../../generated/client';
import { toSubscriptionState } from './to-subscription-state';

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    projectId: 'project-1',
    customerId: 'customer-1',
    appId: 'app-1',
    productId: null,
    storeProductId: 'com.myampix.premium.monthly',
    store: 'APP_STORE',
    environment: 'SANDBOX',
    status: 'ACTIVE',
    periodType: 'NORMAL',
    ownershipType: 'PURCHASED',
    originalTransactionId: 'orig-txn-1',
    purchaseToken: null,
    purchasedAt: new Date('2026-07-15T00:00:00Z'),
    originalPurchasedAt: new Date('2026-07-15T00:00:00Z'),
    expiresAt: new Date('2026-08-15T00:00:00Z'),
    autoRenewStatus: true,
    autoRenewProductId: null,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    refundedAt: null,
    priceCents: 999,
    currency: 'USD',
    lastEventAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  } as Subscription;
}

describe('toSubscriptionState', () => {
  it('projects the lifecycle-relevant fields, excluding identity/customer/app/store columns', () => {
    const row = subscriptionRow();

    expect(toSubscriptionState(row)).toEqual({
      status: 'ACTIVE',
      expiresAt: row.expiresAt,
      autoRenewStatus: true,
      autoRenewProductId: null,
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      gracePeriodExpiresAt: null,
      refundedAt: null,
      periodType: 'NORMAL',
      lastEventAt: row.lastEventAt,
      storeProductId: 'com.myampix.premium.monthly',
      purchasedAt: row.purchasedAt,
      originalPurchasedAt: row.originalPurchasedAt,
    });
  });

  it('falls back lastEventAt to the epoch when the persisted row somehow has none', () => {
    const row = subscriptionRow({ lastEventAt: null });

    expect(toSubscriptionState(row).lastEventAt).toEqual(new Date(0));
  });
});
