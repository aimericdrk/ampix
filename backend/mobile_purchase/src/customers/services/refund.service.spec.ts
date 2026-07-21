import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { InMemoryStoreClient } from '../../webhooks/google/store-client.in-memory';
import { GoogleCredentialsUnavailableError } from '../../webhooks/google/store-client.google-api';
import { computeCustomerInfo } from '../../entitlements/compute-customer-info';
import { RefundService } from './refund.service';

jest.setTimeout(180000);

/** Fixed reference clock (design §1.2 step 5 — `now` is injected, never `Date.now()`). Seeded
 * subscriptions expire 2026-08-01, so they are compute-on-read ACTIVE at this instant. */
const NOW_MS = Date.parse('2026-07-01T00:00:00.000Z');

describe('RefundService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let storeClient: InMemoryStoreClient;
  let service: RefundService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
    storeClient = new InMemoryStoreClient();
    service = new RefundService(prisma as never, storeClient);
  });

  /** An ANDROID App (with packageName) + Customer + PLAY_STORE ACTIVE subscription, overridable
   * per branch (store/status/refundedAt/purchaseToken). */
  async function seedGoogleSubscription(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
    const app = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.demo.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: `u-${randomUUID()}` } });
    const subscription = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'premium.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        purchaseToken: `token-${randomUUID()}`,
        purchasedAt: new Date('2026-06-01T00:00:00.000Z'),
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        ...overrides,
      },
    });
    return { app, customer, subscription };
  }

  async function seedTransaction(subscriptionId: string, customerId: string, appId: string, purchasedAt: Date) {
    return prisma.transaction.create({
      data: {
        projectId,
        customerId,
        appId,
        subscriptionId,
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        storeTransactionId: `order-${randomUUID()}`,
        storeProductId: 'premium.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt,
        rawPayload: {},
      },
    });
  }

  /** Rebuilds the pure-engine input from the persisted rows (the same projections M5's assembler
   * loads) so the happy path proves compute-on-read drops the entitlement after the refund
   * (design §1.2 step 6): `premium.monthly` grants the `premium` entitlement. */
  async function activeEntitlements(customerId: string): Promise<string[]> {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const subscriptions = await prisma.subscription.findMany({ where: { customerId } });
    const info = computeCustomerInfo(
      {
        customer: { appUserId: customer.appUserId, firstSeenAt: customer.createdAt, lastSeenAt: customer.lastSeenAt },
        subscriptions,
        transactions: [],
        promotionalEntitlements: [],
        entitlementsByStoreProductId: new Map([['premium.monthly', ['premium']]]),
      },
      NOW_MS,
    );
    return Object.keys(info.entitlements.active);
  }

  it('refunds an active PLAY_STORE subscription: REVOKED + refundedAt set, latest transaction revoked, older transaction untouched, store called once, entitlement drops', async () => {
    const { app, customer, subscription } = await seedGoogleSubscription();
    const older = await seedTransaction(subscription.id, customer.id, app.id, new Date('2026-05-01T00:00:00.000Z'));
    const latest = await seedTransaction(subscription.id, customer.id, app.id, new Date('2026-06-01T00:00:00.000Z'));
    expect(await activeEntitlements(customer.id)).toEqual(['premium']);

    const result = await service.refund(projectId, customer.id, subscription.id, NOW_MS);

    expect(result).toEqual({ id: subscription.id, status: 'REVOKED', refundedAt: new Date(NOW_MS) });
    const reloaded = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloaded.status).toBe('REVOKED');
    expect(reloaded.refundedAt).toEqual(new Date(NOW_MS));
    const latestReloaded = await prisma.transaction.findUniqueOrThrow({ where: { id: latest.id } });
    expect(latestReloaded.revokedAt).toEqual(new Date(NOW_MS));
    const olderReloaded = await prisma.transaction.findUniqueOrThrow({ where: { id: older.id } });
    expect(olderReloaded.revokedAt).toBeNull();
    expect(storeClient.revokeAndRefundCalls).toEqual([
      { packageName: app.packageName, purchaseToken: subscription.purchaseToken },
    ]);
    expect(await activeEntitlements(customer.id)).toEqual([]);
  });

  it('refunds a subscription with zero transactions — the transaction write is skipped, the subscription-level refund still stands', async () => {
    const { customer, subscription } = await seedGoogleSubscription();

    const result = await service.refund(projectId, customer.id, subscription.id, NOW_MS);

    expect(result.status).toBe('REVOKED');
    const reloaded = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloaded.status).toBe('REVOKED');
    expect(reloaded.refundedAt).toEqual(new Date(NOW_MS));
  });

  it('409s when the subscription is already refunded — store not called, nothing written', async () => {
    const previouslyRefundedAt = new Date('2026-06-15T00:00:00.000Z');
    const { customer, subscription } = await seedGoogleSubscription({ refundedAt: previouslyRefundedAt });

    await expect(service.refund(projectId, customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 409, title: 'This subscription has already been refunded.' },
    });

    expect(storeClient.revokeAndRefundCalls).toEqual([]);
    const reloaded = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloaded.status).toBe('ACTIVE');
    expect(reloaded.refundedAt).toEqual(previouslyRefundedAt);
  });

  it('409s for an APP_STORE subscription — store not called', async () => {
    const { customer, subscription } = await seedGoogleSubscription({
      store: 'APP_STORE',
      purchaseToken: null,
      originalTransactionId: `orig-${randomUUID()}`,
    });

    await expect(service.refund(projectId, customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 409, title: 'Refunds are only available for Google Play subscriptions.' },
    });

    expect(storeClient.revokeAndRefundCalls).toEqual([]);
  });

  it.each(['EXPIRED', 'BILLING_RETRY'] as const)(
    '409s for a %s subscription — store not called',
    async (status) => {
      const { customer, subscription } = await seedGoogleSubscription({ status });

      await expect(service.refund(projectId, customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
        problem: { status: 409, title: 'Only active subscriptions can be refunded.' },
      });

      expect(storeClient.revokeAndRefundCalls).toEqual([]);
      const reloaded = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(reloaded.status).toBe(status);
      expect(reloaded.refundedAt).toBeNull();
    },
  );

  it('503s when store credentials are unavailable — subscription and transaction unchanged', async () => {
    const { app, customer, subscription } = await seedGoogleSubscription();
    const txn = await seedTransaction(subscription.id, customer.id, app.id, new Date('2026-06-01T00:00:00.000Z'));
    storeClient.failRevokeAndRefundWith(new GoogleCredentialsUnavailableError(app.packageName ?? ''));

    await expect(service.refund(projectId, customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 503, title: 'Store credentials unavailable' },
    });

    const reloadedSub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloadedSub.status).toBe('ACTIVE');
    expect(reloadedSub.refundedAt).toBeNull();
    const reloadedTxn = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(reloadedTxn.revokedAt).toBeNull();
  });

  it('502s on a generic store error — detail carries the store message, no local writes', async () => {
    const { customer, subscription } = await seedGoogleSubscription();
    storeClient.failRevokeAndRefundWith(new Error('Google Play rejected the revoke'));

    await expect(service.refund(projectId, customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 502, title: 'Store rejected the refund', detail: 'Google Play rejected the revoke' },
    });

    const reloaded = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(reloaded.status).toBe('ACTIVE');
    expect(reloaded.refundedAt).toBeNull();
  });

  it('404s when the subscription belongs to a DIFFERENT customer in the same project — store not called', async () => {
    const { subscription } = await seedGoogleSubscription();
    const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });

    await expect(service.refund(projectId, otherCustomer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 404, title: 'Subscription not found' },
    });

    expect(storeClient.revokeAndRefundCalls).toEqual([]);
  });

  it('404s when called with a DIFFERENT projectId — store not called', async () => {
    const { customer, subscription } = await seedGoogleSubscription();

    await expect(service.refund(randomUUID(), customer.id, subscription.id, NOW_MS)).rejects.toMatchObject({
      problem: { status: 404, title: 'Subscription not found' },
    });

    expect(storeClient.revokeAndRefundCalls).toEqual([]);
  });
});
