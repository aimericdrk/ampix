# MyRevenueCat Refund Action (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin-initiated, RC-faithful **Refund** action to the MyRevenueCat customer profile — a Google Play, active-subscription refund that calls the (creds-gated) Play store seam, then reflects the revocation locally so compute-on-read drops the entitlement.

**Architecture:** One new `StoreClient` method (`revokeAndRefundSubscription`, creds-gated exactly like its siblings) → a new `RefundService` (double-scoped load → preconditions → store call → one `prisma.$transaction` writing `status=REVOKED` + `refundedAt` + latest-transaction `revokedAt`) → a `RefundController` mounted in the existing customer-writes module (which gains the `GOOGLE_STORE_CLIENT` provider via `WebhooksModule`, the same mechanism `ReceiptsModule` uses). The dashboard adds a `useRefundSubscription` mutation hook and a visibility-gated Refund button + confirm dialog on `RcCustomerDetailPage`. Local writes happen ONLY after store success; without credentials the endpoint 503s and writes nothing.

**Tech Stack:** NestJS 11 + Prisma 6 + jest/Testcontainers (`backend/mobile_purchase`, its own Postgres); React + TanStack Router/Query + Vitest/MSW (`dashboard`).

**Design spec:** `docs/superpowers/specs/2026-07-21-myrevenuecat-refund-action-design.md` (all § references below point there).

## Global Constraints

Every task's requirements implicitly include all of these:

- **Store-gated only (RC-faithful, §0).** The endpoint ALWAYS calls the Google `StoreClient`; `GoogleCredentialsUnavailableError` → **503** and ZERO local writes (verbatim the receipts-path mapping in `src/receipts/support/google-receipt-validator.ts`). No local-only refund mode.
- **Google only, subscriptions only, admin only (§0).** `store === 'PLAY_STORE'`; refundable status set = `{ ACTIVE, TRIAL, INTRO, GRACE_PERIOD, CANCELLED }`; `@RequireProjectRole('admin')`. The UI **hides** (never disables) the action when not applicable.
- **Reuse the existing store seam (§0).** Extend the `StoreClient` interface + `GOOGLE_STORE_CLIENT` DI token + `GoogleApiStoreClient` + `InMemoryStoreClient` (`src/webhooks/google/*`). Do NOT invent a new store client. Do NOT touch `google-store-client.factory.ts`.
- **No schema/migration changes** — `Subscription.refundedAt`/`.status`, `Transaction.revokedAt`, `App.packageName` all already exist.
- **File placement follows repo convention:** services in `src/customers/services/`, controllers in `src/customers/controllers/` (beside the existing B sub-project files).
- **HARD WIP rule:** NEVER touch or stage the user's uncommitted collapse-rail WIP — `dashboard/src/components/layout/*`, `dashboard/src/features/command-palette/CommandPalette.tsx`, `dashboard/src/test/render-app.tsx`, `dashboard/src/components/layout/RailInitial.tsx`, `sdk/flutter_purchases/example/lib/demo_config.dart`, the two `2026-07-16-dashboard-tool-rail*` docs. Always `git add` the specific task files — **never `git add -A`**.
- **Commits:** per-task commits are authorized; the USER pushes/merges. Repo message convention `feat(mobile_purchase): …` / `feat(dashboard): …` / `chore(sdd): …`. **No co-author trailer, ever.** Never commit `.env` / `google-service-account.json` / any secret.
- **Environment:** `backend/mobile_purchase` has NO `.env` (intentional) — specs/e2e boot their own Postgres via Testcontainers; **Docker must be running** for Testcontainers steps. All backend commands run from `backend/mobile_purchase`.
- **Dashboard testing gotchas:** native elements only in new UI (Radix `Select` HANGS jsdom/vitest); run vitest ONE file at a time (`npx vitest run <file>`); if a run hangs, `pkill -9 -f vitest`, wait, rerun that single file once.

---
### Task 1 (D1.1): StoreClient refund extension

**Files:**
- Modify: `backend/mobile_purchase/src/webhooks/google/store-client.ts` (add `revokeAndRefundSubscription` to the `StoreClient` interface)
- Modify: `backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts` (creds-gated implementation in `GoogleApiStoreClient`)
- Modify: `backend/mobile_purchase/src/webhooks/google/store-client.in-memory.ts` (test double: call recording + configurable reject)
- Test: `backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts` (extend existing spec)
- Test: `backend/mobile_purchase/src/webhooks/google/store-client.in-memory.spec.ts` (extend existing spec)
- Modify (compile-fix only): `backend/mobile_purchase/src/receipts/services/receipts.service.spec.ts` (ad-hoc `StoreClient` object literal at line ~212 gains the new method)
- Modify (compile-fix only): `backend/mobile_purchase/src/webhooks/google/google-ingest.service.spec.ts` (ad-hoc `StoreClient` object literal at line ~397 gains the new method)

