# MyRevenueCat Charts Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one RevenueCat-style graph page end-to-end — the `/rc/charts` dashboard page showing Revenue / MRR / Active-Subscriptions, driven by new `mobile_purchase` metrics endpoints.

**Architecture:** Three increments, server-first: (S1) a new `mobile_purchase` `MetricsModule` with three aggregation endpoints behind the existing `ProjectAccessGuard`; (S2) a dashboard→`mobile_purchase` fetch seam (`purchaseApiFetch` + a second base URL + server CORS); (S3) the `/rc/charts` page consuming S1 via S2 with the existing Recharts chart kit.

**Tech Stack:** NestJS 11 + Prisma 6 (own Postgres :5433) for S1; React + TanStack Router/Query + Recharts + MSW for S2/S3.

**Design spec:** `docs/superpowers/specs/2026-07-18-myrevenuecat-charts-vertical-slice-design.md` — the binding source for the endpoint contracts (§1.1), aggregation semantics + MRR derivation (§1.2), the reach seam (§2), and the page (§3).

## Global Constraints

- **Endpoints (S1), exact:** `GET /api/v1/projects/:projectId/metrics/{revenue,mrr,active-subscriptions}?from&to&granularity&environment`, each `@UseGuards(ProjectAccessGuard)` + `@RequireProjectRole('viewer')`, Zod-validated query (`granularity` ∈ day|week|month default day; `environment` ∈ PRODUCTION|SANDBOX default PRODUCTION; `from` default `to−30d`, `to` default now). Errors 401/403/400(RFC-7807)/503 via the guard + `parseOrThrow`.
- **Response shapes (S1), verbatim:** revenue `{currency:string|null, totalCents:number, series:[{bucket,amountCents}], byCurrency:[{currency,totalCents}]}`; mrr `{currency:string|null, mrrCents:number, series:[{bucket,mrrCents}], unattributedActiveCount:number, approximate:true}`; active-subscriptions `{current:number, series:[{bucket,count}], approximate:true}`. `bucket` = UTC ISO date string.
- **Semantics (S1):** active states = `{TRIAL,INTRO,ACTIVE,CANCELLED,GRACE_PERIOD}`. Revenue = `SUM(Transaction.priceCents)` bucketed by `date_trunc(granularity, purchasedAt)`, excluding `revokedAt IS NOT NULL` + `priceCents IS NULL`, scoped `projectId`+`environment` (EXACT, from the ledger). MRR = Σ active-sub `priceCents` normalized to monthly via the sub's `Product.durationIso8601` (products looked up via a separate `product.findMany` — `Subscription` has no Prisma relation to `Product`, `productId` is a bare nullable column); active subs with null product/period excluded → `unattributedActiveCount`. MRR + active-subs series are WINDOW-APPROXIMATED in JS from current `Subscription` rows' `[purchasedAt, expiresAt)` windows (documented spec §0 limitation; exact history needs X2 snapshots). Per-currency: sum in minor units grouped by `currency`, top-level fields report the DOMINANT currency (largest total); null-currency excluded from dominant.
- **Migration (S1):** add `@@index([projectId, environment, purchasedAt])` to `Transaction` (only `@@index([projectId])` exists). `migrate dev --create-only` → review SQL → `migrate deploy` on :5433 → regenerate the package-local `generated/client`.
- **Reach (S2):** `RuntimeConfig.purchaseApiBaseUrl:string` (default `''`) in `dashboard/src/lib/config.ts`; `purchaseApiFetch<T>(path, options?): Promise<T>` in `dashboard/src/lib/api/purchase-client.ts` — prefixes `purchaseApiBaseUrl`, forwards `Authorization: Bearer <accessToken>` (from `authStore`) + `Content-Type`, maps RFC-7807 → `ApiError` (reuse `problemFromResponse`/`ApiError`/`ApiFetchOptions` from `client.ts`; deliberately NO 401 refresh-replay). `mobile_purchase` CORS via `AppConfig.dashboardOrigins?:string[]` (env `DASHBOARD_ORIGINS`, dev default `http://localhost:5173`), credentials + Authorization allowed, `OPTIONS` preflight passes, wired in `createApp()` (`main.ts`).
- **Page (S3):** `/rc/charts` renders `RcChartsPage` (single-line swap in `router.tsx` from `RcPlaceholderPage`); hooks `useRcRevenue/useRcMrr/useRcActiveSubscriptions(projectId, from, to, granularity, opts?)` over `purchaseApiFetch` in `dashboard/src/features/revenuecat/purchase-metrics-api.ts`; page mirrors `RcOverviewPage` (KpiTile row + 3 `ChartCard`+`ComparisonTrend`, each with the kit's accessible `<table>`), a footnote for the approximation + per-currency note, `rcEnabled` gating (`useRcEnabled` + `useProjects()` resolved), `ChartCard` error slot on failure. Granularity control = native `<select aria-label="Granularity">` (deterministic tests).
- **Per-service isolation:** after the S1 migration + regen, `mobile_analytics` `npx tsc --noEmit` MUST stay 0 (the two backends keep separate generated clients).
- **WIP — HARD RULE (do NOT violate):** touch NONE of the uncommitted collapse-rail WIP files: `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, the layout `*.test.tsx`, `CommandPalette.tsx`, `render-app.tsx`. Do NOT edit `nav-model.ts` at all (the `/rc/charts` route already exists; no nav change is needed). Every dashboard task's verification ends with `git status` proving no WIP file changed.
- **Hygiene:** files <500 lines; backend follows the catalog module conventions (`ProjectAccessGuard`, `parseOrThrow`, Testcontainers helpers, the e2e boot pattern faking `ProjectAccessService`); dashboard follows the existing RC/analytics patterns (TanStack Query, MSW, the chart kit, the RC page test style).

## Task index & build order

- **S1** (Task S1.1–S1.5) — server `MetricsModule`: index migration, duration/bucket support, query schema + response types, `MetricsService` (+ Testcontainers), 3 controllers + module wiring + guard e2e. **Produces** the 3 metrics routes.
- **S2** (Task S2.1–S2.4) — dashboard reach: `purchaseApiBaseUrl` config, `purchaseApiFetch`, `mobile_purchase` `DASHBOARD_ORIGINS` config + CORS on boot. **Produces** `purchaseApiFetch` + `purchaseApiBaseUrl`.
- **S3** (Task S3.1–S3.3) — dashboard `/rc/charts`: metrics query hooks, `RcChartsPage` + the single-line router swap, verification gate. **Consumes** S1 routes + S2 `purchaseApiFetch`.

**Build order: S1 → S2 → S3.**

---

## S1 · Server `mobile_purchase` `MetricsModule` + endpoints + migration

New module `backend/mobile_purchase/src/metrics/` mirroring the catalog module (controllers behind `@UseGuards(ProjectAccessGuard)` + `@RequireProjectRole('viewer')`, services, `support/`, Testcontainers + e2e tests). All paths below are absolute-from-repo-root under `backend/mobile_purchase/`. **WIP safety:** S1 touches ONLY `backend/mobile_purchase/**` (plus a verify-only `tsc` run in `backend/mobile_analytics`). Zero dashboard files, zero `nav-model`/collapse-rail files.

Assumed shell cwd for every command: `backend/mobile_purchase/`. Jest auto-detects `jest.config.js` (testMatch = `src/**/*.spec.ts` + `test/e2e/**/*.e2e-spec.ts`). Testcontainers boots `postgres:17-alpine` and runs `pnpm prisma migrate deploy` (helper `test/integration/helpers/containers.ts`), so the S1.1 migration is auto-applied in every DB-backed test.

---

### Task S1.1: Transaction time-series index migration

Add `@@index([projectId, environment, purchasedAt])` to `Transaction` so revenue time-series scans are indexed (only `@@index([projectId])` exists today).

**Files**
- Modify: `prisma/schema.prisma` (Transaction model)
- Create: `prisma/migrations/<ts>_metrics_transaction_timeseries_index/migration.sql`

**Interfaces**
- Consumes: existing `transactions` table (`project_id`, `environment`, `purchased_at`).
- Produces: DB index `transactions_project_id_environment_purchased_at_idx`. No TS symbols; the regenerated Prisma client is byte-identical except the index metadata.

**Steps**

- [ ] **Step 1: Add the composite index to the schema.** Edit the `Transaction` model in `prisma/schema.prisma` — locate the index block:
  ```prisma
    @@unique([projectId, store, storeTransactionId]) // transaction-level idempotency
    @@index([projectId])
    @@index([originalTransactionId])
    @@index([subscriptionId])
    @@map("transactions")
  ```
  and insert the new index directly under `@@index([projectId])`:
  ```prisma
    @@unique([projectId, store, storeTransactionId]) // transaction-level idempotency
    @@index([projectId])
    // Revenue time-series scans (MetricsService.revenue): filter by projectId + environment,
    // bucket/sort by purchasedAt.
    @@index([projectId, environment, purchasedAt])
    @@index([originalTransactionId])
    @@index([subscriptionId])
    @@map("transactions")
  ```

- [ ] **Step 2: Generate the migration SQL only (do not apply yet).** Run:
  ```bash
  pnpm prisma migrate dev --create-only --name metrics_transaction_timeseries_index
  ```
  Expected: a new folder `prisma/migrations/<ts>_metrics_transaction_timeseries_index/` containing `migration.sql`.

- [ ] **Step 3: Review the emitted SQL.** Confirm `migration.sql` is exactly (a single additive `CREATE INDEX`, no drops, no table rewrites):
  ```sql
  -- CreateIndex
  CREATE INDEX "transactions_project_id_environment_purchased_at_idx" ON "transactions"("project_id", "environment", "purchased_at");
  ```
  If Prisma emitted anything else (a drop/rename), stop — the schema edit was wrong.

- [ ] **Step 4: Apply on :5433 and regenerate the client.** Run:
  ```bash
  pnpm prisma migrate deploy
  pnpm prisma generate
  ```
  Expected: `migrate deploy` reports the new migration applied; `generate` writes `generated/client` with no errors.

- [ ] **Step 5: Verify both services typecheck (this-service client + analytics per-service separation).** Run:
  ```bash
  npx tsc --noEmit
  ```
  Expected: exit 0, no output. Then from `backend/mobile_analytics/`:
  ```bash
  npx tsc --noEmit
  ```
  Expected: exit 0 — the analytics service owns a separate Prisma client and is unaffected by this migration.

- [ ] **Step 6: Commit.**
  ```bash
  git add prisma/schema.prisma prisma/migrations
  git commit -m "feat(mobile_purchase): index transactions(project_id, environment, purchased_at) for revenue time-series"
  ```

---

### Task S1.2: `support/duration.ts` + `support/buckets.ts` — pure period + bucket helpers (unit-tested)

Two dependency-free modules (no DB, no Nest) so the aggregation math is fast to test in isolation.

**Files**
- Create: `src/metrics/support/duration.ts`
- Create: `src/metrics/support/buckets.ts`
- Test: `src/metrics/support/duration.spec.ts`
- Test: `src/metrics/support/buckets.spec.ts`

**Interfaces**
- Produces:
  - `monthlyMultiplier(durationIso8601: string | null | undefined): number | null` — factor to multiply a per-period price by to get a monthly figure (month = 30 days); `null` for unparseable/empty/zero-length.
  - `GRANULARITIES: readonly ['day','week','month']`; `type Granularity = 'day'|'week'|'month'`.
  - `truncateUtc(date: Date, g: Granularity): Date`; `nextBucket(bucketStart: Date, g: Granularity): Date`; `generateBuckets(from: Date, to: Date, g: Granularity): Date[]`.
- Consumes: nothing (pure).

**Steps**

- [ ] **Step 1: Write the failing duration test.** Create `src/metrics/support/duration.spec.ts`:
  ```ts
  import { monthlyMultiplier } from './duration';

  describe('monthlyMultiplier', () => {
    it('normalizes common subscription periods to a monthly multiplier (month = 30 days)', () => {
      expect(monthlyMultiplier('P1M')).toBeCloseTo(1, 10);
      expect(monthlyMultiplier('P1Y')).toBeCloseTo(1 / 12, 10);
      expect(monthlyMultiplier('P3M')).toBeCloseTo(1 / 3, 10);
      expect(monthlyMultiplier('P6M')).toBeCloseTo(1 / 6, 10);
      expect(monthlyMultiplier('P1W')).toBeCloseTo(30 / 7, 10);
      expect(monthlyMultiplier('P7D')).toBeCloseTo(30 / 7, 10);
      expect(monthlyMultiplier('P1D')).toBeCloseTo(30, 10);
    });

    it('multiplies a weekly price cleanly to a monthly figure (700c/week -> 3000c/month)', () => {
      expect(Math.round(700 * (monthlyMultiplier('P1W') as number))).toBe(3000);
    });

    it('returns null for null / empty / unparseable / zero-length durations', () => {
      expect(monthlyMultiplier(null)).toBeNull();
      expect(monthlyMultiplier(undefined)).toBeNull();
      expect(monthlyMultiplier('')).toBeNull();
      expect(monthlyMultiplier('1M')).toBeNull();
      expect(monthlyMultiplier('P')).toBeNull();
      expect(monthlyMultiplier('lifetime')).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run to fail.**
  ```bash
  npx jest src/metrics/support/duration.spec.ts
  ```
  Expected failure: `Cannot find module './duration' from 'src/metrics/support/duration.spec.ts'`.

- [ ] **Step 3: Implement `duration.ts`.** Create `src/metrics/support/duration.ts`:
  ```ts
  // Date part (Y/M/W/D) then optional time part (T H/M/S). The `M` after `T` is minutes, before is months.
  const ISO_DURATION_RE =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

  /**
   * Factor to multiply a subscription's per-period price by to normalize it to a monthly figure,
   * derived from an ISO-8601 duration (a month is modeled as 30 days). Returns `null` for an
   * unparseable / empty / zero-length duration so the caller can EXCLUDE the sub from MRR and count
   * it as unattributed rather than silently dropping revenue.
   *
   *   P1M -> 1, P1Y -> 1/12, P3M -> 1/3, P6M -> 1/6, P1W|P7D -> 30/7, P1D -> 30
   */
  export function monthlyMultiplier(durationIso8601: string | null | undefined): number | null {
    if (!durationIso8601) return null;
    const match = ISO_DURATION_RE.exec(durationIso8601.trim().toUpperCase());
    if (!match) return null;
    const [, y, mo, w, d, h, min, s] = match;
    const totalDays = num(d) + num(h) / 24 + num(min) / 1440 + num(s) / 86400;
    const monthsEquivalent = num(y) * 12 + num(mo) + num(w) * (7 / 30) + totalDays / 30;
    if (!(monthsEquivalent > 0)) return null;
    return 1 / monthsEquivalent;
  }

  function num(value: string | undefined): number {
    return value ? Number(value) : 0;
  }
  ```

- [ ] **Step 4: Run to pass.**
  ```bash
  npx jest src/metrics/support/duration.spec.ts
  ```
  Expected: 3 passing tests.

- [ ] **Step 5: Write the failing buckets test.** Create `src/metrics/support/buckets.spec.ts` (2026-07-16 is a Thursday, so its week bucket is Monday 2026-07-13):
  ```ts
  import { generateBuckets, nextBucket, truncateUtc } from './buckets';

  describe('bucket helpers', () => {
    it('truncateUtc snaps to UTC day / week(Monday) / month starts', () => {
      expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'day').toISOString()).toBe('2026-07-16T00:00:00.000Z');
      expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'week').toISOString()).toBe('2026-07-13T00:00:00.000Z');
      expect(truncateUtc(new Date('2026-07-16T13:45:00Z'), 'month').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });

    it('nextBucket advances one granularity step (incl. month/year rollover)', () => {
      expect(nextBucket(new Date('2026-07-16T00:00:00Z'), 'day').toISOString()).toBe('2026-07-17T00:00:00.000Z');
      expect(nextBucket(new Date('2026-07-13T00:00:00Z'), 'week').toISOString()).toBe('2026-07-20T00:00:00.000Z');
      expect(nextBucket(new Date('2026-12-01T00:00:00Z'), 'month').toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('generateBuckets returns inclusive, zero-fill-ready day buckets', () => {
      const buckets = generateBuckets(new Date('2026-07-01T05:00:00Z'), new Date('2026-07-03T23:00:00Z'), 'day');
      expect(buckets.map((b) => b.toISOString())).toEqual([
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z',
        '2026-07-03T00:00:00.000Z',
      ]);
    });
  });
  ```

- [ ] **Step 6: Run to fail.**
  ```bash
  npx jest src/metrics/support/buckets.spec.ts
  ```
  Expected failure: `Cannot find module './buckets' from 'src/metrics/support/buckets.spec.ts'`.

- [ ] **Step 7: Implement `buckets.ts`.** Create `src/metrics/support/buckets.ts`:
  ```ts
  export const GRANULARITIES = ['day', 'week', 'month'] as const;
  export type Granularity = (typeof GRANULARITIES)[number];

  /** Truncates `date` to the UTC start of its `granularity` bucket, matching Postgres `date_trunc`
   * semantics (week starts Monday, month on the 1st, all at UTC midnight). */
  export function truncateUtc(date: Date, granularity: Granularity): Date {
    if (granularity === 'month') {
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    }
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    if (granularity === 'week') {
      const back = (day.getUTCDay() + 6) % 7; // days since Monday (getUTCDay: 0=Sun..6=Sat)
      day.setUTCDate(day.getUTCDate() - back);
    }
    return day;
  }

  /** Start of the bucket immediately following `bucketStart` for `granularity`. */
  export function nextBucket(bucketStart: Date, granularity: Granularity): Date {
    const y = bucketStart.getUTCFullYear();
    const m = bucketStart.getUTCMonth();
    const d = bucketStart.getUTCDate();
    if (granularity === 'day') return new Date(Date.UTC(y, m, d + 1));
    if (granularity === 'week') return new Date(Date.UTC(y, m, d + 7));
    return new Date(Date.UTC(y, m + 1, 1));
  }

  /** Every bucket start from `truncate(from)` to `truncate(to)` inclusive — used to zero-fill empty
   * buckets so a chart renders gaps as zero, not holes. */
  export function generateBuckets(from: Date, to: Date, granularity: Granularity): Date[] {
    const end = truncateUtc(to, granularity);
    const out: Date[] = [];
    let cur = truncateUtc(from, granularity);
    while (cur.getTime() <= end.getTime()) {
      out.push(cur);
      cur = nextBucket(cur, granularity);
    }
    return out;
  }
  ```

- [ ] **Step 8: Run to pass, then typecheck.**
  ```bash
  npx jest src/metrics/support/duration.spec.ts src/metrics/support/buckets.spec.ts
  npx tsc --noEmit
  ```
  Expected: all tests pass; `tsc` exit 0.

- [ ] **Step 9: Commit.**
  ```bash
  git add src/metrics/support/duration.ts src/metrics/support/buckets.ts src/metrics/support/duration.spec.ts src/metrics/support/buckets.spec.ts
  git commit -m "feat(mobile_purchase): add metrics period-normalization + UTC bucket helpers"
  ```

---

### Task S1.3: `support/metrics.schemas.ts` + `support/metrics.types.ts` — Zod query + response shapes

The dashboard-facing query contract (`from`/`to`/`granularity`/`environment` with defaults) and the exact response interfaces from spec §1.1.

**Files**
- Create: `src/metrics/support/metrics.schemas.ts`
- Create: `src/metrics/support/metrics.types.ts`
- Test: `src/metrics/support/metrics.schemas.spec.ts`

**Interfaces**
- Consumes: `GRANULARITIES` from `./buckets`; `parseOrThrow` (used later by controllers) from `src/common/zod`.
- Produces:
  - `metricsQuerySchema` (Zod, `ZodEffects`) with output `MetricsQuery = { from: Date; to: Date; granularity: Granularity; environment: 'PRODUCTION' | 'SANDBOX' }`. Defaults: `granularity='day'`, `environment='PRODUCTION'`, `to=now`, `from=to−30d`. Rejects `from > to`, non-ISO dates, unknown enum values (400 RFC-7807 via `parseOrThrow`).
  - `ENVIRONMENTS: readonly ['PRODUCTION','SANDBOX']`.
  - Response types: `RevenueMetrics`, `MrrMetrics`, `ActiveSubscriptionsMetrics` (+ point/`CurrencyTotal` sub-types) matching spec §1.1 field-for-field.

**Steps**

- [ ] **Step 1: Write the failing schema test.** Create `src/metrics/support/metrics.schemas.spec.ts`:
  ```ts
  import { metricsQuerySchema } from './metrics.schemas';

  describe('metricsQuerySchema', () => {
    it('applies defaults: 30-day window, day granularity, PRODUCTION env', () => {
      const parsed = metricsQuerySchema.parse({});
      expect(parsed.granularity).toBe('day');
      expect(parsed.environment).toBe('PRODUCTION');
      expect(parsed.to.getTime() - parsed.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('coerces from/to to Dates and preserves granularity/environment', () => {
      const parsed = metricsQuerySchema.parse({
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T00:00:00Z',
        granularity: 'week',
        environment: 'SANDBOX',
      });
      expect(parsed.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
      expect(parsed.to.toISOString()).toBe('2026-07-31T00:00:00.000Z');
      expect(parsed.granularity).toBe('week');
      expect(parsed.environment).toBe('SANDBOX');
    });

    it('rejects from-after-to, an unknown granularity, and a non-date from', () => {
      expect(metricsQuerySchema.safeParse({ from: '2026-08-01T00:00:00Z', to: '2026-07-01T00:00:00Z' }).success).toBe(false);
      expect(metricsQuerySchema.safeParse({ granularity: 'hour' }).success).toBe(false);
      expect(metricsQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run to fail.**
  ```bash
  npx jest src/metrics/support/metrics.schemas.spec.ts
  ```
  Expected failure: `Cannot find module './metrics.schemas' from 'src/metrics/support/metrics.schemas.spec.ts'`.

- [ ] **Step 3: Implement `metrics.schemas.ts`.** Create `src/metrics/support/metrics.schemas.ts`:
  ```ts
  import { z } from 'zod';
  import { GRANULARITIES } from './buckets';

  export const ENVIRONMENTS = ['PRODUCTION', 'SANDBOX'] as const;

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const isoDate = z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'must be an ISO 8601 date-time' });

  /** Common metrics query: `from`/`to` (ISO, defaulting to a trailing 30-day window), `granularity`
   * (day|week|month, default day), `environment` (PRODUCTION|SANDBOX, default PRODUCTION). Transforms
   * to resolved Dates + defaults; rejects `from > to`. Parse via `parseOrThrow` for RFC-7807 400s. */
  export const metricsQuerySchema = z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      granularity: z.enum(GRANULARITIES).default('day'),
      environment: z.enum(ENVIRONMENTS).default('PRODUCTION'),
    })
    .transform((q, ctx) => {
      const to = q.to ? new Date(q.to) : new Date();
      const from = q.from ? new Date(q.from) : new Date(to.getTime() - THIRTY_DAYS_MS);
      if (from.getTime() > to.getTime()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be on or before to', path: ['from'] });
        return z.NEVER;
      }
      return { from, to, granularity: q.granularity, environment: q.environment };
    });

  export type MetricsQuery = z.infer<typeof metricsQuerySchema>;
  ```

- [ ] **Step 4: Implement `metrics.types.ts` (response shapes, spec §1.1).** Create `src/metrics/support/metrics.types.ts`:
  ```ts
  export interface RevenueSeriesPoint {
    bucket: string; // ISO date, bucket start (UTC)
    amountCents: number;
  }
  export interface CurrencyTotal {
    currency: string;
    totalCents: number;
  }
  export interface RevenueMetrics {
    currency: string | null; // dominant currency; null if no data
    totalCents: number; // sum over range, dominant currency
    series: RevenueSeriesPoint[];
    byCurrency: CurrencyTotal[]; // full multi-currency breakdown (null-currency excluded)
  }

  export interface MrrSeriesPoint {
    bucket: string;
    mrrCents: number;
  }
  export interface MrrMetrics {
    currency: string | null;
    mrrCents: number; // CURRENT MRR (as of `to`), dominant currency
    series: MrrSeriesPoint[]; // window-approximated
    unattributedActiveCount: number; // active subs with no importable Product/period, excluded from MRR
    approximate: true;
  }

  export interface ActiveSubscriptionsSeriesPoint {
    bucket: string;
    count: number;
  }
  export interface ActiveSubscriptionsMetrics {
    current: number; // active subs as of `to`
    series: ActiveSubscriptionsSeriesPoint[]; // window-approximated
    approximate: true;
  }
  ```

- [ ] **Step 5: Run to pass, then typecheck.**
  ```bash
  npx jest src/metrics/support/metrics.schemas.spec.ts
  npx tsc --noEmit
  ```
  Expected: 3 passing tests; `tsc` exit 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/metrics/support/metrics.schemas.ts src/metrics/support/metrics.types.ts src/metrics/support/metrics.schemas.spec.ts
  git commit -m "feat(mobile_purchase): add metrics query schema + response types"
  ```

---

### Task S1.4: `MetricsService` — revenue / MRR / active-subscriptions aggregation (Testcontainers)

The first aggregation code in the service. Revenue is EXACT (ledger `date_trunc` via `$queryRaw`, refund/null-price/env excluded, per-currency + dominant). MRR + active-subs are window-approximated from current `Subscription` rows (spec §0). `Subscription` has NO Prisma relation to `Product` (schema: `productId String?`, no `product` relation), so periods are resolved via a separate `product.findMany`.

**Files**
- Create: `src/metrics/services/metrics.service.ts`
- Test: `src/metrics/services/metrics.service.spec.ts`

**Interfaces**
- Consumes: `PrismaService` (`src/prisma/prisma.service`); `monthlyMultiplier` (`../support/duration`); `generateBuckets` (`../support/buckets`); `MetricsQuery` (`../support/metrics.schemas`); response types (`../support/metrics.types`); `Environment`, `SubscriptionStatus` (`../../../generated/client`).
- Produces:
  - `ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[]` = `['TRIAL','INTRO','ACTIVE','CANCELLED','GRACE_PERIOD']`.
  - `class MetricsService` with:
    - `revenue(projectId: string, query: MetricsQuery): Promise<RevenueMetrics>`
    - `mrr(projectId: string, query: MetricsQuery): Promise<MrrMetrics>`
    - `activeSubscriptions(projectId: string, query: MetricsQuery): Promise<ActiveSubscriptionsMetrics>`

**Steps**

- [ ] **Step 1: Write the failing Testcontainers spec.** Create `src/metrics/services/metrics.service.spec.ts`:
  ```ts
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
        storeProductId: 's', status: 'ACTIVE' as const, ...over,
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
  ```

- [ ] **Step 2: Run to fail.**
  ```bash
  npx jest src/metrics/services/metrics.service.spec.ts
  ```
  Expected failure: `Cannot find module './metrics.service' from 'src/metrics/services/metrics.service.spec.ts'`.

- [ ] **Step 3: Implement `metrics.service.ts`.** Create `src/metrics/services/metrics.service.ts`. The revenue series uses `$queryRaw` with `to_char(date_trunc(...))` rendering a UTC ISO string DIRECTLY (TZ-independent for `timestamp without time zone`), keyed against JS `generateBuckets` for zero-fill:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { Environment, SubscriptionStatus } from '../../../generated/client';
  import { PrismaService } from '../../prisma/prisma.service';
  import { generateBuckets } from '../support/buckets';
  import { monthlyMultiplier } from '../support/duration';
  import type { MetricsQuery } from '../support/metrics.schemas';
  import type {
    ActiveSubscriptionsMetrics,
    MrrMetrics,
    RevenueMetrics,
  } from '../support/metrics.types';

  /** Entitled subscription states — the set the entitlement engine treats as granting access. A sub
   * in one of these states counts toward active-subscriptions and MRR. */
  export const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
    'TRIAL',
    'INTRO',
    'ACTIVE',
    'CANCELLED',
    'GRACE_PERIOD',
  ];

  interface ActiveSubRow {
    productId: string | null;
    priceCents: number | null;
    currency: string | null;
    purchasedAt: Date;
    expiresAt: Date | null;
  }

  @Injectable()
  export class MetricsService {
    constructor(private readonly prisma: PrismaService) {}

    /** EXACT revenue from the immutable Transaction ledger: SUM(priceCents) by date_trunc(purchasedAt),
     * scoped projectId + environment, excluding revoked (refund/chargeback) + null-price rows.
     * Per-currency totals; top-level currency/total/series report the dominant currency. */
    async revenue(projectId: string, query: MetricsQuery): Promise<RevenueMetrics> {
      const { from, to, granularity, environment } = query;

      const grouped = await this.prisma.transaction.groupBy({
        by: ['currency'],
        where: {
          projectId,
          environment,
          revokedAt: null,
          priceCents: { not: null },
          purchasedAt: { gte: from, lte: to },
        },
        _sum: { priceCents: true },
      });

      const byCurrency = grouped
        .flatMap((g) => (g.currency === null ? [] : [{ currency: g.currency, totalCents: Number(g._sum.priceCents ?? 0) }]))
        .sort((a, b) => b.totalCents - a.totalCents || a.currency.localeCompare(b.currency));

      const dominant = byCurrency[0] ?? null;
      const buckets = generateBuckets(from, to, granularity);

      let byBucket = new Map<string, number>();
      if (dominant) {
        const rows = await this.prisma.$queryRaw<{ bucket: string; amount_cents: bigint }[]>`
          SELECT to_char(date_trunc(${granularity}, purchased_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS bucket,
                 SUM(price_cents)::bigint AS amount_cents
          FROM transactions
          WHERE project_id = ${projectId}::uuid
            AND environment = ${environment}::"Environment"
            AND revoked_at IS NULL
            AND price_cents IS NOT NULL
            AND currency = ${dominant.currency}
            AND purchased_at >= ${from}::timestamp
            AND purchased_at <= ${to}::timestamp
          GROUP BY 1
        `;
        byBucket = new Map(rows.map((r) => [r.bucket, Number(r.amount_cents)]));
      }

      return {
        currency: dominant?.currency ?? null,
        totalCents: dominant?.totalCents ?? 0,
        series: buckets.map((b) => ({ bucket: b.toISOString(), amountCents: byBucket.get(b.toISOString()) ?? 0 })),
        byCurrency,
      };
    }

    /** CURRENT MRR (dominant currency) = Σ monthlyCents over active subs, normalizing priceCents to a
     * monthly figure via the sub's Product.durationIso8601. Subs with no productId / unresolvable
     * period / null price are excluded and counted in unattributedActiveCount (never silently dropped).
     * Series is window-approximated (spec §0): a sub counts at bucket T when purchasedAt<=T and
     * (expiresAt IS NULL or expiresAt>T). */
    async mrr(projectId: string, query: MetricsQuery): Promise<MrrMetrics> {
      const { from, to, granularity, environment } = query;
      const subs = await this.fetchActiveSubs(projectId, environment);
      const multiplierByProduct = await this.resolveMultipliers(projectId, subs);

      let unattributedActiveCount = 0;
      const monthlyByCurrency = new Map<string, number>();
      const attributable: { monthlyCents: number; currency: string | null; purchasedAt: Date; expiresAt: Date | null }[] = [];

      for (const s of subs) {
        const multiplier = s.productId ? multiplierByProduct.get(s.productId) ?? null : null;
        if (multiplier === null || s.priceCents === null) {
          unattributedActiveCount += 1;
          continue;
        }
        const monthlyCents = Math.round(s.priceCents * multiplier);
        attributable.push({ monthlyCents, currency: s.currency, purchasedAt: s.purchasedAt, expiresAt: s.expiresAt });
        if (s.currency !== null) {
          monthlyByCurrency.set(s.currency, (monthlyByCurrency.get(s.currency) ?? 0) + monthlyCents);
        }
      }

      const dominant = pickDominantCurrency(monthlyByCurrency);
      const buckets = generateBuckets(from, to, granularity);

      return {
        currency: dominant?.currency ?? null,
        mrrCents: dominant?.total ?? 0,
        series: buckets.map((b) => {
          let sum = 0;
          if (dominant) {
            for (const a of attributable) {
              if (a.currency === dominant.currency && a.purchasedAt <= b && (a.expiresAt === null || a.expiresAt > b)) {
                sum += a.monthlyCents;
              }
            }
          }
          return { bucket: b.toISOString(), mrrCents: sum };
        }),
        unattributedActiveCount,
        approximate: true,
      };
    }

    /** Active subscribers. `current` = as of `to`; series window-approximated at each bucket start. */
    async activeSubscriptions(projectId: string, query: MetricsQuery): Promise<ActiveSubscriptionsMetrics> {
      const { from, to, granularity, environment } = query;
      const subs = await this.fetchActiveSubs(projectId, environment);
      const buckets = generateBuckets(from, to, granularity);

      return {
        current: subs.filter((s) => s.purchasedAt <= to && (s.expiresAt === null || s.expiresAt > to)).length,
        series: buckets.map((b) => ({
          bucket: b.toISOString(),
          count: subs.filter((s) => s.purchasedAt <= b && (s.expiresAt === null || s.expiresAt > b)).length,
        })),
        approximate: true,
      };
    }

    private fetchActiveSubs(projectId: string, environment: Environment): Promise<ActiveSubRow[]> {
      return this.prisma.subscription.findMany({
        where: { projectId, environment, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
        select: { productId: true, priceCents: true, currency: true, purchasedAt: true, expiresAt: true },
      });
    }

    /** Subscription has no Prisma relation to Product (productId is a bare nullable column), so resolve
     * each referenced product's period in one scoped query -> monthly multiplier (null if unresolvable). */
    private async resolveMultipliers(projectId: string, subs: ActiveSubRow[]): Promise<Map<string, number | null>> {
      const productIds = [...new Set(subs.map((s) => s.productId).filter((id): id is string => id !== null))];
      if (productIds.length === 0) return new Map();
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds }, projectId },
        select: { id: true, durationIso8601: true },
      });
      return new Map(products.map((p) => [p.id, monthlyMultiplier(p.durationIso8601)]));
    }
  }

  /** Largest total wins; ties broken alphabetically for a deterministic dominant currency. */
  function pickDominantCurrency(totals: Map<string, number>): { currency: string; total: number } | null {
    let best: { currency: string; total: number } | null = null;
    for (const [currency, total] of totals) {
      if (best === null || total > best.total || (total === best.total && currency.localeCompare(best.currency) < 0)) {
        best = { currency, total };
      }
    }
    return best;
  }
  ```

- [ ] **Step 4: Run to pass.**
  ```bash
  npx jest src/metrics/services/metrics.service.spec.ts
  ```
  Expected: 4 passing tests (revenue / mrr / active-subscriptions / empty-project).

- [ ] **Step 5: Typecheck.**
  ```bash
  npx tsc --noEmit
  ```
  Expected: exit 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/metrics/services/metrics.service.ts src/metrics/services/metrics.service.spec.ts
  git commit -m "feat(mobile_purchase): add MetricsService (revenue/MRR/active-subs aggregation)"
  ```

