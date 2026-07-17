import { InMemoryStoreClient } from './store-client.in-memory';

describe('InMemoryStoreClient', () => {
  it('returns null for an unseeded subscription purchase token', async () => {
    const client = new InMemoryStoreClient();

    await expect(client.getSubscriptionV2('com.myampix.app', 'unknown-token')).resolves.toBeNull();
  });

  it('returns the seeded subscription for the exact (packageName, purchaseToken) pair', async () => {
    const client = new InMemoryStoreClient();
    client.seedSubscription('com.myampix.app', 'token-1', {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      latestOrderId: 'GPA.1234',
      lineItems: [{ productId: 'gold-monthly', expiryTime: '2026-08-15T00:00:00Z', autoRenewingPlan: { autoRenewEnabled: true } }],
      externalAccountIdentifiers: { obfuscatedExternalAccountId: 'customer-abc' },
    });

    await expect(client.getSubscriptionV2('com.myampix.app', 'token-1')).resolves.toMatchObject({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      latestOrderId: 'GPA.1234',
    });
  });

  it('does not cross-resolve a different packageName with the same purchaseToken', async () => {
    const client = new InMemoryStoreClient();
    client.seedSubscription('com.myampix.app', 'token-1', {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [],
    });

    await expect(client.getSubscriptionV2('com.other.app', 'token-1')).resolves.toBeNull();
  });

  it('returns null for an unseeded one-time product', async () => {
    const client = new InMemoryStoreClient();

    await expect(client.getProduct('com.myampix.app', 'coins_500', 'token-2')).resolves.toBeNull();
  });

  it('returns the seeded one-time product for the exact (packageName, productId, purchaseToken) triple', async () => {
    const client = new InMemoryStoreClient();
    client.seedProduct('com.myampix.app', 'coins_500', 'token-2', {
      purchaseState: 0,
      productId: 'coins_500',
      purchaseToken: 'token-2',
    });

    await expect(client.getProduct('com.myampix.app', 'coins_500', 'token-2')).resolves.toMatchObject({
      purchaseState: 0,
      productId: 'coins_500',
    });
  });
});