**Interfaces:**
- Consumes: nothing from other tasks (this is the first D1 task). Existing symbols reused as-is: `StoreClient`, `GoogleApiStoreClient`, `GoogleCredentialsUnavailableError` (constructed as `new GoogleCredentialsUnavailableError(packageName)`), `InMemoryStoreClient`, `PrismaService`, `AppPlatform`.
- Produces (Task 2's `RefundService` and Task 3's e2e depend on these EXACTLY):
  - `StoreClient` interface gains: `revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>`
  - `GoogleApiStoreClient.revokeAndRefundSubscription` — with `App.storeCredentials` NULL/absent it throws `GoogleCredentialsUnavailableError(packageName)` before any network call (D1 ships only the creds gate; no `googleapis` wiring).
  - `InMemoryStoreClient` gains:
    - `readonly revokeAndRefundCalls: Array<{ packageName: string; purchaseToken: string }>` — one entry per call, in call order, recorded even when the call rejects.
    - `failRevokeAndRefundWith(error: Error | null): this` — fluent (matches `seedSubscription`/`seedProduct` style); makes every subsequent `revokeAndRefundSubscription` call reject with exactly that error instance; pass `null` to reset to the resolving default (Task 3's e2e resets this way in `beforeEach`). Not configured → the method resolves (success).
    - `revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>` per the interface.

Notes before starting:
- All commands run from `/Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase`. Single-file jest runs are `npx jest <path-to-spec>` (jest.config.js `testMatch` covers `src/**/*.spec.ts`). The two store-client specs are pure unit specs — no DB, no Testcontainers, no Docker needed.
- Adding a required method to the `StoreClient` interface breaks every structural implementer at compile time. There are exactly four: `GoogleApiStoreClient`, `InMemoryStoreClient`, and two ad-hoc object literals inside specs (`receipts.service.spec.ts` ~line 212, `google-ingest.service.spec.ts` ~line 397). All four are handled in the steps below; `npm run typecheck` at the end proves nothing else was missed.
- Do NOT touch `google-store-client.factory.ts` — it returns `GoogleApiStoreClient` by interface and needs no change.

- [ ] **Step 1: Write the failing unit test for the creds-gated real impl.**
  In `backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts`, add two `it` blocks inside the existing `describe('GoogleApiStoreClient', ...)`, directly after the existing third test (`'still throws (creds-gated, no googleapis wiring yet) even when storeCredentials IS set — flagged, not silently assumed working'`), mirroring the existing tests' structure and the `fakePrisma` helper already in the file:

  ```ts
    it('revokeAndRefundSubscription throws GoogleCredentialsUnavailableError when the App has no storeCredentials', async () => {
      const client = new GoogleApiStoreClient(fakePrisma(null));

      await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
    });

    it('revokeAndRefundSubscription still throws (creds-gated, no googleapis wiring yet) even when storeCredentials IS set — flagged, not silently assumed working', async () => {
      const client = new GoogleApiStoreClient(fakePrisma('encrypted-blob'));

      await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).rejects.toBeInstanceOf(GoogleCredentialsUnavailableError);
    });
  ```

- [ ] **Step 2: Run the spec and watch it fail on the missing method.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/webhooks/google/store-client.google-api.spec.ts
  ```
  Expected failure: the suite fails to compile with `TS2339: Property 'revokeAndRefundSubscription' does not exist on type 'GoogleApiStoreClient'.` (ts-jest surfaces this as a failed test suite). Do not proceed until you see exactly this failure.

- [ ] **Step 3: Add the method to the `StoreClient` interface.**
  In `backend/mobile_purchase/src/webhooks/google/store-client.ts`, inside `export interface StoreClient { ... }`, add after the `getProduct` member (keeping the file's doc-comment style):

  ```ts
    /** `purchases.subscriptions.revoke(packageName, purchaseToken)` — refund the LAST payment and
     * immediately revoke access (D1 refund design §1.3, RC's Google dashboard refund). Resolves on
     * store success; throws on any failure (`GoogleCredentialsUnavailableError` when credentials
     * are absent, anything else for a store rejection). No `null` case — a revoke either succeeded
     * or it threw. */
    revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>;
  ```

  The interface body becomes:

  ```ts
  export interface StoreClient {
    /** `purchases.subscriptionsv2.get(packageName, purchaseToken)`. `null` signals "no such purchase
     * token" (a genuine 404 from Google) — distinct from a thrown error, which signals a transport/
     * auth/credentials failure the caller should treat as replayable-`FAILED`, not "unknown". */
    getSubscriptionV2(packageName: string, purchaseToken: string): Promise<GoogleSubscriptionV2 | null>;

    /** `purchases.products.get(packageName, productId, purchaseToken)` — one-time products. Same
     * `null`-vs-throw contract as `getSubscriptionV2`. */
    getProduct(packageName: string, productId: string, purchaseToken: string): Promise<GoogleOneTimeProductPurchase | null>;

    /** `purchases.subscriptions.revoke(packageName, purchaseToken)` — refund the LAST payment and
     * immediately revoke access (D1 refund design §1.3, RC's Google dashboard refund). Resolves on
     * store success; throws on any failure (`GoogleCredentialsUnavailableError` when credentials
     * are absent, anything else for a store rejection). No `null` case — a revoke either succeeded
     * or it threw. */
    revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>;
  }
  ```

- [ ] **Step 4: Implement the creds-gated throw in `GoogleApiStoreClient`.**
  In `backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts`, add after the `getProduct` method (before `private async requireCredentials`), copying the exact shape of the sibling methods:

  ```ts
    async revokeAndRefundSubscription(packageName: string, _purchaseToken: string): Promise<void> {
      await this.requireCredentials(packageName);
      // Unreachable today, same as getSubscriptionV2 — the real `purchases.subscriptions.revoke`
      // call (refund last payment + immediate revoke, D1 refund design §1.3) lands here once
      // decryption exists.
      throw new GoogleCredentialsUnavailableError(packageName);
    }
  ```

  No import changes needed (everything referenced is already in the file).

- [ ] **Step 5: Run the google-api spec again — green.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/webhooks/google/store-client.google-api.spec.ts
  ```
  Expected: 1 suite passed, 5 tests passed (the 3 pre-existing + the 2 new).

- [ ] **Step 6: Write the failing tests for the `InMemoryStoreClient` double.**
  In `backend/mobile_purchase/src/webhooks/google/store-client.in-memory.spec.ts`, add two `it` blocks at the end of the existing `describe('InMemoryStoreClient', ...)` (after the seeded one-time-product test):

  ```ts
    it('revokeAndRefundSubscription resolves by default and records the (packageName, purchaseToken) call', async () => {
      const client = new InMemoryStoreClient();

      await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).resolves.toBeUndefined();

      expect(client.revokeAndRefundCalls).toEqual([{ packageName: 'com.myampix.app', purchaseToken: 'token-1' }]);
    });

    it('revokeAndRefundSubscription rejects with the configured error and still records the call', async () => {
      const storeError = new Error('store rejected');
      const client = new InMemoryStoreClient().failRevokeAndRefundWith(storeError);

      await expect(client.revokeAndRefundSubscription('com.myampix.app', 'token-1')).rejects.toBe(storeError);

      expect(client.revokeAndRefundCalls).toEqual([{ packageName: 'com.myampix.app', purchaseToken: 'token-1' }]);
    });
  ```

- [ ] **Step 7: Run the in-memory spec and watch it fail.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/webhooks/google/store-client.in-memory.spec.ts
  ```
  Expected failure: suite fails to compile with `TS2420: Class 'InMemoryStoreClient' incorrectly implements interface 'StoreClient'. Property 'revokeAndRefundSubscription' is missing...` (plus `TS2339` on the spec's calls). This is the interface extension from Step 3 biting the double, as intended.

- [ ] **Step 8: Extend `InMemoryStoreClient`.**
  In `backend/mobile_purchase/src/webhooks/google/store-client.in-memory.ts`, inside the class, add two fields after the existing `private readonly products` field, one fluent configurator after `seedProduct`, and the method after `getProduct` (before the closing brace of the class):

  ```ts
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
  ```

  (Shown as the full class for unambiguous placement — `subscriptionKey`/`productKey` helper functions below the class are untouched.)

- [ ] **Step 9: Run the in-memory spec again — green.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/webhooks/google/store-client.in-memory.spec.ts
  ```
  Expected: 1 suite passed, 7 tests passed (5 pre-existing + 2 new).

- [ ] **Step 10: Compile-fix the two ad-hoc `StoreClient` object literals in existing specs.**
  These are typed `const throwingClient: StoreClient = { ... }` and now miss the new required member. Add one line to each, matching the reject style already used in that literal.

  `backend/mobile_purchase/src/receipts/services/receipts.service.spec.ts` (inside `it('missing store credentials -> 503', ...)`, ~line 212) — change:

  ```ts
        const throwingClient: StoreClient = {
          getSubscriptionV2: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
          getProduct: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
        };
  ```

  to:

  ```ts
        const throwingClient: StoreClient = {
          getSubscriptionV2: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
          getProduct: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
          revokeAndRefundSubscription: () => Promise.reject(new GoogleCredentialsUnavailableError(PACKAGE_NAME)),
        };
  ```

  `backend/mobile_purchase/src/webhooks/google/google-ingest.service.spec.ts` (inside `it('journals FAILED (replayable) and never rejects — still 200 at the handler boundary', ...)`, ~line 397) — change:

  ```ts
        const throwingClient: StoreClient = {
          getSubscriptionV2: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
          getProduct: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
        };
  ```

  to:

  ```ts
        const throwingClient: StoreClient = {
          getSubscriptionV2: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
          getProduct: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
          revokeAndRefundSubscription: () => Promise.reject(new Error('Google Play service-account credentials are not available')),
        };
  ```

- [ ] **Step 11: Full typecheck — proves no other structural implementer was missed.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npm run typecheck
  ```
  Expected: exits 0, no output. If any `TS2420`/`TS2739` remains, it names a `StoreClient` implementer this plan missed — fix it the same way as Step 10 before moving on.

- [ ] **Step 12: Re-run the two touched Testcontainers suites (Docker must be running; each takes a couple of minutes).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/webhooks/google/google-ingest.service.spec.ts
  ```
  Expected: suite green (behavior unchanged — the literals only gained an unused member).
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/receipts/services/receipts.service.spec.ts
  ```
  Expected: suite green.

- [ ] **Step 13: Commit exactly the seven touched files (never `git add -A` — the working tree carries the user's uncommitted dashboard WIP).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add backend/mobile_purchase/src/webhooks/google/store-client.ts backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts backend/mobile_purchase/src/webhooks/google/store-client.google-api.spec.ts backend/mobile_purchase/src/webhooks/google/store-client.in-memory.ts backend/mobile_purchase/src/webhooks/google/store-client.in-memory.spec.ts backend/mobile_purchase/src/webhooks/google/google-ingest.service.spec.ts backend/mobile_purchase/src/receipts/services/receipts.service.spec.ts && git commit -m "feat(mobile_purchase): extend StoreClient with creds-gated revokeAndRefundSubscription (D1.1)"
  ```
  (Seven paths: interface, real impl + its spec, in-memory double + its spec, and the two compile-fix specs. `git status` afterwards must still show the dashboard layout WIP files as the only remaining modifications.) No co-author trailer.

---

### Task 2 (D1.2): RefundService + Testcontainers spec (all §1.5 branches)

**Files:**
- Create: `backend/mobile_purchase/src/customers/services/refund.service.ts`
- Test: `backend/mobile_purchase/src/customers/services/refund.service.spec.ts`

**Interfaces:**
- Consumes (from Task 1, D1.1):
  - `StoreClient.revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>` (`backend/mobile_purchase/src/webhooks/google/store-client.ts`)
  - `InMemoryStoreClient` (`backend/mobile_purchase/src/webhooks/google/store-client.in-memory.ts`) — the refund-recording double: `readonly revokeAndRefundCalls: Array<{ packageName: string; purchaseToken: string }>` (every call appended in order) and `failRevokeAndRefundWith(error: Error | null): this` (fluent, matching `seedSubscription`; `null` resets to the resolving default; after calling it, `revokeAndRefundSubscription` still RECORDS the call then rejects with the supplied error; without it, resolves).
  - `GoogleCredentialsUnavailableError` (`backend/mobile_purchase/src/webhooks/google/store-client.google-api.ts`, constructor `(packageName: string)`) — pre-existing.
  - `GOOGLE_STORE_CLIENT` token (`backend/mobile_purchase/src/webhooks/google/google-store-client.factory.ts`) — pre-existing.
- Produces (Task 3's controller + module wiring build against these):
  - `RefundService` class at `backend/mobile_purchase/src/customers/services/refund.service.ts`, `@Injectable()`, constructor `(prisma: PrismaService, @Inject(GOOGLE_STORE_CLIENT) storeClient: StoreClient)`.
  - `refund(projectId: string, customerId: string, subscriptionId: string, nowMs?: number): Promise<RefundResult>` with `export interface RefundResult { id: string; status: 'REVOKED'; refundedAt: Date }`.
  - Error contract (all `ProblemException`): 404 `'Subscription not found'` (opaque — not-found / cross-customer / cross-project); 409 titles verbatim `'Refunds are only available for Google Play subscriptions.'`, `'This subscription has already been refunded.'`, `'Only active subscriptions can be refunded.'`, `'Subscription is missing its Google purchase token.'`, `'App is not configured for Google Play.'`; 503 `'Store credentials unavailable'` (detail = error message, verbatim the receipts mapping in `src/receipts/support/google-receipt-validator.ts`); 502 `'Store rejected the refund'` (detail = error message).

Requires Docker running (Testcontainers boots `postgres:17-alpine` and applies the Prisma migrations via the shared `startPostgresContainer` helper, exactly like `promotional-entitlements.service.spec.ts`).

- [ ] **Step 1: Write the failing Testcontainers spec** — create `backend/mobile_purchase/src/customers/services/refund.service.spec.ts` (beside `promotional-entitlements.service.spec.ts`, whose Testcontainers harness and import depth it mirrors):

```ts
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
```

- [ ] **Step 2: Run the spec, verify it fails for the right reason** —

  ```
  cd backend/mobile_purchase && npx jest src/customers/services/refund.service.spec.ts
  ```

  Expected failure: ts-jest compile error `TS2307: Cannot find module './refund.service'` (the service does not exist yet). If it instead fails on `revokeAndRefundCalls` / `failRevokeAndRefundWith` not existing on `InMemoryStoreClient`, Task 1 (D1.1) has not landed — stop and finish Task 1 first.

- [ ] **Step 3: Implement RefundService** — create `backend/mobile_purchase/src/customers/services/refund.service.ts` (beside the other customer-write services; Task 3's module wiring imports it from `./services/refund.service`):

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Store, SubscriptionStatus } from '../../../generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { GOOGLE_STORE_CLIENT } from '../../webhooks/google/google-store-client.factory';
import { GoogleCredentialsUnavailableError } from '../../webhooks/google/store-client.google-api';
import type { StoreClient } from '../../webhooks/google/store-client';

export interface RefundResult {
  id: string;
  status: 'REVOKED';
  refundedAt: Date;
}

/** Design §1.2 precondition — RC shows Refund only for currently-entitled subscriptions: the
 * entitled statuses per the `SubscriptionStatus` enum comments (`CANCELLED` = auto-renew off but
 * still entitled until `expiresAt`). Everything else 409s before any store call. */
const REFUNDABLE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIAL,
  SubscriptionStatus.INTRO,
  SubscriptionStatus.GRACE_PERIOD,
  SubscriptionStatus.CANCELLED,
]);

