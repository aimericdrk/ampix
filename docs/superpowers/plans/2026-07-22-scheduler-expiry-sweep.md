# Scheduler skeleton + subscription-expiry sweep (D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `backend/mobile_purchase` its first scheduled job — a `@nestjs/schedule` cron running a **subscription-expiry sweep** that flips still-entitled-looking subscriptions to `EXPIRED` once their expiry passes, **through the existing lifecycle reducer**, so raw-status readers (customers-list counts, `trials_converted`, the churn `status='EXPIRED'` branch) stay honest without waiting on a store webhook.

**Architecture:** `SchedulerModule` (`src/scheduler/`) adds `@nestjs/schedule`, and an `ExpirySweepJob` binds a config-driven cron that delegates to `SubscriptionExpirySweepService` (`src/subscriptions/`). The sweep finds stale rows and expires each by synthesizing an `EXPIRED` lifecycle event (`occurredAt` = the row's own expiry instant) and applying it via the existing `applySubscriptionLifecycle` persist seam — keeping exactly one writer of subscription state. A Postgres advisory try-lock per batch prevents overlapping runs from stampeding, and idempotency (upsert-by-identity through a terminal-safe reducer) makes concurrent/retry runs correct regardless.

**Tech Stack:** NestJS 11 + `@nestjs/schedule` + Prisma 6 + jest/Testcontainers (`backend/mobile_purchase`, its own Postgres). No dashboard changes.

**Design spec:** `docs/superpowers/specs/2026-07-22-scheduler-expiry-sweep-design.md` (all § references below point there).

## Global Constraints

Every task's requirements implicitly include all of these:

- **One writer of subscription state (§0).** The sweep NEVER bulk-`updateMany` a status. It synthesizes an `EXPIRED` lifecycle event per candidate and applies it through the SAME reducer + persist path webhooks use (`applySubscriptionLifecycle`), preserving `lastEventAt`/ordering so a late store webhook still supersedes.
- **`occurredAt` = the row's own effective expiry instant (§2), NOT `now`.** Grace rows use `gracePeriodExpiresAt` (when non-null), everything else `expiresAt`. This keeps the reducer's ordering high-water mark at the expiry moment, so any real store event that happened after expiry still wins.
- **Sweep never touches** `BILLING_RETRY`, `PAUSED`, `EXPIRED`, `REVOKED`, or any candidate-status row whose effective expiry is `null` (§0).
- **No `StoreNotification` journal writes** — an internal transition, not a store delivery.
- **Additive only.** No schema/migration change (`expiresAt`, `gracePeriodExpiresAt`, `SubscriptionStatus` all exist). `mobile_analytics` untouched. Webhook ingest / refund / metrics code untouched except the `AppModule` + config additions.
- **File placement:** scheduler infra in `src/scheduler/`; the sweep domain service beside the lifecycle code in `src/subscriptions/`.
- **HARD WIP rule:** NEVER touch or stage the user's uncommitted collapse-rail WIP — `dashboard/src/components/layout/*`, `dashboard/src/features/command-palette/CommandPalette.tsx`, `dashboard/src/test/render-app.tsx`, `dashboard/src/components/layout/RailInitial.tsx`, `sdk/flutter_purchases/example/lib/demo_config.dart`, the two `2026-07-16-dashboard-tool-rail*` docs. Always `git add` the specific task files — **never `git add -A`**.
- **Commits:** per-task commits authorized; the USER pushes/merges. Convention `feat(mobile_purchase): …`. **No co-author trailer, ever.** Never commit `.env`/secrets.
- **Environment:** `backend/mobile_purchase` has NO `.env` (intentional) — specs/e2e boot their own Postgres via Testcontainers; **Docker must be running** for Testcontainers steps. All backend commands run from `backend/mobile_purchase`.
- **Ledger note:** `.superpowers/` is git-ignored — the verify gate APPENDS its ledger entry but does NOT `git add`/commit it.

---

### Task 1 (D2.1): Scheduler skeleton — `@nestjs/schedule`, config, `ExpirySweepJob` shell + service stub

**Files:**
- Modify: `backend/mobile_purchase/package.json` (add `@nestjs/schedule`)
- Modify: `backend/mobile_purchase/src/config/app-config.ts` (two new env keys + `AppConfig` fields + `loadConfig` mapping + `describeConfig` lines)
- Test: `backend/mobile_purchase/src/config/app-config.spec.ts` (assert the two keys parse)
- Create: `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts` (STUB — real body is D2.2)
- Create: `backend/mobile_purchase/src/scheduler/expiry-sweep.job.ts` (`ExpirySweepJob`)
- Create: `backend/mobile_purchase/src/scheduler/scheduler.module.ts` (`SchedulerModule`)
- Create: `backend/mobile_purchase/src/scheduler/expiry-sweep.job.spec.ts` (DB-free wiring tests)
- Modify: `backend/mobile_purchase/src/app.module.ts` (import `SchedulerModule`)

**Interfaces:**
- Consumes: `APP_CONFIG` token + `AppConfig` (`src/config/app-config.ts`); `SchedulerRegistry`, `ScheduleModule` (`@nestjs/schedule`); `CronJob` (`cron`, a transitive dep of `@nestjs/schedule`).
- Produces (D2.2 replaces the stub body; D2.3 runs these):
  - `SubscriptionExpirySweepService` at `src/subscriptions/subscription-expiry-sweep.service.ts` — `@Injectable()`, constructor `(prisma: PrismaService)`.
  - `sweep(nowMs?: number, opts?: { batchSize?: number; maxBatches?: number }): Promise<ExpirySweepResult>` — `nowMs` defaults to `Date.now()`; `opts` defaults to the exported constants (the second param exists so D2.2's spec can drive batching without seeding 500 rows).
  - `export interface ExpirySweepResult { candidates: number; expired: number; skippedLock: boolean; batches: number; capped: boolean }`.
  - `export const EXPIRY_SWEEP_LOCK_KEY = 824642001;` `export const EXPIRY_SWEEP_BATCH_SIZE = 500;` `export const EXPIRY_SWEEP_MAX_BATCHES = 20;`
  - `export const EXPIRY_SWEEP_JOB_NAME = 'subscription-expiry-sweep';` (in `expiry-sweep.job.ts`).
  - `AppConfig` gains `schedulerEnabled?: boolean` and `expirySweepCron?: string` (both always populated by `loadConfig`; optional for the same hand-built-fixture-compat reason the file documents for the Apple/Google fields).

- [ ] **Step 1: Install `@nestjs/schedule` + `cron` (scoped to the `mobile_purchase` workspace).**

This is a **pnpm workspace** (`pnpm-workspace.yaml`, root `pnpm-lock.yaml`) — use `pnpm add` with a `--filter`, NOT `npm install` (a bare `npm`/root install lands the dep on the root workspace and churns the whole lockfile). The `ExpirySweepJob` imports `CronJob` directly from `cron`, so `cron` must be a **direct** dependency of this workspace (pnpm's strict isolation won't resolve it as a transitive-only dep). Run from the **repo root**:
```bash
pnpm add @nestjs/schedule cron --filter @myampix/mobile-purchase
```
Expected: adds `"@nestjs/schedule"` and `"cron"` to `backend/mobile_purchase/package.json` `dependencies` (resolving versions whose peer range accepts `@nestjs/core@^11` — e.g. `@nestjs/schedule@^6.1.3` + `cron@^4.4.0`), and a minimal `pnpm-lock.yaml` change under the `backend/mobile_purchase:` importer only. Verify the root `package.json` is UNCHANGED and the lockfile did NOT bump unrelated dev deps (`git diff -- package.json` empty; `git diff pnpm-lock.yaml | grep -E 'eslint|prettier|typescript-eslint'` empty). Record the resolved versions in your report.

- [ ] **Step 2: Write the failing config test.**

In `backend/mobile_purchase/src/config/app-config.spec.ts`, add these tests inside the existing top-level `describe('loadConfig', ...)` block (they use the file's existing pattern of calling `loadConfig(env)` with a minimal valid env — reuse whatever minimal-valid-env helper/object the neighbouring tests use; the only required field is `DATABASE_URL`):
```ts
  it('defaults SCHEDULER_ENABLED to true and EXPIRY_SWEEP_CRON to every 5 minutes', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5433/db' });
    expect(config.schedulerEnabled).toBe(true);
    expect(config.expirySweepCron).toBe('*/5 * * * *');
  });

  it('parses SCHEDULER_ENABLED=false and a custom EXPIRY_SWEEP_CRON', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
      SCHEDULER_ENABLED: 'false',
      EXPIRY_SWEEP_CRON: '*/10 * * * *',
    });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.expirySweepCron).toBe('*/10 * * * *');
  });
```

- [ ] **Step 3: Run the config test — verify it fails.**
```bash
npx jest src/config/app-config.spec.ts
```
Expected: the two new tests FAIL (`config.schedulerEnabled` is `undefined`, `config.expirySweepCron` is `undefined`) — the keys aren't in the schema yet. Pre-existing tests still pass.

- [ ] **Step 4: Add the two keys to the config schema.**

In `backend/mobile_purchase/src/config/app-config.ts`, add to the `envSchema` object (after `DASHBOARD_ORIGINS`):
```ts
  // Scheduler (D2): master on/off for the @nestjs/schedule crons. Default on; set 'false' to
  // register no jobs (tests + a future split worker opt out this way).
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),
  // Cron expression for the subscription-expiry sweep (design §1). Default every 5 minutes —
  // RC-faithful promptness without load. The `cron` lib validates the expression at job construction.
  EXPIRY_SWEEP_CRON: z.string().min(1).default('*/5 * * * *'),
```
Add to the `AppConfig` interface (after `dashboardOrigins?`):
```ts
  // Scheduler config (D2) — see envSchema comments. Optional for the same hand-built-fixture-
  // compatibility reason as the Apple/Google fields; loadConfig() always populates both.
  schedulerEnabled?: boolean;
  expirySweepCron?: string;
```
Add to the `loadConfig` return object (after `dashboardOrigins: ...`):
```ts
    schedulerEnabled: v.SCHEDULER_ENABLED === 'true',
    expirySweepCron: v.EXPIRY_SWEEP_CRON,
```
Add to the `describeConfig` return object (after `DASHBOARD_ORIGINS`):
```ts
    SCHEDULER_ENABLED: String(config.schedulerEnabled ?? true),
    EXPIRY_SWEEP_CRON: config.expirySweepCron ?? '*/5 * * * *',
```

- [ ] **Step 5: Run the config test — verify it passes.**
```bash
npx jest src/config/app-config.spec.ts
```
Expected: all tests pass, including the two new ones.

- [ ] **Step 6: Create the `SubscriptionExpirySweepService` STUB.**

Create `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Advisory-lock key for the expiry sweep — a fixed application-chosen bigint so overlapping sweeps
 * (same instance, or a future second Cloud Run instance) serialize on `pg_try_advisory_xact_lock`. */
export const EXPIRY_SWEEP_LOCK_KEY = 824642001;
/** Rows loaded per batch transaction. */
export const EXPIRY_SWEEP_BATCH_SIZE = 500;
/** Hard cap on batches per run — bounds a single sweep; the next cron tick continues. */
export const EXPIRY_SWEEP_MAX_BATCHES = 20;

export interface ExpirySweepResult {
  candidates: number;
  expired: number;
  skippedLock: boolean;
  batches: number;
  capped: boolean;
}

/**
 * Flips still-entitled-looking subscriptions to EXPIRED once their expiry passes, THROUGH the
 * lifecycle reducer (design §2). D2.1 ships this as a stub so the scheduler wiring compiles and
 * lands first; D2.2 implements `sweep`.
 */
@Injectable()
export class SubscriptionExpirySweepService {
  constructor(private readonly prisma: PrismaService) {}

  async sweep(
    nowMs: number = Date.now(),
    opts: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<ExpirySweepResult> {
    // D2.2 implements the real sweep. Stub returns a clean no-op so D2.1's wiring is testable.
    // `void` marks the params/field as intentionally unused here (tsc `noUnusedParameters` +
    // eslint clean) — all three are used by D2.2's implementation.
    void nowMs;
    void opts;
    void this.prisma;
    return { candidates: 0, expired: 0, skippedLock: false, batches: 0, capped: false };
  }
}
```

- [ ] **Step 7: Write the failing wiring tests for `ExpirySweepJob`.**

Create `backend/mobile_purchase/src/scheduler/expiry-sweep.job.spec.ts`:
```ts
import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AppConfig } from '../config/app-config';
import type { SubscriptionExpirySweepService, ExpirySweepResult } from '../subscriptions/subscription-expiry-sweep.service';
import { ExpirySweepJob, EXPIRY_SWEEP_JOB_NAME } from './expiry-sweep.job';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8090,
    databaseUrl: 'postgresql://u:p@localhost:5433/db',
    logLevel: 'info',
    analyticsInternalUrl: 'http://localhost:8088',
    schedulerEnabled: true,
    expirySweepCron: '*/5 * * * *',
    ...overrides,
  };
}

const okResult: ExpirySweepResult = { candidates: 3, expired: 3, skippedLock: false, batches: 1, capped: false };

function makeSweep(impl: () => Promise<ExpirySweepResult>): SubscriptionExpirySweepService {
  return { sweep: jest.fn(impl) } as unknown as SubscriptionExpirySweepService;
}

describe('ExpirySweepJob', () => {
  let registry: SchedulerRegistry;

  beforeEach(() => {
    registry = new SchedulerRegistry();
  });

  it('registers the cron job when the scheduler is enabled', () => {
    const job = new ExpirySweepJob(makeConfig({ schedulerEnabled: true }), registry, makeSweep(async () => okResult));
    job.onModuleInit();
    expect(registry.getCronJob(EXPIRY_SWEEP_JOB_NAME)).toBeDefined();
    registry.getCronJob(EXPIRY_SWEEP_JOB_NAME).stop();
  });

  it('registers NOTHING when the scheduler is disabled', () => {
    const job = new ExpirySweepJob(makeConfig({ schedulerEnabled: false }), registry, makeSweep(async () => okResult));
    job.onModuleInit();
    expect(() => registry.getCronJob(EXPIRY_SWEEP_JOB_NAME)).toThrow();
  });

  it('run() swallows a thrown sweep error and logs it (never rejects)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const job = new ExpirySweepJob(
      makeConfig(),
      registry,
      makeSweep(async () => {
        throw new Error('boom');
      }),
    );
    await expect(job.run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('run() logs a summary from the sweep result', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const job = new ExpirySweepJob(makeConfig(), registry, makeSweep(async () => okResult));
    await job.run();
    // expired > 0 → log level, not debug
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
```

- [ ] **Step 8: Run the wiring tests — verify they fail.**
```bash
npx jest src/scheduler/expiry-sweep.job.spec.ts
```
Expected: compile/import failure — `expiry-sweep.job` does not exist yet (`Cannot find module './expiry-sweep.job'`). That is the expected red state.

- [ ] **Step 9: Implement `ExpirySweepJob`.**

Create `backend/mobile_purchase/src/scheduler/expiry-sweep.job.ts`:
```ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SubscriptionExpirySweepService } from '../subscriptions/subscription-expiry-sweep.service';

export const EXPIRY_SWEEP_JOB_NAME = 'subscription-expiry-sweep';

/**
 * The cron binding for the subscription-expiry sweep (design §1). Owns *when*, not *what*: it
 * registers a config-driven `CronJob` (so `EXPIRY_SWEEP_CRON` actually takes effect — a static
 * `@Cron` decorator cannot read runtime config) and delegates each tick to
 * `SubscriptionExpirySweepService`. Registers NOTHING when `SCHEDULER_ENABLED=false`. The handler
 * catches everything — a scheduled job must never throw out of its tick.
 */
@Injectable()
export class ExpirySweepJob implements OnModuleInit {
  private readonly logger = new Logger(ExpirySweepJob.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly registry: SchedulerRegistry,
    private readonly sweepService: SubscriptionExpirySweepService,
  ) {}

  onModuleInit(): void {
    if (this.config.schedulerEnabled === false) {
      this.logger.log('scheduler disabled (SCHEDULER_ENABLED=false); expiry sweep not registered');
      return;
    }
    const cron = this.config.expirySweepCron ?? '*/5 * * * *';
    const job = new CronJob(cron, () => {
      void this.run();
    });
    this.registry.addCronJob(EXPIRY_SWEEP_JOB_NAME, job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1]);
    job.start();
    this.logger.log(`expiry sweep registered: "${cron}"`);
  }

  /** One sweep tick. Catches everything: a scheduled handler must never throw out of its tick. */
  async run(): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.sweepService.sweep();
      const durationMs = Date.now() - startedAt;
      const summary = { ...result, durationMs };
      if (result.expired === 0 && !result.skippedLock) {
        this.logger.debug(`expiry sweep: ${JSON.stringify(summary)}`);
      } else {
        this.logger.log(`expiry sweep: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      this.logger.error(
        `expiry sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
```
(If `this.registry.addCronJob(name, job)` type-checks with a plain `CronJob` on the resolved `@nestjs/schedule` version, drop the `as unknown as Parameters<...>` cast — it's only there to absorb a known generic-parameter friction between the `cron` package's `CronJob` type and the one `@nestjs/schedule` re-exports.)

- [ ] **Step 10: Create `SchedulerModule`.**

Create `backend/mobile_purchase/src/scheduler/scheduler.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionExpirySweepService } from '../subscriptions/subscription-expiry-sweep.service';
import { ExpirySweepJob } from './expiry-sweep.job';

/**
 * D2 scheduler skeleton (design §1). `ScheduleModule.forRoot()` provides `SchedulerRegistry`;
 * `ExpirySweepJob` registers a config-driven cron over `SubscriptionExpirySweepService`.
 * `PrismaModule` is global, so the sweep service's `PrismaService` resolves without an import here.
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ExpirySweepJob, SubscriptionExpirySweepService],
})
export class SchedulerModule {}
```

- [ ] **Step 11: Run the wiring tests — verify they pass.**
```bash
npx jest src/scheduler/expiry-sweep.job.spec.ts
```
Expected: 4 tests pass.

- [ ] **Step 12: Wire `SchedulerModule` into `AppModule`.**

In `backend/mobile_purchase/src/app.module.ts`, add the import at the top (after the `MetricsModule` import):
```ts
import { SchedulerModule } from './scheduler/scheduler.module';
```
and add `SchedulerModule` to the `imports` array (after `MetricsModule`):
```ts
    MetricsModule,
    SchedulerModule,
```

- [ ] **Step 13: Typecheck.**
```bash
npx tsc --noEmit
```
Expected: exit 0, no output.

- [ ] **Step 14: Commit exactly the D2.1 files** (never `git add -A` — the tree carries the user's uncommitted dashboard WIP):
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add \
  backend/mobile_purchase/package.json \
  pnpm-lock.yaml \
  backend/mobile_purchase/src/config/app-config.ts \
  backend/mobile_purchase/src/config/app-config.spec.ts \
  backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts \
  backend/mobile_purchase/src/scheduler/expiry-sweep.job.ts \
  backend/mobile_purchase/src/scheduler/scheduler.module.ts \
  backend/mobile_purchase/src/scheduler/expiry-sweep.job.spec.ts \
  backend/mobile_purchase/src/app.module.ts && \
  git commit -m "feat(mobile_purchase): add scheduler skeleton — @nestjs/schedule, config, ExpirySweepJob shell (D2.1)"
```
Stage the root `pnpm-lock.yaml` (the workspace lockfile the `pnpm add` updated) — NOT a `package-lock.json`, and NEVER the root `package.json` (it must be unchanged). `git status` afterward must still show the dashboard WIP as the only remaining modifications. No co-author trailer.

---

### Task 2 (D2.2): `SubscriptionExpirySweepService` — real sweep through the reducer + Testcontainers spec

**Files:**
- Modify: `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts` (replace the stub `sweep` body; keep the exported constants + `ExpirySweepResult` from D2.1)
- Test: `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.spec.ts` (Testcontainers)

**Interfaces:**
- Consumes (existing): `applySubscriptionLifecycle` + `SubscriptionIdentity` (`src/webhooks/shared/persist-lifecycle-event.ts`); `PrismaService` (`src/prisma/prisma.service.ts`); `Prisma`, `Subscription`, `SubscriptionStatus` (`generated/client`); `computeCustomerInfo` (`src/entitlements/compute-customer-info.ts`) for the consistency assertion.
- Consumes (from D2.1): the constants + `ExpirySweepResult` + the `sweep(nowMs?, opts?)` signature in the same file.
- Produces: the implemented `sweep`. D2.3 runs its spec.

Requires Docker (Testcontainers boots Postgres and applies migrations via the shared helper, exactly like `refund.service.spec.ts`).

**Key design facts (verified against the codebase):**
- `applySubscriptionLifecycle({ prisma, app: { id, projectId }, store, environment, event, customerId, currentRow, writeIdentity })` runs `applyLifecycleEvent(toSubscriptionState(currentRow), event)` then upserts by identity (`persist-lifecycle-event.ts:142-169`). We pass the loaded row as `currentRow` and a `writeIdentity` derived from that same row, so it takes the plain upsert path (an in-place update).
- The `EXPIRED` event is a bare `{ type: 'EXPIRED', occurredAt: Date }` (`subscription-lifecycle.types.ts:160`). The reducer's `EXPIRED` case sets `status: 'EXPIRED'`, `lastEventAt: occurredAt` (`subscription-lifecycle-reducer.ts:204-209`).
- Reducer ordering guard: `event.occurredAt < current.lastEventAt` → returns `current` UNCHANGED (`reducer:75`). So a candidate whose `lastEventAt` is already ≥ its expiry instant is left non-EXPIRED — exactly the "late store event already superseded" case. We count `expired` by checking the returned row's `status === 'EXPIRED'`.
- `Subscription.customerId` is a required column (M1), so `row.customerId` is a non-null string — satisfies `applySubscriptionLifecycle`'s `customerId: string`.
- Advisory lock + writes must share ONE transaction for the lock to protect them (`pg_try_advisory_xact_lock` releases at transaction end). Because a Postgres error aborts the whole transaction, failure is **batch-scoped, not row-scoped**: a failing batch rolls back and the run ends with the counts so far, and the next cron tick retries (safe — the sweep is idempotent). This is the plan's deliberate, documented resolution of spec §2 step 4's aspirational "row-level continue," which is not achievable inside a single lock-holding transaction.

- [ ] **Step 1: Write the failing Testcontainers spec.**

Create `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, SubscriptionStatus } from '../../generated/client';
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
  let prisma: PrismaClient;
  let service: SubscriptionExpirySweepService;
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

  it('does not clobber a row whose lastEventAt is already later than its expiry instant (ordering guard)', async () => {
    const laterEvent = new Date('2026-06-15T00:00:00.000Z'); // after expiresAt (PAST), before NOW
    const { subscription } = await seedSubscription({ status: 'ACTIVE', expiresAt: PAST, lastEventAt: laterEvent });

    const result = await service.sweep(NOW_MS);

    // It IS a candidate (past expiry, still ACTIVE) but the reducer's ordering guard no-ops it.
    expect(result.candidates).toBe(1);
    expect(result.expired).toBe(0);
    const row = await reload(subscription.id);
    expect(row.status).toBe('ACTIVE');
    expect(row.lastEventAt).toEqual(laterEvent);
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
    const lockHolder = new PrismaClient({ datasources: { db: { url: (container as unknown as { getConnectionUri(): string }).getConnectionUri() } } });
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
```
(If `startPostgresContainer()` returns the URL under a different property name than `.url`, or the lock-holder needs the container URL differently, mirror exactly how `refund.service.spec.ts` obtains `started.url` — read it first and match. The `getConnectionUri()` cast in the lock test is a fallback; prefer reusing the same `started.url` the suite already captured by lifting it into a `describe`-scoped variable in `beforeAll`.)

- [ ] **Step 2: Run the spec — verify it fails against the stub.**
```bash
npx jest src/subscriptions/subscription-expiry-sweep.service.spec.ts
```
Expected: the container boots, then the behavioural tests FAIL because the stub returns all-zeros (`expected status 'EXPIRED', received 'ACTIVE'`; `candidates` 0 vs 1; etc.). The "future/null untouched" and excluded-status tests may pass vacuously against the stub — that's fine. Confirm the flip/lock/batch tests are red before implementing.

- [ ] **Step 3: Implement the real `sweep`.**

Replace the stub `sweep` method body in `backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts`. The full file becomes:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Subscription } from '../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applySubscriptionLifecycle,
  type SubscriptionIdentity,
} from '../webhooks/shared/persist-lifecycle-event';

/** Advisory-lock key for the expiry sweep — a fixed application-chosen bigint so overlapping sweeps
 * (same instance, or a future second Cloud Run instance) serialize on `pg_try_advisory_xact_lock`. */
export const EXPIRY_SWEEP_LOCK_KEY = 824642001;
/** Rows loaded per batch transaction. */
export const EXPIRY_SWEEP_BATCH_SIZE = 500;
/** Hard cap on batches per run — bounds a single sweep; the next cron tick continues. */
export const EXPIRY_SWEEP_MAX_BATCHES = 20;

export interface ExpirySweepResult {
  candidates: number;
  expired: number;
  skippedLock: boolean;
  batches: number;
  capped: boolean;
}

/** Statuses that are still-entitled-looking and thus sweepable once their effective expiry passes
 * (design §0). BILLING_RETRY/PAUSED/EXPIRED/REVOKED are deliberately excluded. */
const SWEEPABLE_VIA_EXPIRES_AT = ['TRIAL', 'INTRO', 'ACTIVE', 'CANCELLED'] as const;

/**
 * Flips still-entitled-looking subscriptions to EXPIRED once their effective expiry passes, THROUGH
 * the lifecycle reducer (design §2) — one writer of subscription state. The store call is not
 * involved; this is an internally-originated transition. Idempotent (upsert-by-identity through a
 * terminal-safe reducer) and safe under concurrency (advisory try-lock per batch).
 */
@Injectable()
export class SubscriptionExpirySweepService {
  private readonly logger = new Logger(SubscriptionExpirySweepService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sweep(
    nowMs: number = Date.now(),
    opts: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<ExpirySweepResult> {
    const now = new Date(nowMs);
    const batchSize = opts.batchSize ?? EXPIRY_SWEEP_BATCH_SIZE;
    const maxBatches = opts.maxBatches ?? EXPIRY_SWEEP_MAX_BATCHES;
    const result: ExpirySweepResult = { candidates: 0, expired: 0, skippedLock: false, batches: 0, capped: false };

    for (let batchNo = 0; batchNo < maxBatches; batchNo++) {
      let outcome: { skippedLock: true } | { skippedLock: false; count: number; expired: number };
      try {
        outcome = await this.runBatch(now, batchSize);
      } catch (error) {
        // A batch transaction aborts atomically on any error; the run ends with the counts so far
        // and the next cron tick retries (the sweep is idempotent). See the plan's §2 note.
        this.logger.error(
          `expiry sweep batch ${batchNo} failed: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        break;
      }

      if (outcome.skippedLock) {
        result.skippedLock = true;
        break;
      }

      result.batches++;
      result.candidates += outcome.count;
      result.expired += outcome.expired;

      if (outcome.count < batchSize) break; // drained
      if (batchNo === maxBatches - 1) result.capped = true;
    }

    return result;
  }

  /** One lock-guarded batch: try the advisory lock, load up to `batchSize` candidates, expire each
   * through the reducer. All in one transaction so the xact lock protects the writes. */
  private runBatch(
    now: Date,
    batchSize: number,
  ): Promise<{ skippedLock: true } | { skippedLock: false; count: number; expired: number }> {
    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(${EXPIRY_SWEEP_LOCK_KEY}::bigint) AS locked`,
      );
      if (lock[0]?.locked !== true) {
        return { skippedLock: true as const };
      }

      const candidates = await tx.subscription.findMany({
        where: candidateWhere(now),
        take: batchSize,
      });

      let expired = 0;
      for (const row of candidates) {
        const next = await applySubscriptionLifecycle({
          prisma: tx as unknown as PrismaService,
          app: { id: row.appId, projectId: row.projectId },
          store: row.store,
          environment: row.environment,
          event: { type: 'EXPIRED', occurredAt: effectiveExpiry(row) },
          customerId: row.customerId,
          currentRow: row,
          writeIdentity: writeIdentityOf(row),
        });
        if (next?.status === 'EXPIRED') expired++;
      }

      return { skippedLock: false as const, count: candidates.length, expired };
    });
  }
}

/** Candidate predicate (design §2): effective expiry ≤ now, still-entitled-looking status. */
function candidateWhere(now: Date): Prisma.SubscriptionWhereInput {
  return {
    OR: [
      { status: { in: [...SWEEPABLE_VIA_EXPIRES_AT] }, expiresAt: { not: null, lte: now } },
      { status: 'GRACE_PERIOD', gracePeriodExpiresAt: { not: null, lte: now } },
      { status: 'GRACE_PERIOD', gracePeriodExpiresAt: null, expiresAt: { not: null, lte: now } },
    ],
  };
}

/** The row's own expiry instant — grace rows use gracePeriodExpiresAt when set, else expiresAt.
 * `candidateWhere` guarantees the chosen field is non-null. */
function effectiveExpiry(row: Subscription): Date {
  if (row.status === 'GRACE_PERIOD' && row.gracePeriodExpiresAt) return row.gracePeriodExpiresAt;
  // Non-null by the candidate predicate.
  return row.expiresAt as Date;
}

/** The row's per-store write identity — Apple by originalTransactionId, Google by purchaseToken. */
function writeIdentityOf(row: Subscription): SubscriptionIdentity {
  if (row.originalTransactionId) return { kind: 'originalTransactionId', value: row.originalTransactionId };
  if (row.purchaseToken) return { kind: 'purchaseToken', value: row.purchaseToken };
  throw new Error(`subscription ${row.id} has neither originalTransactionId nor purchaseToken`);
}
```

- [ ] **Step 4: Run the spec — verify it passes.**
```bash
npx jest src/subscriptions/subscription-expiry-sweep.service.spec.ts
```
Expected: all tests green — the 4 status-flip cases, grace-via-gracePeriodExpiresAt, grace-via-expiresAt-fallback, future/null untouched, the 4 excluded statuses, ordering-guard no-clobber, batch drain (batches=2), maxBatches cap (capped=true), idempotent second run, advisory-lock skip, and compute-on-read consistency.

- [ ] **Step 5: Typecheck.**
```bash
npx tsc --noEmit
```
Expected: exit 0, no output. (If passing `tx` to `applySubscriptionLifecycle` still type-frictions despite the `as unknown as PrismaService` cast, confirm the cast is present exactly as written — `applySubscriptionLifecycle` only calls `prisma.subscription.upsert`/`.update`, both present on the transaction client at runtime.)

- [ ] **Step 6: Commit exactly the two files:**
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add \
  backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.ts \
  backend/mobile_purchase/src/subscriptions/subscription-expiry-sweep.service.spec.ts && \
  git commit -m "feat(mobile_purchase): implement the subscription-expiry sweep through the lifecycle reducer (D2.2)"
```
No co-author trailer. `git status` afterward shows only the dashboard WIP as remaining modifications.

---

### Task 3 (D2.3): Verify gate

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ledger entry only — appended, NOT committed; `.superpowers/` is git-ignored)
- No source changes — verification only. If any command fails, fix the underlying issue in its owning task (D2.1/D2.2) and re-run this gate from Step 1; do not patch around a red check.

**Interfaces:**
- Consumes: the repo state after D2.1 (`SchedulerModule`/`ExpirySweepJob` + config) and D2.2 (the implemented `SubscriptionExpirySweepService` + spec).
- Produces: a pass/fail record appended to `.superpowers/sdd/progress.md`.

**Environment notes:** `backend/mobile_purchase` has NO `.env` (Testcontainers manages its own Postgres). Docker must be RUNNING for Steps 2 & 4. D2 touches NO dashboard code — there are no vitest/dashboard steps. `<D2-base>` below = the commit BEFORE D2.1's commit (the current HEAD at plan-commit time; substitute the real SHA — `git log --oneline` shows the D2.1 commit's parent).

- [ ] **Step 1: `mobile_purchase` typecheck.**
```bash
cd backend/mobile_purchase && npx tsc --noEmit
```
Expected: exit 0, no output (includes the config additions, `SchedulerModule`, `ExpirySweepJob`, and the sweep service).

- [ ] **Step 2: expiry-sweep service spec ALONE.**
```bash
cd backend/mobile_purchase && npx jest src/subscriptions/subscription-expiry-sweep.service.spec.ts
```
Expected: `Test Suites: 1 passed`, all tests green (the full §4 matrix: 4 status flips + 2 grace arms + future/null untouched + 4 excluded statuses + ordering-guard no-clobber + batch drain + cap + idempotent + advisory-lock skip + compute-on-read consistency). Docker up.

- [ ] **Step 3: scheduler wiring tests ALONE.**
```bash
cd backend/mobile_purchase && npx jest src/scheduler/expiry-sweep.job.spec.ts src/config/app-config.spec.ts
```
Expected: both suites pass (4 wiring tests: enabled-registers / disabled-registers-nothing / run-swallows-error / run-logs-summary; plus the config-default + override tests). No Docker needed.

- [ ] **Step 4: FULL `mobile_purchase` suite.**
```bash
cd backend/mobile_purchase && npm test
```
Expected: exit 0, `0 failed` — every pre-D2 suite (catalog, webhooks/lifecycle, entitlements, customers, metrics + summary, refund + its e2e) still green alongside the new scheduler + sweep suites. This is the regression proof that adding `SchedulerModule` to `AppModule` and the config keys broke nothing (the D1 lesson: module-wiring failures only surface when the module actually boots — the full suite boots `AppModule`). Note the final `N suites / M tests` for the ledger entry (grows vs the D1 baseline of 61 suites / 558 tests).

- [ ] **Step 5: WIP-safety — working tree, D2 range, no trailers.**
```bash
git status --short
```
Expected: NOTHING staged, and the ONLY dirty/untracked entries are the user's known WIP set, byte-for-byte:
```
 M dashboard/src/components/layout/AppLayout.tsx
 M dashboard/src/components/layout/OrgSwitcher.tsx
 M dashboard/src/components/layout/ProjectSwitcher.tsx
 M dashboard/src/components/layout/ToolRail.tsx
 M dashboard/src/components/layout/app-layout.test.tsx
 M dashboard/src/components/layout/nav-model.ts
 M dashboard/src/components/layout/org-switcher.test.tsx
 M dashboard/src/components/layout/project-switcher.test.tsx
 M dashboard/src/features/command-palette/CommandPalette.tsx
 M dashboard/src/test/render-app.tsx
 M sdk/flutter_purchases/example/lib/demo_config.dart
?? dashboard/src/components/layout/RailInitial.tsx
?? docs/superpowers/plans/2026-07-16-dashboard-tool-rail.md
?? docs/superpowers/specs/2026-07-16-dashboard-tool-rail-design.md
```
Then prove no D2 commit touched a WIP file:
```bash
git log --name-only <D2-base>..HEAD | grep -E 'dashboard/src/components/layout/|command-palette/CommandPalette|src/test/render-app|RailInitial|demo_config' ; echo "exit=$?"
```
Expected: no matches, `exit=1`.
And no co-author trailer anywhere in the D2 range:
```bash
git log <D2-base>..HEAD --format='%h %b' | grep -i 'co-authored' ; echo "exit=$?"
```
Expected: no matches, `exit=1`.

If ANY WIP file is staged or appears in a D2 commit: STOP, do not commit anything, surface it — reworking the user's WIP is the user's call.

- [ ] **Step 6: Record the gate in the ledger (append only — do NOT git add/commit; `.superpowers/` is git-ignored).**

Append to `.superpowers/sdd/progress.md` (substitute the observed suite counts from Step 4):
```
Task D2.3 (verify gate): complete — ALL checks PASS. (1) mobile_purchase tsc 0; (2) expiry-sweep service spec green solo (§4 matrix: ACTIVE/TRIAL/INTRO/CANCELLED flip via expiresAt + GRACE_PERIOD via gracePeriodExpiresAt + grace null-fallback to expiresAt / future+null untouched / BILLING_RETRY+PAUSED+EXPIRED+REVOKED never swept / ordering-guard no-clobber / batch drain / maxBatches cap / idempotent re-run / advisory-lock skip / compute-on-read drop); (3) scheduler wiring + config specs green solo (enabled-registers / disabled-registers-nothing / run-swallows-error / run-logs-summary / config defaults + overrides); (4) FULL mobile_purchase suite green (<N> suites / <M> tests, 0 failed — SchedulerModule + config wiring regression-proven via AppModule boot); (5) WIP-safe: working tree = user's collapse-rail WIP set ONLY, ZERO D2-range commits touch layout/nav-model/CommandPalette/render-app/RailInitial/demo_config, nothing staged, no co-author trailers.
=== SUB-PROJECT D2 (Scheduler skeleton + subscription-expiry sweep) COMPLETE. @nestjs/schedule + config-driven ExpirySweepJob (SCHEDULER_ENABLED / EXPIRY_SWEEP_CRON) + SubscriptionExpirySweepService: candidate rows (still-entitled status + effective expiry <= now) flipped to EXPIRED through the lifecycle reducer (occurredAt = expiry instant, so late store webhooks still supersede), advisory-xact-lock guarded, idempotent. One writer of subscription state preserved; no schema change. NOT pushed/merged. Next creds-free slice: D3 Cloud Run image slimming. ===
```
Do NOT run `git add .superpowers/...` — it is git-ignored. `git status --short` must remain exactly the WIP set (the ledger file will not appear because it is ignored).
