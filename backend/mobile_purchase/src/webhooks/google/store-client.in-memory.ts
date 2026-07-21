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
  /** Every `revokeAndRefundSubscription` call, in order — recorded even when the call rejects,
   * so specs can assert both "the store WAS asked" and "the store was NOT asked" branches. */
  readonly revokeAndRefundCalls: Array<{ packageName: string; purchaseToken: string }> = [];
  private revokeAndRefundError: Error | null = null;

  seedSubscription(packageName: string, purchaseToken: string, data: GoogleSubscriptionV2): this {
    this.subscriptions.set(subscriptionKey(packageName, purchaseToken), data);
    return this;
  }

  seedProduct(packageName: string, productId: string, purchaseToken: string, data: GoogleOneTimeProductPurchase): this {
    this.products.set(productKey(packageName, productId, purchaseToken), data);
    return this;
  }

  /** Make every subsequent `revokeAndRefundSubscription` call reject with exactly `error` (e.g. a
   * `GoogleCredentialsUnavailableError` to drive the 503 branch, or a plain `Error` for the 502
   * "store rejected" branch). Pass `null` to reset to the resolving default. Fluent, like the
   * `seed*` methods. Default (never called) = the revoke resolves, i.e. store success. */
  failRevokeAndRefundWith(error: Error | null): this {
    this.revokeAndRefundError = error;
    return this;
  }

  async getSubscriptionV2(packageName: string, purchaseToken: string): Promise<GoogleSubscriptionV2 | null> {
    return this.subscriptions.get(subscriptionKey(packageName, purchaseToken)) ?? null;
  }

  async getProduct(packageName: string, productId: string, purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null> {
    return this.products.get(productKey(packageName, productId, purchaseToken)) ?? null;
  }

  async revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void> {
    this.revokeAndRefundCalls.push({ packageName, purchaseToken });
    if (this.revokeAndRefundError) {
      throw this.revokeAndRefundError;
    }
  }
}

function subscriptionKey(packageName: string, purchaseToken: string): string {
  return `${packageName}\u0000${purchaseToken}`;
}

function productKey(packageName: string, productId: string, purchaseToken: string): string {
  return `${packageName}\u0000${productId}\u0000${purchaseToken}`;
}