/**
 * The D1 Refund action (design §1.2): a Google Play, active-subscription refund. Store-gated only
 * — ALWAYS calls `StoreClient.revokeAndRefundSubscription` (creds-gated: without live credentials
 * it throws `GoogleCredentialsUnavailableError` → 503, identical posture to the receipts path in
 * `google-receipt-validator.ts`); the local `refundedAt`/`revokedAt` writes happen ONLY after a
 * successful store call, in one `prisma.$transaction`. No "local-only refund" mode.
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GOOGLE_STORE_CLIENT) private readonly storeClient: StoreClient,
  ) {}

  async refund(
    projectId: string,
    customerId: string,
    subscriptionId: string,
    nowMs: number = Date.now(),
  ): Promise<RefundResult> {
    // Design §1.2 step 1 — double-scoped load (`Subscription` carries both `customerId` and
    // `projectId`, so one filter asserts both scopes); not-found / cross-customer / cross-project
    // all 404 with the SAME opaque title — never leak which scope failed.
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, customerId, projectId },
      select: { id: true, store: true, status: true, refundedAt: true, purchaseToken: true, appId: true },
    });
    if (!subscription) throw new ProblemException({ status: 404, title: 'Subscription not found' });

    // Design §1.2 step 2 — preconditions, all checked BEFORE the store call.
    if (subscription.store !== Store.PLAY_STORE) {
      throw new ProblemException({ status: 409, title: 'Refunds are only available for Google Play subscriptions.' });
    }
    if (subscription.refundedAt !== null) {
      throw new ProblemException({ status: 409, title: 'This subscription has already been refunded.' });
    }
    if (!REFUNDABLE_STATUSES.has(subscription.status)) {
      throw new ProblemException({ status: 409, title: 'Only active subscriptions can be refunded.' });
    }
    if (!subscription.purchaseToken) {
      // Defensive — a PLAY_STORE sub always has one (design §1.2 step 2).
      throw new ProblemException({ status: 409, title: 'Subscription is missing its Google purchase token.' });
    }

    // Design §1.2 step 3 — resolve the store identity via the sub's App.
    const app = await this.prisma.app.findUnique({
      where: { id: subscription.appId },
      select: { packageName: true },
    });
    if (!app?.packageName) {
      throw new ProblemException({ status: 409, title: 'App is not configured for Google Play.' });
    }

    // Design §1.2 step 4 — the creds-gated store call. 503 mapping is verbatim the receipts path
    // (`google-receipt-validator.ts` `toCredentialsUnavailable`); any other store error is a 502.
    try {
      await this.storeClient.revokeAndRefundSubscription(app.packageName, subscription.purchaseToken);
    } catch (e) {
      if (e instanceof GoogleCredentialsUnavailableError) {
        throw new ProblemException({ status: 503, title: 'Store credentials unavailable', detail: e.message });
      }
      throw new ProblemException({
        status: 502,
        title: 'Store rejected the refund',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Design §1.2 step 5 — reflect locally ONLY after store success, atomically. RC refunds "the
    // last purchase": only the latest transaction gets `revokedAt` (if not already set); zero
    // transactions → skip that write, the subscription-level refund still stands.
    const refundedAt = new Date(nowMs);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.REVOKED, refundedAt },
      });
      const latestTransaction = await tx.transaction.findFirst({
        where: { subscriptionId: subscription.id, projectId },
        orderBy: { purchasedAt: 'desc' },
        select: { id: true, revokedAt: true },
      });
      if (latestTransaction && latestTransaction.revokedAt === null) {
        await tx.transaction.update({ where: { id: latestTransaction.id }, data: { revokedAt } });
      }
    });

    return { id: subscription.id, status: 'REVOKED', refundedAt };
  }
}
```

- [ ] **Step 4: Run the spec, verify it passes** —

  ```
  cd backend/mobile_purchase && npx jest src/customers/services/refund.service.spec.ts
  ```

  Expected: `RefundService` suite green, **10 passed** (happy path, zero-transactions, already-refunded 409, APP_STORE 409, EXPIRED 409, BILLING_RETRY 409, creds-unavailable 503, generic store 502, cross-customer 404, cross-project 404). First run pulls/boots the `postgres:17-alpine` container — the 180s timeout covers it.

- [ ] **Step 5: Typecheck** —

  ```
  cd backend/mobile_purchase && npx tsc --noEmit
  ```

  Expected: exit 0, no output.

- [ ] **Step 6: Commit exactly the two new files** (never `git add -A` — the working tree carries the user's uncommitted layout WIP):

  ```
  cd backend/mobile_purchase && git add src/customers/services/refund.service.ts src/customers/services/refund.service.spec.ts
  git commit -m "feat(mobile_purchase): RefundService — scoped Google Play refund with store-gated local writes"
  ```

---

### Task 3 (D1.3): RefundController + module wiring + e2e

**Files:**
- Create: `backend/mobile_purchase/src/customers/controllers/refund.controller.ts` (beside `customer-deletion.controller.ts` — repo convention; Task 2's `refund.service.ts` sits in the sibling `services/` directory)
- Create: `backend/mobile_purchase/test/e2e/refund.e2e-spec.ts`
- Modify: `backend/mobile_purchase/src/customers/customer-writes.module.ts`

**Interfaces:**
- Consumes (from Task 2): `RefundService.refund(projectId: string, customerId: string, subscriptionId: string, nowMs?: number): Promise<{ id: string; status: 'REVOKED'; refundedAt: Date }>` at `backend/mobile_purchase/src/customers/services/refund.service.ts` — injects `PrismaService` (global via `PrismaModule`) + `@Inject(GOOGLE_STORE_CLIENT)`; 409 non-Google `title` is verbatim `'Refunds are only available for Google Play subscriptions.'` (the 409 messages live in the problem `title`, matching the existing customer-write services); 503 title is verbatim `'Store credentials unavailable'`.
- Consumes (from Task 1): `InMemoryStoreClient` (`backend/mobile_purchase/src/webhooks/google/store-client.in-memory.ts`) with `readonly revokeAndRefundCalls: Array<{ packageName: string; purchaseToken: string }>` (records every `revokeAndRefundSubscription` call) and the fluent configurator `failRevokeAndRefundWith(error: Error | null): this` (non-null → subsequent calls reject with that error; `null` → resolve, the default). Also `GoogleCredentialsUnavailableError` from `store-client.google-api.ts` and the `GOOGLE_STORE_CLIENT` token from `google-store-client.factory.ts`.
- Consumes (existing): `ProjectAccessGuard` + `RequireProjectRole` (`src/authz/project-access.guard.ts`, `src/authz/require-project-role.decorator.ts`); `WebhooksModule` (`src/webhooks/webhooks.module.ts`) which already `exports: [... GOOGLE_STORE_CLIENT]` — the exact mechanism `ReceiptsModule` uses; `startPostgresContainer` (`test/integration/helpers/containers`).
- Produces (for Tasks 4/5, the dashboard): the live HTTP contract `POST /api/v1/projects/:projectId/customers/:customerId/subscriptions/:subscriptionId/refund` → `200 { id: string, status: 'REVOKED', refundedAt: string }` (ISO date — Nest JSON-serializes the service's `Date`); errors as RFC-7807 `ProblemException` bodies: 401 (no Authorization header, thrown by the guard), 403 (role below admin), 404, 409, 502, 503 (`title: 'Store credentials unavailable'`).

The e2e harness (copied from `test/e2e/customer-writes.e2e-spec.ts`) boots `AppModule` ONCE per file in `beforeAll` via `Test.createTestingModule({ imports: [AppModule] })` + `overrideProvider`. Per-test provider swapping is therefore NOT feasible — instead we bind ONE `InMemoryStoreClient` instance with `.overrideProvider(GOOGLE_STORE_CLIENT).useValue(storeClient)` (overriding the token replaces the `WebhooksModule` factory provider, so every consumer — including the newly wired `RefundService` — gets the double) and flip its behavior per test with `failRevokeAndRefundWith(...)`, resetting to success in `beforeEach`. This is exactly the pattern the existing harness already uses for role flipping (`fakeAccess.role = 'viewer'` per test on a single `FakeProjectAccessService` instance).

- [ ] **Step 1: Write the failing e2e spec.** Create `backend/mobile_purchase/test/e2e/refund.e2e-spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GOOGLE_STORE_CLIENT } from '../../src/webhooks/google/google-store-client.factory';
import { GoogleCredentialsUnavailableError } from '../../src/webhooks/google/store-client.google-api';
import { InMemoryStoreClient } from '../../src/webhooks/google/store-client.in-memory';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

/** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'admin';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Refund endpoint e2e — POST .../customers/:customerId/subscriptions/:subscriptionId/refund', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeAccess: FakeProjectAccessService;
  // The app boots ONCE per file (same harness as customer-writes.e2e-spec.ts), so per-test provider
  // swaps are off the table — one shared InMemoryStoreClient is bound over GOOGLE_STORE_CLIENT and
  // its behavior is flipped per test via failRevokeAndRefundWith, reset to success in beforeEach
  // (the same single-instance flip pattern fakeAccess.role already uses).
  const storeClient = new InMemoryStoreClient();

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    process.env.DATABASE_URL = started.url.replace(/^postgres:\/\//, 'postgresql://');
    process.env.NODE_ENV = 'test';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProjectAccessService)
      .useClass(FakeProjectAccessService)
      .overrideProvider(GOOGLE_STORE_CLIENT)
      .useValue(storeClient)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  beforeEach(() => {
    fakeAccess.role = 'admin';
    storeClient.failRevokeAndRefundWith(null); // default: the store call succeeds
  });

  function refundPath(projectId: string, customerId: string, subscriptionId: string): string {
    return `/api/v1/projects/${projectId}/customers/${customerId}/subscriptions/${subscriptionId}/refund`;
  }

  async function seedGoogleSubscription(projectId: string) {
    const customer = await prisma.customer.create({
      data: { projectId, appUserId: `refund-e2e-${randomUUID()}` },
    });
    const packageName = `com.refund.e2e.${randomUUID()}`;
    const sdkApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const purchaseToken = `token-${randomUUID()}`;
    const subscription = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: sdkApp.id,
        storeProductId: 'sub.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        purchaseToken,
        purchasedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    return { customer, packageName, purchaseToken, subscription };
  }

  it('200 as admin — body shows REVOKED + refundedAt, sub persisted as revoked, store double received (packageName, purchaseToken)', async () => {
    const projectId = randomUUID();
    const { customer, packageName, purchaseToken, subscription } = await seedGoogleSubscription(projectId);

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(res.body).toMatchObject({ id: subscription.id, status: 'REVOKED' });
    expect(typeof res.body.refundedAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.refundedAt))).toBe(false);

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('REVOKED');
    expect(persisted?.refundedAt).not.toBeNull();

    expect(storeClient.revokeAndRefundCalls).toContainEqual({ packageName, purchaseToken });
  });

  it('403 as viewer — nothing written, store not called', async () => {
    const projectId = randomUUID();
    const { customer, subscription } = await seedGoogleSubscription(projectId);
    const callsBefore = storeClient.revokeAndRefundCalls.length;

    fakeAccess.role = 'viewer';
    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer viewer-token')
      .expect(403);

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
    expect(storeClient.revokeAndRefundCalls.length).toBe(callsBefore);
  });

  it('401 without an Authorization header', async () => {
    const projectId = randomUUID();
    const { customer, subscription } = await seedGoogleSubscription(projectId);

    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .expect(401);
  });

  it('404 for an unknown subscription id', async () => {
    const projectId = randomUUID();
    const { customer } = await seedGoogleSubscription(projectId);

    await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, randomUUID()))
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
  });

  it('409 for a non-Google (APP_STORE) subscription — store not called', async () => {
    const projectId = randomUUID();
    const customer = await prisma.customer.create({
      data: { projectId, appUserId: `refund-e2e-${randomUUID()}` },
    });
    const iosApp = await prisma.app.create({
      data: {
        projectId,
        name: 'iOS',
        platform: 'IOS',
        bundleId: `com.refund.e2e.${randomUUID()}`,
        publicSdkKey: `mp_pub_${randomUUID()}`,
      },
    });
    const appleSub = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: iosApp.id,
        storeProductId: 'sub.monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        originalTransactionId: `orig-${randomUUID()}`,
        purchasedAt: new Date('2026-07-01T00:00:00Z'),
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    const callsBefore = storeClient.revokeAndRefundCalls.length;

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, appleSub.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(409);

    expect(res.body.title).toBe('Refunds are only available for Google Play subscriptions.');
    expect(storeClient.revokeAndRefundCalls.length).toBe(callsBefore);

    const persisted = await prisma.subscription.findUnique({ where: { id: appleSub.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
  });

  it('503 when the store client throws GoogleCredentialsUnavailableError — nothing written', async () => {
    const projectId = randomUUID();
    const { customer, packageName, subscription } = await seedGoogleSubscription(projectId);
    storeClient.failRevokeAndRefundWith(new GoogleCredentialsUnavailableError(packageName));

    const res = await request(app.getHttpServer())
      .post(refundPath(projectId, customer.id, subscription.id))
      .set('Authorization', 'Bearer admin-token')
      .expect(503);

    expect(res.body.title).toBe('Store credentials unavailable');

    const persisted = await prisma.subscription.findUnique({ where: { id: subscription.id } });
    expect(persisted?.status).toBe('ACTIVE');
    expect(persisted?.refundedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail on the missing route.** From `backend/mobile_purchase`:

```bash
npx jest test/e2e/refund.e2e-spec.ts
```

Expected: the app boots (Testcontainers pulls Postgres — Docker must be running), then 5 of 6 tests FAIL with `expected 200 ... got 404` / `expected 403 ... got 404` / `expected 401 ... got 404` / `expected 409 ... got 404` / `expected 503 ... got 404` — the route is not mounted, so Nest's default 404 wins everywhere. Only "404 for an unknown subscription id" passes vacuously. (If instead the spec fails to COMPILE on `failRevokeAndRefundWith` / `revokeAndRefundCalls`, Task 1 is not on this branch yet — stop and finish Task 1 first.)

- [ ] **Step 3: Create the controller.** Create `backend/mobile_purchase/src/customers/controllers/refund.controller.ts` (copying the decorator/guard/param style of `src/customers/controllers/customer-deletion.controller.ts`; `@HttpCode(200)` because Nest defaults POST to 201 and the contract is 200):

```typescript
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { RefundService } from '../services/refund.service';

/**
 * D1 (design §1.1): the admin-initiated Google Play refund action. Double-scoped under
 * `customers/:customerId` like B's write endpoints; no request body; 200 with the updated
 * subscription state `{ id, status, refundedAt }` (the dashboard refetches detail anyway).
 */
