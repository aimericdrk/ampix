# MyRevenueCat — Repoint Overview off the mirror (+ de-gate Conversion) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MyRevenueCat's Overview page onto a new `mobile_purchase` summary endpoint (+ drop its connect gate), and drop the connect gate from Conversion — so the whole surface is the self-hosted clone.

**Architecture:** (C1) a `mobile_purchase` `SummaryService` + `GET …/metrics/summary` returning the exact `SubscriptionsSummaryResponse` shape, computed from Subscription/Transaction (reusing `MetricsService`). (C2) a dashboard `useRcSummary` hook over `purchaseApiFetch`. (C3) repoint + de-gate `RcOverviewPage`. (C4) de-gate `RcConversionPage`. (C5) verify.

**Tech Stack:** NestJS 11 + Prisma 6 + Jest/Testcontainers (`backend/mobile_purchase`); React + TanStack Query + the chart kit + Vitest/MSW (`dashboard`).

**Design spec:** `docs/superpowers/specs/2026-07-21-myrevenuecat-repoint-overview-design.md` — binding for the summary shape (§1.1, §7), the aggregation/churn-reason semantics (§1.2), and the page changes (§2).

## Global Constraints

- **Overview = full repoint** onto `mobile_purchase` via `purchaseApiFetch`; **Conversion = de-gate only** (keeps its `mobile_analytics` `useSubscriptionAttribution`).
- **No connect gate:** remove `useRcEnabled`/`RcConnectPage` from BOTH pages; gate-then-mount on `useProjects()` resolving only, render directly (zeros/empty when no subscriptions).
- **Do NOT break `RcChartsPage`** (already on `mobile_purchase` metrics — untouched).
- **Summary endpoint** = `GET /api/v1/projects/:projectId/metrics/summary?from&to&environment`, `ProjectAccessGuard` + `@RequireProjectRole('viewer')`, Zod reusing the metrics `from/to/environment` schema. Returns the EXACT snake_case `SubscriptionsSummaryResponse` (`dashboard/src/lib/api/types.ts`): `{ mrr_cents, active, in_trial, grace, new_subscriptions, churned, trials_started, trials_converted, by_day:[{t,new_subscriptions,churned,revenue}], by_product:[{product_id,active,mrr_cents}], by_store:[{store,active}], churn_reasons:[{reason,count}], recent_events:[{insert_id,event,distinct_id,timestamp,product_id,price}] }`.
- **Semantics (§1.2):** mrr_cents/active/in_trial(TRIAL,INTRO)/grace(GRACE_PERIOD) = current state; new_subscriptions(purchasedAt in range)/churned(terminal signal in range)/trials/by_day = window-approximated (Charts-slice §0 convention). by_product = active+mrr grouped by productId; by_store = active grouped by store. `churn_reasons` mapped from billing signals: `billing_error` (billingIssueDetectedAt), `voluntary_cancel` (unsubscribeDetectedAt, no billing issue), `refund` (refundedAt), `expiration` (expired, none of the above). `recent_events` = most-recent ~20 subscription lifecycle events from Transactions, `distinct_id` = customer.appUserId (join), `price` = priceCents/100, `insert_id` = transaction id. Env default PRODUCTION; all scoped by projectId.
- **Per-service isolation:** no schema change; `mobile_analytics` tsc stays 0.
- **Dashboard:** `useRcSummary(projectId, from, to, opts?)` over `purchaseApiFetch<SubscriptionsSummaryResponse>` in `features/revenuecat/purchase-metrics-api.ts`, keyed `rcMetricsKey(projectId, 'summary', from, to, 'day')`, enabled once the range is set (mirror `useRcRevenue`). `RcOverviewPage` swaps `useSubscriptionsSummary(...,filters)` → `useRcSummary(projectId, from, to)`, drops `useGlobalFilters`/`mergeGlobalFilters`, removes the gate; all KPI/chart rendering unchanged (same fields). `RcConversionPage` removes only the gate.
- **UI:** reuse the chart kit (`ChartCard`/`KpiTile`/`ComparisonTrend`/`DonutChart`) + `formatCurrency`/`formatPercent`; gate-then-mount like the post-gate-removal `RcChartsPage`.
- **Tests:** server Testcontainers + e2e; dashboard — update the Overview/Conversion page tests (point Overview's MSW at `GET …/metrics/summary`; drop the connect-upsell assertions; add a renders-directly assertion).
- **HARD WIP rule:** never touch `components/layout/*`, layout `*.test.tsx`, `nav-model.ts` (NOT edited), `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`. `git add` only each task's files; every dashboard task ends with `git status`. NO co-author trailers.

## Task index & build order

- **C1** — `mobile_purchase` `SummaryService` + `GET …/metrics/summary` (+ Testcontainers + e2e). **Produces** the summary endpoint.
- **C2** — dashboard `useRcSummary` hook + MSW hook test. **Produces** the hook C3 consumes.
- **C3** — repoint + de-gate `RcOverviewPage` + update its tests.
- **C4** — de-gate `RcConversionPage` + update its tests.
- **C5** — verify gate.

**Build order: C1 → C2 → C3 → C4 → C5.**

## File structure

- `backend/mobile_purchase/src/metrics/services/summary.service.ts` (+ `summary.service.spec.ts`) — **create**: the aggregation service.
- `backend/mobile_purchase/src/metrics/support/summary.types.ts` (+ schema reuse) — **create/modify**: the `SubscriptionsSummaryResponse` types + reasons.
- `backend/mobile_purchase/src/metrics/controllers/summary.controller.ts` — **create**: the guarded route; wire into `MetricsModule`.
- `backend/mobile_purchase/test/e2e/metrics.e2e-spec.ts` (or a new `summary.e2e-spec.ts`) — **modify/create**.
- `dashboard/src/features/revenuecat/purchase-metrics-api.ts` (+ `purchase-metrics-api.test.ts`) — **modify**: add `useRcSummary`.
- `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx` / `RcConversionPage.tsx` — **modify**: repoint + de-gate / de-gate.
- `dashboard/src/features/revenuecat/components/rc-pages.test.tsx` (+ any overview/conversion specs) — **modify**: point at the new source, drop connect assertions.

---

### Task C1.1: `SummaryService` for the RC Overview summary (mobile_purchase)

**Files**
- Create: `backend/mobile_purchase/src/metrics/support/summary.types.ts`
- Create: `backend/mobile_purchase/src/metrics/services/summary.service.ts`
- Test: `backend/mobile_purchase/src/metrics/services/summary.service.spec.ts` (Testcontainers, mirrors `metrics.service.spec.ts`)

**Interfaces**
- Consumes:
  - `MetricsService.mrr(projectId: string, query: MetricsQuery): Promise<MrrMetrics>` and `MetricsService.activeSubscriptions(projectId: string, query: MetricsQuery): Promise<ActiveSubscriptionsMetrics>` (`src/metrics/services/metrics.service.ts`) — headline mrr_cents/active reuse.
  - `ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[]` (`src/metrics/services/metrics.service.ts`)
  - `generateBuckets(from: Date, to: Date, granularity: Granularity): Date[]`, `truncateUtc(date: Date, granularity: Granularity): Date` (`src/metrics/support/buckets.ts`)
  - `monthlyMultiplier(durationIso8601: string | null | undefined): number | null` (`src/metrics/support/duration.ts`)
  - `MetricsQuery` type (`src/metrics/support/metrics.schemas.ts`)
  - `PrismaService` (`src/prisma/prisma.service.ts`)
- Produces:
  - `SubscriptionsSummaryResponse` (and its nested row types) exported from `summary.types.ts` — consumed by C1.2's controller.
  - `SummaryService.summary(projectId: string, query: MetricsQuery): Promise<SubscriptionsSummaryResponse>` — consumed by C1.2's controller.

---

- [ ] **Step 1 — `summary.types.ts` (snake_case mirror of the dashboard/mirror shape)**

  Write `backend/mobile_purchase/src/metrics/support/summary.types.ts`:

  ```typescript
  // Mirrors dashboard/src/lib/api/types.ts's SubscriptionsSummaryResponse and the mobile_analytics
  // RC-mirror shape (backend/mobile_analytics/src/revenuecat/metrics/rc-summary.service.ts)
  // field-for-field, snake_case verbatim, so RcOverviewPage's existing KPI/chart rendering is
  // unchanged when it repoints from the mirror onto this endpoint.

  export interface SubscriptionsByDay {
    t: string;
    new_subscriptions: number;
    churned: number;
    revenue: number;
  }

  export interface SubscriptionsByProduct {
    product_id: string;
    active: number;
    mrr_cents: number;
  }

  export interface SubscriptionsByStore {
    store: string;
    active: number;
  }

  export interface ChurnReasonCount {
    reason: string;
    count: number;
  }

  export interface SubscriptionRecentEvent {
    insert_id: string;
    event: string;
    distinct_id: string;
    timestamp: string;
    product_id: string;
    price: number;
  }

  /** `GET /api/v1/projects/:projectId/metrics/summary` response (RC Overview repoint, design §1.1). */
  export interface SubscriptionsSummaryResponse {
    mrr_cents: number;
    active: number;
    in_trial: number;
    grace: number;
    new_subscriptions: number;
    churned: number;
    trials_started: number;
    trials_converted: number;
    by_day: SubscriptionsByDay[];
    by_product: SubscriptionsByProduct[];
    by_store: SubscriptionsByStore[];
    churn_reasons: ChurnReasonCount[];
    recent_events: SubscriptionRecentEvent[];
  }
  ```

  This is a pure type file (nothing to run yet) — verified later by `tsc` in C1.2's final step. No test/run for this step; proceed straight to Step 2.

- [ ] **Step 2 — RED: write the full `SummaryService` Testcontainers spec**

  Write `backend/mobile_purchase/src/metrics/services/summary.service.spec.ts`:

  ```typescript
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
        productId: monthly.id, storeProductId: 'monthly', priceCents: 1000, currency: 'USD',
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
        purchasedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: null as Date | null, currency: 'USD',
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
  ```

  Run to fail:

  ```
  cd backend/mobile_purchase && npx jest src/metrics/services/summary.service.spec.ts
  ```

  Expected (RED — `summary.service.ts` doesn't exist yet, ts-jest fails to compile the suite):

  ```
  FAIL src/metrics/services/summary.service.spec.ts
    ● Test suite failed to run

      Cannot find module './summary.service' from 'src/metrics/services/summary.service.spec.ts'
  ```

- [ ] **Step 3 — implement `SummaryService`**

  Write `backend/mobile_purchase/src/metrics/services/summary.service.ts`:

  ```typescript
  import { Injectable } from '@nestjs/common';
  import type { Environment, PeriodType, Store, SubscriptionStatus } from '../../../generated/client';
  import { PrismaService } from '../../prisma/prisma.service';
  import { generateBuckets, truncateUtc } from '../support/buckets';
  import { monthlyMultiplier } from '../support/duration';
  import type { MetricsQuery } from '../support/metrics.schemas';
  import type {
    ChurnReasonCount,
    SubscriptionRecentEvent,
    SubscriptionsByDay,
    SubscriptionsByProduct,
    SubscriptionsByStore,
    SubscriptionsSummaryResponse,
  } from '../support/summary.types';
  import { ACTIVE_SUBSCRIPTION_STATUSES, MetricsService } from './metrics.service';

  const RECENT_EVENTS_LIMIT = 20;

  interface ActiveAsOfToRow {
    productId: string | null;
    storeProductId: string;
    store: Store;
    status: SubscriptionStatus;
    periodType: PeriodType;
    priceCents: number | null;
    currency: string | null;
  }

  interface ChurnedSubRow {
    billingIssueDetectedAt: Date | null;
    unsubscribeDetectedAt: Date | null;
    refundedAt: Date | null;
    expiresAt: Date | null;
  }

  interface SubInRangeRow {
    purchasedAt: Date;
    periodType: PeriodType;
  }

  interface RevenueTxRow {
    priceCents: number | null;
    purchasedAt: Date;
  }

  interface RecentTxRow {
    id: string;
    customerId: string | null;
    storeProductId: string;
    priceCents: number | null;
    purchasedAt: Date;
    revokedAt: Date | null;
    originalTransactionId: string | null;
    storeTransactionId: string;
  }

  /**
   * Assembles the RC Overview `SubscriptionsSummaryResponse` (design §1.2): current-state KPIs
   * (mrr_cents/active) reuse `MetricsService.mrr`/`activeSubscriptions`; everything else is computed
   * directly from Subscription/Transaction rows, window-approximated like the rest of the metrics
   * slice (design §0).
   */
  @Injectable()
  export class SummaryService {
    constructor(
      private readonly prisma: PrismaService,
      private readonly metrics: MetricsService,
    ) {}

    async summary(projectId: string, query: MetricsQuery): Promise<SubscriptionsSummaryResponse> {
      const { from, to, environment } = query;

      const [mrrResult, activeResult, activeAsOfTo, subsInRange, churnedSubs, convertedCandidates, revenueTx, recentTx] =
        await Promise.all([
          this.metrics.mrr(projectId, query),
          this.metrics.activeSubscriptions(projectId, query),
          this.fetchActiveAsOfTo(projectId, environment, to),
          this.prisma.subscription.findMany({
            where: { projectId, environment, purchasedAt: { gte: from, lte: to } },
            select: { purchasedAt: true, periodType: true },
          }) as Promise<SubInRangeRow[]>,
          this.fetchChurnedInRange(projectId, environment, from, to),
          this.prisma.subscription.findMany({
            where: {
              projectId,
              environment,
              periodType: 'NORMAL',
              status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
              purchasedAt: { gte: from, lte: to },
            },
            select: { id: true },
          }),
          this.prisma.transaction.findMany({
            where: { projectId, environment, revokedAt: null, priceCents: { not: null }, purchasedAt: { gte: from, lte: to } },
            select: { priceCents: true, purchasedAt: true },
          }) as Promise<RevenueTxRow[]>,
          this.prisma.transaction.findMany({
            where: { projectId, environment, purchasedAt: { gte: from, lte: to } },
            orderBy: { purchasedAt: 'desc' },
            take: RECENT_EVENTS_LIMIT,
            select: {
              id: true, customerId: true, storeProductId: true, priceCents: true,
              purchasedAt: true, revokedAt: true, originalTransactionId: true, storeTransactionId: true,
            },
          }) as Promise<RecentTxRow[]>,
        ]);

      const trials_converted = await this.countConvertedTrials(convertedCandidates.map((c) => c.id));
      const by_product = await this.buildByProduct(projectId, activeAsOfTo);
      const recent_events = await this.buildRecentEvents(recentTx);

      const in_trial = activeAsOfTo.filter((s) => s.periodType === 'TRIAL' || s.periodType === 'INTRO').length;
      const grace = activeAsOfTo.filter((s) => s.status === 'GRACE_PERIOD').length;

      const byStoreMap = new Map<string, number>();
      for (const s of activeAsOfTo) byStoreMap.set(s.store, (byStoreMap.get(s.store) ?? 0) + 1);
      const by_store: SubscriptionsByStore[] = [...byStoreMap.entries()].map(([store, active]) => ({ store, active }));

      const trials_started = subsInRange.filter((s) => s.periodType === 'TRIAL' || s.periodType === 'INTRO').length;

      return {
        mrr_cents: mrrResult.mrrCents,
        active: activeResult.current,
        in_trial,
        grace,
        new_subscriptions: subsInRange.length,
        churned: churnedSubs.length,
        trials_started,
        trials_converted,
        by_day: this.buildByDay(from, to, subsInRange, churnedSubs, revenueTx),
        by_product,
        by_store,
        churn_reasons: buildChurnReasons(churnedSubs),
        recent_events,
      };
    }

    private fetchActiveAsOfTo(projectId: string, environment: Environment, to: Date): Promise<ActiveAsOfToRow[]> {
      return this.prisma.subscription.findMany({
        where: {
          projectId,
          environment,
          status: { in: ACTIVE_SUBSCRIPTION_STATUSES },
          purchasedAt: { lte: to },
          OR: [{ expiresAt: null }, { expiresAt: { gt: to } }],
        },
        select: { productId: true, storeProductId: true, store: true, status: true, periodType: true, priceCents: true, currency: true },
      });
    }

    /** "Churned" (design §1.2): a terminal signal in `[from, to]` — voluntary unsubscribe, a refund,
     * or an expiration for a non-renewing/expired sub. `billingIssueDetectedAt` is NOT a membership
     * signal here (it only ranks the churn *reason* once a sub already qualifies via one of these). */
    private fetchChurnedInRange(projectId: string, environment: Environment, from: Date, to: Date): Promise<ChurnedSubRow[]> {
      return this.prisma.subscription.findMany({
        where: {
          projectId,
          environment,
          OR: [
            { unsubscribeDetectedAt: { gte: from, lte: to } },
            { refundedAt: { gte: from, lte: to } },
            { expiresAt: { gte: from, lte: to }, OR: [{ status: 'EXPIRED' }, { autoRenewStatus: false }] },
          ],
        },
        select: { billingIssueDetectedAt: true, unsubscribeDetectedAt: true, refundedAt: true, expiresAt: true },
      });
    }

    /** `trials_converted` (design §1.2): the sub's own row is already NORMAL + active-status +
     * purchased in-window (the caller's `convertedCandidates` query); "a prior trial signal" is a
     * Transaction row for the same subscription with `isTrialPeriod = true`. */
    private async countConvertedTrials(subscriptionIds: string[]): Promise<number> {
      if (subscriptionIds.length === 0) return 0;
      const trialTx = await this.prisma.transaction.findMany({
        where: { subscriptionId: { in: subscriptionIds }, isTrialPeriod: true },
        select: { subscriptionId: true },
        distinct: ['subscriptionId'],
      });
      return trialTx.length;
    }

    /** `by_product` groups by `storeProductId` (never null, unlike the nullable catalog `productId`
     * FK) so every active sub is represented even before its store product is imported into the
     * catalog; `mrr_cents` sums only the subs whose catalog Product resolves a period (same
     * unattributed-exclusion rule as `MetricsService.mrr`). */
    private async buildByProduct(projectId: string, activeAsOfTo: ActiveAsOfToRow[]): Promise<SubscriptionsByProduct[]> {
      const productIds = [...new Set(activeAsOfTo.map((s) => s.productId).filter((id): id is string => id !== null))];
      const products = productIds.length
        ? await this.prisma.product.findMany({ where: { id: { in: productIds }, projectId }, select: { id: true, durationIso8601: true } })
        : [];
      const multiplierByProductId = new Map(products.map((p) => [p.id, monthlyMultiplier(p.durationIso8601)]));

      const byProduct = new Map<string, { active: number; mrrCents: number }>();
      for (const s of activeAsOfTo) {
        const acc = byProduct.get(s.storeProductId) ?? { active: 0, mrrCents: 0 };
        acc.active += 1;
        const multiplier = s.productId ? multiplierByProductId.get(s.productId) ?? null : null;
        if (multiplier !== null && s.priceCents !== null) {
          acc.mrrCents += Math.round(s.priceCents * multiplier);
        }
        byProduct.set(s.storeProductId, acc);
      }
      return [...byProduct.entries()].map(([product_id, acc]) => ({ product_id, active: acc.active, mrr_cents: acc.mrrCents }));
    }

    private buildByDay(
      from: Date,
      to: Date,
      subsInRange: SubInRangeRow[],
      churnedSubs: ChurnedSubRow[],
      revenueTx: RevenueTxRow[],
    ): SubscriptionsByDay[] {
      const buckets = generateBuckets(from, to, 'day');
      const key = (d: Date) => truncateUtc(d, 'day').toISOString();

      const newByBucket = new Map<string, number>();
      for (const s of subsInRange) {
        const k = key(s.purchasedAt);
        newByBucket.set(k, (newByBucket.get(k) ?? 0) + 1);
      }

      const churnedByBucket = new Map<string, number>();
      for (const s of churnedSubs) {
        const at = churnedAt(s, from, to);
        if (at === null) continue;
        const k = key(at);
        churnedByBucket.set(k, (churnedByBucket.get(k) ?? 0) + 1);
      }

      const revenueByBucket = new Map<string, number>();
      for (const t of revenueTx) {
        const k = key(t.purchasedAt);
        revenueByBucket.set(k, (revenueByBucket.get(k) ?? 0) + (t.priceCents ?? 0));
      }

      return buckets.map((b) => {
        const k = b.toISOString();
        return {
          t: k,
          new_subscriptions: newByBucket.get(k) ?? 0,
          churned: churnedByBucket.get(k) ?? 0,
          revenue: revenueByBucket.get(k) ?? 0,
        };
      });
    }

    /** `distinct_id` joins `Customer.appUserId`; unlinked transactions (`customerId === null`) fall
     * back to `''` (no identity to report). `event` is inferred from the transaction's own shape —
     * a refund/chargeback (`revokedAt` set) is `$rc_cancellation`; a transaction that IS its own
     * original (`originalTransactionId` unset or equal to its own store transaction id) is
     * `$rc_initial_purchase`; everything else is `$rc_renewal` — the same vocabulary the
     * `mobile_analytics` RC mirror uses. */
    private async buildRecentEvents(recentTx: RecentTxRow[]): Promise<SubscriptionRecentEvent[]> {
      const customerIds = [...new Set(recentTx.map((t) => t.customerId).filter((id): id is string => id !== null))];
      const customers = customerIds.length
        ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, appUserId: true } })
        : [];
      const appUserIdByCustomerId = new Map(customers.map((c) => [c.id, c.appUserId]));

      return recentTx.map((t) => ({
        insert_id: t.id,
        event: inferEventName(t),
        distinct_id: (t.customerId && appUserIdByCustomerId.get(t.customerId)) || '',
        timestamp: t.purchasedAt.toISOString(),
        product_id: t.storeProductId,
        price: (t.priceCents ?? 0) / 100,
      }));
    }
  }

  /** The `[from,to]` date that made `sub` count as churned (design §1.2's terminal-signal
   * definition), used to bucket `by_day.churned`; priority: unsubscribe > refund > terminal
   * expiration. */
  function churnedAt(sub: ChurnedSubRow, from: Date, to: Date): Date | null {
    const inRange = (d: Date | null) => d !== null && d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
    if (inRange(sub.unsubscribeDetectedAt)) return sub.unsubscribeDetectedAt;
    if (inRange(sub.refundedAt)) return sub.refundedAt;
    if (inRange(sub.expiresAt)) return sub.expiresAt;
    return null;
  }

  /** Maps a churned sub's billing signals to an RC-style reason (design §1.2 priority order). */
  function churnReason(sub: ChurnedSubRow): string {
    if (sub.billingIssueDetectedAt !== null) return 'billing_error';
    if (sub.unsubscribeDetectedAt !== null) return 'voluntary_cancel';
    if (sub.refundedAt !== null) return 'refund';
    return 'expiration';
  }

  function buildChurnReasons(churnedSubs: ChurnedSubRow[]): ChurnReasonCount[] {
    const counts = new Map<string, number>();
    for (const s of churnedSubs) {
      const reason = churnReason(s);
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  }

  function inferEventName(t: { revokedAt: Date | null; originalTransactionId: string | null; storeTransactionId: string }): string {
    if (t.revokedAt !== null) return '$rc_cancellation';
    if (t.originalTransactionId === null || t.originalTransactionId === t.storeTransactionId) return '$rc_initial_purchase';
    return '$rc_renewal';
  }
  ```

  Run to pass:

  ```
  cd backend/mobile_purchase && npx jest src/metrics/services/summary.service.spec.ts
  ```

  Expected (GREEN):

  ```
  PASS src/metrics/services/summary.service.spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       8 passed, 8 total
  ```

- [ ] **Step 4 — commit**

  ```
  git add backend/mobile_purchase/src/metrics/support/summary.types.ts backend/mobile_purchase/src/metrics/services/summary.service.ts backend/mobile_purchase/src/metrics/services/summary.service.spec.ts
  git commit -m "feat(mobile_purchase): SummaryService for the RC Overview summary"
  ```

---

### Task C1.2: `GET metrics/summary` endpoint + wire `MetricsModule`

**Files**
- Create: `backend/mobile_purchase/src/metrics/controllers/summary.controller.ts`
- Modify: `backend/mobile_purchase/src/metrics/metrics.module.ts`
- Modify: `backend/mobile_purchase/test/e2e/metrics.e2e-spec.ts`

**Interfaces**
- Consumes:
  - `SummaryService.summary(projectId: string, query: MetricsQuery): Promise<SubscriptionsSummaryResponse>` (C1.1)
  - `parseOrThrow(schema, body)`, `metricsQuerySchema` (existing, `src/common/zod.ts`, `src/metrics/support/metrics.schemas.ts`)
  - `ProjectAccessGuard`, `RequireProjectRole('viewer')` (existing, `src/authz/*`)
- Produces:
  - `GET /api/v1/projects/:projectId/metrics/summary?from&to&environment` — 200 `SubscriptionsSummaryResponse`, 401 (no auth header), 403 (denied role), 400 (bad query, e.g. `from > to`).

---

- [ ] **Step 1 — RED: extend the e2e spec to cover `summary`**

  Edit `backend/mobile_purchase/test/e2e/metrics.e2e-spec.ts`:

  Replace:
  ```typescript
  const routes = ['revenue', 'mrr', 'active-subscriptions'];
  ```
  with:
  ```typescript
  const routes = ['revenue', 'mrr', 'active-subscriptions', 'summary'];
  ```

  Replace:
  ```typescript
    const active = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/active-subscriptions`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(active.body).toMatchObject({ current: 0, approximate: true });
  });
  ```
  with:
  ```typescript
    const active = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/active-subscriptions`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(active.body).toMatchObject({ current: 0, approximate: true });

    const summary = await request(http)
      .get(`/api/v1/projects/${projectId}/metrics/summary`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(summary.body).toEqual({
      mrr_cents: 0,
      active: 0,
      in_trial: 0,
      grace: 0,
      new_subscriptions: 0,
      churned: 0,
      trials_started: 0,
      trials_converted: 0,
      by_day: expect.any(Array),
      by_product: [],
      by_store: [],
      churn_reasons: [],
      recent_events: [],
    });
  });
  ```

  Replace:
  ```typescript
  it('denied role -> 403', async () => {
    fakeAccess.role = null;
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/metrics/revenue`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);
  });
  });
  ```
  with:
  ```typescript
  it('denied role -> 403', async () => {
    fakeAccess.role = null;
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/metrics/revenue`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${randomUUID()}/metrics/summary`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);
  });

  it('summary — 400 when from is after to', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}/metrics/summary`)
      .query({ from: '2026-07-10T00:00:00Z', to: '2026-07-01T00:00:00Z' })
      .set('Authorization', 'Bearer viewer-token')
      .expect(400);
  });
  });
  ```

  (Note: the `});` immediately following `it('denied role -> 403', ...)`'s closing `});` in both the old and new snippets above is the `describe(...)` block's own closing brace — the edit re-closes the `describe` after inserting the new `it` block.)

  Run to fail:

  ```
  cd backend/mobile_purchase && npx jest test/e2e/metrics.e2e-spec.ts
  ```

  Expected (RED — no controller registers `GET .../metrics/summary` yet, so every new/changed assertion hits a 404):

  ```
  FAIL test/e2e/metrics.e2e-spec.ts
    Metrics e2e — module wiring + ProjectAccessGuard
      ✕ viewer gets 200 with the documented shape on every metrics route (empty project -> zeros)
      ✕ missing Authorization header -> 401 on every metrics route (guard runs before the handler)
      ✕ denied role -> 403
      ✕ summary — 400 when from is after to

      expected 200 "OK", got 404 "Not Found"
  Tests:       4 failed, 4 total
  ```

