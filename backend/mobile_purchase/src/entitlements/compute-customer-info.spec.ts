import { computeCustomerInfo } from './compute-customer-info';
import type {
  ComputeCustomerInfoInput,
  CustomerProjection,
  EntitlementLookup,
  SubscriptionProjection,
} from './customer-info.types';

const d = (iso: string): Date => new Date(iso);
const NOW = d('2026-07-17T00:00:00Z').getTime();

function customer(overrides: Partial<CustomerProjection> = {}): CustomerProjection {
  return {
    appUserId: 'user-1',
    firstSeenAt: d('2026-01-01T00:00:00Z'),
    lastSeenAt: d('2026-07-10T00:00:00Z'),
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionProjection> = {}): SubscriptionProjection {
  return {
    status: 'ACTIVE',
    store: 'APP_STORE',
    storeProductId: 'com.myampix.premium.monthly',
    periodType: 'NORMAL',
    expiresAt: d('2026-08-01T00:00:00Z'),
    autoRenewStatus: true,
    purchasedAt: d('2026-07-01T00:00:00Z'),
    originalPurchasedAt: d('2026-01-01T00:00:00Z'),
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    ...overrides,
  };
}

function lookup(entries: Record<string, string[]>): EntitlementLookup {
  return new Map(Object.entries(entries));
}

function input(overrides: Partial<ComputeCustomerInfoInput> = {}): ComputeCustomerInfoInput {
  return {
    customer: customer(),
    subscriptions: [],
    transactions: [],
    promotionalEntitlements: [],
    entitlementsByStoreProductId: lookup({}),
    ...overrides,
  };
}

describe('computeCustomerInfo — single active subscription', () => {
  it('produces one active entitlement with the full EntitlementInfo shape', () => {
    const sub = subscription();
    const result = computeCustomerInfo(
      input({
        subscriptions: [sub],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );

    expect(Object.keys(result.entitlements.active)).toEqual(['premium']);
    expect(result.entitlements.all).toEqual(result.entitlements.active);
    expect(result.entitlements.active.premium).toEqual({
      isActive: true,
      willRenew: true,
      periodType: 'normal',
      latestPurchaseDate: d('2026-07-01T00:00:00Z'),
      originalPurchaseDate: d('2026-01-01T00:00:00Z'),
      expirationDate: d('2026-08-01T00:00:00Z'),
      store: 'app_store',
      productIdentifier: 'com.myampix.premium.monthly',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED',
    });
  });

  it('defaults originalPurchaseDate to purchasedAt when originalPurchasedAt is null', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ originalPurchasedAt: null })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.originalPurchaseDate).toEqual(d('2026-07-01T00:00:00Z'));
  });
});

describe('compute-on-read isActive (design §4 rule 1)', () => {
  it('CANCELLED with a future expiresAt is still active, but will not renew (cancelled-still-entitled)', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [
          subscription({ status: 'CANCELLED', autoRenewStatus: false, unsubscribeDetectedAt: d('2026-07-05T00:00:00Z') }),
        ],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.isActive).toBe(true);
    expect(result.entitlements.active.premium.willRenew).toBe(false);
    expect(result.entitlements.active.premium.unsubscribeDetectedAt).toEqual(d('2026-07-05T00:00:00Z'));
  });

  it('ACTIVE status with expiresAt in the past is NOT active (compute-on-read expiry)', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'ACTIVE', expiresAt: d('2026-07-01T00:00:00Z') })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all.premium.isActive).toBe(false);
  });

  it('treats expiresAt exactly equal to nowMs as expired (strict > boundary)', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'ACTIVE', expiresAt: d('2026-07-17T00:00:00Z') })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
  });

  it('GRACE_PERIOD with a future expiresAt is active', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'GRACE_PERIOD', billingIssueDetectedAt: d('2026-07-10T00:00:00Z') })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.isActive).toBe(true);
    expect(result.entitlements.active.premium.billingIssueDetectedAt).toEqual(d('2026-07-10T00:00:00Z'));
  });

  it('BILLING_RETRY is NOT active even with a future expiresAt', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'BILLING_RETRY' })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all.premium.isActive).toBe(false);
  });

  it('PAUSED is NOT active', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'PAUSED' })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
  });

  it('EXPIRED and REVOKED are NOT active', () => {
    const expired = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'EXPIRED' })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    const revoked = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'REVOKED', storeProductId: 'com.myampix.premium.annual' })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.annual': ['premium'] }),
      }),
      NOW,
    );
    expect(expired.entitlements.active).toEqual({});
    expect(revoked.entitlements.active).toEqual({});
  });

  it('a null expiresAt never expires (still active while status is entitled)', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'ACTIVE', expiresAt: null })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.isActive).toBe(true);
  });
});