---

### Task S1.5: 3 controllers + `MetricsModule` + `app.module` wiring + guard e2e

Three guarded controllers (one route each) at `@Controller('api/v1/projects/:projectId/metrics')`, Zod-validated query, behind `ProjectAccessGuard` + `@RequireProjectRole('viewer')`. Wire `MetricsModule` into `AppModule`. Prove routing + guard with an e2e boot test (`ProjectAccessService` faked like the catalog e2e).

**Files**
- Create: `src/metrics/controllers/revenue.controller.ts`
- Create: `src/metrics/controllers/mrr.controller.ts`
- Create: `src/metrics/controllers/active-subscriptions.controller.ts`
- Create: `src/metrics/metrics.module.ts`
- Modify: `src/app.module.ts` (add `MetricsModule` to `imports`)
- Test: `test/e2e/metrics.e2e-spec.ts`

**Interfaces**
- Consumes: `MetricsService`; `ProjectAccessGuard`, `RequireProjectRole` (`../../authz/*`); `parseOrThrow` (`../../common/zod`); `metricsQuerySchema` (`../support/metrics.schemas`); `AuthzModule` (`../authz/authz.module`).
- Produces routes (PRODUCES for the whole S1 section):
  - `GET /api/v1/projects/:projectId/metrics/revenue?from&to&granularity&environment` → `200 RevenueMetrics`
  - `GET /api/v1/projects/:projectId/metrics/mrr?from&to&granularity&environment` → `200 MrrMetrics`
  - `GET /api/v1/projects/:projectId/metrics/active-subscriptions?from&to&granularity&environment` → `200 ActiveSubscriptionsMetrics`
  - Errors (from the guard/parser): `401` missing/invalid auth, `403` insufficient role, `400` bad query (RFC-7807), `503` analytics unreachable.