- [ ] **Step 2 — implement the controller and wire the module**

  Write `backend/mobile_purchase/src/metrics/controllers/summary.controller.ts`:

  ```typescript
  import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { parseOrThrow } from '../../common/zod';
  import { metricsQuerySchema } from '../support/metrics.schemas';
  import { SummaryService } from '../services/summary.service';

  @Controller('api/v1/projects/:projectId/metrics')
  @UseGuards(ProjectAccessGuard)
  export class SummaryController {
    constructor(private readonly service: SummaryService) {}

    @Get('summary')
    @RequireProjectRole('viewer')
    summary(@Param('projectId') projectId: string, @Query() query: unknown) {
      return this.service.summary(projectId, parseOrThrow(metricsQuerySchema, query));
    }
  }
  ```

  Read `backend/mobile_purchase/src/metrics/metrics.module.ts` (already read in full above), then replace its entire contents with:

  ```typescript
  import { Module } from '@nestjs/common';
  import { AuthzModule } from '../authz/authz.module';
  import { ActiveSubscriptionsController } from './controllers/active-subscriptions.controller';
  import { MrrController } from './controllers/mrr.controller';
  import { RevenueController } from './controllers/revenue.controller';
  import { SummaryController } from './controllers/summary.controller';
  import { MetricsService } from './services/metrics.service';
  import { SummaryService } from './services/summary.service';

  /**
   * Read-only aggregation surface (dashboard-JWT authz seam). AuthzModule provides
   * ProjectAccessGuard for the viewer-gated controllers; PrismaModule is @Global() so PrismaService
   * needs no import here.
   */
  @Module({
    imports: [AuthzModule],
    controllers: [RevenueController, MrrController, ActiveSubscriptionsController, SummaryController],
    providers: [MetricsService, SummaryService],
  })
  export class MetricsModule {}
  ```

  Run to pass:

  ```
  cd backend/mobile_purchase && npx jest test/e2e/metrics.e2e-spec.ts
  ```

  Expected (GREEN):

  ```
  PASS test/e2e/metrics.e2e-spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       4 passed, 4 total
  ```

