import type { GoogleOneTimeProductPurchase, GoogleSubscriptionV2, StoreClient } from './store-client';

/**
 * In-memory `StoreClient` test double (design §1.2/§8: "Buildable + unit-testable against MOCKED
 * payloads (no creds)"). Seed fixtures with `seedSubscription`/`seedProduct`, then use it wherever
 * a test needs a `StoreClient` — M3b's ingest tests, the future entitlement-engine-from-webhook
 * tests, etc. Never talks to `googleapis`; has no notion of credentials at all.
 */
export class InMemoryStoreClient implements StoreClient {
  private readonly subscriptions = new Map<string, GoogleSubscriptionV2>();
  private readonly products = new Map<string, GoogleOneTimeProductPurchase>();

  seedSubscription(packageName: string, purchaseToken: string, data: GoogleSubscriptionV2): this {
    this.subscriptions.set(subscriptionKey(packageName, purchaseToken), data);
    return this;
  }

  seedProduct(packageName: string, productId: string, purchaseToken: string, data: GoogleOneTimeProductPurchase): this {
    this.products.set(productKey(packageName, productId, purchaseToken), data);
    return this;
  }

  async getSubscriptionV2(packageName: string, purchaseToken: string): Promise<GoogleSubscriptionV2 | null> {
    return this.subscriptions.get(subscriptionKey(packageName, purchaseToken)) ?? null;
  }

  async getProduct(packageName: string, productId: string, purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null> {
    return this.products.get(productKey(packageName, productId, purchaseToken)) ?? null;
  }
}

function subscriptionKey(packageName: string, purchaseToken: string): string {
  return `${packageName}\u0000${purchaseToken}`;
}

function productKey(packageName: string, productId: string, purchaseToken: string): string {
  return `${packageName}\u0000${productId}\u0000${purchaseToken}`;
}