- Produces: `class MetricsModule`.

**Steps**

- [ ] **Step 1: Write the failing e2e.** Create `test/e2e/metrics.e2e-spec.ts` (mirrors `test/e2e/catalog.e2e-spec.ts`; overrides `ProjectAccessService` with a fake whose `role` drives the guard):
  ```ts
  import { randomUUID } from 'node:crypto';
  import type { INestApplication } from '@nestjs/common';
  import { Test } from '@nestjs/testing';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import request from 'supertest';
  import { AppModule } from '../../src/app.module';
  import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
  import { startPostgresContainer } from '../integration/helpers/containers';

  jest.setTimeout(180000);

  class FakeProjectAccessService {
    role: ProjectRole | null = 'viewer';
    async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
      return this.role;
    }
  }

  describe('Metrics e2e — module wiring + ProjectAccessGuard', () => {
    let container: StartedPostgreSqlContainer;
    let app: INestApplication;
    let fakeAccess: FakeProjectAccessService;

    beforeAll(async () => {
      const started = await startPostgresContainer();
      container = started.container;
      process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
      process.env.NODE_ENV = 'test';

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ProjectAccessService)
        .useClass(FakeProjectAccessService)
        .compile();

      app = moduleRef.createNestApplication();
      await app.init();
      fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
    });

    afterAll(async () => {
      await app.close();
      await container.stop();
    });

    const routes = ['revenue', 'mrr', 'active-subscriptions'];

    it('viewer gets 200 with the documented shape on every metrics route (empty project -> zeros)', async () => {
      fakeAccess.role = 'viewer';
      const projectId = randomUUID();
      const http = app.getHttpServer();

      const revenue = await request(http)
        .get(`/api/v1/projects/${projectId}/metrics/revenue`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(200);
      expect(revenue.body).toEqual({ currency: null, totalCents: 0, series: expect.any(Array), byCurrency: [] });

      const mrr = await request(http)
        .get(`/api/v1/projects/${projectId}/metrics/mrr`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(200);
      expect(mrr.body).toMatchObject({ currency: null, mrrCents: 0, unattributedActiveCount: 0, approximate: true });

      const active = await request(http)
        .get(`/api/v1/projects/${projectId}/metrics/active-subscriptions`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(200);
      expect(active.body).toMatchObject({ current: 0, approximate: true });
    });

    it('missing Authorization header -> 401 on every metrics route (guard runs before the handler)', async () => {
      const projectId = randomUUID();
      const http = app.getHttpServer();
      for (const route of routes) {
        await request(http).get(`/api/v1/projects/${projectId}/metrics/${route}`).expect(401);
      }
    });

    it('denied role -> 403', async () => {
      fakeAccess.role = null;
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${randomUUID()}/metrics/revenue`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(403);
    });
  });
  ```

- [ ] **Step 2: Run to fail.**
  ```bash
  npx jest test/e2e/metrics.e2e-spec.ts
  ```
  Expected failure: the app compiles but every metrics route 404s (module not mounted) — first assertion fails with `expected 200 "OK", got 404 "Not Found"`. (If run before controllers/module exist, TS also fails to compile `AppModule` importing `MetricsModule`; create the files in Steps 3-6 then re-run.)

- [ ] **Step 3: Implement the revenue controller.** Create `src/metrics/controllers/revenue.controller.ts`:
  ```ts
  import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { parseOrThrow } from '../../common/zod';
  import { metricsQuerySchema } from '../support/metrics.schemas';
  import { MetricsService } from '../services/metrics.service';

  @Controller('api/v1/projects/:projectId/metrics')
  @UseGuards(ProjectAccessGuard)
  export class RevenueController {
    constructor(private readonly service: MetricsService) {}

    @Get('revenue')
    @RequireProjectRole('viewer')
    revenue(@Param('projectId') projectId: string, @Query() query: unknown) {
      return this.service.revenue(projectId, parseOrThrow(metricsQuerySchema, query));
    }
  }
  ```

- [ ] **Step 4: Implement the MRR controller.** Create `src/metrics/controllers/mrr.controller.ts`:
  ```ts
  import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { parseOrThrow } from '../../common/zod';
  import { metricsQuerySchema } from '../support/metrics.schemas';
  import { MetricsService } from '../services/metrics.service';

  @Controller('api/v1/projects/:projectId/metrics')
  @UseGuards(ProjectAccessGuard)
  export class MrrController {
    constructor(private readonly service: MetricsService) {}

    @Get('mrr')
    @RequireProjectRole('viewer')
    mrr(@Param('projectId') projectId: string, @Query() query: unknown) {
      return this.service.mrr(projectId, parseOrThrow(metricsQuerySchema, query));
    }
  }
  ```

- [ ] **Step 5: Implement the active-subscriptions controller.** Create `src/metrics/controllers/active-subscriptions.controller.ts`:
  ```ts
  import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { parseOrThrow } from '../../common/zod';
  import { metricsQuerySchema } from '../support/metrics.schemas';
  import { MetricsService } from '../services/metrics.service';

  @Controller('api/v1/projects/:projectId/metrics')
  @UseGuards(ProjectAccessGuard)
  export class ActiveSubscriptionsController {
    constructor(private readonly service: MetricsService) {}

    @Get('active-subscriptions')
    @RequireProjectRole('viewer')
    activeSubscriptions(@Param('projectId') projectId: string, @Query() query: unknown) {
      return this.service.activeSubscriptions(projectId, parseOrThrow(metricsQuerySchema, query));
    }
  }
  ```

- [ ] **Step 6: Implement `MetricsModule`.** Create `src/metrics/metrics.module.ts` (imports `AuthzModule` for the guard; `PrismaModule` is `@Global()` so `PrismaService` needs no import — same as `CatalogModule`):
  ```ts
  import { Module } from '@nestjs/common';
  import { AuthzModule } from '../authz/authz.module';
  import { ActiveSubscriptionsController } from './controllers/active-subscriptions.controller';
  import { MrrController } from './controllers/mrr.controller';
  import { RevenueController } from './controllers/revenue.controller';
  import { MetricsService } from './services/metrics.service';

  /**
   * Read-only aggregation surface (dashboard-JWT authz seam). AuthzModule provides
   * ProjectAccessGuard for the viewer-gated controllers; PrismaModule is @Global() so PrismaService
   * needs no import here. First aggregation code in the service.
   */
  @Module({
    imports: [AuthzModule],
    controllers: [RevenueController, MrrController, ActiveSubscriptionsController],
    providers: [MetricsService],
  })
  export class MetricsModule {}
  ```

- [ ] **Step 7: Wire `MetricsModule` into `AppModule`.** Edit `src/app.module.ts` — add the import near the other domain-module imports:
  ```ts
  import { ReceiptsModule } from './receipts/receipts.module';
  import { MetricsModule } from './metrics/metrics.module';
  ```
  and add `MetricsModule` to the `imports` array (after `ReceiptsModule`):
  ```ts
      WebhooksModule,
      ReceiptsModule,
      MetricsModule,
    ],
  })
  export class AppModule {}
  ```

- [ ] **Step 8: Run the e2e to pass.**
  ```bash
  npx jest test/e2e/metrics.e2e-spec.ts
  ```
  Expected: 3 passing tests (viewer 200 on all three routes; missing-auth 401 on all three; denied role 403).

- [ ] **Step 9: Full typecheck + full metrics suite + analytics typecheck.**
  ```bash
  npx tsc --noEmit
  npx jest src/metrics test/e2e/metrics.e2e-spec.ts
  ```
  Expected: `tsc` exit 0; all metrics unit + Testcontainers + e2e tests green. Then from `backend/mobile_analytics/`:
  ```bash
  npx tsc --noEmit
  ```
  Expected: exit 0.

- [ ] **Step 10: Commit.**
  ```bash
  git add src/metrics/controllers src/metrics/metrics.module.ts src/app.module.ts test/e2e/metrics.e2e-spec.ts
  git commit -m "feat(mobile_purchase): expose guarded metrics endpoints (revenue/mrr/active-subscriptions) + wire MetricsModule"
  ```


---

## S2 · Dashboard reach — `purchaseApiBaseUrl` config + `purchaseApiFetch` + `mobile_purchase` CORS

Implements design §2. Build order inside S2: **S2.1 → S2.2** (dashboard reach; independent of the server), then **S2.3 → S2.4** (server CORS). All four are independent of S1 and can land before/after it. **No WIP file is touched** — S2 only modifies `dashboard/src/lib/config.ts`, adds new files under `dashboard/src/lib/api/`, modifies `backend/mobile_purchase/src/config/app-config.ts` + `backend/mobile_purchase/src/main.ts`, and adds `backend/mobile_purchase/test/e2e/cors.e2e-spec.ts`.

**Cross-section interface produced (S3 consumes):**
- `purchaseApiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T>` — `dashboard/src/lib/api/purchase-client.ts`
- `RuntimeConfig.purchaseApiBaseUrl: string` — `dashboard/src/lib/config.ts` (default `''`)

---

### Task S2.1: Dashboard runtime config — `purchaseApiBaseUrl` field

Add the `mobile_purchase` origin to the dashboard runtime config, mirroring `apiBaseUrl`. Default `''` (same-origin); settable by X1 in prod / the dev server origin in dev.

**Files**
- Modify: `dashboard/src/lib/config.ts`
- Test (modify): `dashboard/src/lib/config.test.ts`

**Interfaces**
- Produces: `interface RuntimeConfig { apiBaseUrl: string; purchaseApiBaseUrl: string }`; `getRuntimeConfig(): RuntimeConfig` (unchanged signature, now includes `purchaseApiBaseUrl`).
- Consumes: `window.___MYAMPIX_CONFIG__?: Partial<RuntimeConfig>` (existing global).

**TDD steps**

- [ ] **Step 1: Failing test — `purchaseApiBaseUrl` is part of the runtime config.** Replace the whole body of `dashboard/src/lib/config.test.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeConfig } from './config';