describe('willRenew (design §4 rule 2)', () => {
  it('is false when autoRenewStatus is false even on ACTIVE', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'ACTIVE', autoRenewStatus: false })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.willRenew).toBe(false);
  });

  it('is false for CANCELLED even if autoRenewStatus is (incorrectly) true', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'CANCELLED', autoRenewStatus: true })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.willRenew).toBe(false);
  });
});

describe('promotional entitlements (design §1.2)', () => {
  it('a promotional grant produces an active, promotionally-sourced entitlement', () => {
    const result = computeCustomerInfo(
      input({
        promotionalEntitlements: [
          { entitlementIdentifier: 'premium', expiresAtMs: d('2026-08-01T00:00:00Z').getTime() },
        ],
      }),
      NOW,
    );
    expect(result.entitlements.active.premium).toEqual({
      isActive: true,
      willRenew: false,
      periodType: 'normal',
      latestPurchaseDate: new Date(NOW),
      originalPurchaseDate: new Date(NOW),
      expirationDate: d('2026-08-01T00:00:00Z'),
      store: 'promotional',
      productIdentifier: 'promotional',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED',
    });
  });

  it('a lifetime promotional grant (expiresAtMs: null) is active with a null expirationDate', () => {
    const result = computeCustomerInfo(
      input({ promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: null }] }),
      NOW,
    );
    expect(result.entitlements.active.premium.isActive).toBe(true);
    expect(result.entitlements.active.premium.expirationDate).toBeNull();
  });

  it('an expired promotional grant (expiresAtMs in the past) contributes nothing, not even to `.all`', () => {
    const result = computeCustomerInfo(
      input({
        promotionalEntitlements: [
          { entitlementIdentifier: 'premium', expiresAtMs: d('2026-07-01T00:00:00Z').getTime() },
        ],
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all).toEqual({});
  });

  it('treats expiresAtMs exactly equal to nowMs as expired (strict > boundary, same as subscriptions)', () => {
    const result = computeCustomerInfo(
      input({ promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: NOW }] }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
  });

  it('a revoked grant never reaches the engine — the caller\'s revokedAt: null query keeps it out of the array, so it contributes nothing', () => {
    const result = computeCustomerInfo(input({ promotionalEntitlements: [] }), NOW);
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all).toEqual({});
  });

  it('merge: when the promotional grant expires after the store subscription, the promotional backing wins', () => {
    const sub = subscription({ status: 'ACTIVE', expiresAt: d('2026-08-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        subscriptions: [sub],
        promotionalEntitlements: [
          { entitlementIdentifier: 'premium', expiresAtMs: d('2026-09-01T00:00:00Z').getTime() },
        ],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.store).toBe('promotional');
    expect(result.entitlements.active.premium.expirationDate).toEqual(d('2026-09-01T00:00:00Z'));
  });

  it('merge: when the store subscription expires after the promotional grant, the store backing wins', () => {
    const sub = subscription({ status: 'ACTIVE', expiresAt: d('2026-09-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        subscriptions: [sub],
        promotionalEntitlements: [
          { entitlementIdentifier: 'premium', expiresAtMs: d('2026-08-01T00:00:00Z').getTime() },
        ],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.store).toBe('app_store');
    expect(result.entitlements.active.premium.expirationDate).toEqual(d('2026-09-01T00:00:00Z'));
  });

  it('merge: a lifetime promotional grant (expiresAtMs: null) always wins over a dated store subscription', () => {
    const sub = subscription({ status: 'ACTIVE', expiresAt: d('2099-01-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        subscriptions: [sub],
        promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: null }],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.store).toBe('promotional');
    expect(result.entitlements.active.premium.expirationDate).toBeNull();
  });
});
