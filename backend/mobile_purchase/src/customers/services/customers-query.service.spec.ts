import { randomUUID } from 'node:crypto';
import { PrismaClient, type SubscriptionStatus } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { CustomersQueryService } from './customers-query.service';

jest.setTimeout(180000);

describe('CustomersQueryService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomersQueryService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomersQueryService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('returns an empty page for a project with no customers', async () => {
    await expect(service.list(projectId, { limit: 25 })).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('lists customers newest-first with zeroed aggregates when none have subscriptions/transactions', async () => {
    const older = await prisma.customer.create({
      data: { projectId, appUserId: 'alice', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const newer = await prisma.customer.create({
      data: { projectId, appUserId: 'bob', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const result = await service.list(projectId, { limit: 25 });

    expect(result.items.map((i) => i.id)).toEqual([newer.id, older.id]);
    expect(result.items[0]).toMatchObject({
      appUserId: 'bob',
      activeSubscriptionCount: 0,
      totalSpentCents: 0,
      currency: null,
    });
    expect(result.nextCursor).toBeNull();
  });

  it('filters by appUserId, case-insensitive contains', async () => {
    await prisma.customer.create({ data: { projectId, appUserId: 'Alice-Wonderland' } });
    await prisma.customer.create({ data: { projectId, appUserId: 'bob-builder' } });

    const result = await service.list(projectId, { search: 'wonder', limit: 25 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].appUserId).toBe('Alice-Wonderland');
  });

  it('scopes to the given project — a customer in another project never appears', async () => {
    await prisma.customer.create({ data: { projectId: randomUUID(), appUserId: 'someone-elses-user' } });
    await prisma.customer.create({ data: { projectId, appUserId: 'my-user' } });

    const result = await service.list(projectId, { limit: 25 });

    expect(result.items.map((i) => i.appUserId)).toEqual(['my-user']);
  });

  it('paginates via keyset cursor — page 1 + page 2 + page 3 cover every customer with no overlap', async () => {
    const customers = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        prisma.customer.create({
          data: { projectId, appUserId: `user-${i}`, createdAt: new Date(2026, 0, 1 + i) },
        }),
      ),
    );
    const expectedNewestFirst = [...customers].reverse().map((c) => c.id);

    const page1 = await service.list(projectId, { limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(expectedNewestFirst.slice(0, 2));
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.list(projectId, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(expectedNewestFirst.slice(2, 4));
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await service.list(projectId, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((i) => i.id)).toEqual(expectedNewestFirst.slice(4, 5));
    expect(page3.nextCursor).toBeNull();
  });

  it('breaks ties on id DESC when two customers share the exact same createdAt — no gap, no overlap across pages', async () => {
    const sharedCreatedAt = new Date('2026-03-01T00:00:00.000Z');
    const [a, b] = await Promise.all([
      prisma.customer.create({ data: { projectId, appUserId: 'tie-a', createdAt: sharedCreatedAt } }),
      prisma.customer.create({ data: { projectId, appUserId: 'tie-b', createdAt: sharedCreatedAt } }),
    ]);
    // Expected order is id DESC (the tiebreak) — larger uuid string first.
    const expectedIds = [a.id, b.id].sort().reverse();

    const page1 = await service.list(projectId, { limit: 1 });
    expect(page1.items.map((i) => i.id)).toEqual(expectedIds.slice(0, 1));
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.list(projectId, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(expectedIds.slice(1, 2));
    expect(page2.nextCursor).toBeNull();

    // No gap, no overlap: the two pages together are exactly {a, b}, each exactly once.
    expect([...page1.items, ...page2.items].map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('counts activeSubscriptionCount only for TRIAL/INTRO/ACTIVE/CANCELLED/GRACE_PERIOD statuses', async () => {
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: `com.a.${randomUUID()}`, publicSdkKey: `mp_pub_test_${randomUUID()}` },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'sub-user' } });
    const statuses: SubscriptionStatus[] = [
      'TRIAL',
      'INTRO',
      'ACTIVE',
      'CANCELLED',
      'GRACE_PERIOD',
      'BILLING_RETRY',
      'PAUSED',
      'EXPIRED',
      'REVOKED',
    ];
    for (const status of statuses) {
      await prisma.subscription.create({
        data: {
          projectId,
          customerId: customer.id,
          appId: app.id,
          storeProductId: `product-${status}`,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          status,
          originalTransactionId: `orig-${randomUUID()}`,
          purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
    }

    const result = await service.list(projectId, { limit: 25 });
    expect(result.items[0].activeSubscriptionCount).toBe(5);
  });

  it('sums totalSpentCents from non-revoked transactions and picks the dominant currency', async () => {
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: `com.b.${randomUUID()}`, publicSdkKey: `mp_pub_test_${randomUUID()}` },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'spend-user' } });
    await prisma.transaction.createMany({
      data: [
        {
          projectId,
          customerId: customer.id,
          appId: app.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `t1-${randomUUID()}`,
          storeProductId: 'p1',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
          priceCents: 1000,
          currency: 'USD',
          rawPayload: {},
        },
        {
          projectId,
          customerId: customer.id,
          appId: app.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `t2-${randomUUID()}`,
          storeProductId: 'p1',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date('2026-01-02T00:00:00.000Z'),
          priceCents: 500,
          currency: 'USD',
          rawPayload: {},
        },
        {
          projectId,
          customerId: customer.id,
          appId: app.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `t3-${randomUUID()}`,
          storeProductId: 'p2',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date('2026-01-03T00:00:00.000Z'),
          priceCents: 200,
          currency: 'EUR',
          rawPayload: {},
        },
        {
          projectId,
          customerId: customer.id,
          appId: app.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `t4-revoked-${randomUUID()}`,
          storeProductId: 'p1',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date('2026-01-04T00:00:00.000Z'),
          priceCents: 9999,
          currency: 'USD',
          revokedAt: new Date('2026-01-05T00:00:00.000Z'),
          rawPayload: {},
        },
      ],
    });

    const result = await service.list(projectId, { limit: 25 });
    expect(result.items[0]).toMatchObject({
      totalSpentCents: 1700, // 1000 + 500 + 200; the revoked 9999 is excluded
      currency: 'USD', // 1500 USD > 200 EUR
    });
  });

  it('rejects a malformed cursor with a 400 problem', async () => {
    await expect(service.list(projectId, { limit: 25, cursor: 'not-a-real-cursor' })).rejects.toMatchObject({
      problem: { status: 400 },
    });
  });
});
