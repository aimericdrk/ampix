import { randomUUID } from 'node:crypto';
import type { Customer, Subscription, Transaction } from '../../../generated/client';
import { projectCustomer, projectSubscription, projectTransaction } from './prisma-projections';

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    appUserId: 'user-1',
    appleAppAccountToken: null,
    googleObfuscatedId: null,
    attributes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: null,
    ...overrides,
  };
}

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    customerId: randomUUID(),
    appId: randomUUID(),
    productId: null,
    storeProductId: 'com.a.b.monthly',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    status: 'ACTIVE',
    periodType: 'NORMAL',
    ownershipType: 'PURCHASED',
    originalTransactionId: 'orig-txn-1',
    purchaseToken: null,
    purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
    originalPurchasedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    autoRenewStatus: true,
    autoRenewProductId: null,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    refundedAt: null,
    priceCents: 999,
    currency: 'USD',
    lastEventAt: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    customerId: randomUUID(),
    appId: randomUUID(),
    subscriptionId: null,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    storeTransactionId: 'txn-1',
    originalTransactionId: null,
    storeProductId: 'com.a.b.lifetime',
    type: 'NON_CONSUMABLE',
    purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    priceCents: 4999,
    currency: 'USD',
    isTrialPeriod: false,
    revokedAt: null,
    rawPayload: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('prisma-projections', () => {
  it('projects a Customer row to CustomerProjection', () => {
    const customer = makeCustomer({ appUserId: 'user-42', lastSeenAt: new Date('2026-03-01T00:00:00.000Z') });
    expect(projectCustomer(customer)).toEqual({
      appUserId: 'user-42',
      firstSeenAt: customer.createdAt,
      lastSeenAt: customer.lastSeenAt,
    });
  });

  it('projects a Subscription row to SubscriptionProjection, dropping fields the engine does not read', () => {
    const subscription = makeSubscription();
    expect(projectSubscription(subscription)).toEqual({
      status: 'ACTIVE',
      store: 'APP_STORE',
      storeProductId: 'com.a.b.monthly',
      periodType: 'NORMAL',
      expiresAt: subscription.expiresAt,
      autoRenewStatus: true,
      purchasedAt: subscription.purchasedAt,
      originalPurchasedAt: subscription.originalPurchasedAt,
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
    });
  });

  it('projects a Transaction row to TransactionProjection, dropping fields the engine does not read', () => {
    const transaction = makeTransaction();
    expect(projectTransaction(transaction)).toEqual({
      store: 'APP_STORE',
      storeProductId: 'com.a.b.lifetime',
      type: 'NON_CONSUMABLE',
      purchasedAt: transaction.purchasedAt,
      expiresAt: null,
      revokedAt: null,
    });
  });
});
