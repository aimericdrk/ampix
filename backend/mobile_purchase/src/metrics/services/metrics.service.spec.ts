import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '../../../generated/client';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { metricsQuerySchema } from '../support/metrics.schemas';
import { MetricsService } from './metrics.service';

jest.setTimeout(180000);

const query = (over: Record<string, unknown>) => metricsQuerySchema.parse(over);

describe('MetricsService (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: MetricsService;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new MetricsService(prisma as never);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  const makeApp = (projectId: string) =>
    prisma.app.create({
      data: { projectId, name: 'App', platform: 'IOS', bundleId: `com.metrics.${randomUUID()}`, publicSdkKey: `mp_pub_${randomUUID()}` },
    });
  const makeCustomer = (projectId: string) =>
    prisma.customer.create({ data: { projectId, appUserId: `u_${randomUUID()}` } });

  it('revenue: sums per day bucket, excludes refunds + null price + other env, groups per currency, picks dominant', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId);
    const base = {
      projectId, appId: app.id, customerId: customer.id, store: 'APP_STORE' as const,
      type: 'AUTO_RENEWABLE_SUBSCRIPTION' as const, storeProductId: 'p', rawPayload: {},
    };
    await prisma.transaction.createMany({
      data: [
        { ...base, storeTransactionId: `t1-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-01T09:00:00Z'), priceCents: 1000, currency: 'USD' },
        { ...base, storeTransactionId: `t2-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-01T18:00:00Z'), priceCents: 500, currency: 'USD' },
        { ...base, storeTransactionId: `t3-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-02T12:00:00Z'), priceCents: 2000, currency: 'USD' },
        { ...base, storeTransactionId: `t4-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-02T12:00:00Z'), priceCents: 9999, currency: 'USD', revokedAt: new Date('2026-07-05T00:00:00Z') },
        { ...base, storeTransactionId: `t5-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-02T12:00:00Z'), priceCents: null, currency: 'USD' },
        { ...base, storeTransactionId: `t6-${randomUUID()}`, environment: 'SANDBOX', purchasedAt: new Date('2026-07-02T12:00:00Z'), priceCents: 7777, currency: 'USD' },
        { ...base, storeTransactionId: `t7-${randomUUID()}`, environment: 'PRODUCTION', purchasedAt: new Date('2026-07-02T12:00:00Z'), priceCents: 300, currency: 'EUR' },
      ],
    });

    const result = await service.revenue(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z', granularity: 'day' }));

    expect(result.currency).toBe('USD');
    expect(result.totalCents).toBe(3500);
    expect(result.series).toEqual([
      { bucket: '2026-07-01T00:00:00.000Z', amountCents: 1500 },
      { bucket: '2026-07-02T00:00:00.000Z', amountCents: 2000 },
      { bucket: '2026-07-03T00:00:00.000Z', amountCents: 0 },
    ]);
    expect(result.byCurrency).toEqual([
      { currency: 'USD', totalCents: 3500 },
      { currency: 'EUR', totalCents: 300 },
    ]);
  });

  it('mrr: normalizes P1M/P1Y/P1W to monthly, counts unattributed (null product), reports dominant currency', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId);
    const mk = (storeProductId: string, durationIso8601: string) =>
      prisma.product.create({ data: { projectId, appId: app.id, storeProductId, type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: storeProductId, durationIso8601 } });
    const monthly = await mk('m', 'P1M');
    const annual = await mk('a', 'P1Y');
    const weekly = await mk('w', 'P1W');

    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: new Date('2027-01-01T00:00:00Z'),
      ...over,
    });
    await prisma.subscription.create({ data: sub({ productId: monthly.id, priceCents: 1000, currency: 'USD', originalTransactionId: `o1-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ productId: annual.id, priceCents: 12000, currency: 'USD', originalTransactionId: `o2-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ productId: weekly.id, priceCents: 700, currency: 'USD', originalTransactionId: `o3-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ productId: null, priceCents: 500, currency: 'USD', originalTransactionId: `o4-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ productId: monthly.id, priceCents: 999, currency: 'USD', status: 'EXPIRED', originalTransactionId: `o5-${randomUUID()}` }) });

    const result = await service.mrr(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z', granularity: 'day' }));

    expect(result.currency).toBe('USD');
    expect(result.mrrCents).toBe(5000); // 1000 (P1M) + 1000 (12000/12) + 3000 (700*30/7)
    expect(result.unattributedActiveCount).toBe(1); // null-product sub
    expect(result.approximate).toBe(true);
    expect(result.series.map((p) => p.mrrCents)).toEqual([5000, 5000, 5000]);
  });

  it('active-subscriptions: window predicate at bucket boundaries, EXPIRED excluded, current as-of to', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId);
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, purchasedAt: new Date(), expiresAt: null as Date | null, ...over,
    });
    // sB active until the 07-02 boundary (exclusive); sC always; sA from 07-02; sD from 07-03; sE EXPIRED (never).
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: new Date('2026-07-02T00:00:00Z'), originalTransactionId: `b-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null, originalTransactionId: `c-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-02T00:00:00Z'), expiresAt: null, originalTransactionId: `a-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-03T00:00:00Z'), expiresAt: null, originalTransactionId: `d-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null, status: 'EXPIRED', originalTransactionId: `e-${randomUUID()}` }) });

    const result = await service.activeSubscriptions(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z', granularity: 'day' }));

    expect(result.series).toEqual([
      { bucket: '2026-07-01T00:00:00.000Z', count: 2 }, // sB + sC
      { bucket: '2026-07-02T00:00:00.000Z', count: 2 }, // sA + sC (sB expired at boundary)
      { bucket: '2026-07-03T00:00:00.000Z', count: 3 }, // sA + sC + sD
    ]);
    expect(result.current).toBe(3);
    expect(result.approximate).toBe(true);
  });

  it('empty project: zeros not errors, with zero-filled buckets', async () => {
    const projectId = randomUUID();
    const q = query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z', granularity: 'day' });

    const revenue = await service.revenue(projectId, q);
    expect(revenue).toEqual({
      currency: null,
      totalCents: 0,
      series: [
        { bucket: '2026-07-01T00:00:00.000Z', amountCents: 0 },
        { bucket: '2026-07-02T00:00:00.000Z', amountCents: 0 },
        { bucket: '2026-07-03T00:00:00.000Z', amountCents: 0 },
      ],
      byCurrency: [],
    });

    const mrr = await service.mrr(projectId, q);
    expect(mrr.currency).toBeNull();
    expect(mrr.mrrCents).toBe(0);
    expect(mrr.unattributedActiveCount).toBe(0);
    expect(mrr.series.map((p) => p.mrrCents)).toEqual([0, 0, 0]);

    const active = await service.activeSubscriptions(projectId, q);
    expect(active.current).toBe(0);
    expect(active.series.map((p) => p.count)).toEqual([0, 0, 0]);
  });
});