@Controller('api/v1/projects/:projectId/customers/:customerId/subscriptions')
@UseGuards(ProjectAccessGuard)
export class RefundController {
  constructor(private readonly service: RefundService) {}

  @Post(':subscriptionId/refund')
  @HttpCode(200)
  @RequireProjectRole('admin')
  refund(
    @Param('projectId') projectId: string,
    @Param('customerId') customerId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.service.refund(projectId, customerId, subscriptionId);
  }
}
```

- [ ] **Step 4: Wire the module.** Replace the full contents of `backend/mobile_purchase/src/customers/customer-writes.module.ts` with (the change: import `WebhooksModule` — which already `exports` `GOOGLE_STORE_CLIENT`, the exact mechanism `ReceiptsModule` reuses, so NO new store client is constructed and `RefundService`'s `@Inject(GOOGLE_STORE_CLIENT)` resolves to the one factory-built `GoogleApiStoreClient`; register `RefundController` + `RefundService`; extend the doc comment):

```typescript
import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
import { CustomerDeletionController } from './controllers/customer-deletion.controller';
import { RefundController } from './controllers/refund.controller';
import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';
import { CustomerDeletionService } from './services/customer-deletion.service';
import { RefundService } from './services/refund.service';

/**
 * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
 * (B3.1/B3.2), customer deletion, and the D1 Google Play refund action. Deliberately separate
 * from `CustomersModule` (M1 ingest persistence) and the read-side customers controller (B2) —
 * no route collision, since every controller here owns a distinct HTTP method + path under
 * `api/v1/projects/:projectId/customers`. WebhooksModule is imported for its exported
 * `GOOGLE_STORE_CLIENT` (the same creds-gated `GoogleApiStoreClient` instance ReceiptsModule
 * reuses — D1 design §1.4: no second, divergent store client).
 */