- [ ] **Step 3 — verify gate: tsc 0 on both backend services**

  ```
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  ```
  cd backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: no output, exit code 0 (untouched by C1 — confirms design §0's "mobile_analytics tsc stays 0").

- [ ] **Step 4 — commit**

  ```
  git add backend/mobile_purchase/src/metrics/controllers/summary.controller.ts backend/mobile_purchase/src/metrics/metrics.module.ts backend/mobile_purchase/test/e2e/metrics.e2e-spec.ts
  git commit -m "feat(mobile_purchase): GET metrics/summary endpoint + wire MetricsModule"
  ```


---

### Task C2.1: `useRcSummary` hook over the purchase-service summary endpoint

**Files**
- Modify: `dashboard/src/features/revenuecat/purchase-metrics-api.ts`
- Test: `dashboard/src/features/revenuecat/purchase-metrics-api.test.ts`

**Interfaces**
- Consumes: `purchaseApiFetch<T>(path, options?)` from `dashboard/src/lib/api/purchase-client.ts`; `SubscriptionsSummaryResponse` from `dashboard/src/lib/api/types.ts`; existing `rcMetricsKey(projectId, metric, from, to, granularity)` and `RcMetricOptions`/`isEnabled` in the same file.
- Produces: `export function useRcSummary(projectId: string, from: string, to: string, opts: RcMetricOptions = {}): UseQueryResult<SubscriptionsSummaryResponse>` — `GET /api/v1/projects/${projectId}/metrics/summary?from=${from}&to=${to}`, keyed `rcMetricsKey(projectId, 'summary', from, to, 'day')`, enabled once `from`/`to` are both set (mirrors `useRcRevenue`).

---

- [ ] **Step 1 — failing test: `useRcSummary` GETs `/metrics/summary` and parses the body**

  Edit `dashboard/src/features/revenuecat/purchase-metrics-api.test.ts`:

  1. Add `useRcSummary` to the named import from `./purchase-metrics-api`, and add a type import for `SubscriptionsSummaryResponse`:

  Old:
  ```ts
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import {
    rcMetricsKey,
    useRcActiveSubscriptions,
    useRcMrr,
    useRcRevenue,
    type RcActiveSubscriptionsResponse,
    type RcMrrResponse,
    type RcRevenueResponse,
  } from './purchase-metrics-api';
  ```

  New:
  ```ts
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import type { SubscriptionsSummaryResponse } from '../../lib/api/types';
  import {
    rcMetricsKey,
    useRcActiveSubscriptions,
    useRcMrr,
    useRcRevenue,
    useRcSummary,
    type RcActiveSubscriptionsResponse,
    type RcMrrResponse,
    type RcRevenueResponse,
  } from './purchase-metrics-api';
  ```

  2. Add a `SUMMARY` fixture next to the existing `REVENUE`/`MRR`/`ACTIVE` fixtures:

  Old:
  ```ts
  const ACTIVE: RcActiveSubscriptionsResponse = {
    current: 42,
    series: [{ bucket: '2026-07-01', count: 40 }],
    approximate: true,
  };
  ```

  New:
  ```ts
  const ACTIVE: RcActiveSubscriptionsResponse = {
    current: 42,
    series: [{ bucket: '2026-07-01', count: 40 }],
    approximate: true,
  };
  const SUMMARY: SubscriptionsSummaryResponse = {
    mrr_cents: 4995,
    active: 5,
    in_trial: 2,
    grace: 1,
    new_subscriptions: 3,
    churned: 1,
    trials_started: 4,
    trials_converted: 2,
    by_day: [{ t: '2026-07-01', new_subscriptions: 1, churned: 0, revenue: 999 }],
    by_product: [{ product_id: 'pro_monthly', active: 3, mrr_cents: 2997 }],
    by_store: [{ store: 'app_store', active: 3 }],
    churn_reasons: [{ reason: 'voluntary', count: 1 }],
    recent_events: [
      {
        insert_id: 'rcevt-1',
        event: '$rc_initial_purchase',
        distinct_id: 'user-001',
        timestamp: '2026-07-01T09:58:00.000Z',
        product_id: 'pro_monthly',
        price: 9.99,
      },
    ],
  };
  ```

  3. Add a new test inside `describe('purchase metrics hooks', ...)`, right after the `useRcActiveSubscriptions` test:

  Old:
  ```ts
    it('useRcActiveSubscriptions returns the current count and series', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      server.use(
        http.get(`/api/v1/projects/${PID}/metrics/active-subscriptions`, () => HttpResponse.json(ACTIVE)),
      );

      const { result } = renderHook(() => useRcActiveSubscriptions(PID, FROM, TO, 'month'), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.current).toBe(42);
    });

    it('stays idle (no fetch) until both range bounds are set', () => {
  ```

  New:
  ```ts
    it('useRcActiveSubscriptions returns the current count and series', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      server.use(
        http.get(`/api/v1/projects/${PID}/metrics/active-subscriptions`, () => HttpResponse.json(ACTIVE)),
      );

      const { result } = renderHook(() => useRcActiveSubscriptions(PID, FROM, TO, 'month'), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.current).toBe(42);
    });

    it('useRcSummary hits /metrics/summary on the purchase service and returns the parsed body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.get(`/api/v1/projects/${PID}/metrics/summary`, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(SUMMARY);
        }),
      );

      const { result } = renderHook(() => useRcSummary(PID, FROM, TO), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(SUMMARY);
      const url = new URL(seenUrl);
      expect(url.searchParams.get('from')).toBe(FROM);
      expect(url.searchParams.get('to')).toBe(TO);
    });

    it('stays idle (no fetch) until both range bounds are set', () => {
  ```

- [ ] **Step 2 — run to fail**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/purchase-metrics-api.test.ts --reporter=basic
  ```
  Expected: the file fails to load/run — `useRcSummary` is not yet exported from `purchase-metrics-api.ts`, e.g.:
  ```
  SyntaxError: The requested module '/src/features/revenuecat/purchase-metrics-api.ts' does not provide an export named 'useRcSummary'
  ```
  (If it instead hangs, `pkill -9 -f vitest` once and retry once.)

- [ ] **Step 3 — minimal implementation**

  Edit `dashboard/src/features/revenuecat/purchase-metrics-api.ts`:

  1. Import the response type and widen the metric union:

  Old:
  ```ts
  import { useQuery } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  ```

  New:
  ```ts
  import { useQuery } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  import type { SubscriptionsSummaryResponse } from '../../lib/api/types';
  ```

  Old:
  ```ts
  type RcMetric = 'revenue' | 'mrr' | 'active-subscriptions';
  ```

  New:
  ```ts
  type RcMetric = 'revenue' | 'mrr' | 'active-subscriptions' | 'summary';
  ```

  2. Add a `summaryUrl` helper right after `metricsUrl` (the summary route has no `granularity` query param, unlike the other three):

  Old:
  ```ts
  function metricsUrl(
    projectId: string,
    metric: RcMetric,
    from: string,
    to: string,
    granularity: RcGranularity,
  ): string {
    return `${purchaseMetricsBase(projectId)}/${metric}?from=${from}&to=${to}&granularity=${granularity}`;
  }
  ```

  New:
  ```ts
  function metricsUrl(
    projectId: string,
    metric: RcMetric,
    from: string,
    to: string,
    granularity: RcGranularity,
  ): string {
    return `${purchaseMetricsBase(projectId)}/${metric}?from=${from}&to=${to}&granularity=${granularity}`;
  }

  /** `/metrics/summary` (spec §1.1) has no `granularity` query param — unlike revenue/mrr/active-subscriptions. */
  function summaryUrl(projectId: string, from: string, to: string): string {
    return `${purchaseMetricsBase(projectId)}/summary?from=${from}&to=${to}`;
  }
  ```

  3. Add the hook after `useRcActiveSubscriptions` (end of file):

  Old:
  ```ts
  export function useRcActiveSubscriptions(
    projectId: string,
    from: string,
    to: string,
    granularity: RcGranularity,
    opts: RcMetricOptions = {},
  ) {
    return useQuery({
      queryKey: rcMetricsKey(projectId, 'active-subscriptions', from, to, granularity),
      queryFn: () =>
        purchaseApiFetch<RcActiveSubscriptionsResponse>(
          metricsUrl(projectId, 'active-subscriptions', from, to, granularity),
        ),
      enabled: isEnabled(from, to, opts),
    });
  }
  ```

  New:
  ```ts
  export function useRcActiveSubscriptions(
    projectId: string,
    from: string,
    to: string,
    granularity: RcGranularity,
    opts: RcMetricOptions = {},
  ) {
    return useQuery({
      queryKey: rcMetricsKey(projectId, 'active-subscriptions', from, to, granularity),
      queryFn: () =>
        purchaseApiFetch<RcActiveSubscriptionsResponse>(
          metricsUrl(projectId, 'active-subscriptions', from, to, granularity),
        ),
      enabled: isEnabled(from, to, opts),
    });
  }

  /**
   * `GET /metrics/summary` (spec §1.1/§2) — the Overview page's subscription summary. Returns the
   * exact `SubscriptionsSummaryResponse` shape (`lib/api/types.ts`) so `RcOverviewPage` renders it
   * unchanged. Auto-loads once both range bounds are set (mirrors the other three metrics); the
   * URL carries no `granularity`, but the query key still pins it to `'day'` so `rcMetricsKey`'s
   * shape stays uniform across every purchase-metrics hook.
   */
  export function useRcSummary(
    projectId: string,
    from: string,
    to: string,
    opts: RcMetricOptions = {},
  ) {
    return useQuery({
      queryKey: rcMetricsKey(projectId, 'summary', from, to, 'day'),
      queryFn: () => purchaseApiFetch<SubscriptionsSummaryResponse>(summaryUrl(projectId, from, to)),
      enabled: isEnabled(from, to, opts),
    });
  }
  ```

- [ ] **Step 4 — run to pass**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/purchase-metrics-api.test.ts --reporter=basic
  ```
  Expected: `Test Files 1 passed (1)`, `Tests 7 passed (7)` (the existing 6 plus the new `useRcSummary` test).

- [ ] **Step 5 — WIP-safety check and commit**

  ```
  git add dashboard/src/features/revenuecat/purchase-metrics-api.ts dashboard/src/features/revenuecat/purchase-metrics-api.test.ts
  git status --short
  ```
  Expected: only these two files staged (`M `); nothing under `dashboard/src/components/layout/`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, or `RailInitial.tsx`.

  ```
  git commit -m "$(cat <<'EOF'
  feat(dashboard): add useRcSummary hook over the purchase-service summary endpoint
  EOF
  )"
  ```

---

### Task C3.1: Repoint + de-gate `RcOverviewPage`

**Files**
- Modify: `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx`
- Modify: `dashboard/src/test/msw/handlers.ts`
- Test: `dashboard/src/features/revenuecat/components/rc-pages.test.tsx`

**Interfaces**
- Consumes: `useRcSummary(projectId, from, to)` (Task C2.1) from `../purchase-metrics-api`; `useProjects()` from `../../projects/api`; `useDateRange()`/`DateRangeControl` from `../../analytics/date-range`.
- Removes from this page only: `useSubscriptionsSummary` (stays in `api.ts` for other callers), `RcConnectPage` import, `useGlobalFilters`/`mergeGlobalFilters` usage, the `rcEnabled` const, and the `if (!rcEnabled) return <RcConnectPage .../>` branch.
- Produces (test infra): a default MSW handler for `GET /api/v1/projects/:projectId/metrics/summary` in `dashboard/src/test/msw/handlers.ts`, returning `SUBSCRIPTIONS_SUMMARY_FIXTURE` (field-for-field identical shape per spec §1.1/§7).

---

- [ ] **Step 1 — failing test: Overview renders directly, no connect gate**

  Edit `dashboard/src/features/revenuecat/components/rc-pages.test.tsx` — replace the "shows an upsell empty state" test with a "renders directly" test in the `RcOverviewPage` describe:

  Old:
  ```tsx
  describe('RcOverviewPage', () => {
    it('renders KPI tiles, trend, churn donut, and breakdown tables from the summary', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(OVERVIEW_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByText('MRR')).toBeInTheDocument();
      expect(main.getByText('$49.95')).toBeInTheDocument(); // 4995 cents from the fixture
      expect(main.getByText('Active subscribers')).toBeInTheDocument();
      expect(main.getByText(/churn reasons/i)).toBeInTheDocument();
      expect(main.getByText(/by product/i)).toBeInTheDocument();
    });

    it('shows an upsell empty state when RC is not connected', async () => {
      server.use(projectsHandlerWithoutRc());
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(OVERVIEW_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    });

    it('does not render attribution sections', async () => {
  ```

  New:
  ```tsx
  describe('RcOverviewPage', () => {
    it('renders KPI tiles, trend, churn donut, and breakdown tables from the summary', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(OVERVIEW_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByText('MRR')).toBeInTheDocument();
      expect(main.getByText('$49.95')).toBeInTheDocument(); // 4995 cents from the fixture
      expect(main.getByText('Active subscribers')).toBeInTheDocument();
      expect(main.getByText(/churn reasons/i)).toBeInTheDocument();
      expect(main.getByText(/by product/i)).toBeInTheDocument();
    });

    it('renders directly without a connect gate, even when integrations.revenuecat is false', async () => {
      server.use(projectsHandlerWithoutRc());
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(OVERVIEW_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByText('MRR')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /connect revenuecat/i })).not.toBeInTheDocument();
    });

    it('does not render attribution sections', async () => {
  ```

- [ ] **Step 2 — run to fail**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx --reporter=basic
  ```
  Expected: `RcOverviewPage > renders directly without a connect gate...` fails — `RcOverviewPage` still gates on `rcEnabled` and renders `RcConnectPage`, so `MRR` never appears:
  ```
  TestingLibraryElementError: Unable to find an element with the text: MRR.
  ```
  All other tests in the file still pass at this point. (If it hangs, `pkill -9 -f vitest` once and retry once.)

- [ ] **Step 3 — minimal implementation**

  3a. Add a default MSW handler for `/metrics/summary` in `dashboard/src/test/msw/handlers.ts`, right after the existing `/metrics/subscriptions` handler:

  Old:
  ```ts
    http.get('/api/v1/projects/:projectId/metrics/subscriptions', ({ request }) => {
      const token = bearerToken(request);
      if (!token || !ACCEPTED_TOKENS.has(token))
        return problem(401, 'Access token invalid or expired');
      return HttpResponse.json(SUBSCRIPTIONS_SUMMARY_FIXTURE);
    }),

    http.get('/api/v1/projects/:projectId/metrics/subscriptions/attribution', ({ request }) => {
  ```

  New:
  ```ts
    http.get('/api/v1/projects/:projectId/metrics/subscriptions', ({ request }) => {
      const token = bearerToken(request);
      if (!token || !ACCEPTED_TOKENS.has(token))
        return problem(401, 'Access token invalid or expired');
      return HttpResponse.json(SUBSCRIPTIONS_SUMMARY_FIXTURE);
    }),

    // `mobile_purchase`'s Overview summary endpoint (spec §1.1) — field-for-field identical shape
    // to the mirror's `/metrics/subscriptions` above, so the same fixture doubles for both.
    http.get('/api/v1/projects/:projectId/metrics/summary', ({ request }) => {
      const token = bearerToken(request);
      if (!token || !ACCEPTED_TOKENS.has(token))
        return problem(401, 'Access token invalid or expired');
      return HttpResponse.json(SUBSCRIPTIONS_SUMMARY_FIXTURE);
    }),

    http.get('/api/v1/projects/:projectId/metrics/subscriptions/attribution', ({ request }) => {
  ```

  3b. Rewrite `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx` in full:

  ```tsx
  import { useParams } from '@tanstack/react-router';
  import { PageShell } from '../../../components/layout/PageShell';
  import { Reveal } from '../../../components/ui/reveal';
  import { SectionGrid } from '../../../components/ui/SectionGrid';
  import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
  import type {
    SubscriptionRecentEvent,
    SubscriptionsByProduct,
    SubscriptionsByStore,
  } from '../../../lib/api/types';
  import { useRcSummary } from '../purchase-metrics-api';
  import { useProjects } from '../../projects/api';
  import { colorForIndex } from '../../analytics/palette';
  import { DateRangeControl, useDateRange } from '../../analytics/date-range';
  import { formatCurrency, formatPercent } from '../../analytics/format';
  import { ChartCard } from '../../analytics/components/charts/ChartCard';
  import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
  import { DonutChart } from '../../analytics/components/charts/DonutChart';
  import { KpiTile } from '../../analytics/components/charts/KpiTile';

  /** Maps loading/error/empty query state onto `ChartCard`'s `state` prop in one place (mirrors Revenue/Home). */
  function chartState(
    isPending: boolean,
    isError: boolean,
    isEmpty: boolean,
  ): 'loading' | 'error' | 'empty' | 'ready' {
    if (isPending) return 'loading';
    if (isError) return 'error';
    if (isEmpty) return 'empty';
    return 'ready';
  }

  const BY_PRODUCT_COLUMNS: Array<DataTableColumn<SubscriptionsByProduct>> = [
    { key: 'product_id', header: 'Product', sortable: true },
    { key: 'active', header: 'Active', sortable: true, align: 'right' },
    {
      key: 'mrr',
      header: 'Monthly revenue',
      sortable: true,
      align: 'right',
      render: (row) => formatCurrency(row.mrr_cents / 100),
      sortValue: (row) => row.mrr_cents,
    },
  ];

  const BY_STORE_COLUMNS: Array<DataTableColumn<SubscriptionsByStore>> = [
    { key: 'store', header: 'Store', sortable: true },
    { key: 'active', header: 'Active', sortable: true, align: 'right' },
  ];

  const RECENT_EVENTS_COLUMNS: Array<DataTableColumn<SubscriptionRecentEvent>> = [
    {
      key: 'timestamp',
      header: 'Time',
      sortable: true,
      render: (row) => new Date(row.timestamp).toLocaleString(),
    },
    { key: 'event', header: 'Event', sortable: true },
    { key: 'distinct_id', header: 'User', sortable: true },
    { key: 'product_id', header: 'Product', sortable: true },
    {
      key: 'price',
      header: 'Price',
      sortable: true,
      align: 'right',
      render: (row) => formatCurrency(row.price),
    },
  ];

  /**
   * MyRevenueCat → Overview. The `mobile_purchase` billing-authority summary (MRR, active/trial
   * counts, churn) for the selected range, from `useRcSummary`. Attribution lives on the separate
   * Conversion page — the two are split along the query boundary, so neither straddles a data
   * source. No connect gate: MyRevenueCat is the self-hosted clone, so this renders directly off
   * `mobile_purchase` for every project once `useProjects()` resolves.
   */
  export function RcOverviewPage() {
    const { projectId } = useParams({ from: '/private/projects/$projectId/rc/overview' });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
    const { from, to } = useDateRange();
    const subscriptions = useRcSummary(projectId, from, to);

    // Mirrors RcSettingsPage/RcChartsPage: nothing renders until `useProjects()` has actually
    // resolved, so a still-loading project briefly flashes an empty shell instead of stale content.
    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Overview"
          description="Subscription analytics powered by RevenueCat."
          breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
        >
          {null}
        </PageShell>
      );
    }

    const data = subscriptions.data;

    const trend = data?.by_day.map((day) => ({ t: day.t, new_subscriptions: day.new_subscriptions })) ?? [];
    const churnSlices =
      data?.churn_reasons.map((reason) => ({ key: reason.reason, label: reason.reason, value: reason.count })) ?? [];
    const churnColor = new Map(churnSlices.map((slice, index) => [slice.key, colorForIndex(index)]));

    const trialsConverted = data?.trials_converted ?? 0;
    const trialsStarted = data?.trials_started ?? 0;
    const trialConversionRate = trialsStarted > 0 ? trialsConverted / trialsStarted : 0;

    return (
      <PageShell
        projectId={projectId}
        title="Overview"
        description="MRR, active subscribers, trials, and churn for the selected range."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Overview' }]}
        dateRangeControl={<DateRangeControl />}
      >
        {subscriptions.isPending && (
          <Reveal index={0}>
            <p role="status">Loading subscriptions summary…</p>
          </Reveal>
        )}
        {subscriptions.isError && (
          <Reveal index={0}>
            <p role="alert" className="text-danger">
              Failed to load subscriptions summary
            </p>
          </Reveal>
        )}

        {data && (
          <>
            <Reveal index={0}>
              <SectionGrid>
                <KpiTile label="MRR" value={formatCurrency(data.mrr_cents / 100)} unfiltered />
                <KpiTile label="Active subscribers" value={data.active} unfiltered />
                <KpiTile label="In trial" value={data.in_trial} unfiltered />
                <KpiTile label="New subscriptions" value={data.new_subscriptions} />
                <KpiTile label="Churned" value={data.churned} />
                <KpiTile label="Trial→paid" value={formatPercent(trialConversionRate)} />
              </SectionGrid>
            </Reveal>

            <Reveal index={1}>
              <ChartCard
                title="New subscriptions"
                description="Daily new subscriptions for the selected range."
                state={chartState(subscriptions.isPending, subscriptions.isError, trend.length === 0)}
                exportImageName="subscriptions-new-trend"
              >
                <ComparisonTrend
                  current={trend}
                  xKey="t"
                  valueKey="new_subscriptions"
                  label="New subscriptions"
                  ariaLabel="New subscriptions trend"
                />
              </ChartCard>
            </Reveal>

            <Reveal index={2}>
              <ChartCard
                title="Churn reasons"
                state={chartState(subscriptions.isPending, subscriptions.isError, churnSlices.length === 0)}
              >
                <DonutChart
                  slices={churnSlices}
                  colorFor={(key) => churnColor.get(key) ?? 'var(--series-1)'}
                  ariaLabel="Churn reasons composition"
                />
              </ChartCard>
            </Reveal>

            <Reveal index={3}>
              <ChartCard title="By product">
                <DataTable
                  columns={BY_PRODUCT_COLUMNS}
                  rows={data.by_product}
                  caption="Per-product subscription breakdown"
                  initialSort={{ key: 'mrr', dir: 'desc' }}
                  rowKey={(row) => row.product_id}
                  exportFilename="subscriptions-by-product"
                />
              </ChartCard>
            </Reveal>

            <Reveal index={4}>
              <ChartCard title="By store">
                <DataTable
                  columns={BY_STORE_COLUMNS}
                  rows={data.by_store}
                  caption="Subscriptions by store"
                  initialSort={{ key: 'active', dir: 'desc' }}
                  rowKey={(row) => row.store}
                  exportFilename="subscriptions-by-store"
                />
              </ChartCard>
            </Reveal>

            <Reveal index={5}>
              <ChartCard title="Recent events">
                <DataTable
                  columns={RECENT_EVENTS_COLUMNS}
                  rows={data.recent_events}
                  caption="Recent subscription events"
                  initialSort={{ key: 'timestamp', dir: 'desc' }}
                  rowKey={(row) => row.insert_id}
                  exportFilename="subscriptions-recent-events"
                />
              </ChartCard>
            </Reveal>
          </>
        )}
      </PageShell>
    );
  }
  ```

- [ ] **Step 4 — run to pass**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx --reporter=basic
  ```
  Expected: `Test Files 1 passed (1)`, `Tests 12 passed (12)` — the `RcOverviewPage` (4), `RcConversionPage` (5, unchanged in this task), `RcPlaceholderPage` (1), and `RcSettingsPage` (2) describes all green.

- [ ] **Step 5 — WIP-safety check and commit**

  ```
  git add dashboard/src/features/revenuecat/components/RcOverviewPage.tsx dashboard/src/features/revenuecat/components/rc-pages.test.tsx dashboard/src/test/msw/handlers.ts
  git status --short
  ```
  Expected: only these three files staged; nothing under `dashboard/src/components/layout/`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, or `RailInitial.tsx`.

  ```
  git commit -m "$(cat <<'EOF'
  refactor(dashboard): repoint MyRevenueCat Overview onto mobile_purchase and drop its connect gate
  EOF
  )"
  ```

---

### Task C4.1: De-gate `RcConversionPage`

**Files**
- Modify: `dashboard/src/features/revenuecat/components/RcConversionPage.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-pages.test.tsx`

**Interfaces**
- Consumes: `useSubscriptionAttribution(projectId, from, to)` from `../api` — unchanged, still reads `mobile_analytics`. `useProjects()` from `../../projects/api` — unchanged (still used for the `!project` loading gate).
- Removes from this page only: the `RcConnectPage` import, the `rcEnabled` const, and the `if (!rcEnabled) return <RcConnectPage .../>` branch.

---

- [ ] **Step 1 — failing test: Conversion renders directly, no connect gate**

  Edit `dashboard/src/features/revenuecat/components/rc-pages.test.tsx` — in the `RcConversionPage` describe, replace the two gate-specific tests with one "renders directly" test:

  Old:
  ```tsx
    it('does not render summary KPI tiles', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(CONVERSION_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText(/trial funnel/i);
      expect(main.queryByText('Active subscribers')).not.toBeInTheDocument();
    });

    // Same class of bug as RcOverviewPage/RcSettingsPage (see rc-connect.test.tsx): reading the RC
    // connection flag off a still-loading `useProjects()` must not be mistaken for "not connected".
    // Holds `/api/v1/projects` open with an infinite delay to inspect the loading window itself.
    it('never shows the "connect revenuecat" upsell for an RC-connected project, including while still loading', async () => {
      server.use(
        http.get('/api/v1/projects', async () => {
          await delay('infinite');
          return HttpResponse.json({ projects: [] });
        }),
      );
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(CONVERSION_URL);

      await screen.findByRole('heading', { name: 'Conversion' });
      // `queryAllByText` — the empty state's title AND description both contain "connect revenuecat",
      // so the singular `queryByText` throws on multiple matches instead of failing cleanly.
      expect(screen.queryAllByText(/connect revenuecat/i)).toHaveLength(0);
    });

    // Regression test: the disconnected branch used to render a stale EmptyState pointing at
    // project settings, which is wrong now that `/rc/settings` exists specifically so configuring
    // RevenueCat doesn't eject you from the tool. It must give the same connect surface as
    // RcOverviewPage instead.
    it('shows the same connect surface as RcOverviewPage when RC is not connected, not the old project-settings copy', async () => {
      server.use(projectsHandlerWithoutRc());
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(CONVERSION_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
      expect(await main.findByRole('button', { name: /connect/i })).toBeInTheDocument();
      expect(main.queryByText(/project settings/i)).not.toBeInTheDocument();
    });

    // Regression test: `ChartCard`'s error branch has no live region, so a failed attribution fetch
  ```

  New:
  ```tsx
    it('does not render summary KPI tiles', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(CONVERSION_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText(/trial funnel/i);
      expect(main.queryByText('Active subscribers')).not.toBeInTheDocument();
    });

    it('renders directly without a connect gate, even when integrations.revenuecat is false', async () => {
      server.use(projectsHandlerWithoutRc());
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      renderApp(CONVERSION_URL);
      const main = within(await screen.findByRole('main'));
      expect(await main.findByText(/conversion drivers/i)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /connect revenuecat/i })).not.toBeInTheDocument();
    });

    // Regression test: `ChartCard`'s error branch has no live region, so a failed attribution fetch
  ```

  (`delay`, `http`, `HttpResponse`, and `projectsHandlerWithoutRc` stay imported and used — by `RcSettingsPage`'s loading test and by the new test above, respectively.)

- [ ] **Step 2 — run to fail**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx --reporter=basic
  ```
  Expected: `RcConversionPage > renders directly without a connect gate...` fails — `RcConversionPage` still gates on `rcEnabled` and renders `RcConnectPage` instead of the drivers table:
  ```
  TestingLibraryElementError: Unable to find an element with the text: /conversion drivers/i
  ```
  All other tests in the file still pass. (If it hangs, `pkill -9 -f vitest` once and retry once.)

- [ ] **Step 3 — minimal implementation**

  Edit `dashboard/src/features/revenuecat/components/RcConversionPage.tsx`:

  1. Drop the `RcConnectPage` import:

  Old:
  ```tsx
  import { useSubscriptionAttribution } from '../api';
  import { useProjects } from '../../projects/api';
  import { RcConnectPage } from './RcConnectPage';
  import { DateRangeControl, useDateRange } from '../../analytics/date-range';
  ```

  New:
  ```tsx
  import { useSubscriptionAttribution } from '../api';
  import { useProjects } from '../../projects/api';
  import { DateRangeControl, useDateRange } from '../../analytics/date-range';
  ```

  2. Update the page doc comment and drop the `rcEnabled` const + gate branch:

  Old:
  ```tsx
  /**
   * MyRevenueCat → Conversion. Correlates RevenueCat subscription events against the SDK's own event
   * stream: which events and screens precede a trial-to-paid conversion, how long it takes, and the
   * trial funnel. Real RevenueCat cannot do this — it has no event stream — which is why this is
   * grouped under "Analyze" rather than mirroring RevenueCat's own IA.
   *
   * Unlike Overview, `useSubscriptionAttribution` ignores global filters, so this page carries no
   * filter-dependent state and owns its own loading/error handling.
   */
  export function RcConversionPage() {
    const { projectId } = useParams({ from: '/private/projects/$projectId/rc/conversion' });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
    const rcEnabled = project?.integrations?.revenuecat ?? false;
    const { from, to } = useDateRange();
    const attribution = useSubscriptionAttribution(projectId, from, to);

    // Same discipline as RcOverviewPage/RcSettingsPage: don't decide "not connected" until
    // `useProjects()` has actually resolved, or a still-loading project briefly flashes this upsell
    // at every RC-connected project.
    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Conversion"
          description="What drives trial-to-paid conversion."
          breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
        >
          {null}
        </PageShell>
      );
    }

    // Same connect surface as RcOverviewPage's disconnected state — `/rc/settings` exists precisely
    // so configuring RevenueCat doesn't eject you from the MyRevenueCat tool, so this page must not
    // point back at project settings.
    if (!rcEnabled) return <RcConnectPage projectId={projectId} />;

    const data = attribution.data;
  ```

  New:
  ```tsx
  /**
   * MyRevenueCat → Conversion. Correlates RevenueCat subscription events against the SDK's own event
   * stream: which events and screens precede a trial-to-paid conversion, how long it takes, and the
   * trial funnel. Real RevenueCat cannot do this — it has no event stream — which is why this is
   * grouped under "Analyze" rather than mirroring RevenueCat's own IA.
   *
   * Unlike Overview, `useSubscriptionAttribution` ignores global filters, so this page carries no
   * filter-dependent state and owns its own loading/error handling. No connect gate: this renders
   * directly off `mobile_analytics` for every project once `useProjects()` resolves.
   */
  export function RcConversionPage() {
    const { projectId } = useParams({ from: '/private/projects/$projectId/rc/conversion' });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
    const { from, to } = useDateRange();
    const attribution = useSubscriptionAttribution(projectId, from, to);

    // Same discipline as RcOverviewPage/RcSettingsPage: don't render below until `useProjects()`
    // has actually resolved, or a still-loading project briefly flashes an empty shell.
    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Conversion"
          description="What drives trial-to-paid conversion."
          breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Conversion' }]}
        >
          {null}
        </PageShell>
      );
    }

    const data = attribution.data;
  ```

- [ ] **Step 4 — run to pass**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-pages.test.tsx --reporter=basic
  ```
  Expected: `Test Files 1 passed (1)`, `Tests 11 passed (11)` — `RcOverviewPage` (4), `RcConversionPage` (now 4), `RcPlaceholderPage` (1), `RcSettingsPage` (2).

- [ ] **Step 5 — WIP-safety check and commit**

  ```
  git add dashboard/src/features/revenuecat/components/RcConversionPage.tsx dashboard/src/features/revenuecat/components/rc-pages.test.tsx
  git status --short
  ```
  Expected: only these two files staged; nothing under `dashboard/src/components/layout/`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, or `RailInitial.tsx`.

  ```
  git commit -m "$(cat <<'EOF'
  refactor(dashboard): drop the connect gate from MyRevenueCat Conversion
  EOF
  )"
  ```

---

### Task C5.1: Verify gate — both backends + dashboard green, WIP-safe

**Files**
- No source changes — verification only. If any command below fails, fix the underlying issue in its owning task's files (C1–C4) and re-run this task from Step 1; do not patch around a red check.

**Interfaces**
- Consumes: the state of the repo after C1 (server `metrics/summary` + Testcontainers/e2e), C2.1 (`useRcSummary`), C3.1 (`RcOverviewPage` repoint + de-gate), C4.1 (`RcConversionPage` de-gate).
- Produces: nothing — a pass/fail verification report.

---

- [ ] **Step 1 — `mobile_purchase` typecheck**

  ```
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: exit code `0`, no output (0 type errors — includes the new `SummaryService`/controller/Zod schema from C1).

- [ ] **Step 2 — `mobile_purchase` metrics + e2e suites**

  ```
  cd backend/mobile_purchase && npx jest src/metrics test/e2e
  ```
  Expected: all suites pass, e.g. `Test Suites: N passed, N total` / `Tests: M passed, M total` with `0` failed — includes the C1 `SummaryService` spec and `metrics.e2e-spec.ts`'s `GET .../metrics/summary` cases (200 viewer + zeros on an empty project + 401/403/400).

- [ ] **Step 3 — `mobile_analytics` typecheck (untouched service stays clean)**

  ```
  cd backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: exit code `0`, no output — confirms this sub-project made no schema/type change to the legacy mirror (spec §0 per-service isolation).

- [ ] **Step 4 — dashboard typecheck**

  ```
  cd dashboard && npm run typecheck
  ```
  Expected: exit code `0`, no `tsc` errors — confirms `useRcSummary`, the repointed `RcOverviewPage`, and the de-gated `RcConversionPage` all type-check.

- [ ] **Step 5 — dashboard RevenueCat suite**

  ```
  cd dashboard && npx vitest run src/features/revenuecat --reporter=basic
  ```
  Expected: every file under `src/features/revenuecat/**` passes, including `purchase-metrics-api.test.ts` (7 tests, C2.1), `components/rc-pages.test.tsx` (11 tests, C3.1+C4.1), `components/rc-charts.test.tsx` (unchanged, still green — RcChartsPage untouched), and `components/rc-connect.test.tsx` (unchanged, `RcConnectPage` still standalone-tested). `0` failed.
  (If it hangs, `pkill -9 -f vitest` once and retry once.)

- [ ] **Step 6 — WIP-safety check**

  ```
  git status --short
  ```
  Expected: only files touched by C1 (server) through C4.1 (dashboard) are dirty/staged — specifically `backend/mobile_purchase/src/metrics/**` and its tests/e2e for C1, plus `dashboard/src/features/revenuecat/purchase-metrics-api.ts`, `dashboard/src/features/revenuecat/purchase-metrics-api.test.ts`, `dashboard/src/features/revenuecat/components/RcOverviewPage.tsx`, `dashboard/src/features/revenuecat/components/RcConversionPage.tsx`, `dashboard/src/features/revenuecat/components/rc-pages.test.tsx`, and `dashboard/src/test/msw/handlers.ts` for C2–C4. Nothing under `dashboard/src/components/layout/`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, or `RailInitial.tsx`. No `.env` files. This task makes no code changes, so there is nothing to commit here.


---

