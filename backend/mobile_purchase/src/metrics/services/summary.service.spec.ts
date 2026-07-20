import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '../../../generated/client';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { metricsQuerySchema } from '../support/metrics.schemas';
import { MetricsService } from './metrics.service';
import { SummaryService } from './summary.service';

jest.setTimeout(180000);

const query = (over: Record<string, unknown>) => metricsQuerySchema.parse(over);

describe('SummaryService (Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: SummaryService;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new SummaryService(prisma as never, new MetricsService(prisma as never));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  const makeApp = (projectId: string) =>
    prisma.app.create({
      data: { projectId, name: 'App', platform: 'IOS', bundleId: `com.summary.${randomUUID()}`, publicSdkKey: `mp_pub_${randomUUID()}` },
    });
  const makeCustomer = (projectId: string, appUserId: string) =>
    prisma.customer.create({ data: { projectId, appUserId } });

  it('mrr_cents/active/in_trial/grace: current-state as of `to`, from active-status subs', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const monthly = await prisma.product.create({
      data: { projectId, appId: app.id, storeProductId: 'monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'Monthly', durationIso8601: 'P1M' },
    });
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      status: 'ACTIVE' as const, productId: monthly.id, storeProductId: 'monthly', priceCents: 1000, currency: 'USD',
      purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: new Date('2027-01-01T00:00:00Z'),
      ...over,
    });
    await prisma.subscription.create({ data: sub({ status: 'ACTIVE', periodType: 'NORMAL', originalTransactionId: `a-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ status: 'TRIAL', periodType: 'TRIAL', originalTransactionId: `t-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ status: 'GRACE_PERIOD', periodType: 'NORMAL', originalTransactionId: `g-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ status: 'EXPIRED', periodType: 'NORMAL', originalTransactionId: `e-${randomUUID()}` }) });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.active).toBe(3);
    expect(result.in_trial).toBe(1);
    expect(result.grace).toBe(1);
    expect(result.mrr_cents).toBe(3000);
  });

  it('new_subscriptions/churned/trials_started: purchasedAt/terminal-signal window membership', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, periodType: 'NORMAL' as const,
      purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null as Date | null,
      ...over,
    });

    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-02T00:00:00Z'), originalTransactionId: `n-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-06-01T00:00:00Z'), originalTransactionId: `o-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-02T12:00:00Z'), periodType: 'TRIAL', status: 'TRIAL', originalTransactionId: `ts-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-05-01T00:00:00Z'), unsubscribeDetectedAt: new Date('2026-07-02T00:00:00Z'), originalTransactionId: `cv-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-05-01T00:00:00Z'), unsubscribeDetectedAt: new Date('2026-06-15T00:00:00Z'), originalTransactionId: `cx-${randomUUID()}` }) });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.new_subscriptions).toBe(2);
    expect(result.trials_started).toBe(1);
    expect(result.churned).toBe(1);
  });

  it('churn_reasons: maps each terminal billing signal, billing_error takes priority, sorted desc by count', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, periodType: 'NORMAL' as const,
      purchasedAt: new Date('2026-05-01T00:00:00Z'), expiresAt: null as Date | null,
      ...over,
    });

    await prisma.subscription.create({ data: sub({ billingIssueDetectedAt: new Date('2026-07-01T00:00:00Z'), unsubscribeDetectedAt: new Date('2026-07-01T00:00:00Z'), originalTransactionId: `be1-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ billingIssueDetectedAt: new Date('2026-07-02T00:00:00Z'), refundedAt: new Date('2026-07-02T00:00:00Z'), originalTransactionId: `be2-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ unsubscribeDetectedAt: new Date('2026-07-01T00:00:00Z'), originalTransactionId: `vc-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ refundedAt: new Date('2026-07-01T00:00:00Z'), originalTransactionId: `rf-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ status: 'EXPIRED', expiresAt: new Date('2026-07-01T00:00:00Z'), originalTransactionId: `ex-${randomUUID()}` }) });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.churned).toBe(5);
    expect(result.churn_reasons).toEqual([
      { reason: 'billing_error', count: 2 },
      { reason: 'expiration', count: 1 },
      { reason: 'refund', count: 1 },
      { reason: 'voluntary_cancel', count: 1 },
    ]);
  });

  it('trials_converted: NORMAL+active subs, purchasedAt in window, with a prior trial Transaction', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, periodType: 'NORMAL' as const,
      purchasedAt: new Date('2026-07-02T00:00:00Z'), expiresAt: null as Date | null,
      ...over,
    });

    const converted = await prisma.subscription.create({ data: sub({ originalTransactionId: `cv-${randomUUID()}` }) });
    await prisma.transaction.create({
      data: {
        projectId, customerId: customer.id, appId: app.id, subscriptionId: converted.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: `tt-${randomUUID()}`, storeProductId: 's', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-06-01T00:00:00Z'), isTrialPeriod: true, rawPayload: {},
      },
    });
    await prisma.subscription.create({ data: sub({ originalTransactionId: `nt-${randomUUID()}` }) });
    const stillTrial = await prisma.subscription.create({ data: sub({ periodType: 'TRIAL', status: 'TRIAL', originalTransactionId: `st-${randomUUID()}` }) });
    await prisma.transaction.create({
      data: {
        projectId, customerId: customer.id, appId: app.id, subscriptionId: stillTrial.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: `tt2-${randomUUID()}`, storeProductId: 's', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-02T00:00:00Z'), isTrialPeriod: true, rawPayload: {},
      },
    });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.trials_converted).toBe(1);
  });

  it('by_day: zero-filled per-day buckets for new_subscriptions/churned/revenue', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE' as const, environment: 'PRODUCTION' as const,
      storeProductId: 's', status: 'ACTIVE' as const, periodType: 'NORMAL' as const,
      purchasedAt: new Date('2026-07-01T09:00:00Z'), expiresAt: null as Date | null,
      ...over,
    });

    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-01T09:00:00Z'), originalTransactionId: `d1-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-07-01T18:00:00Z'), originalTransactionId: `d2-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ purchasedAt: new Date('2026-06-01T00:00:00Z'), unsubscribeDetectedAt: new Date('2026-07-02T12:00:00Z'), originalTransactionId: `d3-${randomUUID()}` }) });

    await prisma.transaction.create({
      data: { projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: `rt1-${randomUUID()}`, storeProductId: 's', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-01T10:00:00Z'), priceCents: 1000, currency: 'USD', rawPayload: {} },
    });
    await prisma.transaction.create({
      data: { projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: `rt2-${randomUUID()}`, storeProductId: 's', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-02T10:00:00Z'), priceCents: 500, currency: 'USD', revokedAt: new Date('2026-07-02T12:00:00Z'), rawPayload: {} },
    });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.by_day).toEqual([
      { t: '2026-07-01T00:00:00.000Z', new_subscriptions: 2, churned: 0, revenue: 1000 },
      { t: '2026-07-02T00:00:00.000Z', new_subscriptions: 0, churned: 1, revenue: 0 },
      { t: '2026-07-03T00:00:00.000Z', new_subscriptions: 0, churned: 0, revenue: 0 },
    ]);
  });

  it('by_product/by_store: active-as-of-`to` subs grouped by storeProductId/store with normalized mrr_cents', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, `u_${randomUUID()}`);
    const monthly = await prisma.product.create({
      data: { projectId, appId: app.id, storeProductId: 'monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'Monthly', durationIso8601: 'P1M' },
    });
    const annual = await prisma.product.create({
      data: { projectId, appId: app.id, storeProductId: 'annual', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'Annual', durationIso8601: 'P1Y' },
    });
    const sub = (over: Record<string, unknown>) => ({
      projectId, customerId: customer.id, appId: app.id, environment: 'PRODUCTION' as const, status: 'ACTIVE' as const, periodType: 'NORMAL' as const,
      store: 'APP_STORE' as const, storeProductId: 's', purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null as Date | null, currency: 'USD',
      ...over,
    });

    await prisma.subscription.create({ data: sub({ store: 'APP_STORE', productId: monthly.id, storeProductId: 'monthly', priceCents: 1000, originalTransactionId: `p1-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ store: 'APP_STORE', productId: monthly.id, storeProductId: 'monthly', priceCents: 1000, originalTransactionId: `p2-${randomUUID()}` }) });
    await prisma.subscription.create({ data: sub({ store: 'PLAY_STORE', productId: annual.id, storeProductId: 'annual', priceCents: 12000, originalTransactionId: `p3-${randomUUID()}` }) });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.by_product).toEqual(
      expect.arrayContaining([
        { product_id: 'monthly', active: 2, mrr_cents: 2000 },
        { product_id: 'annual', active: 1, mrr_cents: 1000 },
      ]),
    );
    expect(result.by_product).toHaveLength(2);
    expect(result.by_store).toEqual(
      expect.arrayContaining([
        { store: 'APP_STORE', active: 2 },
        { store: 'PLAY_STORE', active: 1 },
      ]),
    );
    expect(result.by_store).toHaveLength(2);
  });

  it('recent_events: newest-first, joins Customer.appUserId, price = priceCents/100, event inferred', async () => {
    const projectId = randomUUID();
    const app = await makeApp(projectId);
    const customer = await makeCustomer(projectId, 'app_user_42');

    await prisma.transaction.create({
      data: { projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: 'tx-initial', originalTransactionId: 'tx-initial', storeProductId: 'monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-01T09:00:00Z'), priceCents: 999, currency: 'USD', rawPayload: {} },
    });
    await prisma.transaction.create({
      data: { projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: 'tx-renewal', originalTransactionId: 'tx-initial', storeProductId: 'monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-02T09:00:00Z'), priceCents: 999, currency: 'USD', rawPayload: {} },
    });
    await prisma.transaction.create({
      data: { projectId, customerId: customer.id, appId: app.id, store: 'APP_STORE', environment: 'PRODUCTION',
        storeTransactionId: 'tx-refund', originalTransactionId: 'tx-initial', storeProductId: 'monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: new Date('2026-07-02T18:00:00Z'), priceCents: 999, currency: 'USD', revokedAt: new Date('2026-07-03T00:00:00Z'), rawPayload: {} },
    });

    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result.recent_events).toEqual([
      { insert_id: expect.any(String), event: '$rc_cancellation', distinct_id: 'app_user_42', timestamp: '2026-07-02T18:00:00.000Z', product_id: 'monthly', price: 9.99 },
      { insert_id: expect.any(String), event: '$rc_renewal', distinct_id: 'app_user_42', timestamp: '2026-07-02T09:00:00.000Z', product_id: 'monthly', price: 9.99 },
      { insert_id: expect.any(String), event: '$rc_initial_purchase', distinct_id: 'app_user_42', timestamp: '2026-07-01T09:00:00.000Z', product_id: 'monthly', price: 9.99 },
    ]);
  });

  it('empty project: zeros not errors, with zero-filled by_day buckets and empty arrays', async () => {
    const projectId = randomUUID();
    const result = await service.summary(projectId, query({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' }));

    expect(result).toEqual({
      mrr_cents: 0,
      active: 0,
      in_trial: 0,
      grace: 0,
      new_subscriptions: 0,
      churned: 0,
      trials_started: 0,
      trials_converted: 0,
      by_day: [
        { t: '2026-07-01T00:00:00.000Z', new_subscriptions: 0, churned: 0, revenue: 0 },
        { t: '2026-07-02T00:00:00.000Z', new_subscriptions: 0, churned: 0, revenue: 0 },
        { t: '2026-07-03T00:00:00.000Z', new_subscriptions: 0, churned: 0, revenue: 0 },
      ],
      by_product: [],
      by_store: [],
      churn_reasons: [],
      recent_events: [],
    });
  });
});