describe('getRuntimeConfig', () => {
  afterEach(() => {
    delete window.___MYAMPIX_CONFIG__;
  });

  it('returns values injected by config.js', () => {
    window.___MYAMPIX_CONFIG__ = {
      apiBaseUrl: 'https://api.myampix.example',
      purchaseApiBaseUrl: 'https://purchase.myampix.example',
    };
    expect(getRuntimeConfig()).toEqual({
      apiBaseUrl: 'https://api.myampix.example',
      purchaseApiBaseUrl: 'https://purchase.myampix.example',
    });
  });

  it('falls back to same-origin defaults when config.js is absent (dev)', () => {
    delete window.___MYAMPIX_CONFIG__;
    expect(getRuntimeConfig()).toEqual({ apiBaseUrl: '', purchaseApiBaseUrl: '' });
  });

  it('fills missing keys from defaults', () => {
    window.___MYAMPIX_CONFIG__ = { apiBaseUrl: 'https://api.myampix.example' };
    expect(getRuntimeConfig().apiBaseUrl).toBe('https://api.myampix.example');
    expect(getRuntimeConfig().purchaseApiBaseUrl).toBe('');
  });
});
```

- [ ] **Step 2: Run to fail.** From `dashboard/`:
  ```bash
  pnpm exec vitest run src/lib/config.test.ts
  ```
  Expected failure: the first two cases fail with `expected { apiBaseUrl: '…' } to deeply equal { apiBaseUrl: '…', purchaseApiBaseUrl: '…' }` (actual object has no `purchaseApiBaseUrl` key), and `getRuntimeConfig().purchaseApiBaseUrl` is `undefined`.

- [ ] **Step 3: Minimal implementation.** Replace the whole body of `dashboard/src/lib/config.ts` with:

```ts
export interface RuntimeConfig {
  /** Backend origin. '' means same-origin (dev proxy / reverse-proxied prod). */
  apiBaseUrl: string;
  /**
   * mobile_purchase (billing-authority) service origin for the MyRevenueCat data pages. '' means
   * same-origin; set to the mobile_purchase origin when it is a distinct host — both services
   * expose /api/v1/projects/:projectId/…, so they cannot share apiBaseUrl. Set by X1 in prod / the
   * mobile_purchase dev server origin in dev.
   */
  purchaseApiBaseUrl: string;
}

