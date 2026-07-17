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
