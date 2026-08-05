import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../test/integration/helpers/containers';
import { computeCustomerInfo } from '../entitlements/compute-customer-info';
import {
  SubscriptionExpirySweepService,
  EXPIRY_SWEEP_LOCK_KEY,
} from './subscription-expiry-sweep.service';

jest.setTimeout(180000);

/** Fixed reference clock — all seeded expiries are relative to this instant. */
const NOW_MS = Date.parse('2026-07-01T00:00:00.000Z');
const PAST = new Date('2026-06-01T00:00:00.000Z');
const FUTURE = new Date('2026-08-01T00:00:00.000Z');

describe('SubscriptionExpirySweepService', () => {
  let container: StartedPostgreSqlContainer;
  let containerUrl: string;
  let prisma: PrismaClient;
  let service: SubscriptionExpirySweepService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    containerUrl = started.url;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    // The sweep is a deliberately global, non-project-scoped query (a cron job sweeps every
    // project in one pass — see the raw-SQL candidate selection in `runBatch`). That means every
    // test in this file shares one Postgres container with no natural isolation between them.
    // Reset the swept tables before each test so every test's `sweep()` call only ever sees that
    // test's own freshly-seeded rows.
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.app.deleteMany();
    projectId = randomUUID();
    service = new SubscriptionExpirySweepService(prisma as never);
  });

  /** A Google (PLAY_STORE) subscription is the default; overridable per case. `lastEventAt` defaults
   * to `purchasedAt` (before expiry) so the synthesized EXPIRED event's occurredAt (= expiry) wins. */
  async function seedSubscription(overrides: Partial<Prisma.SubscriptionUncheckedCreateInput> = {}) {
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
        purchasedAt: PAST,
        originalPurchasedAt: PAST,
        expiresAt: PAST,
        autoRenewStatus: true,
        periodType: 'NORMAL',
        lastEventAt: PAST,
        ...overrides,
      },
    });
    return { app, customer, subscription };
  }

  async function reload(id: string) {
    return prisma.subscription.findUniqueOrThrow({ where: { id } });
  }

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

  it.each(['ACTIVE', 'TRIAL', 'INTRO', 'CANCELLED'] as const)(
    'expires a past-expiry %s subscription through the reducer (status EXPIRED, lastEventAt = expiry instant)',
    async (status) => {
      const { subscription } = await seedSubscription({ status });

      const result = await service.sweep(NOW_MS);

      expect(result).toMatchObject({ candidates: 1, expired: 1, skippedLock: false });
      const row = await reload(subscription.id);
      expect(row.status).toBe('EXPIRED');
      expect(row.lastEventAt).toEqual(PAST); // occurredAt = the row's own expiry instant, NOT NOW
    },
  );

  it('expires a GRACE_PERIOD subscription via gracePeriodExpiresAt', async () => {
    const graceEnd = new Date('2026-06-10T00:00:00.000Z');
    const { subscription } = await seedSubscription({
      status: 'GRACE_PERIOD',
      expiresAt: FUTURE, // proves grace uses gracePeriodExpiresAt, not expiresAt
      gracePeriodExpiresAt: graceEnd,
    });

    const result = await service.sweep(NOW_MS);

    expect(result.expired).toBe(1);
    const row = await reload(subscription.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.lastEventAt).toEqual(graceEnd);
  });

  it('expires a GRACE_PERIOD subscription via the expiresAt fallback when gracePeriodExpiresAt is null', async () => {
    const { subscription } = await seedSubscription({
      status: 'GRACE_PERIOD',
      gracePeriodExpiresAt: null,
      expiresAt: PAST,
    });

    const result = await service.sweep(NOW_MS);

    expect(result.expired).toBe(1);
    const row = await reload(subscription.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.lastEventAt).toEqual(PAST);
  });

  it('leaves future-expiry and null-expiry rows untouched', async () => {
    const future = await seedSubscription({ status: 'ACTIVE', expiresAt: FUTURE });
    const lifetime = await seedSubscription({ status: 'ACTIVE', expiresAt: null });

    const result = await service.sweep(NOW_MS);

    expect(result).toMatchObject({ candidates: 0, expired: 0 });
    expect((await reload(future.subscription.id)).status).toBe('ACTIVE');
    expect((await reload(lifetime.subscription.id)).status).toBe('ACTIVE');
  });

  it.each(['BILLING_RETRY', 'PAUSED', 'EXPIRED', 'REVOKED'] as const)(
    'never sweeps a %s subscription even with a past expiry',
    async (status) => {
      const { subscription } = await seedSubscription({ status, expiresAt: PAST, gracePeriodExpiresAt: PAST });

      const result = await service.sweep(NOW_MS);

      expect(result.candidates).toBe(0);
      expect((await reload(subscription.id)).status).toBe(status);
    },
  );

  it('excludes a superseded row (lastEventAt already later than its expiry instant) from candidate selection', async () => {
    const laterEvent = new Date('2026-06-15T00:00:00.000Z'); // after expiresAt (PAST), before NOW
    const { subscription } = await seedSubscription({ status: 'ACTIVE', expiresAt: PAST, lastEventAt: laterEvent });

    const result = await service.sweep(NOW_MS);

    // The reducer's ordering guard would no-op this row anyway, so the productive-only predicate
    // excludes it up front rather than letting it consume a batch slot forever.
    expect(result.candidates).toBe(0);
    expect(result.expired).toBe(0);
    const row = await reload(subscription.id);
    expect(row.status).toBe('ACTIVE');
    expect(row.lastEventAt).toEqual(laterEvent);
  });

  it('excludes a row with neither originalTransactionId nor purchaseToken set (no throw, not selected)', async () => {
    const { subscription } = await seedSubscription({
      status: 'ACTIVE',
      expiresAt: PAST,
      purchaseToken: null,
      originalTransactionId: null,
    });

    const result = await service.sweep(NOW_MS);

    expect(result).toMatchObject({ candidates: 0, expired: 0 });
    expect((await reload(subscription.id)).status).toBe('ACTIVE');
  });

  it('treats a null lastEventAt as never-superseded — the row is selected and expired', async () => {
    // `lastEventAt` is defensively nullable in the schema; the raw SQL COALESCEs a null to
    // '-infinity' (matching the reducer's new Date(0) fallback), so such a row stays eligible
    // instead of being silently dropped by SQL three-valued logic.
    const { subscription } = await seedSubscription({ status: 'ACTIVE', expiresAt: PAST, lastEventAt: null });

    const result = await service.sweep(NOW_MS);

    expect(result).toMatchObject({ candidates: 1, expired: 1 });
    const row = await reload(subscription.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.lastEventAt).toEqual(PAST); // reducer stamped the expiry instant
  });

  it('drains more candidates than one batch across batches', async () => {
    await seedSubscription();
    await seedSubscription();
    await seedSubscription();

    const result = await service.sweep(NOW_MS, { batchSize: 2 });

    expect(result.batches).toBe(2); // 2 + 1
    expect(result.candidates).toBe(3);
    expect(result.expired).toBe(3);
    expect(result.capped).toBe(false);
  });

  it('stops at maxBatches and reports capped', async () => {
    await seedSubscription();
    await seedSubscription();
    await seedSubscription();

    const result = await service.sweep(NOW_MS, { batchSize: 1, maxBatches: 2 });

    expect(result.batches).toBe(2);
    expect(result.expired).toBe(2);
    expect(result.capped).toBe(true);
  });

  it('is a no-op on a second run (idempotent)', async () => {
    await seedSubscription();

    const first = await service.sweep(NOW_MS);
    const second = await service.sweep(NOW_MS);

    expect(first.expired).toBe(1);
    expect(second).toMatchObject({ candidates: 0, expired: 0 });
  });

  it('skips the run when another connection holds the advisory lock', async () => {
    const { subscription } = await seedSubscription();
    const lockHolder = new PrismaClient({ datasources: { db: { url: containerUrl } } });
    try {
      // Session-level advisory lock on the same key blocks the sweep's pg_try_advisory_xact_lock.
      await lockHolder.$executeRawUnsafe(`SELECT pg_advisory_lock(${EXPIRY_SWEEP_LOCK_KEY})`);

      const result = await service.sweep(NOW_MS);

      expect(result.skippedLock).toBe(true);
      expect(result.expired).toBe(0);
      expect((await reload(subscription.id)).status).toBe('ACTIVE');
    } finally {
      await lockHolder.$disconnect(); // closing the connection releases its session locks
    }
  });

  it('drops the entitlement after sweeping (compute-on-read consistency)', async () => {
    const { customer, subscription } = await seedSubscription({ status: 'ACTIVE', expiresAt: PAST });

    await service.sweep(NOW_MS);

    expect((await reload(subscription.id)).status).toBe('EXPIRED');
    expect(await activeEntitlements(customer.id)).toEqual([]);
  });
});