declare global {
  interface Window {
    ___MYAMPIX_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULTS: RuntimeConfig = {
  apiBaseUrl: '',
  purchaseApiBaseUrl: '',
};

/** Merges the runtime config injected by /config.js over dev-safe defaults. */
export function getRuntimeConfig(): RuntimeConfig {
  return { ...DEFAULTS, ...window.___MYAMPIX_CONFIG__ };
}
```

- [ ] **Step 4: Run to pass.** From `dashboard/`:
  ```bash
  pnpm exec vitest run src/lib/config.test.ts
  ```
  Expected: 3 passing.

- [ ] **Step 5: Commit.**
  ```bash
  git add dashboard/src/lib/config.ts dashboard/src/lib/config.test.ts
  git commit -m "feat(dashboard): add purchaseApiBaseUrl runtime config field"
  ```

---

### Task S2.2: `purchaseApiFetch` — the dashboard→`mobile_purchase` transport seam

A thin sibling of `apiFetch` (new file, so no WIP overlap with `client.ts`) that prefixes `purchaseApiBaseUrl`, forwards the same auth-store bearer JWT + `Content-Type`, sends `credentials: 'include'`, and maps RFC-7807 bodies to `ApiError` — identical error handling to `apiFetch`. This is the reusable seam every future RC dashboard page uses.

**Files**
- Create: `dashboard/src/lib/api/purchase-client.ts`
- Test (create): `dashboard/src/lib/api/purchase-client.test.ts`

**Interfaces**
- Produces: `export async function purchaseApiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T>`.
- Consumes: `ApiFetchOptions` (type from `./client`), `authStore.getState().accessToken` (`../../features/auth/store`), `getRuntimeConfig().purchaseApiBaseUrl` (`../config` — from Task S2.1), `ApiError` + `problemFromResponse` (`./problem`).

**TDD steps**

- [ ] **Step 1: Failing test — base-url prefixing, auth/Content-Type forwarding, RFC-7807 mapping.** Create `dashboard/src/lib/api/purchase-client.test.ts`. Uses a `vi.stubGlobal('fetch', …)` mock (the same fetch-mock approach the transport layer is tested with) so the exact request URL + headers can be asserted; `authStore` is reset by the global `afterEach` in `src/test/setup.ts`.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../features/auth/store';
import { TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
import { purchaseApiFetch } from './purchase-client';

const fetchMock = vi.fn();

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.contentType ?? 'application/json' },
  });
}

describe('purchaseApiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.___MYAMPIX_CONFIG__;
  });

  it('prefixes the configured purchaseApiBaseUrl before the path', async () => {
    window.___MYAMPIX_CONFIG__ = { purchaseApiBaseUrl: 'https://purchase.myampix.example' };
    fetchMock.mockResolvedValue(jsonResponse({ current: 3 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://purchase.myampix.example/api/v1/projects/p1/metrics/active-subscriptions',
    );
  });

  it('defaults to same-origin (no prefix) when purchaseApiBaseUrl is unset', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 0 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/projects/p1/metrics/active-subscriptions');
  });

  it('forwards the Authorization bearer + Content-Type from the shared auth store and sends credentials', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/mrr', {
      method: 'POST',
      body: { from: '2026-06-01' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${VALID_ACCESS_TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(JSON.stringify({ from: '2026-06-01' }));
  });

  it('omits the Authorization header when there is no session token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 0 }));

    await purchaseApiFetch('/api/v1/projects/p1/metrics/active-subscriptions');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns the parsed JSON body on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ current: 42 }));

    const body = await purchaseApiFetch<{ current: number }>(
      '/api/v1/projects/p1/metrics/active-subscriptions',
    );

    expect(body).toEqual({ current: 42 });
  });

  it('maps an RFC 7807 problem body to ApiError with the parsed problem', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          type: 'about:blank',
          title: 'Invalid query',
          status: 400,
          detail: 'from must be an ISO date',
        },
        { status: 400, contentType: 'application/problem+json' },
      ),
    );

    await expect(
      purchaseApiFetch('/api/v1/projects/p1/metrics/revenue?from=nope'),
    ).rejects.toMatchObject({
      name: 'ApiError',
      problem: { status: 400, title: 'Invalid query', detail: 'from must be an ISO date' },
    });
  });
});
```

- [ ] **Step 2: Run to fail.** From `dashboard/`:
  ```bash
  pnpm exec vitest run src/lib/api/purchase-client.test.ts
  ```
  Expected failure: `Failed to resolve import "./purchase-client"` (the module does not exist yet) — the whole file errors before any assertion runs.

- [ ] **Step 3: Minimal implementation.** Create `dashboard/src/lib/api/purchase-client.ts`:

```ts
import { authStore } from '../../features/auth/store';
import { getRuntimeConfig } from '../config';
import type { ApiFetchOptions } from './client';
import { ApiError, problemFromResponse } from './problem';

/**
 * Typed transport for the `mobile_purchase` (billing-authority) service — the sibling of
 * {@link apiFetch} that every MyRevenueCat data page uses. It prefixes `purchaseApiBaseUrl` (a
 * distinct origin from `apiBaseUrl`; both services expose /api/v1/projects/:projectId/…), forwards
 * the same dashboard bearer JWT from the shared auth store + `Content-Type`, sends credentials, and
 * maps RFC 7807 problem bodies to {@link ApiError} — identical error handling to `apiFetch`.
 *
 * Unlike `apiFetch` it does NOT run the 401 silent-refresh-and-replay: token refresh is owned by
 * the same-origin `apiFetch` path (and `restoreSession` on load); a 401 here surfaces as an
 * `ApiError` the RC pages render as a configuration/auth error slot (design §3 gating).
 */
export async function purchaseApiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, ...init } = options;
  const token = authStore.getState().accessToken;
  const res = await fetch(`${getRuntimeConfig().purchaseApiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) throw new ApiError(await problemFromResponse(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 4: Run to pass.** From `dashboard/`:
  ```bash
  pnpm exec vitest run src/lib/api/purchase-client.test.ts
  ```
  Expected: 6 passing.

- [ ] **Step 5: Commit.**
  ```bash
  git add dashboard/src/lib/api/purchase-client.ts dashboard/src/lib/api/purchase-client.test.ts
  git commit -m "feat(dashboard): add purchaseApiFetch transport for the mobile_purchase service"
  ```

---

### Task S2.3: `mobile_purchase` config — `DASHBOARD_ORIGINS` CORS allowlist

Config-driven dashboard-origin allowlist for CORS (design §2), parsed exactly like the existing `APPLE_BUNDLE_IDS` comma-list. Dev default is the dashboard dev server origin (`http://localhost:5173`, from `dashboard/vite.config.ts`) so local dev works out of the box; X1 sets the prod origin(s).

**Files**
- Modify: `backend/mobile_purchase/src/config/app-config.ts`
- Test (create): `backend/mobile_purchase/src/config/app-config.spec.ts`

**Interfaces**
- Produces: `AppConfig.dashboardOrigins?: string[]` (optional for hand-built-fixture compat, per the file's existing convention; `loadConfig` always populates it). `describeConfig` surfaces `DASHBOARD_ORIGINS`.
- Consumes: `DASHBOARD_ORIGINS` from `process.env`.

**TDD steps**

- [ ] **Step 1: Failing test — `DASHBOARD_ORIGINS` parses into `dashboardOrigins`.** Create `backend/mobile_purchase/src/config/app-config.spec.ts`:

```ts
import { describeConfig, loadConfig } from './app-config';

const BASE_ENV = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' } as NodeJS.ProcessEnv;

describe('loadConfig — DASHBOARD_ORIGINS (CORS allowlist)', () => {
  it('defaults to the dashboard dev server origin when DASHBOARD_ORIGINS is unset', () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.dashboardOrigins).toEqual(['http://localhost:5173']);
  });

  it('splits a comma-separated allowlist, trimming whitespace and dropping empty entries', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DASHBOARD_ORIGINS: 'http://localhost:5173, https://app.myampix.example , ',
    });
    expect(config.dashboardOrigins).toEqual([
      'http://localhost:5173',
      'https://app.myampix.example',
    ]);
  });

  it('surfaces the configured origins in the redacted boot description', () => {
    const config = loadConfig({
      ...BASE_ENV,
      DASHBOARD_ORIGINS: 'https://app.myampix.example',
    });
    expect(describeConfig(config).DASHBOARD_ORIGINS).toBe('https://app.myampix.example');
  });
});
```

- [ ] **Step 2: Run to fail.** From `backend/mobile_purchase/`:
  ```bash
  pnpm exec jest src/config/app-config.spec.ts
  ```
  Expected failure: `expected undefined to deeply equal [ 'http://localhost:5173' ]` (the `dashboardOrigins` field does not exist on `AppConfig` yet), and `describeConfig(config).DASHBOARD_ORIGINS` is `undefined`.

- [ ] **Step 3: Minimal implementation.** In `backend/mobile_purchase/src/config/app-config.ts`:

  (a) Add the env var to `envSchema` (place it after `GOOGLE_PUBSUB_SHARED_SECRET`, before the closing `});`):
```ts
  // CORS allowlist for the dashboard→mobile_purchase reach (design §2): comma-separated list of
  // dashboard origin(s) permitted to send credentialed (Authorization) cross-origin requests. Dev
  // default is the dashboard dev server origin (dashboard/vite.config.ts); X1 sets the prod
  // origin(s). Empty → no origin is allowed (CORS effectively closed).
  DASHBOARD_ORIGINS: z.string().default('http://localhost:5173'),
```

  (b) Add the field to the `AppConfig` interface (after `googlePubsubSharedSecret?: string;`):
```ts
  // CORS allowlist — see envSchema comment above. Optional for the same hand-built-fixture-
  // compatibility reason as the Apple/Google fields; loadConfig() always populates it.
  dashboardOrigins?: string[];
```

  (c) Add to the `loadConfig` return object (after `googlePubsubSharedSecret: v.GOOGLE_PUBSUB_SHARED_SECRET,`):
```ts
    dashboardOrigins: v.DASHBOARD_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
```

  (d) Add to the `describeConfig` return object (after the `GOOGLE_PUBSUB_SHARED_SECRET` line):
```ts
    DASHBOARD_ORIGINS: (config.dashboardOrigins ?? []).join(',') || 'MISSING',
```

- [ ] **Step 4: Run to pass.** From `backend/mobile_purchase/`:
  ```bash
  pnpm exec jest src/config/app-config.spec.ts
  ```
  Expected: 3 passing.

- [ ] **Step 5: Commit.**
  ```bash
  git add backend/mobile_purchase/src/config/app-config.ts backend/mobile_purchase/src/config/app-config.spec.ts
  git commit -m "feat(mobile_purchase): add DASHBOARD_ORIGINS CORS allowlist config"
  ```

---

### Task S2.4: Enable CORS on `mobile_purchase` `main.ts` + e2e boot preflight check

Wire the `DASHBOARD_ORIGINS` allowlist into the app in `createApp` (the wiring the e2e reuses), allowing credentials + `Authorization`/`Content-Type`, so the `OPTIONS` preflight is answered by the CORS layer before routing (never reaching `ProjectAccessGuard`).

**Files**
- Modify: `backend/mobile_purchase/src/main.ts`
- Test (create): `backend/mobile_purchase/test/e2e/cors.e2e-spec.ts`

**Interfaces**
- Consumes: `AppConfig.dashboardOrigins` (Task S2.3), `createApp()` (existing export), `startPostgresContainer()` (`test/integration/helpers/containers.ts`).
- Produces: no new symbol — a behavior (CORS headers on `createApp()`).

**TDD steps**

- [ ] **Step 1: Failing test — preflight for an allowed origin passes with credentialed CORS headers; a disallowed origin is not authorized.** Create `backend/mobile_purchase/test/e2e/cors.e2e-spec.ts`. It boots the real `createApp()` wiring against a testcontainer DB (mirroring `catalog.e2e-spec.ts`); the metrics route need not exist for CORS to apply — the CORS middleware runs before routing.

```ts
import type { INestApplication } from '@nestjs/common';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createApp } from '../../src/main';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

const ALLOWED_ORIGIN = 'http://localhost:5173';
const DISALLOWED_ORIGIN = 'https://evil.example';

describe('CORS boot — mobile_purchase allows the configured dashboard origin', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    // testcontainers emits `postgres://`; app-config's Zod schema requires `postgresql://`.
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';
    process.env.DASHBOARD_ORIGINS = `${ALLOWED_ORIGIN},https://app.myampix.example`;

    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
    delete process.env.DASHBOARD_ORIGINS;
  });

  it('answers the OPTIONS preflight for an allowed origin before the guard (204 + credentialed CORS headers)', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-headers'].toLowerCase()).toContain('authorization');
  });

  it('stamps the credentialed allow-origin header on an actual request from an allowed origin', async () => {
    // Auth is not the subject here (no fake ProjectAccessService wired); the CORS layer must still
    // stamp allow-origin regardless of the eventual 401/403/404 the request resolves to.
    const res = await request(app.getHttpServer())
      .get('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', ALLOWED_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not authorize a disallowed origin (no allow-origin header)', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/projects/proj-1/metrics/revenue')
      .set('Origin', DISALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to fail.** From `backend/mobile_purchase/` (requires Docker for testcontainers):
  ```bash
  pnpm exec jest test/e2e/cors.e2e-spec.ts
  ```
  Expected failure: the first case fails at `.expect(204)` — with no CORS enabled, the unmatched `OPTIONS` route returns `404` (`expected 204 "No Content", got 404 "Not Found"`), and `access-control-allow-origin` is `undefined`.

- [ ] **Step 3: Minimal implementation.** In `backend/mobile_purchase/src/main.ts`, update `createApp` to fetch the config and enable CORS (the imports `APP_CONFIG`, `AppConfig` already exist in the file):

```ts
/** Builds the fully wired application. Reused by e2e tests so they exercise production wiring. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useLogger(app.get(Logger));
  // CORS for the dashboard→mobile_purchase reach (design §2): the MyRevenueCat data pages call
  // this service cross-origin (both services expose /api/v1/projects/:projectId/…, so the dashboard
  // cannot proxy same-origin). Only the configured dashboard origin(s) may send credentialed
  // requests; the Authorization bearer + Content-Type are allowed and the OPTIONS preflight is
  // answered here — before routing — so it never reaches ProjectAccessGuard.
  app.enableCors({
    origin: config.dashboardOrigins ?? [],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  });
  app.enableShutdownHooks();
  return app;
}
```

- [ ] **Step 4: Run to pass.** From `backend/mobile_purchase/`:
  ```bash
  pnpm exec jest test/e2e/cors.e2e-spec.ts
  ```
  Expected: 3 passing.

- [ ] **Step 5: Commit.**
  ```bash
  git add backend/mobile_purchase/src/main.ts backend/mobile_purchase/test/e2e/cors.e2e-spec.ts
  git commit -m "feat(mobile_purchase): enable dashboard-origin CORS allowlist on boot"
  ```

---

### S2 verification gate (run before handing off to S3)

- [ ] **Dashboard typecheck + lint + full test run.** From `dashboard/`:
  ```bash
  pnpm typecheck && pnpm lint && pnpm exec vitest run src/lib
  ```
  Expected: tsc `0` errors, eslint clean, all `src/lib` tests green (config + api/*).

- [ ] **`mobile_purchase` typecheck + config/e2e tests.** From `backend/mobile_purchase/`:
  ```bash
  pnpm typecheck && pnpm exec jest src/config/app-config.spec.ts test/e2e/cors.e2e-spec.ts
  ```
  Expected: tsc `0` errors; config + CORS e2e green.

- [ ] **WIP-safety check.** `git status --short` shows only: `dashboard/src/lib/config.ts`, `dashboard/src/lib/config.test.ts`, `dashboard/src/lib/api/purchase-client.ts`, `dashboard/src/lib/api/purchase-client.test.ts`, `backend/mobile_purchase/src/config/app-config.ts`, `backend/mobile_purchase/src/config/app-config.spec.ts`, `backend/mobile_purchase/src/main.ts`, `backend/mobile_purchase/test/e2e/cors.e2e-spec.ts` — **no collapse-rail WIP file** (`AppLayout`, `OrgSwitcher`, `ProjectSwitcher`, `ToolRail`, `nav-model`, `RailInitial`, `CommandPalette`, `render-app`, layout `*.test.tsx`) touched.


---

## S3 · Dashboard `/rc/charts` page + hooks

**Scope:** the three purchase-service query hooks, the `RcChartsPage`, the single-line router swap, and end-to-end verification. **Consumes** S1's three metrics routes (spec §1.1) and S2's `purchaseApiFetch` (spec §2). **Produces** nothing downstream.

**Cross-section interface (frozen by the spec):**
- S1 routes (spec §1.1), all under `GET /api/v1/projects/:projectId/metrics/…?from&to&granularity`:
  - `revenue` → `{ currency: string | null, totalCents: number, series: [{ bucket, amountCents }], byCurrency: [{ currency, totalCents }] }`
  - `mrr` → `{ currency: string | null, mrrCents: number, series: [{ bucket, mrrCents }], unattributedActiveCount: number, approximate: true }`
  - `active-subscriptions` → `{ current: number, series: [{ bucket, count }], approximate: true }`
- S2 seam: `purchaseApiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T>`, exported from `dashboard/src/lib/api/purchase-client.ts` (a `purchaseApiBaseUrl`-prefixed sibling of `apiFetch` with identical bearer + RFC-7807 handling). In the test/dev default `purchaseApiBaseUrl === ''`, so requests are same-origin and MSW intercepts them exactly like `apiFetch`.

**WIP-safety (spec §4):** this section creates two new files under `dashboard/src/features/revenuecat/`, one new test, and edits exactly two lines of `router.tsx` (one import, one `component:`). It does NOT touch `nav-model.ts`, `AppLayout.tsx`, `OrgSwitcher/ProjectSwitcher/ToolRail/RailInitial`, `CommandPalette.tsx`, `render-app.tsx`, or any layout `*.test.tsx`. Verified in Task S3.3 by `git status`.

---

### Task S3.1: Purchase-service metrics query hooks

TanStack Query hooks over `purchaseApiFetch` for the three S1 routes, keyed by `projectId + range + granularity`, mirroring the `features/revenuecat/api.ts` hook style (`useRcStatus`'s `opts.enabled`, `useSubscriptionsSummary`'s range-gated `enabled`).

**Files**
- Create: `dashboard/src/features/revenuecat/purchase-metrics-api.ts`
- Test: `dashboard/src/features/revenuecat/purchase-metrics-api.test.ts`

**Interfaces**
- Consumes: `purchaseApiFetch<T>(path, options?)` from `../../lib/api/purchase-client` (S2); the three route shapes above.
- Produces:
  - `type RcGranularity = 'day' | 'week' | 'month'`
  - `interface RcRevenueResponse`, `RcMrrResponse`, `RcActiveSubscriptionsResponse` (+ point/currency sub-types) — field-for-field mirrors of §1.1
  - `rcMetricsKey(projectId: string, metric: 'revenue' | 'mrr' | 'active-subscriptions', from: string, to: string, granularity: RcGranularity)` → readonly key tuple
  - `useRcRevenue(projectId: string, from: string, to: string, granularity: RcGranularity, opts?: { enabled?: boolean })` → `UseQueryResult<RcRevenueResponse>`
  - `useRcMrr(projectId, from, to, granularity, opts?)` → `UseQueryResult<RcMrrResponse>`
  - `useRcActiveSubscriptions(projectId, from, to, granularity, opts?)` → `UseQueryResult<RcActiveSubscriptionsResponse>`

**TDD steps**

- [ ] **Step 1: Write the failing hooks test.** Create `dashboard/src/features/revenuecat/purchase-metrics-api.test.ts`:

```ts
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
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

const PID = TEST_PROJECT.id;
const FROM = '2026-06-18';
const TO = '2026-07-18';

const REVENUE: RcRevenueResponse = {
  currency: 'USD',
  totalCents: 123400,
  series: [
    { bucket: '2026-07-01', amountCents: 50000 },
    { bucket: '2026-07-02', amountCents: 73400 },
  ],
  byCurrency: [{ currency: 'USD', totalCents: 123400 }],
};
const MRR: RcMrrResponse = {
  currency: 'USD',
  mrrCents: 4995,
  series: [{ bucket: '2026-07-01', mrrCents: 4995 }],
  unattributedActiveCount: 2,
  approximate: true,
};
const ACTIVE: RcActiveSubscriptionsResponse = {
  current: 42,
  series: [{ bucket: '2026-07-01', count: 40 }],
  approximate: true,
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('rcMetricsKey', () => {
  it('is keyed by project, metric, range, and granularity', () => {
    expect(rcMetricsKey(PID, 'revenue', FROM, TO, 'day')).toEqual([
      'rc-purchase-metrics',
      PID,
      'revenue',
      FROM,
      TO,
      'day',
    ]);
    // Granularity is part of the key so switching day↔month refetches instead of serving stale data.
    expect(rcMetricsKey(PID, 'mrr', FROM, TO, 'day')).not.toEqual(
      rcMetricsKey(PID, 'mrr', FROM, TO, 'month'),
    );
  });
});

describe('purchase metrics hooks', () => {
  it('useRcRevenue hits /metrics/revenue on the purchase service and returns the parsed body', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    let seenUrl = '';
    server.use(
      http.get(`/api/v1/projects/${PID}/metrics/revenue`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(REVENUE);
      }),
    );

    const { result } = renderHook(() => useRcRevenue(PID, FROM, TO, 'day'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(REVENUE);
    const url = new URL(seenUrl);
    expect(url.searchParams.get('from')).toBe(FROM);
    expect(url.searchParams.get('to')).toBe(TO);
    expect(url.searchParams.get('granularity')).toBe('day');
  });

  it('useRcMrr returns the MRR body including the approximation caveat fields', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`/api/v1/projects/${PID}/metrics/mrr`, () => HttpResponse.json(MRR)));

    const { result } = renderHook(() => useRcMrr(PID, FROM, TO, 'week'), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mrrCents).toBe(4995);
    expect(result.current.data?.unattributedActiveCount).toBe(2);
    expect(result.current.data?.approximate).toBe(true);
  });

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
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    // No handler registered: if the hook fired, MSW's onUnhandledRequest:'error' would fail the test.
    const { result } = renderHook(() => useRcRevenue(PID, '', '', 'day'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('respects an explicit enabled:false even with a valid range', () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    const { result } = renderHook(() => useRcMrr(PID, FROM, TO, 'day', { enabled: false }), {
      wrapper: wrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run — expect fail (module missing).**

```bash
cd dashboard && npx vitest run src/features/revenuecat/purchase-metrics-api.test.ts
```

Expected failure: `Error: Failed to resolve import "./purchase-metrics-api"` (the module does not exist yet) — the whole file errors at collection time.

- [ ] **Step 3: Implement the hooks.** Create `dashboard/src/features/revenuecat/purchase-metrics-api.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { purchaseApiFetch } from '../../lib/api/purchase-client';

/** Bucket granularity for the purchase-service time series (spec §1.1 common query params). */
export type RcGranularity = 'day' | 'week' | 'month';

export interface RcRevenuePoint {
  bucket: string;
  amountCents: number;
}
export interface RcCurrencyTotal {
  currency: string;
  totalCents: number;
}
/** `GET /metrics/revenue` (spec §1.1) — exact revenue from the transaction ledger. */
export interface RcRevenueResponse {
  currency: string | null;
  totalCents: number;
  series: RcRevenuePoint[];
  byCurrency: RcCurrencyTotal[];
}

export interface RcMrrPoint {
  bucket: string;
  mrrCents: number;
}
/** `GET /metrics/mrr` (spec §1.1) — current MRR + window-approximated series. */
export interface RcMrrResponse {
  currency: string | null;
  mrrCents: number;
  series: RcMrrPoint[];
  unattributedActiveCount: number;
  approximate: true;
}

export interface RcActiveSubscriptionsPoint {
  bucket: string;
  count: number;
}
/** `GET /metrics/active-subscriptions` (spec §1.1) — current count + window-approximated series. */
export interface RcActiveSubscriptionsResponse {
  current: number;
  series: RcActiveSubscriptionsPoint[];
  approximate: true;
}

type RcMetric = 'revenue' | 'mrr' | 'active-subscriptions';

interface RcMetricOptions {
  /** Force-disable the query (e.g. RC not connected). Defaults to enabled once the range is set. */
  enabled?: boolean;
}

const purchaseMetricsBase = (projectId: string) => `/api/v1/projects/${projectId}/metrics`;

/** Query key shared by all three metrics — keyed by project, metric, range, and granularity, so a
 *  range/granularity change refetches rather than serving another window's cache. */
export function rcMetricsKey(
  projectId: string,
  metric: RcMetric,
  from: string,
  to: string,
  granularity: RcGranularity,
) {
  return ['rc-purchase-metrics', projectId, metric, from, to, granularity] as const;
}

function metricsUrl(
  projectId: string,
  metric: RcMetric,
  from: string,
  to: string,
  granularity: RcGranularity,
): string {
  return `${purchaseMetricsBase(projectId)}/${metric}?from=${from}&to=${to}&granularity=${granularity}`;
}

/** Auto-loads once both range bounds are set (mirrors `useSubscriptionsSummary`); `opts.enabled`
 *  can additionally suppress it (mirrors `useRcStatus`). */
function isEnabled(from: string, to: string, opts: RcMetricOptions): boolean {
  return (opts.enabled ?? true) && from.length > 0 && to.length > 0;
}

export function useRcRevenue(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'revenue', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcRevenueResponse>(metricsUrl(projectId, 'revenue', from, to, granularity)),
    enabled: isEnabled(from, to, opts),
  });
}

export function useRcMrr(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'mrr', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcMrrResponse>(metricsUrl(projectId, 'mrr', from, to, granularity)),
    enabled: isEnabled(from, to, opts),
  });
}

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

- [ ] **Step 4: Run — expect pass.**

```bash
cd dashboard && npx vitest run src/features/revenuecat/purchase-metrics-api.test.ts
```

Expected: all 6 tests pass (`rcMetricsKey` shape + inequality, three hook fetches, two idle/disabled cases).

- [ ] **Step 5: Commit.**

```bash
cd dashboard && git add src/features/revenuecat/purchase-metrics-api.ts src/features/revenuecat/purchase-metrics-api.test.ts && git commit -m "feat(rc-charts): purchase-service metrics query hooks (revenue/mrr/active-subs)"
```

---

### Task S3.2: `RcChartsPage` + router swap + MSW page tests

The real `/rc/charts` page: a range + granularity control, a KPI row (current MRR / active subscribers / revenue-in-range), three `ChartCard`+`ComparisonTrend` charts (each shipping the kit's accessible `<table>` via `showDataTable`'s default), the approximation + per-currency footnote, `rcEnabled` gating via `RcConnectPage`, and `ChartCard`'s error slot on failure — composed exactly like `RcOverviewPage`/`RcConversionPage`. Then swap the router's `/rc/charts` placeholder to this component (spec §3/§4).

**Files**
- Create: `dashboard/src/features/revenuecat/components/RcChartsPage.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-charts.test.tsx`
- Modify: `dashboard/src/router.tsx` (one import line + one `component:` line — well outside every WIP file)

**Interfaces**
- Consumes: `useRcRevenue`/`useRcMrr`/`useRcActiveSubscriptions` + `RcGranularity` (S3.1); `useRcEnabled` (`../api`); `useDateRange`/`DateRangeControl` (`../../analytics/date-range`); `ChartCard`, `ComparisonTrend`, `KpiTile` (chart kit); `RcConnectPage`; `PageShell`; `useProjects`.
- Produces: `RcChartsPage(): JSX.Element` (no props — reads `projectId` off the route); after the router edit, `/projects/$projectId/rc/charts` renders it.

**TDD steps**

- [ ] **Step 1: Write the failing page test.** Create `dashboard/src/features/revenuecat/components/rc-charts.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const CHARTS_URL = `/projects/${TEST_PROJECT.id}/rc/charts`;
const base = `/api/v1/projects/:projectId/metrics`;

function problem(status: number) {
  return HttpResponse.json(
    { type: 'about:blank', title: 'Service Unavailable', status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

/** Registers all three metrics endpoints — the page fires all three, and MSW's
 *  onUnhandledRequest:'error' would fail the test if any were missing. */
function metrics(handlers: {
  revenue: () => Response | Promise<Response>;
  mrr: () => Response | Promise<Response>;
  active: () => Response | Promise<Response>;
}) {
  server.use(
    http.get(`${base}/revenue`, handlers.revenue),
    http.get(`${base}/mrr`, handlers.mrr),
    http.get(`${base}/active-subscriptions`, handlers.active),
  );
}

describe('RcChartsPage', () => {
  it('renders the KPI row, three charts, accessible tables, and the approximation footnote from the data', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () =>
        HttpResponse.json({
          currency: 'USD',
          totalCents: 123400,
          series: [
            { bucket: '2026-07-01', amountCents: 50000 },
            { bucket: '2026-07-02', amountCents: 73400 },
          ],
          byCurrency: [
            { currency: 'USD', totalCents: 123400 },
            { currency: 'EUR', totalCents: 5000 },
          ],
        }),
      mrr: () =>
        HttpResponse.json({
          currency: 'USD',
          mrrCents: 4995,
          series: [{ bucket: '2026-07-01', mrrCents: 4995 }],
          unattributedActiveCount: 2,
          approximate: true,
        }),
      active: () =>
        HttpResponse.json({
          current: 42,
          series: [
            { bucket: '2026-07-01', count: 40 },
            { bucket: '2026-07-02', count: 41 },
          ],
          approximate: true,
        }),
    });
    renderApp(CHARTS_URL);
    const main = within(await screen.findByRole('main'));

    // KPI row
    expect(await main.findByText('Current MRR')).toBeInTheDocument();
    expect(main.getByText('$49.95')).toBeInTheDocument();
    expect(main.getByText('Active subscribers')).toBeInTheDocument();
    expect(main.getByText('42')).toBeInTheDocument(); // active current — unique (series counts are 40/41)
    expect(main.getByText('Revenue in range')).toBeInTheDocument();
    expect(main.getByText('$1,234.00')).toBeInTheDocument();

    // Three charts
    expect(main.getByText('Revenue over time')).toBeInTheDocument();
    expect(main.getByText(/monthly recurring revenue/i)).toBeInTheDocument(); // MRR chart description
    expect(main.getByText('Active subscriptions')).toBeInTheDocument();

    // Accessible per-bucket tables (ComparisonTrend ships them by default)
    expect(main.getAllByText('2026-07-01').length).toBeGreaterThan(0);
    expect(main.getByText('734')).toBeInTheDocument(); // 73400 cents -> $734 in the revenue table

    // Footnote
    expect(main.getByText(/understate past churn/i)).toBeInTheDocument();
    expect(main.getByText(/excluded from MRR/i)).toBeInTheDocument(); // unattributedActiveCount = 2
    expect(main.getByText(/EUR/)).toBeInTheDocument(); // per-currency note
  });

  it('shows a page-level loading status and chart skeletons while the metrics are in flight', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
      mrr: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
      active: async () => {
        await delay('infinite');
        return HttpResponse.json({});
      },
    });
    renderApp(CHARTS_URL);

    expect(await screen.findByText(/loading purchase metrics/i)).toBeInTheDocument();
    expect(screen.getAllByTestId('kpi-tile-skeleton')).toHaveLength(3);
  });

  it('renders zeros (not a crash) when the project has no purchases yet', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () =>
        HttpResponse.json({ currency: null, totalCents: 0, series: [], byCurrency: [] }),
      mrr: () =>
        HttpResponse.json({
          currency: null,
          mrrCents: 0,
          series: [],
          unattributedActiveCount: 0,
          approximate: true,
        }),
      active: () => HttpResponse.json({ current: 0, series: [], approximate: true }),
    });
    renderApp(CHARTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('Current MRR')).toBeInTheDocument();
    expect(main.getAllByText('$0.00').length).toBeGreaterThan(0); // MRR + revenue-in-range
    // Empty series -> each ChartCard shows its empty slot, not a broken chart.
    expect(main.getAllByText('No data for this range.')).toHaveLength(3);
  });

  it('surfaces a page-level alert and the ChartCard error slot when the purchase service fails', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    metrics({
      revenue: () => problem(503),
      mrr: () => problem(503),
      active: () => problem(503),
    });
    renderApp(CHARTS_URL);

    expect(await screen.findByRole('alert')).toHaveTextContent(/purchase service/i);
    // The alert plus the three ChartCard error slots all carry the same message.
    expect(screen.getAllByText(/purchase service/i).length).toBeGreaterThanOrEqual(2);
  });

  it('shows the connect upsell (not charts) when RevenueCat is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(CHARTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.queryByText('Revenue over time')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail (component missing).**

```bash
cd dashboard && npx vitest run src/features/revenuecat/components/rc-charts.test.tsx
```

Expected failure: `Error: Failed to resolve import "./RcChartsPage"` — the test imports it via the router indirectly through `renderApp`; add the direct dependency by creating the component next. (Before the router swap the route still resolves to `RcPlaceholderPage`, so even a stub would fail the content assertions — both changes land in Step 3/Step 5.)

- [ ] **Step 3: Implement `RcChartsPage`.** Create `dashboard/src/features/revenuecat/components/RcChartsPage.tsx`:

```tsx
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import { fieldLook } from '../../../components/ui/input';
import { useProjects } from '../../projects/api';
import { DateRangeControl, useDateRange } from '../../analytics/date-range';
import { formatCurrency } from '../../analytics/format';
import { ChartCard } from '../../analytics/components/charts/ChartCard';
import { ComparisonTrend } from '../../analytics/components/charts/ComparisonTrend';
import { KpiTile } from '../../analytics/components/charts/KpiTile';
import { useRcEnabled } from '../api';
import { RcConnectPage } from './RcConnectPage';
import {
  useRcActiveSubscriptions,
  useRcMrr,
  useRcRevenue,
  type RcGranularity,
} from '../purchase-metrics-api';

/** Shown both as the page-level alert and as each ChartCard's error slot when the purchase service
 *  is unset/unreachable (spec §3 gating & degradation). */
const PURCHASE_SERVICE_ERROR =
  'The purchase service isn’t configured or is unreachable.';

/** Maps a query's loading/error/empty flags onto `ChartCard`'s `state` prop (mirrors RcOverviewPage). */
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

/**
 * MyRevenueCat → Charts. The first dashboard surface wired to the billing-authority `mobile_purchase`
 * service (via `purchaseApiFetch`), rather than the legacy `mobile_analytics` RC mirror the Overview/
 * Conversion pages read. Three time series — exact Revenue, approximated MRR, approximated Active
 * Subscriptions — plus their headline KPIs, mirroring `RcOverviewPage`'s composition. Projects without
 * RevenueCat connected land on `RcConnectPage`, exactly like the sibling RC pages.
 */
export function RcChartsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/charts' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const rcEnabled = useRcEnabled(projectId);
  const { from, to } = useDateRange();
  const [granularity, setGranularity] = useState<RcGranularity>('day');

  // Don't fire the purchase-service queries for a disconnected project, and don't start until the
  // range is set. Hooks are called unconditionally (rules of hooks); the early returns come after.
  const enabled = rcEnabled && from.length > 0 && to.length > 0;
  const revenue = useRcRevenue(projectId, from, to, granularity, { enabled });
  const mrr = useRcMrr(projectId, from, to, granularity, { enabled });
  const activeSubs = useRcActiveSubscriptions(projectId, from, to, granularity, { enabled });

  // Same discipline as RcOverviewPage/RcConversionPage: don't decide "not connected" until
  // `useProjects()` has resolved, or a still-loading flag briefly flashes the connect upsell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Charts"
        description="Revenue, MRR, and active subscriptions over time."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Charts' }]}
      >
        {null}
      </PageShell>
    );
  }

  if (!rcEnabled) return <RcConnectPage projectId={projectId} />;

  const anyPending = revenue.isPending || mrr.isPending || activeSubs.isPending;
  const anyError = revenue.isError || mrr.isError || activeSubs.isError;

  const revenueCurrency = revenue.data?.currency ?? 'USD';
  const mrrCurrency = mrr.data?.currency ?? 'USD';

  const revenueRows = (revenue.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    revenue: point.amountCents / 100,
  }));
  const mrrRows = (mrr.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    mrr: point.mrrCents / 100,
  }));
  const activeRows = (activeSubs.data?.series ?? []).map((point) => ({
    bucket: point.bucket,
    active: point.count,
  }));

  const currentMrr = mrr.data ? formatCurrency(mrr.data.mrrCents / 100, mrrCurrency) : '—';
  const currentActive = activeSubs.data?.current ?? 0;
  const revenueInRange = revenue.data
    ? formatCurrency(revenue.data.totalCents / 100, revenueCurrency)
    : '—';

  const unattributed = mrr.data?.unattributedActiveCount ?? 0;
  const otherCurrencies = (revenue.data?.byCurrency ?? []).filter(
    (entry) => entry.currency !== revenueCurrency,
  );

  const granularityControl = (
    <label className="flex items-center gap-2 text-sm text-text-muted">
      <span className="sr-only">Granularity</span>
      <select
        aria-label="Granularity"
        className={fieldLook}
        value={granularity}
        onChange={(event) => setGranularity(event.target.value as RcGranularity)}
      >
        <option value="day">Daily</option>
        <option value="week">Weekly</option>
        <option value="month">Monthly</option>
      </select>
    </label>
  );

  return (
    <PageShell
      projectId={projectId}
      title="Charts"
      description="Revenue, MRR, and active subscriptions over time, from the purchase service."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Charts' }]}
      dateRangeControl={
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeControl />
          {granularityControl}
        </div>
      }
    >
      {/* Page-level loading/error announcement, mirroring RcOverviewPage/RcConversionPage:
          `ChartCard`'s own error branch has no live region, so a failed fetch would otherwise be
          silent to screen readers. */}
      {anyPending && (
        <Reveal index={0}>
          <p role="status">Loading purchase metrics…</p>
        </Reveal>
      )}
      {anyError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            {PURCHASE_SERVICE_ERROR}
          </p>
        </Reveal>
      )}

      <Reveal index={0}>
        <SectionGrid>
          <KpiTile label="Current MRR" value={currentMrr} loading={mrr.isPending} unfiltered />
          <KpiTile
            label="Active subscribers"
            value={currentActive}
            loading={activeSubs.isPending}
            unfiltered
          />
          <KpiTile label="Revenue in range" value={revenueInRange} loading={revenue.isPending} />
        </SectionGrid>
      </Reveal>

      <Reveal index={1}>
        <ChartCard
          title="Revenue over time"
          description="Exact revenue from the transaction ledger, by bucket."
          state={chartState(revenue.isPending, revenue.isError, revenueRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-revenue-over-time"
        >
          <ComparisonTrend
            current={revenueRows}
            xKey="bucket"
            valueKey="revenue"
            label={`Revenue (${revenueCurrency})`}
            ariaLabel="Revenue over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={2}>
        <ChartCard
          title="MRR"
          description="Monthly recurring revenue, approximated from current subscriptions."
          state={chartState(mrr.isPending, mrr.isError, mrrRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-mrr-over-time"
        >
          <ComparisonTrend
            current={mrrRows}
            xKey="bucket"
            valueKey="mrr"
            label={`MRR (${mrrCurrency})`}
            ariaLabel="MRR over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={3}>
        <ChartCard
          title="Active subscriptions"
          description="Active subscriptions per bucket, approximated from current state."
          state={chartState(activeSubs.isPending, activeSubs.isError, activeRows.length === 0)}
          errorText={PURCHASE_SERVICE_ERROR}
          exportImageName="rc-active-subscriptions"
        >
          <ComparisonTrend
            current={activeRows}
            xKey="bucket"
            valueKey="active"
            label="Active subscriptions"
            ariaLabel="Active subscriptions over time"
          />
        </ChartCard>
      </Reveal>

      <Reveal index={4}>
        <p className="text-xs text-text-muted">
          MRR and active-subscription history are approximated from current subscription state and
          understate past churn; exact daily snapshots are a scheduled follow-up. Revenue over time is
          exact.
          {unattributed > 0 &&
            ` ${unattributed} active subscription(s) are excluded from MRR because their product period couldn’t be resolved.`}
          {` Amounts are shown in ${revenueCurrency}.`}
          {otherCurrencies.length > 0 &&
            ` Other currencies (${otherCurrencies
              .map((entry) => entry.currency)
              .join(', ')}) are reported separately and not converted.`}
        </p>
      </Reveal>
    </PageShell>
  );
}
```

- [ ] **Step 4: Run — expect fail (route still shows the placeholder).**

```bash
cd dashboard && npx vitest run src/features/revenuecat/components/rc-charts.test.tsx
```

Expected failure: the data test can't find `Current MRR` — `/rc/charts` still resolves to `RcPlaceholderPage` ("Charts is not built yet"). This is the red that the router swap turns green.

- [ ] **Step 5: Swap the router line (two isolated lines).** Edit `dashboard/src/router.tsx`.

Add the import beside the other RC page imports (after line 42, the `RcSettingsPage` import):

```tsx
import { RcChartsPage } from './features/revenuecat/components/RcChartsPage';
```

Replace the inline placeholder component of `rcChartsRoute` (currently ~lines 296-305):

```tsx
const rcChartsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/charts',
  component: () => (
    <RcPlaceholderPage
      title="Charts"
      description="Explore MRR, subscribers, and churn over time with custom breakdowns."
    />
  ),
});
```

with:

```tsx
const rcChartsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/charts',
  component: RcChartsPage,
});
```

`RcPlaceholderPage` stays imported — the Customers/Products/Entitlements/Offerings/Paywalls routes still use it. No `nav-model`, `AppLayout`, or any WIP file is touched.

- [ ] **Step 6: Run — expect pass.**

```bash
cd dashboard && npx vitest run src/features/revenuecat/components/rc-charts.test.tsx
```

Expected: all 5 tests pass (data / loading / empty-zeros / error / gating).

- [ ] **Step 7: Commit.**

```bash
cd dashboard && git add src/features/revenuecat/components/RcChartsPage.tsx src/features/revenuecat/components/rc-charts.test.tsx src/router.tsx && git commit -m "feat(rc-charts): RcChartsPage + wire /rc/charts route to it"
```

---

### Task S3.3: Verify the slice (tsc + lint + tests + WIP-safety gate)

Final acceptance for S3 (spec §5 S3 acceptance): dashboard typechecks and lints clean, the full test suite is green, and `git status` proves no collapse-rail WIP file was touched.

**Files**
- None created or modified (verification only).

**Interfaces**
- Consumes: the entire S3 surface (hooks + page + router edit).
- Produces: nothing.

**Steps**

- [ ] **Step 1: Typecheck.**

```bash
cd dashboard && npm run typecheck
```

Expected: `tsc --noEmit` exits 0, no errors (the new hooks/page are fully typed; response interfaces match §1.1).

- [ ] **Step 2: Lint.**

```bash
cd dashboard && npm run lint
```

Expected: `eslint .` exits 0 — no unused imports, no rules-of-hooks violations (all three query hooks are called unconditionally before the early returns).

- [ ] **Step 3: Run the two new suites plus the existing RC page suite (no regressions).**

```bash
cd dashboard && npx vitest run src/features/revenuecat
```

Expected: `purchase-metrics-api.test.ts`, `rc-charts.test.tsx`, `api.test.ts`, and `components/rc-pages.test.tsx` all pass — the placeholder swap did not break the Overview/Conversion/Placeholder/Settings tests (Customers still renders the placeholder).

- [ ] **Step 4: Full dashboard test run.**

```bash
cd dashboard && npm test
```

Expected: the whole `vitest run` suite is green.

- [ ] **Step 5: WIP-safety gate — assert no collapse-rail WIP file changed.**

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --porcelain -- \
  dashboard/src/components/layout/AppLayout.tsx \
  dashboard/src/components/layout/OrgSwitcher.tsx \
  dashboard/src/components/layout/ProjectSwitcher.tsx \
  dashboard/src/components/layout/ToolRail.tsx \
  dashboard/src/components/layout/nav-model.ts \
  dashboard/src/components/layout/RailInitial.tsx \
  dashboard/src/components/layout/CommandPalette.tsx \
  dashboard/src/test/render-app.tsx \
  'dashboard/src/components/layout/*.test.tsx'
```

Expected: **empty output** (zero lines) — none of the WIP files were modified. The only tracked changes from S3 are `dashboard/src/features/revenuecat/purchase-metrics-api.ts`, `.../purchase-metrics-api.test.ts`, `.../components/RcChartsPage.tsx`, `.../components/rc-charts.test.tsx`, and the two lines in `dashboard/src/router.tsx`. Confirm the committed set with:

```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && git show --stat --oneline HEAD HEAD~1 -- dashboard/
```

Expected: only the five files above appear across the two S3 commits; `nav-model.ts` and every WIP file are absent.


---