@Module({
  imports: [AuthzModule, WebhooksModule],
  controllers: [PromotionalEntitlementsController, CustomerDeletionController, RefundController],
  providers: [PromotionalEntitlementsService, CustomerDeletionService, RefundService],
})
export class CustomerWritesModule {}
```

(No cycle: `WebhooksModule` imports `CatalogModule` + `CustomersModule`, neither of which imports `CustomerWritesModule`. `PrismaModule` is global, so `RefundService`'s `PrismaService` resolves without an extra import — same as the two existing services here.)

- [ ] **Step 5: Run the e2e again — all green.** From `backend/mobile_purchase`:

```bash
npx jest test/e2e/refund.e2e-spec.ts
```

Expected: `Tests: 6 passed, 6 total`.

- [ ] **Step 6: Typecheck + neighbor regression (route-collision guard).** From `backend/mobile_purchase`:

```bash
npx tsc --noEmit && npx jest test/e2e/customer-writes.e2e-spec.ts
```

Expected: tsc exits 0 with no output; `Tests: 3 passed, 3 total` (the existing customer-writes e2e still green — the new `POST .../subscriptions/:subscriptionId/refund` path collides with nothing under `api/v1/projects/:projectId/customers`).

- [ ] **Step 7: Commit (only the three task files — never `git add -A`).** From the repo root:

```bash
git add backend/mobile_purchase/src/customers/controllers/refund.controller.ts backend/mobile_purchase/src/customers/customer-writes.module.ts backend/mobile_purchase/test/e2e/refund.e2e-spec.ts
git commit -m "feat(mobile_purchase): mount POST subscriptions/:id/refund (RefundController + GOOGLE_STORE_CLIENT wiring into customer-writes) with e2e"
```

---

### Task 4 (D1.4): dashboard `useRefundSubscription` mutation hook + MSW hook test

**Files:**
- Modify: `dashboard/src/features/revenuecat/customers-api.ts` (add `RcRefundSubscriptionResult` + `useRefundSubscription`, after `useDeleteCustomer`)
- Test: `dashboard/src/features/revenuecat/customers-api.test.ts` (add a `useRefundSubscription` describe block: success + 503 `ApiError`)

**Interfaces:**
- Consumes:
  - `purchaseApiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T>` (`dashboard/src/lib/api/purchase-client.ts`) — throws `ApiError` on non-2xx.
  - `ApiError` with `readonly problem: ApiProblem` (`dashboard/src/lib/api/problem.ts`).
  - `rcCustomerDetailKey(projectId, customerId)` → `['rc-customers', projectId, 'detail', customerId]` and the module-private `invalidateDetail(queryClient, projectId, customerId)` helper (both already in `customers-api.ts`).
  - Server contract from D1.3: `POST /api/v1/projects/:projectId/customers/:customerId/subscriptions/:subscriptionId/refund`, no body, 200 `{ id, status: 'REVOKED', refundedAt }` (ISO string on the wire); 503 problem `{ title: 'Store credentials unavailable' }` when Google creds are absent.
- Produces (D1.5 depends on these EXACTLY):
  - `export function useRefundSubscription(projectId: string, customerId: string)` — TanStack `useMutation<RcRefundSubscriptionResult, ApiError, string>`; `mutate(subscriptionId)` POSTs the refund path; `onSuccess` invalidates `rcCustomerDetailKey(projectId, customerId)`.
  - `export interface RcRefundSubscriptionResult { id: string; status: 'REVOKED'; refundedAt: string }`.

- [ ] **Step 1: Write the failing MSW test (success + 503).**
  In `dashboard/src/features/revenuecat/customers-api.test.ts`, extend the imports. Replace:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import {
    rcCustomerDetailKey,
    rcCustomersListKey,
    useDeleteCustomer,
    useGrantPromotionalEntitlement,
    useRcCustomer,
    useRcCustomers,
    useRevokePromotionalEntitlement,
    type RcCustomerDetail,
    type RcCustomerList,
    type RcCustomerRow,
    type RcPromotionalEntitlement,
  } from './customers-api';
  ```
  with:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { ApiError } from '../../lib/api/problem';
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import {
    rcCustomerDetailKey,
    rcCustomersListKey,
    useDeleteCustomer,
    useGrantPromotionalEntitlement,
    useRcCustomer,
    useRcCustomers,
    useRefundSubscription,
    useRevokePromotionalEntitlement,
    type RcCustomerDetail,
    type RcCustomerList,
    type RcCustomerRow,
    type RcPromotionalEntitlement,
    type RcRefundSubscriptionResult,
  } from './customers-api';
  ```
  Then append this describe block at the end of the file (after the `useDeleteCustomer` describe block):
  ```ts
  describe('useRefundSubscription', () => {
    it('POSTs the nested subscriptions/:subscriptionId/refund path with no body and invalidates the detail query', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody = 'unset';
      let detailCalls = 0;
      const refunded: RcRefundSubscriptionResult = {
        id: 'sub-1',
        status: 'REVOKED',
        refundedAt: '2026-07-21T00:00:00.000Z',
      };
      server.use(
        http.get(`${BASE}/:customerId`, () => {
          detailCalls += 1;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
        http.post(
          `${BASE}/:customerId/subscriptions/:subscriptionId/refund`,
          async ({ request }) => {
            seenUrl = request.url;
            seenBody = await request.text();
            return HttpResponse.json(refunded);
          },
        ),
      );

      const Wrapper = wrapper();
      const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
      await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
      expect(detailCalls).toBe(1);

      const refund = renderHook(() => useRefundSubscription(PID, 'cust-1'), { wrapper: Wrapper });
      act(() => {
        refund.result.current.mutate('sub-1');
      });

      await waitFor(() => expect(refund.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/subscriptions/sub-1/refund`);
      expect(seenBody).toBe('');
      expect(refund.result.current.data).toEqual(refunded);
      await waitFor(() => expect(detailCalls).toBe(2));
    });

    it('surfaces a 503 problem body as ApiError and does not invalidate the detail query', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let detailCalls = 0;
      server.use(
        http.get(`${BASE}/:customerId`, () => {
          detailCalls += 1;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
        http.post(`${BASE}/:customerId/subscriptions/:subscriptionId/refund`, () =>
          HttpResponse.json(
            { type: 'about:blank', title: 'Store credentials unavailable', status: 503 },
            { status: 503 },
          ),
        ),
      );

      const Wrapper = wrapper();
      const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
      await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
      expect(detailCalls).toBe(1);

      const refund = renderHook(() => useRefundSubscription(PID, 'cust-1'), { wrapper: Wrapper });
      act(() => {
        refund.result.current.mutate('sub-1');
      });

      await waitFor(() => expect(refund.result.current.isError).toBe(true));
      const error = refund.result.current.error;
      expect(error).toBeInstanceOf(ApiError);
      expect(error?.problem).toMatchObject({ status: 503, title: 'Store credentials unavailable' });
      expect(detailCalls).toBe(1);
    });
  });
  ```
  (`http`, `HttpResponse`, `renderHook`, `act`, `waitFor`, `wrapper`, `PID`, `BASE`, and `CUSTOMER_DETAIL` are already defined/imported at the top of this test file — reuse them, do not redeclare.)

- [ ] **Step 2: Run the test file — confirm it fails on the missing export.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts
  ```
  Expected failure: the whole file fails to load with `SyntaxError: The requested module './customers-api' does not provide an export named 'useRefundSubscription'` (every test in the file reports as failed). That is the expected red state — do not proceed until you see exactly this class of failure.

- [ ] **Step 3: Implement the hook in `customers-api.ts`.**
  In `dashboard/src/features/revenuecat/customers-api.ts`, first add the `ApiError` type import. Replace:
  ```ts
  import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  import type { RcProductType } from './catalog-api';
  ```
  with:
  ```ts
  import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import type { ApiError } from '../../lib/api/problem';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  import type { RcProductType } from './catalog-api';
  ```
  Update the module doc comment's action list so it stays truthful. Replace (inside the `/** … */` block at the top):
  ```ts
   * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
   * grant/revoke/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
  ```
  with:
  ```ts
   * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
   * grant/revoke/refund/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
  ```
  Then append the result type + hook at the very end of the file, directly after the closing `}` of `useDeleteCustomer`:
  ```ts

  /** Refund response (refund design `2026-07-21-myrevenuecat-refund-action-design.md` §1.1 —
   *  the updated subscription's new state; `refundedAt` is an ISO string on the wire). */
  export interface RcRefundSubscriptionResult {
    id: string;
    status: 'REVOKED';
    refundedAt: string;
  }

  /** `POST …/customers/:customerId/subscriptions/:subscriptionId/refund` (refund design §2) —
   *  Google Play refund-last-payment + revoke. Invalidates the detail so the subscription
   *  re-renders as REVOKED/refunded and the entitlement drops. */
  export function useRefundSubscription(projectId: string, customerId: string) {
    const queryClient = useQueryClient();
    return useMutation<RcRefundSubscriptionResult, ApiError, string>({
      mutationFn: (subscriptionId: string) =>
        purchaseApiFetch<RcRefundSubscriptionResult>(
          `${customersBase(projectId)}/${customerId}/subscriptions/${subscriptionId}/refund`,
          { method: 'POST' },
        ),
      onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
    });
  }
  ```
  (`customersBase` and `invalidateDetail` are the existing module-private helpers in this file — reuse them. Note the explicit `useMutation<RcRefundSubscriptionResult, ApiError, string>` generics: the cross-task contract fixes `TError = ApiError` so D1.5 can read `error.problem` without an `instanceof` narrow. The two-space indentation inside the fenced block above is for the plan document — paste at the file's top level with the file's normal indentation, matching `useDeleteCustomer`.)

- [ ] **Step 4: Run the test file again — all green.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts
  ```
  Expected: 10 tests pass (the 8 pre-existing + the 2 new `useRefundSubscription` tests), 0 failures.

- [ ] **Step 5: Typecheck the dashboard.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npm run typecheck
  ```
  Expected: `tsc --noEmit` exits 0 with no output.

- [ ] **Step 6: Commit exactly the two touched files (never `git add -A` — the layout/CommandPalette/render-app WIP must stay uncommitted).**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add dashboard/src/features/revenuecat/customers-api.ts dashboard/src/features/revenuecat/customers-api.test.ts && git commit -m "feat(dashboard): add useRefundSubscription mutation hook over the refund endpoint"
  ```
  Expected: commit contains only those two files (`git show --stat HEAD` lists exactly them). No co-author trailer.

---

### Task 5 (D1.5): RcCustomerDetailPage Refund action + confirm dialog + toasts

**Files:**
- Modify: `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx`
- Modify: `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.dialogs.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx`

**Interfaces:**
- Consumes: `useRefundSubscription(projectId: string, customerId: string)` from `dashboard/src/features/revenuecat/customers-api.ts` (Task 4 / D1.4) — TanStack `useMutation`, `mutate(subscriptionId: string)`, `TError = ApiError`, `onSuccess` invalidates `rcCustomerDetailKey(projectId, customerId)` (`['rc-customers', projectId, 'detail', customerId]`). Also consumes the existing `RcSubscriptionRow` fields `id` / `store: RcRawStore` / `status: RcSubscriptionStatus` / `refundedAt: string | null`, `apiErrorMessage(error, fallback)` from the dialogs file, `useToast()` from `dashboard/src/components/ui/toast.tsx` (`toast({ title, description?, variant? })`), and `useProjectRole(projectId)` from `dashboard/src/features/projects/api.ts` (returns `'owner' | 'admin' | 'editor' | 'viewer' | undefined`; the page's existing `canManage = role === 'admin' || role === 'owner'`).
- Produces: `RefundSubscriptionDialog({ projectId, customerId, subscriptionId, onClose }: { projectId: string; customerId: string; subscriptionId: string; onClose: () => void })` exported from `RcCustomerDetailPage.dialogs.tsx`; the per-row Refund button in the "Customer subscriptions" table (visible only when `canManage && store === 'PLAY_STORE' && status ∈ {ACTIVE,TRIAL,INTRO,GRACE_PERIOD,CANCELLED} && refundedAt === null` — hidden otherwise, never disabled). D1.6's verify gate runs this test file.

Toasts (not the dialogs' usual inline `role="alert"` errors) are the outcome channel here because the dialog closes on both outcomes — the row itself re-renders as `REVOKED` via the hook's detail invalidation. The dialog copies `RevokeGrantAlertDialog`'s mounted-per-target `AlertDialogAction asChild` + `preventDefault` pattern (native `<Button>`s, no Radix Select anywhere — it hangs jsdom). State-reset-on-open is free with this pattern: the component only mounts while `refundTarget` is set, so every open is a fresh mount (the `GrantEntitlementDialog` sync bug can't recur — there is no form state at all).

#### Cycle 1 — visibility matrix + success flow

- [ ] **Step 1: Write the failing page tests (visibility matrix, viewer, success flow).**
  Edit `dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx`.

  1a. Add three Google-sub fixtures right after the existing `SUBSCRIPTION` const (line ~71):

  ```tsx
  /** A refundable Google Play subscription — the one row the Refund action may appear on (refund
   *  design §2: `PLAY_STORE` + still-entitled status + not yet refunded). */
  const GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
    ...SUBSCRIPTION,
    id: 'sub-google-1',
    store: 'PLAY_STORE',
    storeProductId: 'com.example.play.monthly',
    purchaseToken: 'play-token-1',
  };

  /** Already refunded — status stays in the refundable set (`CANCELLED`) so the hidden button is
   *  attributable to `refundedAt` alone. */
  const REFUNDED_GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
    ...GOOGLE_SUBSCRIPTION,
    id: 'sub-google-refunded',
    storeProductId: 'com.example.play.refunded',
    status: 'CANCELLED',
    refundedAt: '2026-06-15T00:00:00.000Z',
  };

  /** Google but no longer entitled — `EXPIRED` is outside the refundable status set. */
  const EXPIRED_GOOGLE_SUBSCRIPTION: RcSubscriptionRow = {
    ...GOOGLE_SUBSCRIPTION,
    id: 'sub-google-expired',
    storeProductId: 'com.example.play.expired',
    status: 'EXPIRED',
  };
  ```

  1b. Let `mockCustomerDetail` seed subscriptions and serve the refund POST. Change its signature and the `state` initializer (currently `mockCustomerDetail(seedGrants: RcPromotionalEntitlement[] = [])` with `subscriptions: [SUBSCRIPTION]`) to copy the seeds, so the refund handler can mutate rows in place without leaking into the module-level fixtures:

  ```tsx
  function mockCustomerDetail(
    seedGrants: RcPromotionalEntitlement[] = [],
    subscriptions: RcSubscriptionRow[] = [SUBSCRIPTION],
  ) {
    const state: RcCustomerDetail = {
      customer: { ...CUSTOMER },
      customerInfo: customerInfoFixture(),
      subscriptions: subscriptions.map((sub) => ({ ...sub })),
      transactions: [TRANSACTION],
      promotionalEntitlements: seedGrants,
    };
  ```

  and register the refund endpoint inside the same `server.use(...)` call, right after the `http.delete(`${customersBase}/:customerId/promotional-entitlements/:grantId`, …)` handler (read-your-writes, like the grant/revoke handlers above it):

  ```tsx
      http.post(`${customersBase}/:customerId/subscriptions/:subscriptionId/refund`, ({ params }) => {
        const sub = state.subscriptions.find((candidate) => candidate.id === params.subscriptionId);
        if (!sub) return problem(404, 'Subscription not found');
        sub.status = 'REVOKED';
        sub.refundedAt = '2026-07-21T00:00:00.000Z';
        return HttpResponse.json({ id: sub.id, status: sub.status, refundedAt: sub.refundedAt });
      }),
  ```

  1c. Append three tests at the end of the `describe('RcCustomerDetailPage', …)` block (after the viewer test):

  ```tsx
  it('shows Refund only on a refundable Google Play subscription (APP_STORE / refunded / EXPIRED get none)', async () => {
    signInOwner();
    mockCustomerDetail(
      [],
      [GOOGLE_SUBSCRIPTION, SUBSCRIPTION, REFUNDED_GOOGLE_SUBSCRIPTION, EXPIRED_GOOGLE_SUBSCRIPTION],
    );
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(subsTable.getAllByRole('button', { name: 'Refund' })).toHaveLength(1);

    const googleRow = subsTable.getByText('com.example.play.monthly').closest('tr') as HTMLElement;
    expect(within(googleRow).getByRole('button', { name: 'Refund' })).toBeInTheDocument();

    for (const productId of ['com.example.monthly', 'com.example.play.refunded', 'com.example.play.expired']) {
      const row = subsTable.getByText(productId).closest('tr') as HTMLElement;
      expect(within(row).queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
    }
  });

  it('hides Refund from a viewer even on a refundable Google Play subscription', async () => {
    signInOwner();
    server.use(
      http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
    );
    mockCustomerDetail([], [GOOGLE_SUBSCRIPTION]);
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(subsTable.getByText('com.example.play.monthly')).toBeInTheDocument();
    expect(subsTable.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
  });

  it('refunds a Google Play subscription after confirming: POST, success toast, row re-renders REVOKED', async () => {
    signInOwner();
    mockCustomerDetail([], [GOOGLE_SUBSCRIPTION]);
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    await userEvent.click(subsTable.getByRole('button', { name: 'Refund' }));

    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText('Refund subscription')).toBeInTheDocument();
    expect(
      alert.getByText(/Refund the last payment and revoke this subscription immediately\?/),
    ).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Refund' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Refund issued')).toBeInTheDocument();

    await waitFor(() => {
      const refreshedTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
      const row = refreshedTable.getByText('com.example.play.monthly').closest('tr') as HTMLElement;
      expect(within(row).getByText('REVOKED')).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument();
    });
  });
  ```

  (All names used — `RcSubscriptionRow`, `server`, `http`, `HttpResponse`, `TEST_PROJECT`, `waitFor`, `within`, `userEvent` — are already imported at the top of this test file; no import changes needed.)

- [ ] **Step 2: Run the file — the three new tests fail.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx
  ```
  Expected: the six pre-existing tests stay green; the three new ones fail with `Unable to find an accessible element with the role "button" and name "Refund"` (no Refund action exists yet).

- [ ] **Step 3: Implement `RefundSubscriptionDialog` in the dialogs file.**
  Edit `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.dialogs.tsx`.

  3a. Imports — add `useToast` after the `Label` import, and `useRefundSubscription` into the existing `customers-api` import block:

  ```tsx
  import { Label } from '../../../components/ui/label';
  import { useToast } from '../../../components/ui/toast';
  import { ApiError } from '../../../lib/api/problem';
  ```

  ```tsx
  import {
    useDeleteCustomer,
    useGrantPromotionalEntitlement,
    useRefundSubscription,
    useRevokePromotionalEntitlement,
    type RcPromotionalDuration,
    type RcPromotionalEntitlement,
  } from '../customers-api';
  ```

  3b. Append the dialog after `RevokeGrantAlertDialog` (before `DeleteCustomerAlertDialog`, keeping the subscription-scoped dialogs next to the grant-scoped one). Cycle 1 ships the success path plus a *generic* error toast; the 503 special case is Cycle 2's failing test:

  ```tsx
  /** Refund a Google Play subscription (refund design §2): calls the store-gated refund endpoint
   *  (refund the last payment + revoke access immediately). Same mounted-per-target
   *  `AlertDialogAction` + `preventDefault` pattern as `RevokeGrantAlertDialog`, but outcomes
   *  surface as toasts instead of inline errors — the dialog closes either way, and on success the
   *  hook's detail invalidation re-renders the row as REVOKED. */
  export function RefundSubscriptionDialog({
    projectId,
    customerId,
    subscriptionId,
    onClose,
  }: {
    projectId: string;
    customerId: string;
    subscriptionId: string;
    onClose: () => void;
  }) {
    const refundSubscription = useRefundSubscription(projectId, customerId);
    const { toast } = useToast();

    return (
      <AlertDialog open onOpenChange={(next) => !next && onClose()}>
        <AlertDialogContent>
          <AlertDialogTitle>Refund subscription</AlertDialogTitle>
          <AlertDialogDescription>
            Refund the last payment and revoke this subscription immediately? This can’t be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="danger"
                disabled={refundSubscription.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  refundSubscription.mutate(subscriptionId, {
                    onSuccess: () => {
                      onClose();
                      toast({ title: 'Refund issued' });
                    },
                    onError: (mutationError) => {
                      onClose();
                      toast({
                        title: apiErrorMessage(mutationError, 'Could not refund this subscription.'),
                        variant: 'error',
                      });
                    },
                  });
                }}
              >
                {refundSubscription.isPending ? 'Refunding…' : 'Refund'}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  ```

  (Body copy uses the typographic apostrophe `can’t`, matching every other JSX string in this file — `customer’s`, `there’s` — and the success-flow test only regex-matches the first sentence, so the apostrophe is not load-bearing.)

- [ ] **Step 4: Wire the Refund action into the page.**
  Edit `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx`.

  4a. Imports — add the `RcSubscriptionStatus` type and the new dialog to the two existing import blocks:

  ```tsx
  import {
    useRcCustomer,
    type RcEntitlementInfo,
    type RcPromotionalEntitlement,
    type RcSubscriptionRow,
    type RcSubscriptionStatus,
    type RcTransactionRow,
  } from '../customers-api';
  import {
    apiErrorMessage,
    DeleteCustomerAlertDialog,
    GrantEntitlementDialog,
    RefundSubscriptionDialog,
    RevokeGrantAlertDialog,
  } from './RcCustomerDetailPage.dialogs';
  ```

  4b. Module-level helper, after `isPromotional` (line ~42):

  ```tsx
  /** Refund design §2: the still-entitled (refundable) statuses — `CANCELLED` = auto-renew off but
   *  entitled until `expiresAt`. `BILLING_RETRY`/`PAUSED`/`EXPIRED`/`REVOKED` are not refundable. */
  const REFUNDABLE_STATUSES: ReadonlySet<RcSubscriptionStatus> = new Set([
    'ACTIVE',
    'TRIAL',
    'INTRO',
    'GRACE_PERIOD',
    'CANCELLED',
  ]);

  /** RC-faithful (refund design §2): only a not-yet-refunded, still-entitled Google Play
   *  subscription is refundable — Apple refunds are impossible via API, so `APP_STORE` rows never
   *  get the action (hidden, not disabled). */
  function isRefundable(sub: RcSubscriptionRow): boolean {
    return sub.store === 'PLAY_STORE' && sub.refundedAt === null && REFUNDABLE_STATUSES.has(sub.status);
  }
  ```

  4c. In `CustomerDetailManager`, add the target state next to the other dialog state:

  ```tsx
    const [showGrant, setShowGrant] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<RcPromotionalEntitlement | null>(null);
    const [showDelete, setShowDelete] = useState(false);
    const [refundTarget, setRefundTarget] = useState<RcSubscriptionRow | null>(null);
  ```

  4d. Extend `subscriptionColumns` with a `canManage`-gated actions column — the exact spread pattern `grantColumns` already uses:

  ```tsx
    const subscriptionColumns: Array<DataTableColumn<RcSubscriptionRow>> = [
      { key: 'store', header: 'Store' },
      { key: 'storeProductId', header: 'Product', sortable: true },
      { key: 'status', header: 'Status' },
      { key: 'autoRenewStatus', header: 'Auto-renew', render: (sub) => (sub.autoRenewStatus ? 'Yes' : 'No') },
      { key: 'purchasedAt', header: 'Purchased', render: (sub) => formatDate(sub.purchasedAt) },
      { key: 'expiresAt', header: 'Expires', render: (sub) => formatExpiry(sub.expiresAt) },
      ...(canManage
        ? [
            {
              key: 'actions',
              header: 'Actions',
              align: 'right' as const,
              render: (sub: RcSubscriptionRow) =>
                isRefundable(sub) ? (
                  <div className="flex justify-end">
                    <Button variant="danger" size="sm" onClick={() => setRefundTarget(sub)}>
                      Refund
                    </Button>
                  </div>
                ) : null,
            },
          ]
        : []),
    ];
  ```

  4e. Mount the dialog next to the other mounted-per-target dialogs, between the `RevokeGrantAlertDialog` and `DeleteCustomerAlertDialog` blocks at the bottom of the JSX:

  ```tsx
        {canManage && refundTarget && (
          <RefundSubscriptionDialog
            projectId={projectId}
            customerId={customerId}
            subscriptionId={refundTarget.id}
            onClose={() => setRefundTarget(null)}
          />
        )}
  ```

- [ ] **Step 5: Run the file — Cycle 1 tests pass.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx
  ```
  Expected: all 9 tests pass (6 pre-existing + 3 new).

- [ ] **Step 6: Commit Cycle 1.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx dashboard/src/features/revenuecat/components/RcCustomerDetailPage.dialogs.tsx dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx && git commit -m "feat(dashboard): add the Refund action + confirm dialog to the RC customer detail subscriptions"
  ```
  (Only these three files — never `git add -A`; the layout/CommandPalette/render-app WIP must stay uncommitted.)

#### Cycle 2 — the 503 creds-unavailable toast

- [ ] **Step 7: Write the failing 503 test.**
  Append to the same `describe` block in `rc-customer-detail.test.tsx`:

  ```tsx
  it('toasts the connect-Google-Play hint on a 503 refund, leaving the row refundable', async () => {
    signInOwner();
    mockCustomerDetail([], [GOOGLE_SUBSCRIPTION]);
    // Registered after mockCustomerDetail, so this 503 wins over its stateful refund handler —
    // the exact problem the server emits when GoogleCredentialsUnavailableError maps to 503.
    server.use(
      http.post(`${customersBase}/:customerId/subscriptions/:subscriptionId/refund`, () =>
        problem(503, 'Store credentials unavailable'),
      ),
    );
    renderApp(DETAIL_URL);
    await screen.findByText('user-42');

    const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    await userEvent.click(subsTable.getByRole('button', { name: 'Refund' }));
    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Refund' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Connect a Google Play service account first.')).toBeInTheDocument();

    const refreshedTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
    expect(refreshedTable.getByRole('button', { name: 'Refund' })).toBeInTheDocument();
  });
  ```

- [ ] **Step 8: Run the file — the 503 test fails.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx
  ```
  Expected: the new test times out on `findByText('Connect a Google Play service account first.')` — the generic error path toasts the problem's own text (`Store credentials unavailable`) instead of the friendly hint. The other 9 tests stay green.

- [ ] **Step 9: Special-case 503 in the dialog's `onError`.**
  In `RcCustomerDetailPage.dialogs.tsx`, replace `RefundSubscriptionDialog`'s `onError` callback:

  ```tsx
                    onError: (mutationError) => {
                      onClose();
                      const status = mutationError instanceof ApiError ? mutationError.problem.status : null;
                      toast({
                        title:
                          status === 503
                            ? 'Connect a Google Play service account first.'
                            : apiErrorMessage(mutationError, 'Could not refund this subscription.'),
                        variant: 'error',
                      });
                    },
  ```

  (`ApiError` is already imported in this file; `apiErrorMessage` still carries the 409/404/502 problem `detail` — e.g. "This subscription has already been refunded." — straight into the toast.)

- [ ] **Step 10: Run the file — all 10 tests pass.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx
  ```
  Expected: 10 passed, 0 failed.

- [ ] **Step 11: WIP-safety check, then commit Cycle 2.**
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --short dashboard/src/components/layout dashboard/src/features/command-palette/CommandPalette.tsx dashboard/src/test/render-app.tsx
  ```
  Expected: those files still show only the user's pre-existing ` M` modifications, none staged. Then:
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add dashboard/src/features/revenuecat/components/RcCustomerDetailPage.dialogs.tsx dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx && git commit -m "feat(dashboard): map the refund 503 to the connect-Google-Play toast"
  ```

---

### Task 6 (D1.6): Verify gate — mobile_purchase + dashboard green, WIP-safe

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ledger entry only — the ONLY file this task may change or commit)
- No source changes — verification only. If any command below fails, fix the underlying issue in its owning task's files (D1.1–D1.5) and re-run this task from Step 1; do not patch around a red check.

**Interfaces:**
- Consumes: the state of the repo after D1.1 (`StoreClient.revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>` + creds-gated `GoogleApiStoreClient` throw + `InMemoryStoreClient` recording double), D1.2 (`RefundService.refund(projectId, customerId, subscriptionId, nowMs?)` in `backend/mobile_purchase/src/customers/services/refund.service.ts` + its Testcontainers spec), D1.3 (`RefundController` `POST /api/v1/projects/:projectId/customers/:customerId/subscriptions/:subscriptionId/refund` wired into `customer-writes.module.ts` + e2e), D1.4 (`useRefundSubscription(projectId, customerId)` in `dashboard/src/features/revenuecat/customers-api.ts` + tests in `customers-api.test.ts`), D1.5 (`RcCustomerDetailPage` Refund action + confirm dialog + tests in `components/rc-customer-detail.test.tsx`).
- Produces: nothing — a pass/fail verification record in `.superpowers/sdd/progress.md`, committed as `chore(sdd): record D1 verify gate`.

**Environment notes (read before Step 1):**
- `backend/mobile_purchase` has NO `.env` (only `.env.example`) — this is fine: every spec/e2e uses Testcontainers and manages its own Postgres. Docker Desktop must be RUNNING for Steps 2–4.
- Dashboard vitest: run ONE file at a time. **Vitest-hang recovery:** if a run hangs (>~120s with no output), run `pkill -9 -f vitest`, wait a few seconds, then rerun that SINGLE file once. (Known runner behavior — see the RUNNER NOTE in `.superpowers/sdd/progress.md`; the C5.1 gate ran clean, so a persistent hang means a real test bug, not the runner.)
- `2bdf9d3` (the D1 spec commit) is the baseline of the D1 range; every D1 commit is `2bdf9d3..HEAD`.

---

- [ ] **Step 1: `mobile_purchase` typecheck**

  ```
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: exit code `0`, no output (0 type errors — includes the D1.1 `StoreClient` extension, `refund.service.ts`, `refund.controller.ts`, and the `customer-writes.module.ts` wiring).

- [ ] **Step 2: refund service spec ALONE**

  ```
  cd backend/mobile_purchase && npx jest src/customers/services/refund.service.spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`, `Tests: 10 passed, 10 total`, `0 failed` — every §1.5 branch green: happy path (sub → `REVOKED` + `refundedAt` set, latest transaction `revokedAt` set while an older one stays untouched, double received `(packageName, purchaseToken)`, `computeCustomerInfo` no longer reports the entitlement), zero-transactions happy path, already-refunded 409 (store NOT called), `APP_STORE` 409, inactive-status 409 (`EXPIRED` + `BILLING_RETRY`), `GoogleCredentialsUnavailableError` → 503 with ZERO local writes, generic store error → 502 with ZERO local writes, cross-customer 404, cross-project 404.

- [ ] **Step 3: refund e2e ALONE**

  ```
  cd backend/mobile_purchase && npx jest test/e2e/refund.e2e-spec.ts
  ```
  Expected: `Test Suites: 1 passed, 1 total`, `0 failed` — 200 admin happy path (body `{ id, status: 'REVOKED', refundedAt }`), 403 viewer, 401 no token, 404 unknown subscription, 409 non-Google (`APP_STORE` seed), plus the 503 case if D1.3 bound a throwing double.
  (If D1.3 instead added its cases to the existing customers write e2e, run `npx jest test/e2e/customer-writes.e2e-spec.ts` — same expectations. Docker must be up; the spec boots its own Postgres container.)

- [ ] **Step 4: FULL `mobile_purchase` suite (unit + e2e)**

  ```
  cd backend/mobile_purchase && npm test
  ```
  Expected: exit code `0`; `Test Suites: N passed, N total` / `Tests: M passed, M total` with `0 failed` — every pre-D1 suite (catalog, webhooks/lifecycle, entitlements, customers B, metrics + summary, all `test/e2e/*.e2e-spec.ts`) still green alongside the new refund suites. Note the final `N`/`M` for the Step 9 ledger entry. This is the regression proof that the `customer-writes.module.ts` `GOOGLE_STORE_CLIENT` wiring broke nothing else (the P0 lesson: module-wiring failures only surface when the module actually boots).

- [ ] **Step 5: dashboard typecheck**

  ```
  cd dashboard && npm run typecheck
  ```
  Expected: exit code `0`, no `tsc` errors — confirms `useRefundSubscription` and the `RcCustomerDetailPage`/`.dialogs.tsx` Refund UI type-check, and (because the user's uncommitted WIP is part of the same tree) that D1 did not break the collapse-rail WIP compile.

- [ ] **Step 6: dashboard hook tests ALONE (Task 4's file)**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```
  Expected: `Test Files 1 passed (1)`, `0 failed` — the pre-existing B4.1 tests (list/detail/grant/revoke/delete, 8 tests) PLUS D1.4's `useRefundSubscription` tests (POST hits `/api/v1/projects/:projectId/customers/:customerId/subscriptions/:subscriptionId/refund`; success invalidates `['rc-customers', projectId, 'detail', customerId]`; `ApiError` surfaced on failure).
  (Hang? `pkill -9 -f vitest`, rerun this single file once.)

- [ ] **Step 7: dashboard page tests ALONE (Task 5's file)**

  ```
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx --reporter=basic
  ```
  Expected: `Test Files 1 passed (1)`, `0 failed` — the pre-existing B6.1 detail-page tests PLUS D1.5's: Refund visible for admin on an ACTIVE `PLAY_STORE` un-refunded sub; HIDDEN (not disabled) for viewer / `APP_STORE` / already-refunded / non-refundable status; confirm dialog → success toast "Refund issued" + detail refetch; MSW 503 → toast "Connect a Google Play service account first."
  (Hang? `pkill -9 -f vitest`, rerun this single file once.)

- [ ] **Step 8: WIP-safety check — working tree, D1 range, no trailers**

  ```
  git status --short
  ```
  Expected: NOTHING staged, and the ONLY dirty/untracked entries are the user's known WIP set, byte-for-byte this list and nothing else (every D1 file was committed by its own task, so none may appear here):

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

  Then prove no D1 commit ever touched a WIP file:

  ```
  git log --name-only 2bdf9d3..HEAD | grep -E 'dashboard/src/components/layout/|command-palette/CommandPalette|src/test/render-app|RailInitial|demo_config' ; echo "exit=$?"
  ```
  Expected: no matches, `exit=1`.

  And no co-author trailer anywhere in the D1 range:

  ```
  git log 2bdf9d3..HEAD --format='%h %b' | grep -i 'co-authored' ; echo "exit=$?"
  ```
  Expected: no matches, `exit=1`.

  If ANY WIP file is dirty-and-staged, staged-by-accident, or appears in a D1 commit: STOP, do not commit anything, and surface it — unstaging/reworking the user's WIP is the user's call, never this task's.

- [ ] **Step 9: record the gate in the ledger and commit ONLY that file**

  Append to `.superpowers/sdd/progress.md`, at the end of the D1 section (below the Task D1.1–D1.5 lines; substitute the two suite counts observed in Step 4):

  ```
  Task D1.6 (verify gate): complete — ALL checks PASS. (1) mobile_purchase tsc 0; (2) refund.service.spec green solo (all §1.5 branches: happy+txn+computeCustomerInfo drop / 409 x4 / 503 no-writes / 502 no-writes / 404 x2); (3) refund e2e green solo (200 admin REVOKED+refundedAt / 403 / 401 / 404 / 409 non-Google, Docker up); (4) FULL mobile_purchase suite green (<N> suites / <M> tests, 0 failed — customer-writes GOOGLE_STORE_CLIENT wiring regression-proven); (5) dashboard tsc 0 (user WIP still compiles); (6) customers-api.test.ts + rc-customer-detail.test.tsx green solo per-file (refund hook invalidates ['rc-customers',projectId,'detail',customerId]; Refund hidden-not-disabled matrix + success toast + 503 toast); (7) WIP-safe: working tree = user's collapse-rail WIP set ONLY, ZERO D1-range commits (2bdf9d3..HEAD) touch layout/nav-model/CommandPalette/render-app/RailInitial/demo_config, nothing staged, no co-author trailers.
  === SUB-PROJECT D1 (Refund action) COMPLETE. StoreClient.revokeAndRefundSubscription seam (creds-gated 503) + RefundService/RefundController (POST .../customers/:customerId/subscriptions/:subscriptionId/refund, admin) + useRefundSubscription + RcCustomerDetailPage Refund action w/ confirm dialog. Local writes only after store success; no creds -> 503 + zero writes. NOT pushed/merged. ===
  ```

  Then stage and commit ONLY the ledger:

  ```
  git add .superpowers/sdd/progress.md
  git status --short
  ```
  Expected: exactly one staged entry `M  .superpowers/sdd/progress.md`; the WIP set from Step 8 still unstaged/untracked, nothing else staged.

  ```
  git commit -m "chore(sdd): record D1 verify gate"
  ```
  Expected: 1 file changed. No co-author trailer.

---

