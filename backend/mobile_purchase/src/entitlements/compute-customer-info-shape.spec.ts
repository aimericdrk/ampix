import { computeCustomerInfo } from './compute-customer-info';
import type {
  ComputeCustomerInfoInput,
  CustomerProjection,
  EntitlementLookup,
  SubscriptionProjection,
  TransactionProjection,
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

function transaction(overrides: Partial<TransactionProjection> = {}): TransactionProjection {
  return {
    store: 'APP_STORE',
    storeProductId: 'com.myampix.lifetime',
    type: 'NON_CONSUMABLE',
    purchasedAt: d('2026-01-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
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

describe('multiple products granting the same entitlement (design §4 rule 3)', () => {
  it('is active if ANY backing subscription is active, with fields from the active one', () => {
    const activeSub = subscription({ storeProductId: 'com.myampix.premium.monthly', status: 'ACTIVE' });
    const expiredSub = subscription({
      storeProductId: 'com.myampix.premium.annual',
      status: 'EXPIRED',
      expiresAt: d('2026-06-01T00:00:00Z'),
    });
    const result = computeCustomerInfo(
      input({
        subscriptions: [expiredSub, activeSub],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.premium.annual': ['premium'],
        }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.isActive).toBe(true);
    expect(result.entitlements.active.premium.productIdentifier).toBe('com.myampix.premium.monthly');
  });

  it('picks the latest-expiring ACTIVE backing when multiple are active', () => {
    const sooner = subscription({ storeProductId: 'com.myampix.premium.monthly', expiresAt: d('2026-08-01T00:00:00Z') });
    const later = subscription({ storeProductId: 'com.myampix.premium.annual', expiresAt: d('2027-01-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        subscriptions: [sooner, later],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.premium.annual': ['premium'],
        }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.productIdentifier).toBe('com.myampix.premium.annual');
    expect(result.entitlements.active.premium.expirationDate).toEqual(d('2027-01-01T00:00:00Z'));
  });

  it('breaks an expiresAt tie by the most recent purchasedAt', () => {
    const older = subscription({
      storeProductId: 'com.myampix.premium.monthly',
      expiresAt: d('2026-08-01T00:00:00Z'),
      purchasedAt: d('2026-06-01T00:00:00Z'),
    });
    const newer = subscription({
      storeProductId: 'com.myampix.premium.annual',
      expiresAt: d('2026-08-01T00:00:00Z'),
      purchasedAt: d('2026-07-10T00:00:00Z'),
    });
    const result = computeCustomerInfo(
      input({
        subscriptions: [older, newer],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.premium.annual': ['premium'],
        }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.productIdentifier).toBe('com.myampix.premium.annual');
  });

  it('falls back to the most-recently-expired backing for `.all` when none are active', () => {
    const longerAgo = subscription({
      storeProductId: 'com.myampix.premium.monthly',
      status: 'EXPIRED',
      expiresAt: d('2026-05-01T00:00:00Z'),
    });
    const mostRecent = subscription({
      storeProductId: 'com.myampix.premium.annual',
      status: 'EXPIRED',
      expiresAt: d('2026-06-15T00:00:00Z'),
    });
    const result = computeCustomerInfo(
      input({
        subscriptions: [longerAgo, mostRecent],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.premium.annual': ['premium'],
        }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all.premium.productIdentifier).toBe('com.myampix.premium.annual');
  });
});

describe('lifetime / non-renewing transactions (design §4 rule 4)', () => {
  it('a NON_CONSUMABLE transaction with no expiresAt/revokedAt grants permanently', () => {
    const tx = transaction({ storeProductId: 'com.myampix.lifetime', type: 'NON_CONSUMABLE', purchasedAt: d('2026-02-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        transactions: [tx],
        entitlementsByStoreProductId: lookup({ 'com.myampix.lifetime': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium).toEqual({
      isActive: true,
      willRenew: false,
      periodType: 'normal',
      latestPurchaseDate: d('2026-02-01T00:00:00Z'),
      originalPurchaseDate: d('2026-02-01T00:00:00Z'),
      expirationDate: null,
      store: 'app_store',
      productIdentifier: 'com.myampix.lifetime',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED',
    });
  });

  it('a NON_RENEWING_SUBSCRIPTION transaction also grants permanently', () => {
    const tx = transaction({ storeProductId: 'com.myampix.season-pass', type: 'NON_RENEWING_SUBSCRIPTION' });
    const result = computeCustomerInfo(
      input({
        transactions: [tx],
        entitlementsByStoreProductId: lookup({ 'com.myampix.season-pass': ['season'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active.season.isActive).toBe(true);
  });

  it('a CONSUMABLE transaction does NOT grant an entitlement even with no expiresAt/revokedAt', () => {
    const tx = transaction({ storeProductId: 'com.myampix.coins', type: 'CONSUMABLE' });
    const result = computeCustomerInfo(
      input({
        transactions: [tx],
        entitlementsByStoreProductId: lookup({ 'com.myampix.coins': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.all).toEqual({});
  });

  it('a revoked transaction contributes NO entitlement at all (not even to `.all`)', () => {
    const tx = transaction({ revokedAt: d('2026-03-01T00:00:00Z') });
    const result = computeCustomerInfo(
      input({
        transactions: [tx],
        entitlementsByStoreProductId: lookup({ 'com.myampix.lifetime': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.all).toEqual({});
    expect(result.entitlements.active).toEqual({});
  });

  it('a transaction that still carries an expiresAt (a renewal record) is not treated as a standalone lifetime backing', () => {
    const tx = transaction({
      storeProductId: 'com.myampix.premium.monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      expiresAt: d('2026-08-01T00:00:00Z'),
    });
    const result = computeCustomerInfo(
      input({
        transactions: [tx],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.all).toEqual({});
  });

  it('a subscription and a lifetime transaction can both back the same entitlement — combined active', () => {
    const sub = subscription({ status: 'EXPIRED', expiresAt: d('2026-06-01T00:00:00Z') });
    const tx = transaction({ storeProductId: 'com.myampix.lifetime' });
    const result = computeCustomerInfo(
      input({
        subscriptions: [sub],
        transactions: [tx],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.lifetime': ['premium'],
        }),
      }),
      NOW,
    );
    expect(result.entitlements.active.premium.productIdentifier).toBe('com.myampix.lifetime');
    expect(result.entitlements.active.premium.expirationDate).toBeNull();
  });
});

describe('unimported store product (design §4 rule 5)', () => {
  it('a storeProductId absent from the map grants no entitlement, gracefully', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ storeProductId: 'com.myampix.not-imported' })],
        transactions: [transaction({ storeProductId: 'com.myampix.also-not-imported' })],
        entitlementsByStoreProductId: lookup({}),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(result.entitlements.all).toEqual({});
  });

  it('still appears in the `subscriptions` summary even when unimported', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ storeProductId: 'com.myampix.not-imported' })],
        entitlementsByStoreProductId: lookup({}),
      }),
      NOW,
    );
    expect(result.subscriptions).toHaveLength(1);
    expect(result.subscriptions[0].storeProductId).toBe('com.myampix.not-imported');
  });
});

describe('active vs all split (design §5)', () => {
  it('an expired entitlement appears in `all` but not `active`', () => {
    const result = computeCustomerInfo(
      input({
        subscriptions: [subscription({ status: 'EXPIRED', expiresAt: d('2026-06-01T00:00:00Z') })],
        entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
      }),
      NOW,
    );
    expect(result.entitlements.active).toEqual({});
    expect(Object.keys(result.entitlements.all)).toEqual(['premium']);
    expect(result.entitlements.all.premium.isActive).toBe(false);
  });

  it('active is exactly the isActive subset of all when there are multiple entitlements', () => {
    const activeSub = subscription({ storeProductId: 'com.myampix.premium.monthly', status: 'ACTIVE' });
    const expiredSub = subscription({
      storeProductId: 'com.myampix.other',
      status: 'EXPIRED',
      expiresAt: d('2026-06-01T00:00:00Z'),
    });
    const result = computeCustomerInfo(
      input({
        subscriptions: [activeSub, expiredSub],
        entitlementsByStoreProductId: lookup({
          'com.myampix.premium.monthly': ['premium'],
          'com.myampix.other': ['other'],
        }),
      }),
      NOW,
    );
    expect(Object.keys(result.entitlements.active)).toEqual(['premium']);
    expect(Object.keys(result.entitlements.all).sort()).toEqual(['other', 'premium']);
  });
});

describe('subscriptions summary array (design §5)', () => {
  it('includes every input subscription with the RC-shaped fields, regardless of entitlement mapping', () => {
    const sub = subscription({ status: 'CANCELLED', autoRenewStatus: false, periodType: 'TRIAL' });
    const result = computeCustomerInfo(input({ subscriptions: [sub] }), NOW);
    expect(result.subscriptions).toEqual([
      {
        storeProductId: 'com.myampix.premium.monthly',
        store: 'app_store',
        isActive: true,
        willRenew: false,
        expirationDate: d('2026-08-01T00:00:00Z'),
        periodType: 'trial',
      },
    ]);
  });

  it('maps PLAY_STORE to play_store', () => {
    const result = computeCustomerInfo(input({ subscriptions: [subscription({ store: 'PLAY_STORE' })] }), NOW);
    expect(result.subscriptions[0].store).toBe('play_store');
  });
});

describe('firstSeen / lastSeen', () => {
  it('passes through firstSeenAt and lastSeenAt', () => {
    const result = computeCustomerInfo(
      input({ customer: customer({ firstSeenAt: d('2026-01-01T00:00:00Z'), lastSeenAt: d('2026-07-15T00:00:00Z') }) }),
      NOW,
    );
    expect(result.firstSeen).toEqual(d('2026-01-01T00:00:00Z'));
    expect(result.lastSeen).toEqual(d('2026-07-15T00:00:00Z'));
  });

  it('defaults lastSeen to firstSeen when lastSeenAt is null', () => {
    const result = computeCustomerInfo(
      input({ customer: customer({ firstSeenAt: d('2026-01-01T00:00:00Z'), lastSeenAt: null }) }),
      NOW,
    );
    expect(result.lastSeen).toEqual(d('2026-01-01T00:00:00Z'));
  });
});

describe('managementURL (best-effort)', () => {
  it('returns the static Apple URL when there is an active App Store subscription', () => {
    const result = computeCustomerInfo(input({ subscriptions: [subscription({ store: 'APP_STORE' })] }), NOW);
    expect(result.managementURL).toBe('https://apps.apple.com/account/subscriptions');
  });

  it('is undefined for a Google-only active subscription (package name not derivable)', () => {
    const result = computeCustomerInfo(input({ subscriptions: [subscription({ store: 'PLAY_STORE' })] }), NOW);
    expect(result.managementURL).toBeUndefined();
  });

  it('is undefined when there are no active subscriptions', () => {
    const result = computeCustomerInfo(
      input({ subscriptions: [subscription({ status: 'EXPIRED', expiresAt: d('2026-06-01T00:00:00Z') })] }),
      NOW,
    );
    expect(result.managementURL).toBeUndefined();
  });

  it('is undefined when there are no subscriptions at all', () => {
    const result = computeCustomerInfo(input(), NOW);
    expect(result.managementURL).toBeUndefined();
  });
});
