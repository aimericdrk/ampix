# MyRevenueCat Customers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the MyRevenueCat Customers surface — a searchable subscriber list + per-customer detail (entitlements, subscriptions, transactions, attributes) plus admin actions grant/revoke a promotional entitlement and delete a customer — replacing the `/rc/customers` placeholder.

**Architecture:** Server-first. (B1) a new `PromotionalEntitlement` domain + an additive union into the reviewed `computeCustomerInfo` engine so manual grants show up wherever CustomerInfo is assembled (dashboard AND the SDK endpoint). (B2/B3) dashboard-facing read + write endpoints on `mobile_purchase` behind `ProjectAccessGuard`. (B4–B6) the dashboard `customers-api` layer + list page + nested detail page, mirroring the catalog sub-project's patterns. (B7) a verify gate.

**Tech Stack:** NestJS 11 + Prisma 6 + Zod + Jest/Testcontainers (`backend/mobile_purchase`); React + TanStack Router/Query + the dashboard ui-kit + Vitest/MSW (`dashboard`).

**Design spec:** `docs/superpowers/specs/2026-07-20-myrevenuecat-customers-design.md` — binding for the promotional-entitlement model + engine union (§1.1–§1.2), endpoint shapes (§1.3–§1.4, §7), and the pages (§2).

## Global Constraints

- **Refund is OUT of scope** (→ sub-project D with store creds + `StoreClient`). This plan ships read view + grant/revoke promotional entitlement + delete customer only.
- **No connect gate:** pages NEVER use `useRcEnabled`/`RcConnectPage`. Gate-then-mount only on `useProjects()` resolving, then render content directly (empty states when no customers). This is the from-scratch clone.
- **Roles:** reads `@RequireProjectRole('viewer')`; grant/revoke/delete `@RequireProjectRole('admin')`. Dashboard write controls gated on `useProjectRole(projectId) ∈ {admin, owner}`; viewers get a read-only surface (controls absent, not disabled).
- **Reach seam reused:** dashboard → `purchaseApiFetch<T>(path, options?)` (`dashboard/src/lib/api/purchase-client.ts`); base `/api/v1/projects/${projectId}/customers`; query keys `['rc-customers', projectId, …]`; mutations invalidate the detail (delete also invalidates the list).
- **Promotional-entitlement model (§1.1):** `PromotionalEntitlement { id, projectId, customerId→Customer (Cascade), entitlementId→Entitlement (Cascade), grantedAt, startsAt, expiresAt?, revokedAt?, note? }`. Duration set: `daily | three_day | weekly | monthly | two_month | three_month | six_month | yearly | lifetime`; server computes `expiresAt = grantedAt + duration` (UTC date math; lifetime → null).
- **Engine union (§1.2), additive to M4b:** `ComputeCustomerInfoInput` gains `promotionalEntitlements: { entitlementIdentifier: string; expiresAtMs: number | null }[]`; the engine unions each grant active at `nowMs` (`expiresAtMs === null || expiresAtMs > nowMs`) into `entitlements`, marked promotionally-sourced (`productIdentifier: 'promotional'`, `store: 'promotional'`, `willRenew: false`). Merge rule when store + promotional grant the same entitlement: **later expiration wins** (lifetime/null beats a date). `CustomerInfoAssemblerService.assemble` loads non-revoked grants and passes them (so the SDK `/v1/subscribers/:appUserId` also reflects them). `computeCustomerInfo` stays pure.
- **List (§1.3):** `GET …/customers?search=&limit=&cursor=` — `search` = case-insensitive `appUserId` contains; `limit` default 25 (max 100); **keyset pagination** on `(createdAt DESC, id DESC)` via an opaque `cursor`; row `{ id, appUserId, createdAt, lastSeenAt, activeSubscriptionCount, totalSpentCents, currency }` (active statuses `TRIAL,INTRO,ACTIVE,CANCELLED,GRACE_PERIOD`; `totalSpentCents` = SUM non-revoked `Transaction.priceCents`, dominant `currency`; computed via grouped aggregation, NOT per-row `computeCustomerInfo`). Response `{ items, nextCursor }`.
- **Detail (§1.3):** `GET …/customers/:customerId` → `{ customer, customerInfo (extended assembler), subscriptions[], transactions[] (recent first), promotionalEntitlements[] }`; 404 when not in project.
- **Writes (§1.4):** grant `POST …/customers/:customerId/promotional-entitlements {entitlementId, duration, note?}` (validates customer + entitlement in project → 404); revoke `DELETE …/promotional-entitlements/:grantId` (double-scoped; sets `revokedAt`; idempotent 204); delete `DELETE …/customers/:customerId` (404 if not in project; cascades subscriptions + promo grants; **`Transaction.customerId` SetNull** — anonymized ledger preserved; 204).
- **Per-service isolation:** after the B1 migration + regen, `backend/mobile_analytics` `tsc` stays 0.
- **UI:** reuse `components/ui/{DataTable,dialog,alert-dialog,badge,button,input,label}`; **native `<select>`** for the entitlement + duration pickers (Radix `Select` hangs jsdom); mirror the catalog pages' gate-then-mount + role-gating + CRUD-dialog patterns; `formatCurrency` for money.
- **Routing:** `router.tsx` — swap `/rc/customers` `component:` to `RcCustomersPage` + add a nested route `/projects/$projectId/rc/customers/$customerId` → `RcCustomerDetailPage`; keep `RcPlaceholderPage` imported (Paywalls uses it).
- **HARD WIP rule:** never touch `components/layout/*`, layout `*.test.tsx`, `nav-model.ts` (NOT edited), `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`. `git add` only each task's files; every dashboard task ends with a `git status` WIP check. NO co-author trailers.

## Task index & build order

- **B1** — `PromotionalEntitlement` migration + `computeCustomerInfo` promotional union + `CustomerInfoAssembler` load; unit + Testcontainers tests. **Produces** the promotional domain + extended CustomerInfo.
- **B2** — read endpoints: customers list (search/keyset/aggregates) + detail; Testcontainers + e2e. **Produces** `GET …/customers` + `GET …/customers/:id`.
- **B3** — write endpoints: grant + revoke promotional entitlement + delete customer; Testcontainers + e2e.
- **B4** — dashboard `customers-api.ts` hooks + MSW hook tests. **Produces** the hooks B5/B6 consume.
- **B5** — `RcCustomersPage` (list + search + load-more) + router swap + MSW page tests.
- **B6** — `RcCustomerDetailPage` (detail + grant/revoke/delete) + nested route + MSW page tests.
- **B7** — verify gate.

**Build order: B1 → B2 → B3 → B4 → B5 → B6 → B7.**

## File structure

- `backend/mobile_purchase/prisma/schema.prisma` — **modify**: add `PromotionalEntitlement` model + back-relations on `Customer` and `Entitlement`.
- `backend/mobile_purchase/prisma/migrations/<ts>_promotional_entitlements/migration.sql` — **create** (additive table).
- `backend/mobile_purchase/src/entitlements/compute-customer-info.ts` + `customer-info.types.ts` (input types) — **modify**: promotional union + input field.
- `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts` — **modify**: load + pass non-revoked grants.
- `backend/mobile_purchase/src/customers/**` — **create/modify**: a dashboard-facing customers admin controller + services (list, detail, grant/revoke promotional entitlement, delete), a promotional-entitlement service, Zod schemas, wired into the module; Testcontainers specs + `test/e2e/customers.e2e-spec.ts`.
- `dashboard/src/features/revenuecat/customers-api.ts` (+ `customers-api.test.ts`) — **create**.
- `dashboard/src/features/revenuecat/components/RcCustomersPage.tsx` / `RcCustomerDetailPage.tsx` (+ `rc-customers.test.tsx` / `rc-customer-detail.test.tsx`) — **create**.
- `dashboard/src/router.tsx` — **modify**: `/rc/customers` swap + nested `/rc/customers/$customerId` route.

---

### Task B1.1: `PromotionalEntitlement` schema + migration

**Files**
- Modify: `backend/mobile_purchase/prisma/schema.prisma`
- Create (generated by `prisma migrate dev --create-only`, reviewed then applied): `backend/mobile_purchase/prisma/migrations/<timestamp>_promotional_entitlement/migration.sql`
- Create/Test: `backend/mobile_purchase/src/customers/promotional-entitlement-schema.spec.ts`

**Interfaces**
- Consumes: existing `Customer` (`customers`) and `Entitlement` (`entitlements`) models in `schema.prisma`.
- Produces (consumed by B1.2 and later B2/B3):
  ```prisma
  model PromotionalEntitlement {
    id            String      @id @default(uuid(7)) @db.Uuid
    projectId     String      @map("project_id") @db.Uuid
    customerId    String      @map("customer_id") @db.Uuid
    entitlementId String      @map("entitlement_id") @db.Uuid
    grantedAt     DateTime    @default(now()) @map("granted_at")
    startsAt      DateTime    @default(now()) @map("starts_at")
    expiresAt     DateTime?   @map("expires_at")
    revokedAt     DateTime?   @map("revoked_at")
    note          String?
  }
  ```
  Accessible at runtime as `prisma.promotionalEntitlement.{create,findMany,findUnique,delete,...}`. Back-relations added: `Customer.promotionalEntitlements: PromotionalEntitlement[]`, `Entitlement.promotionalEntitlements: PromotionalEntitlement[]`.

- [ ] **Step 1: Write the failing schema smoke test**

  Create `backend/mobile_purchase/src/customers/promotional-entitlement-schema.spec.ts`:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../test/integration/helpers/containers';

  jest.setTimeout(180000);

  // Smoke test against a real, self-contained Postgres (Testcontainers) — no dependency on
  // infra/docker-compose.yml's mobile-purchase-postgres service being up.
  describe('PromotionalEntitlement schema (smoke)', () => {
    let container: StartedPostgreSqlContainer;
    let prisma: PrismaClient;
    const projectId = randomUUID();

    beforeAll(async () => {
      const started = await startPostgresContainer();
      container = started.container;
      prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await container.stop();
    });

    it('persists a grant with its Customer/Entitlement relations and default timestamps', async () => {
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'pro', displayName: 'Pro' },
      });

      const grant = await prisma.promotionalEntitlement.create({
        data: { projectId, customerId: customer.id, entitlementId: entitlement.id, note: 'smoke test grant' },
      });

      expect(grant).toMatchObject({
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        expiresAt: null,
        revokedAt: null,
        note: 'smoke test grant',
      });
      expect(grant.grantedAt).toBeInstanceOf(Date);
      expect(grant.startsAt).toBeInstanceOf(Date);

      await prisma.promotionalEntitlement.delete({ where: { id: grant.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
      await prisma.entitlement.delete({ where: { id: entitlement.id } });
    });

    it('cascades on Customer delete', async () => {
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'pro-cascade-customer', displayName: 'Pro' },
      });
      const grant = await prisma.promotionalEntitlement.create({
        data: { projectId, customerId: customer.id, entitlementId: entitlement.id },
      });

      await prisma.customer.delete({ where: { id: customer.id } });

      await expect(prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).resolves.toBeNull();
      await prisma.entitlement.delete({ where: { id: entitlement.id } });
    });

    it('cascades on Entitlement delete', async () => {
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `smoke-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'pro-cascade-entitlement', displayName: 'Pro' },
      });
      const grant = await prisma.promotionalEntitlement.create({
        data: { projectId, customerId: customer.id, entitlementId: entitlement.id },
      });

      await prisma.entitlement.delete({ where: { id: entitlement.id } });

      await expect(prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).resolves.toBeNull();
      await prisma.customer.delete({ where: { id: customer.id } });
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/promotional-entitlement-schema.spec.ts
  ```
  Expected failure: ts-jest fails to compile the file before any test runs, e.g.
  ```
  TS2339: Property 'promotionalEntitlement' does not exist on type 'PrismaClient<...>'.
  ```
  (The generated Prisma Client has no `promotionalEntitlement` model yet.)

- [ ] **Step 2: Add the model + back-relations to `schema.prisma`**

  Edit `Customer.subscriptions`/`transactions` block — add the back-relation:
  ```prisma
    subscriptions        Subscription[]
    transactions         Transaction[]
    promotionalEntitlements PromotionalEntitlement[]
  ```
  (inserted directly after the existing `transactions Transaction[]` line, before the `// M5b: ...` comment.)

  Edit `Entitlement.products` block — add the back-relation:
  ```prisma
  model Entitlement {
    id          String               @id @default(uuid(7)) @db.Uuid
    projectId   String               @map("project_id") @db.Uuid
    identifier  String // e.g. "pro" — unique per project, stable, used by the SDK
    displayName String               @map("display_name")
    createdAt   DateTime             @default(now()) @map("created_at")
    products    ProductEntitlement[]
    promotionalEntitlements PromotionalEntitlement[]

    @@unique([projectId, identifier])
    @@index([projectId])
    @@map("entitlements")
  }
  ```

  Add the new model directly after the `Transaction` model's closing brace, before the `// Webhook journal...` comment:
  ```prisma
  // Admin-granted entitlement not backed by a store purchase (design §1.1 of the MyRevenueCat
  // Customers spec). Coexists with store-derived entitlements on the same customer/entitlement
  // pair — `computeCustomerInfo` (M4b, extended) unions both, later-expiration-wins.
  model PromotionalEntitlement {
    id            String      @id @default(uuid(7)) @db.Uuid
    projectId     String      @map("project_id") @db.Uuid
    customerId    String      @map("customer_id") @db.Uuid
    entitlementId String      @map("entitlement_id") @db.Uuid
    grantedAt     DateTime    @default(now()) @map("granted_at")
    startsAt      DateTime    @default(now()) @map("starts_at") // when the grant becomes active
    expiresAt     DateTime?   @map("expires_at") // null = lifetime
    revokedAt     DateTime?   @map("revoked_at") // null = active; set on revoke
    note          String? // optional admin note
    customer      Customer    @relation(fields: [customerId], references: [id], onDelete: Cascade)
    entitlement   Entitlement @relation(fields: [entitlementId], references: [id], onDelete: Cascade)

    @@index([projectId, customerId])
    @@index([customerId])
    @@map("promotional_entitlements")
  }
  ```

- [ ] **Step 3: Create the migration (review-only) and verify it's purely additive**

  Run:
  ```bash
  cd backend/mobile_purchase && pnpm prisma migrate dev --create-only --name promotional_entitlement
  ```
  Expected output: exit code 0, ending with something like
  ```
  Prisma Migrate created the following migration without applying it:

  prisma/migrations/<timestamp>_promotional_entitlement/

  migration.sql
  ```

  Open the generated `backend/mobile_purchase/prisma/migrations/<timestamp>_promotional_entitlement/migration.sql` and confirm it is EXACTLY this (additive only — no `ALTER`/`DROP` touching any existing table):
  ```sql
  -- CreateTable
  CREATE TABLE "promotional_entitlements" (
      "id" UUID NOT NULL,
      "project_id" UUID NOT NULL,
      "customer_id" UUID NOT NULL,
      "entitlement_id" UUID NOT NULL,
      "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expires_at" TIMESTAMP(3),
      "revoked_at" TIMESTAMP(3),
      "note" TEXT,

      CONSTRAINT "promotional_entitlements_pkey" PRIMARY KEY ("id")
  );

  -- CreateIndex
  CREATE INDEX "promotional_entitlements_project_id_customer_id_idx" ON "promotional_entitlements"("project_id", "customer_id");

  -- CreateIndex
  CREATE INDEX "promotional_entitlements_customer_id_idx" ON "promotional_entitlements"("customer_id");

  -- AddForeignKey
  ALTER TABLE "promotional_entitlements" ADD CONSTRAINT "promotional_entitlements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  -- AddForeignKey
  ALTER TABLE "promotional_entitlements" ADD CONSTRAINT "promotional_entitlements_entitlement_id_fkey" FOREIGN KEY ("entitlement_id") REFERENCES "entitlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ```
  If Prisma emitted anything different (different column/index/constraint names), fix `schema.prisma` to match this exact shape and re-run `--create-only` (delete the mismatched migration folder first) before proceeding — the dashboard/service code in later tasks depends on these exact names.

- [ ] **Step 4: Apply the migration and regenerate the client**

  Run:
  ```bash
  cd backend/mobile_purchase && pnpm prisma migrate deploy
  ```
  Expected output: exit code 0, ending with `All migrations have been successfully applied.` (or `No pending migrations to apply.` only if deploy is re-run — first run must show the new migration applied).

  Run:
  ```bash
  cd backend/mobile_purchase && pnpm prisma generate
  ```
  Expected output: exit code 0, ending with `✔ Generated Prisma Client ... to ./generated/client`.

- [ ] **Step 5: Run the schema smoke test to green**

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/promotional-entitlement-schema.spec.ts
  ```
  Expected output: `Tests: 3 passed, 3 total`.

- [ ] **Step 6: Verify both services still typecheck clean**

  Run:
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: exit code 0, no output.

  Run:
  ```bash
  cd backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: exit code 0, no output (per-service isolation — `mobile_analytics` never references `mobile_purchase`'s generated client, so this additive migration cannot affect it; this step just proves that).

- [ ] **Step 7: Commit**

  Run:
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add backend/mobile_purchase/prisma/schema.prisma backend/mobile_purchase/prisma/migrations/*_promotional_entitlement backend/mobile_purchase/src/customers/promotional-entitlement-schema.spec.ts
  git commit -m "feat(mobile_purchase): add PromotionalEntitlement model"
  ```
  (No co-author trailer.)

---

### Task B1.2: entitlement-engine promotional union + assembler wiring

**Files**
- Modify: `backend/mobile_purchase/src/entitlements/customer-info.types.ts`
- Modify: `backend/mobile_purchase/src/entitlements/compute-customer-info.ts`
- Modify/Test: `backend/mobile_purchase/src/entitlements/compute-customer-info.spec.ts`
- Modify: `backend/mobile_purchase/src/entitlements/compute-customer-info-shape.spec.ts` (local `input()` helper needs the new required field — no behavioral change)
- Modify: `backend/mobile_purchase/src/subscribers/support/prisma-projections.ts`
- Modify: `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts`
- Modify/Test: `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts`

**Interfaces**
- Consumes: `prisma.promotionalEntitlement` model from B1.1.
- Produces (consumed by later B2 customer-detail endpoint and B3 write endpoints):
  ```ts
  export interface PromotionalEntitlementProjection {
    entitlementIdentifier: string;
    expiresAtMs: number | null;
  }
  export type Store = 'app_store' | 'play_store' | 'promotional'; // widened
  export interface ComputeCustomerInfoInput {
    customer: CustomerProjection;
    subscriptions: readonly SubscriptionProjection[];
    transactions: readonly TransactionProjection[];
    promotionalEntitlements: readonly PromotionalEntitlementProjection[]; // new, required
    entitlementsByStoreProductId: EntitlementLookup;
  }
  ```
  ```ts
  export function projectPromotionalEntitlement(grant: {
    expiresAt: Date | null;
    entitlement: { identifier: string };
  }): PromotionalEntitlementProjection;
  ```
  `CustomerInfoAssemblerService.assemble(params: AssembleCustomerInfoParams, nowMs: number): Promise<CustomerInfo>` — signature unchanged; `CustomerInfo.entitlements.active/all` entries may now carry `store: 'promotional'`, `productIdentifier: 'promotional'` for promotionally-sourced entitlements.

#### Part A — pure engine union

- [ ] **Step 1: Widen the types, and write the failing engine-union tests**

  Edit `backend/mobile_purchase/src/entitlements/customer-info.types.ts` — widen `Store` and add the new projection + input field:
  ```ts
  /** RC's `store` string, exactly as the SDK returns it (design §4 rule 6), plus the
   * `'promotional'` sentinel for admin-granted entitlements (design §1.2). */
  export type Store = 'app_store' | 'play_store' | 'promotional';
  ```
  (replaces the existing `export type Store = 'app_store' | 'play_store';` line)

  Add, directly after the `ComputeCustomerInfoInput` interface's closing brace... actually insert BEFORE `ComputeCustomerInfoInput` (so the type is declared before use), directly above it:
  ```ts
  /**
   * Design §1.2 — the pure projection of a customer's non-revoked promotional grant. The caller
   * (`CustomerInfoAssemblerService`) filters `revokedAt: null` before building this array; this
   * engine only ever sees active-or-expired grants, never revoked ones — revocation itself is not
   * a compute-on-read concern here, only expiry is (same as subscriptions/transactions).
   * `expiresAtMs` is `null` for a lifetime grant.
   */
  export interface PromotionalEntitlementProjection {
    entitlementIdentifier: string;
    expiresAtMs: number | null;
  }
  ```
  And update `ComputeCustomerInfoInput`:
  ```ts
  export interface ComputeCustomerInfoInput {
    customer: CustomerProjection;
    subscriptions: readonly SubscriptionProjection[];
    transactions: readonly TransactionProjection[];
    promotionalEntitlements: readonly PromotionalEntitlementProjection[];
    entitlementsByStoreProductId: EntitlementLookup;
  }
  ```

  Edit `backend/mobile_purchase/src/entitlements/compute-customer-info-shape.spec.ts` — this file's local `input()` helper must supply the new required field (no behavioral change, just keeps this file compiling):
  ```ts
  function input(overrides: Partial<ComputeCustomerInfoInput> = {}): ComputeCustomerInfoInput {
    return {
      customer: customer(),
      subscriptions: [],
      transactions: [],
      promotionalEntitlements: [],
      entitlementsByStoreProductId: lookup({}),
      ...overrides,
    };
  }
  ```
  (only the added `promotionalEntitlements: [],` line changes)

  Edit `backend/mobile_purchase/src/entitlements/compute-customer-info.spec.ts` — update its own `input()` helper the same way:
  ```ts
  function input(overrides: Partial<ComputeCustomerInfoInput> = {}): ComputeCustomerInfoInput {
    return {
      customer: customer(),
      subscriptions: [],
      transactions: [],
      promotionalEntitlements: [],
      entitlementsByStoreProductId: lookup({}),
      ...overrides,
    };
  }
  ```

  Then append this new `describe` block at the end of the same file:
  ```ts
  describe('promotional entitlements (design §1.2)', () => {
    it('a promotional grant produces an active, promotionally-sourced entitlement', () => {
      const result = computeCustomerInfo(
        input({
          promotionalEntitlements: [
            { entitlementIdentifier: 'premium', expiresAtMs: d('2026-08-01T00:00:00Z').getTime() },
          ],
        }),
        NOW,
      );
      expect(result.entitlements.active.premium).toEqual({
        isActive: true,
        willRenew: false,
        periodType: 'normal',
        latestPurchaseDate: new Date(NOW),
        originalPurchaseDate: new Date(NOW),
        expirationDate: d('2026-08-01T00:00:00Z'),
        store: 'promotional',
        productIdentifier: 'promotional',
        unsubscribeDetectedAt: null,
        billingIssueDetectedAt: null,
        ownershipType: 'PURCHASED',
      });
    });

    it('a lifetime promotional grant (expiresAtMs: null) is active with a null expirationDate', () => {
      const result = computeCustomerInfo(
        input({ promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: null }] }),
        NOW,
      );
      expect(result.entitlements.active.premium.isActive).toBe(true);
      expect(result.entitlements.active.premium.expirationDate).toBeNull();
    });

    it('an expired promotional grant (expiresAtMs in the past) contributes nothing, not even to `.all`', () => {
      const result = computeCustomerInfo(
        input({
          promotionalEntitlements: [
            { entitlementIdentifier: 'premium', expiresAtMs: d('2026-07-01T00:00:00Z').getTime() },
          ],
        }),
        NOW,
      );
      expect(result.entitlements.active).toEqual({});
      expect(result.entitlements.all).toEqual({});
    });

    it('treats expiresAtMs exactly equal to nowMs as expired (strict > boundary, same as subscriptions)', () => {
      const result = computeCustomerInfo(
        input({ promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: NOW }] }),
        NOW,
      );
      expect(result.entitlements.active).toEqual({});
    });

    it('a revoked grant never reaches the engine — the caller\'s revokedAt: null query keeps it out of the array, so it contributes nothing', () => {
      const result = computeCustomerInfo(input({ promotionalEntitlements: [] }), NOW);
      expect(result.entitlements.active).toEqual({});
      expect(result.entitlements.all).toEqual({});
    });

    it('merge: when the promotional grant expires after the store subscription, the promotional backing wins', () => {
      const sub = subscription({ status: 'ACTIVE', expiresAt: d('2026-08-01T00:00:00Z') });
      const result = computeCustomerInfo(
        input({
          subscriptions: [sub],
          promotionalEntitlements: [
            { entitlementIdentifier: 'premium', expiresAtMs: d('2026-09-01T00:00:00Z').getTime() },
          ],
          entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
        }),
        NOW,
      );
      expect(result.entitlements.active.premium.store).toBe('promotional');
      expect(result.entitlements.active.premium.expirationDate).toEqual(d('2026-09-01T00:00:00Z'));
    });

    it('merge: when the store subscription expires after the promotional grant, the store backing wins', () => {
      const sub = subscription({ status: 'ACTIVE', expiresAt: d('2026-09-01T00:00:00Z') });
      const result = computeCustomerInfo(
        input({
          subscriptions: [sub],
          promotionalEntitlements: [
            { entitlementIdentifier: 'premium', expiresAtMs: d('2026-08-01T00:00:00Z').getTime() },
          ],
          entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
        }),
        NOW,
      );
      expect(result.entitlements.active.premium.store).toBe('app_store');
      expect(result.entitlements.active.premium.expirationDate).toEqual(d('2026-09-01T00:00:00Z'));
    });

    it('merge: a lifetime promotional grant (expiresAtMs: null) always wins over a dated store subscription', () => {
      const sub = subscription({ status: 'ACTIVE', expiresAt: d('2099-01-01T00:00:00Z') });
      const result = computeCustomerInfo(
        input({
          subscriptions: [sub],
          promotionalEntitlements: [{ entitlementIdentifier: 'premium', expiresAtMs: null }],
          entitlementsByStoreProductId: lookup({ 'com.myampix.premium.monthly': ['premium'] }),
        }),
        NOW,
      );
      expect(result.entitlements.active.premium.store).toBe('promotional');
      expect(result.entitlements.active.premium.expirationDate).toBeNull();
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/entitlements/compute-customer-info.spec.ts
  ```
  Expected failure: the file now compiles (both `input()` helpers already supply `promotionalEntitlements: []` by default), but the new assertions fail because the engine doesn't read `input.promotionalEntitlements` yet, e.g.
  ```
  expect(received).toEqual(expected)
  - Expected  - ...
  + Received  + {}
  ```
  for `result.entitlements.active.premium` (undefined/`{}` instead of the promotional `EntitlementInfo`), and the two merge tests report `store: 'app_store'`/`undefined` instead of `'promotional'` where promotional should win.

- [ ] **Step 2: Implement the union in the engine**

  Edit `backend/mobile_purchase/src/entitlements/compute-customer-info.ts` — add `PromotionalEntitlementProjection` to the type import:
  ```ts
  import type {
    ComputeCustomerInfoInput,
    CustomerInfo,
    CustomerInfoSubscription,
    EntitlementInfo,
    EntitlementPeriodType,
    PromotionalEntitlementProjection,
    Store,
    SubscriptionProjection,
    TransactionProjection,
  } from './customer-info.types';
  ```

  Add these two functions directly after `transactionToEntitlementInfo` (before `entitlementIdsFor`):
  ```ts
  /**
   * Design §1.2 — a promotional grant is "active" purely by its own expiry (no status machine like
   * subscriptions/transactions have): `null` means lifetime (never expires), otherwise strictly
   * after `nowMs`, matching the subscription/transaction compute-on-read boundary (rule 1's `>
   * nowMs`, not `>=`). Revocation is NOT re-checked here — design §1.2 says the engine only ever
   * receives "the customer's non-revoked grants"; the caller (`CustomerInfoAssemblerService`)
   * enforces that with a `revokedAt: null` query before this function is ever called.
   */
  function isPromotionalEntitlementActive(grant: PromotionalEntitlementProjection, nowMs: number): boolean {
    return grant.expiresAtMs === null || grant.expiresAtMs > nowMs;
  }

  /**
   * Design §1.2 — an active promotional grant's `EntitlementInfo`. Promotionally-sourced
   * entitlements carry no store product or renewal, so `productIdentifier`/`store` are the literal
   * `'promotional'` sentinel and `willRenew` is always `false`. The pure input carries no
   * grant/purchase timestamp (the input shape is just `{ entitlementIdentifier, expiresAtMs }`), so
   * `nowMs` — the same reference clock every other compute-on-read decision uses — stands in for
   * both purchase dates; this is a synthesized, not a persisted, timestamp.
   */
  function promotionalEntitlementToEntitlementInfo(
    grant: PromotionalEntitlementProjection,
    nowMs: number,
  ): EntitlementInfo {
    const grantedAsOf = new Date(nowMs);
    return {
      isActive: true,
      willRenew: false,
      periodType: 'normal',
      latestPurchaseDate: grantedAsOf,
      originalPurchaseDate: grantedAsOf,
      expirationDate: grant.expiresAtMs === null ? null : new Date(grant.expiresAtMs),
      store: 'promotional',
      productIdentifier: 'promotional',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED',
    };
  }
  ```

  Inside `computeCustomerInfo`, add a third backing loop directly after the existing transactions loop (before `const all: Record<string, EntitlementInfo> = {};`):
  ```ts
    for (const grant of input.promotionalEntitlements) {
      if (!isPromotionalEntitlementActive(grant, nowMs)) continue; // expired — contributes nothing (design §1.2)
      const backing = promotionalEntitlementToEntitlementInfo(grant, nowMs);
      addBacking(backingsByEntitlement, grant.entitlementIdentifier, backing);
    }
  ```
  This reuses the existing `pickWinningBacking`/`compareByRecency` dedupe for the merge rule — later-expiration-wins with `null` (lifetime) sorting as latest — for free, since promotional backings land in the same `backingsByEntitlement` map keyed by entitlement identifier as store-derived backings.

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/entitlements/compute-customer-info.spec.ts src/entitlements/compute-customer-info-shape.spec.ts
  ```
  Expected output: all tests pass, e.g. `Tests: 25 passed, 25 total` (17 pre-existing across both files + 8 new).

#### Part B — assembler wiring

- [ ] **Step 3: Write the failing assembler test**

  Edit `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts` — append this `it` inside the existing `describe('CustomerInfoAssemblerService', ...)` block, after the last existing test:
  ```ts
    it('unions a non-revoked promotional grant into entitlements.active as promotionally-sourced', async () => {
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'promo-premium', displayName: 'Promo Premium' },
      });
      const customer = await prisma.customer.create({ data: { projectId, appUserId: 'promo-user' } });
      await prisma.promotionalEntitlement.create({
        data: {
          projectId,
          customerId: customer.id,
          entitlementId: entitlement.id,
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      });

      const info = await service.assemble({ projectId, appId, customer }, NOW);

      expect(Object.keys(info.entitlements.active)).toEqual(['promo-premium']);
      expect(info.entitlements.active['promo-premium']).toMatchObject({
        isActive: true,
        willRenew: false,
        store: 'promotional',
        productIdentifier: 'promotional',
        expirationDate: new Date('2026-08-01T00:00:00.000Z'),
      });
    });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/subscribers/services/customer-info-assembler.service.spec.ts
  ```
  Expected failure:
  ```
  expect(received).toEqual(expected)
  Expected: ["promo-premium"]
  Received: []
  ```
  (`assemble` doesn't query `promotionalEntitlement` yet, so the grant is invisible to `computeCustomerInfo`.)

- [ ] **Step 4: Implement the assembler wiring**

  Edit `backend/mobile_purchase/src/subscribers/support/prisma-projections.ts` — add the import and the new projection function:
  ```ts
  import type { Customer, Subscription, Transaction } from '../../../generated/client';
  import type {
    CustomerProjection,
    PromotionalEntitlementProjection,
    SubscriptionProjection,
    TransactionProjection,
  } from '../../entitlements/customer-info.types';
  ```
  (only `PromotionalEntitlementProjection` is added to the existing type-only import list)

  Append at the end of the file:
  ```ts
  /**
   * Narrows a `PromotionalEntitlement` row (joined with its catalog `Entitlement.identifier`) to
   * the pure shape `computeCustomerInfo` (M4b, extended) accepts — design §1.2's assembler step.
   * Typed structurally against just the fields the caller's `include`/`select` produces, not the
   * full Prisma payload.
   */
  export function projectPromotionalEntitlement(grant: {
    expiresAt: Date | null;
    entitlement: { identifier: string };
  }): PromotionalEntitlementProjection {
    return {
      entitlementIdentifier: grant.entitlement.identifier,
      expiresAtMs: grant.expiresAt === null ? null : grant.expiresAt.getTime(),
    };
  }
  ```

  Edit `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts`:
  ```ts
  import { Injectable } from '@nestjs/common';
  import { PrismaService } from '../../prisma/prisma.service';
  import type { Customer } from '../../../generated/client';
  import { computeCustomerInfo } from '../../entitlements/compute-customer-info';
  import type { CustomerInfo } from '../../entitlements/customer-info.types';
  import { EntitlementMapService } from './entitlement-map.service';
  import {
    projectCustomer,
    projectPromotionalEntitlement,
    projectSubscription,
    projectTransaction,
  } from '../support/prisma-projections';

  export interface AssembleCustomerInfoParams {
    projectId: string;
    appId: string;
    customer: Customer;
  }

  /**
   * Loads a Customer's `Subscription`/`Transaction`/non-revoked `PromotionalEntitlement` rows and
   * the App's catalog entitlement mapping, projects them into M4b's pure input shape, and calls
   * `computeCustomerInfo`. This is the "CustomerInfo assembly" step design §5 assigns to the
   * SDK-facing endpoints — the impurity (DB I/O, `nowMs` as an injected argument) lives here so
   * `computeCustomerInfo` itself stays pure. Shared by every endpoint that needs a customer's
   * current CustomerInfo: M5a's read today, M5b's receipt intake, and design §1.2's dashboard
   * customer-detail read — promotional grants automatically apply to all of them.
   */
  @Injectable()
  export class CustomerInfoAssemblerService {
    constructor(
      private readonly prisma: PrismaService,
      private readonly entitlementMap: EntitlementMapService,
    ) {}

    async assemble(params: AssembleCustomerInfoParams, nowMs: number): Promise<CustomerInfo> {
      const { projectId, appId, customer } = params;

      const [subscriptions, transactions, promotionalGrants, entitlementsByStoreProductId] = await Promise.all([
        this.prisma.subscription.findMany({ where: { projectId, customerId: customer.id } }),
        this.prisma.transaction.findMany({ where: { projectId, customerId: customer.id } }),
        this.prisma.promotionalEntitlement.findMany({
          where: { projectId, customerId: customer.id, revokedAt: null },
          include: { entitlement: { select: { identifier: true } } },
        }),
        this.entitlementMap.resolveEntitlementMap(appId),
      ]);

      return computeCustomerInfo(
        {
          customer: projectCustomer(customer),
          subscriptions: subscriptions.map(projectSubscription),
          transactions: transactions.map(projectTransaction),
          promotionalEntitlements: promotionalGrants.map(projectPromotionalEntitlement),
          entitlementsByStoreProductId,
        },
        nowMs,
      );
    }
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/subscribers/services/customer-info-assembler.service.spec.ts
  ```
  Expected output: `Tests: 3 passed, 3 total`.

- [ ] **Step 5: Full regression + typecheck both services**

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/entitlements/compute-customer-info.spec.ts src/entitlements/compute-customer-info-shape.spec.ts src/subscribers/services/customer-info-assembler.service.spec.ts src/customers/promotional-entitlement-schema.spec.ts
  ```
  Expected output: all suites pass (`Test Suites: 4 passed, 4 total`).

  Run:
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: exit code 0, no output.

  Run:
  ```bash
  cd backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: exit code 0, no output.

- [ ] **Step 6: Commit**

  Run:
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add backend/mobile_purchase/src/entitlements/customer-info.types.ts backend/mobile_purchase/src/entitlements/compute-customer-info.ts backend/mobile_purchase/src/entitlements/compute-customer-info.spec.ts backend/mobile_purchase/src/entitlements/compute-customer-info-shape.spec.ts backend/mobile_purchase/src/subscribers/support/prisma-projections.ts backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts
  git commit -m "feat(mobile_purchase): union promotional entitlements into computeCustomerInfo + assembler"
  ```
  (No co-author trailer.)


---

### Task B2.1: Customers LIST endpoint (search + keyset pagination + aggregates)

**Files:**
- Create: `backend/mobile_purchase/src/customers/support/cursor.ts`
- Test: `backend/mobile_purchase/src/customers/support/cursor.spec.ts`
- Create: `backend/mobile_purchase/src/customers/support/customers.schemas.ts`
- Create: `backend/mobile_purchase/src/customers/services/customers-query.service.ts`
- Test: `backend/mobile_purchase/src/customers/services/customers-query.service.spec.ts`
- Create: `backend/mobile_purchase/src/customers/controllers/customers.controller.ts`
- Modify: `backend/mobile_purchase/src/customers/customers.module.ts`
- Test: `backend/mobile_purchase/test/e2e/customers.e2e-spec.ts` (new file)

**Interfaces:**
- Consumes: `PrismaService` (`backend/mobile_purchase/src/prisma/prisma.service.ts`, `@Global()`); `ProblemException` from `../../common/problem-details`; `parseOrThrow` from `../../common/zod` (`parseOrThrow<T>(schema, body): z.infer<T>`, throws a 400 `ProblemException` on failure); `ProjectAccessGuard` + `RequireProjectRole(role: ProjectRole)` from `../../authz/*`; `ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[]` exported from `../../metrics/services/metrics.service.ts` (`['TRIAL','INTRO','ACTIVE','CANCELLED','GRACE_PERIOD']` — reused, not redefined, per design §1.3's identical active-status list); the existing `Customer` Prisma model (`id, projectId, appUserId, createdAt, lastSeenAt`) and `Subscription`/`Transaction` models (design §1.3).
- Produces (for Task B2.2 and later sub-projects to build on):
  - `encodeCustomersCursor(cursor: { createdAt: Date; id: string }): string` / `decodeCustomersCursor(raw: string): { createdAt: Date; id: string }` (throws 400 `ProblemException` on a malformed cursor) — `backend/mobile_purchase/src/customers/support/cursor.ts`.
  - `customersListQuerySchema` (Zod) and `type CustomersListQuery = { search?: string; limit: number; cursor?: string }` — `backend/mobile_purchase/src/customers/support/customers.schemas.ts`.
  - `class CustomersQueryService { list(projectId: string, query: CustomersListQuery): Promise<{ items: CustomerListRow[]; nextCursor: string | null }> }` where `CustomerListRow = { id: string; appUserId: string; createdAt: Date; lastSeenAt: Date | null; activeSubscriptionCount: number; totalSpentCents: number; currency: string | null }` — `backend/mobile_purchase/src/customers/services/customers-query.service.ts`.
  - `class CustomersController` mounted at `api/v1/projects/:projectId/customers`, `@UseGuards(ProjectAccessGuard)`, with a `list()` handler on `@Get()` — Task B2.2 modifies this SAME file to add the `detail()` handler; B3 (a sibling plan section) will further modify it to add the write (grant/revoke/delete) routes.
  - `CustomersModule` provides `CustomersQueryService` and mounts `CustomersController` — Task B2.2 and B3 modify this SAME file to add more providers.

- [ ] **Step 1: Write the failing test for the cursor helper**

Create `backend/mobile_purchase/src/customers/support/cursor.spec.ts`:

```ts
import { decodeCustomersCursor, encodeCustomersCursor } from './cursor';

describe('customers cursor', () => {
  it('round-trips createdAt + id through encode/decode', () => {
    const createdAt = new Date('2026-07-01T12:00:00.000Z');
    const id = '11111111-1111-1111-1111-111111111111';

    const encoded = encodeCustomersCursor({ createdAt, id });
    const decoded = decodeCustomersCursor(encoded);

    expect(decoded).toEqual({ createdAt, id });
  });

  it('produces an opaque, non-JSON-looking string', () => {
    const encoded = encodeCustomersCursor({ createdAt: new Date(), id: 'x' });
    expect(() => JSON.parse(encoded)).toThrow();
  });

  it('rejects a cursor that does not decode to valid JSON', () => {
    expect(() => decodeCustomersCursor('not-a-real-cursor!!!')).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a cursor missing required fields', () => {
    const bogus = Buffer.from(JSON.stringify({ createdAt: '2026-07-01T00:00:00.000Z' }), 'utf8').toString('base64');
    expect(() => decodeCustomersCursor(bogus)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });

  it('rejects a cursor with an unparseable date', () => {
    const bogus = Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'x' }), 'utf8').toString('base64');
    expect(() => decodeCustomersCursor(bogus)).toThrow(
      expect.objectContaining({ problem: expect.objectContaining({ status: 400 }) }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest src/customers/support/cursor.spec.ts --verbose`
Expected: FAIL — `Cannot find module './cursor' from 'src/customers/support/cursor.spec.ts'`

- [ ] **Step 3: Write the minimal implementation**

Create `backend/mobile_purchase/src/customers/support/cursor.ts`:

```ts
import { ProblemException } from '../../common/problem-details';

export interface CustomersCursor {
  createdAt: Date;
  id: string;
}

/** Opaque keyset-pagination cursor: base64-encodes `{createdAt, id}` — the tie-breaking pair the
 * customers LIST orders by (`createdAt DESC, id DESC`, design §1.3). Never inspected by the
 * client; round-tripped verbatim from a page's `nextCursor` back into the next request's
 * `?cursor=`. */
export function encodeCustomersCursor(cursor: CustomersCursor): string {
  const payload = JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(payload, 'utf8').toString('base64');
}

/** Decodes + validates a cursor produced by `encodeCustomersCursor`. Throws a 400 RFC-7807
 * problem for anything malformed — the dashboard never constructs this by hand, but a
 * tampered/stale `?cursor=` must fail closed, not silently misbehave (input validation at the
 * system boundary). */
export function decodeCustomersCursor(raw: string): CustomersCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw invalidCursor();
  }
  const { createdAt, id } = parsed as { createdAt: string; id: string };
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) {
    throw invalidCursor();
  }
  return { createdAt: parsedDate, id };
}

function invalidCursor(): ProblemException {
  return new ProblemException({ status: 400, title: 'Bad Request', detail: 'cursor: invalid cursor' });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend/mobile_purchase && npx jest src/customers/support/cursor.spec.ts --verbose`
Expected: PASS — 5 tests passed

- [ ] **Step 5: Write the query schema (declarative, no dedicated unit test — exercised by the service + e2e tests below, mirroring `catalog.schemas.ts`'s convention of no per-schema spec file)**

Create `backend/mobile_purchase/src/customers/support/customers.schemas.ts`:

```ts
import { z } from 'zod';

/**
 * Dashboard-facing customers LIST query (design §1.3): `search` matches `appUserId`
 * case-insensitive contains; `limit` defaults to 25, capped at 100; `cursor` is the opaque
 * keyset-pagination token from a previous page's `nextCursor`. Query params arrive as strings —
 * `z.coerce.number()` parses `limit`. An empty `search` (a cleared search box) is treated the
 * same as omitted by `CustomersQueryService` (a falsy check), so it is not rejected here.
 */
export const customersListQuerySchema = z.object({
  search: z.string().trim().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().min(1).optional(),
});

export type CustomersListQuery = z.infer<typeof customersListQuerySchema>;
```

- [ ] **Step 6: Write the failing Testcontainers test for the query service**

Create `backend/mobile_purchase/src/customers/services/customers-query.service.spec.ts`:

```ts
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
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest src/customers/services/customers-query.service.spec.ts --verbose`
Expected: FAIL — `Cannot find module './customers-query.service' from 'src/customers/services/customers-query.service.spec.ts'`

- [ ] **Step 8: Write the minimal implementation**

Create `backend/mobile_purchase/src/customers/services/customers-query.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../metrics/services/metrics.service';
import { decodeCustomersCursor, encodeCustomersCursor } from '../support/cursor';
import type { CustomersListQuery } from '../support/customers.schemas';

export interface CustomerListRow {
  id: string;
  appUserId: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  activeSubscriptionCount: number;
  totalSpentCents: number;
  currency: string | null;
}

export interface CustomersListResult {
  items: CustomerListRow[];
  nextCursor: string | null;
}

/**
 * Dashboard-facing customers LIST (design §1.3): search + keyset pagination on
 * `(createdAt DESC, id DESC)` + per-row aggregates computed via GROUPED queries — never per-row
 * `computeCustomerInfo` (keeps the list cheap even at scale). `activeSubscriptionCount` reuses
 * `ACTIVE_SUBSCRIPTION_STATUSES` from `metrics.service.ts` (same active-status list, design §1.3).
 */
@Injectable()
export class CustomersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, query: CustomersListQuery): Promise<CustomersListResult> {
    const { search, limit, cursor } = query;
    const decoded = cursor ? decodeCustomersCursor(cursor) : null;

    const rows = await this.prisma.customer.findMany({
      where: {
        projectId,
        ...(search ? { appUserId: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const customerIds = page.map((c) => c.id);

    if (customerIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const [subCounts, spendRows] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds }, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['customerId', 'currency'],
        where: { customerId: { in: customerIds }, revokedAt: null },
        _sum: { priceCents: true },
      }),
    ]);

    const subCountByCustomer = new Map(subCounts.map((r) => [r.customerId, r._count._all]));
    const spendByCustomer = new Map<string, { totalCents: number; byCurrency: Map<string, number> }>();
    for (const row of spendRows) {
      if (row.customerId === null) continue;
      const amount = row._sum.priceCents ?? 0;
      const entry = spendByCustomer.get(row.customerId) ?? { totalCents: 0, byCurrency: new Map<string, number>() };
      entry.totalCents += amount;
      if (row.currency !== null) {
        entry.byCurrency.set(row.currency, (entry.byCurrency.get(row.currency) ?? 0) + amount);
      }
      spendByCustomer.set(row.customerId, entry);
    }

    const items: CustomerListRow[] = page.map((c) => {
      const spend = spendByCustomer.get(c.id);
      return {
        id: c.id,
        appUserId: c.appUserId,
        createdAt: c.createdAt,
        lastSeenAt: c.lastSeenAt,
        activeSubscriptionCount: subCountByCustomer.get(c.id) ?? 0,
        totalSpentCents: spend?.totalCents ?? 0,
        currency: spend ? pickDominantCurrency(spend.byCurrency) : null,
      };
    });

    const last = page[page.length - 1];
    const nextCursor = hasMore ? encodeCustomersCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { items, nextCursor };
  }
}

/** Largest total wins; ties broken alphabetically — the same convention `metrics.service.ts`
 * uses for its per-currency dominant-currency selection. */
function pickDominantCurrency(byCurrency: Map<string, number>): string | null {
  let best: { currency: string; total: number } | null = null;
  for (const [currency, total] of byCurrency) {
    if (best === null || total > best.total || (total === best.total && currency.localeCompare(best.currency) < 0)) {
      best = { currency, total };
    }
  }
  return best?.currency ?? null;
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `cd backend/mobile_purchase && npx jest src/customers/services/customers-query.service.spec.ts --verbose`
Expected: PASS — 8 tests passed

- [ ] **Step 10: Write the failing e2e test for the list route**

Create `backend/mobile_purchase/test/e2e/customers.e2e-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { startPostgresContainer } from '../integration/helpers/containers';

jest.setTimeout(180000);

/** Stands in for the real ProjectAccessService, mirroring `catalog.e2e-spec.ts`'s pattern. */
class FakeProjectAccessService {
  role: ProjectRole | null = 'viewer';
  async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
    return this.role;
  }
}

describe('Customers e2e — list + detail', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;
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

    prisma = app.get(PrismaService);
    fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  it('GET /customers — 200 as viewer, lists newest-first, search filters by appUserId', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await prisma.customer.create({
      data: { projectId, appUserId: 'zed-user', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const target = await prisma.customer.create({
      data: { projectId, appUserId: 'annie-target', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    });

    const res = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ search: 'annie' })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);

    expect(res.body).toMatchObject({
      items: [
        { id: target.id, appUserId: 'annie-target', activeSubscriptionCount: 0, totalSpentCents: 0, currency: null },
      ],
      nextCursor: null,
    });
  });

  it('GET /customers — paginates: limit=1 returns nextCursor, a second call with it returns the rest', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await prisma.customer.create({
      data: { projectId, appUserId: 'first', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    });
    await prisma.customer.create({
      data: { projectId, appUserId: 'second', createdAt: new Date('2026-02-02T00:00:00.000Z') },
    });

    const page1 = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1 })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0].appUserId).toBe('second');
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].appUserId).toBe('first');
    expect(page2.body.nextCursor).toBeNull();
  });

  it('GET /customers — 400 for a limit over the max (100)', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .query({ limit: 1000 })
      .set('Authorization', 'Bearer viewer-token')
      .expect(400);
  });

  it('GET /customers — 403 when the caller is not a project member', async () => {
    fakeAccess.role = null;
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .set('Authorization', 'Bearer stranger-token')
      .expect(403);
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest test/e2e/customers.e2e-spec.ts --verbose`
Expected: FAIL — the first test's `.expect(200)` fails with `expected 200 "OK", got 404 "Not Found"` (the route is not mounted yet — `CustomersController` does not exist and `CustomersModule` has no controller).

- [ ] **Step 12: Wire the controller and module**

Create `backend/mobile_purchase/src/customers/controllers/customers.controller.ts`:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { customersListQuerySchema } from '../support/customers.schemas';
import { CustomersQueryService } from '../services/customers-query.service';

@Controller('api/v1/projects/:projectId/customers')
@UseGuards(ProjectAccessGuard)
export class CustomersController {
  constructor(private readonly queryService: CustomersQueryService) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.queryService.list(projectId, parseOrThrow(customersListQuerySchema, query));
  }
}
```

Read `backend/mobile_purchase/src/customers/customers.module.ts` (current content, from M1), then replace it entirely with:

```ts
import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CustomersService } from './services/customers.service';
import { CustomersQueryService } from './services/customers-query.service';
import { CustomersController } from './controllers/customers.controller';

/**
 * M1: persistence (`CustomersService`, exported so M2/M3/M5 can resolve customers without
 * re-mounting this module). B2.1 (MyRevenueCat Customers design §1.3) additive: mounts the
 * dashboard-facing customers LIST read (`GET /api/v1/projects/:projectId/customers`), behind
 * AuthzModule's ProjectAccessGuard + @RequireProjectRole('viewer').
 */
@Module({
  imports: [AuthzModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersQueryService],
  exports: [CustomersService],
})
export class CustomersModule {}
```

- [ ] **Step 13: Run the e2e test to verify it passes**

Run: `cd backend/mobile_purchase && npx jest test/e2e/customers.e2e-spec.ts --verbose`
Expected: PASS — 4 tests passed

- [ ] **Step 14: Typecheck the whole service**

Run: `cd backend/mobile_purchase && npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 15: Commit**

```bash
git add backend/mobile_purchase/src/customers/support/cursor.ts \
        backend/mobile_purchase/src/customers/support/cursor.spec.ts \
        backend/mobile_purchase/src/customers/support/customers.schemas.ts \
        backend/mobile_purchase/src/customers/services/customers-query.service.ts \
        backend/mobile_purchase/src/customers/services/customers-query.service.spec.ts \
        backend/mobile_purchase/src/customers/controllers/customers.controller.ts \
        backend/mobile_purchase/src/customers/customers.module.ts \
        backend/mobile_purchase/test/e2e/customers.e2e-spec.ts
git commit -m "feat(mobile_purchase): customers list endpoint (search + keyset pagination + aggregates)"
```

---

### Task B2.2: Customer DETAIL endpoint (CustomerInfo + subscriptions + transactions + promotional grants)

**Files:**
- Modify: `backend/mobile_purchase/src/subscribers/services/entitlement-map.service.ts`
- Modify: `backend/mobile_purchase/src/subscribers/services/entitlement-map.service.spec.ts`
- Modify: `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts`
- Modify: `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts`
- Create: `backend/mobile_purchase/src/customers/services/customer-detail.service.ts`
- Test: `backend/mobile_purchase/src/customers/services/customer-detail.service.spec.ts`
- Modify: `backend/mobile_purchase/src/customers/controllers/customers.controller.ts` (created in B2.1)
- Modify: `backend/mobile_purchase/src/customers/customers.module.ts` (modified in B2.1)
- Modify: `backend/mobile_purchase/test/e2e/customers.e2e-spec.ts` (created in B2.1)

**Interfaces:**
- Consumes B2.1: `CustomersController` at `src/customers/controllers/customers.controller.ts` (modified below, adding a `detail()` handler alongside `list()`); `CustomersModule` at `src/customers/customers.module.ts` (modified below, adding providers).
- Consumes B1 (produced by a sibling plan section, per design §1.2 — the exact reconstruction this task edits against): the Prisma model `PromotionalEntitlement` (migration applied + `prisma generate` run) with fields `{ id, projectId, customerId, entitlementId, grantedAt, startsAt, expiresAt, revokedAt, note }` and a relation field named `entitlement -> Entitlement` (`{ identifier: string }`); and `CustomerInfoAssemblerService.assemble(params, nowMs): Promise<CustomerInfo>` already loading `promotionalEntitlement.findMany({ where: { projectId, customerId, revokedAt: null }, include: { entitlement: { select: { identifier: true } } } })` and passing `promotionalEntitlements: { entitlementIdentifier, expiresAtMs }[]` into `computeCustomerInfo`, per spec §1.2. This task's OWN change to that file is additive and narrowly scoped to two things only — the `appId` field becoming optional, and the `entitlementsByStoreProductId` resolution line becoming a ternary — reconstructed in full in Step 5 below. If B1 landed with different surrounding code, reconcile the file to match Step 5's full content; the `appId`-related lines are this task's actual deliverable.
- Produces: `EntitlementMapService.resolveEntitlementMapForProject(projectId: string): Promise<EntitlementLookup>`; `AssembleCustomerInfoParams.appId` becomes optional (project-wide resolution when omitted); `class CustomerDetailService { getDetail(projectId: string, customerId: string): Promise<{ customer, customerInfo: CustomerInfo, subscriptions: Subscription[], transactions: Transaction[], promotionalEntitlements: PromotionalEntitlementRow[] }> }` (throws 404 `ProblemException` when the customer is not found in the project) — `backend/mobile_purchase/src/customers/services/customer-detail.service.ts`. `CustomersController`/`CustomersModule` end this task with BOTH list and detail routes mounted; a later sibling section (B3, write endpoints) modifies these SAME two files again to add the grant/revoke/delete routes and their service.

- [ ] **Step 1: Write the failing test for the project-wide entitlement map**

Read `backend/mobile_purchase/src/subscribers/services/entitlement-map.service.spec.ts` (current content, ends with the `'scopes products to the given appId only...'` test inside the `describe('EntitlementMapService', ...)` block), then insert a new `describe` block immediately before the outer block's closing `});` — i.e. replace this trailing fragment:

```ts
    const map = await service.resolveEntitlementMap(appId);
    expect(map.has('com.a.b.other-app-product')).toBe(false);
  });
});
```

with:

```ts
    const map = await service.resolveEntitlementMap(appId);
    expect(map.has('com.a.b.other-app-product')).toBe(false);
  });

  describe('resolveEntitlementMapForProject', () => {
    it('merges the entitlement mapping across every App in the project', async () => {
      const androidApp = await prisma.app.create({
        data: {
          projectId,
          name: 'Android',
          platform: 'ANDROID',
          packageName: `com.a.b.android.${randomUUID()}`,
          publicSdkKey: `mp_pub_test_${randomUUID()}`,
        },
      });
      const iosProduct = await prisma.product.create({
        data: { projectId, appId, storeProductId: 'ios.monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'iOS Monthly' },
      });
      const androidProduct = await prisma.product.create({
        data: {
          projectId,
          appId: androidApp.id,
          storeProductId: 'android.monthly',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          displayName: 'Android Monthly',
        },
      });
      const pro = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });
      await prisma.productEntitlement.create({ data: { productId: iosProduct.id, entitlementId: pro.id } });
      await prisma.productEntitlement.create({ data: { productId: androidProduct.id, entitlementId: pro.id } });

      const map = await service.resolveEntitlementMapForProject(projectId);

      expect(map.get('ios.monthly')).toEqual(['pro']);
      expect(map.get('android.monthly')).toEqual(['pro']);
    });

    it('scopes to the given project — a product in another project is excluded', async () => {
      const otherProjectId = randomUUID();
      const otherApp = await prisma.app.create({
        data: {
          projectId: otherProjectId,
          name: 'Other',
          platform: 'IOS',
          bundleId: `com.other.${randomUUID()}`,
          publicSdkKey: `mp_pub_test_${randomUUID()}`,
        },
      });
      const otherProduct = await prisma.product.create({
        data: {
          projectId: otherProjectId,
          appId: otherApp.id,
          storeProductId: 'other.monthly',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          displayName: 'Other',
        },
      });
      const otherEnt = await prisma.entitlement.create({
        data: { projectId: otherProjectId, identifier: 'other', displayName: 'Other' },
      });
      await prisma.productEntitlement.create({ data: { productId: otherProduct.id, entitlementId: otherEnt.id } });

      const map = await service.resolveEntitlementMapForProject(projectId);
      expect(map.has('other.monthly')).toBe(false);
    });

    it('returns an empty map for a project with no products', async () => {
      await expect(service.resolveEntitlementMapForProject(projectId)).resolves.toEqual(new Map());
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest src/subscribers/services/entitlement-map.service.spec.ts --verbose`
Expected: FAIL — TypeScript compile error, `error TS2339: Property 'resolveEntitlementMapForProject' does not exist on type 'EntitlementMapService'`

- [ ] **Step 3: Write the minimal implementation**

Replace `backend/mobile_purchase/src/subscribers/services/entitlement-map.service.ts` entirely with:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { EntitlementLookup } from '../../entitlements/customer-info.types';

/**
 * Resolves the `entitlementsByStoreProductId` map `computeCustomerInfo` (M4b) needs: walks the
 * catalog `Product -> ProductEntitlement -> Entitlement` join (design §2: "Entitlements flow
 * `Product -> ProductEntitlement -> Entitlement`") for a single App and returns
 * `storeProductId -> entitlement identifier[]`. Read-only, no writes. A `storeProductId` with no
 * mapped entitlement is simply absent from the map — `computeCustomerInfo` treats a missing key
 * as "grants nothing" (design §4 rule 5), so an unimported/unmapped product needs no special
 * casing here.
 */
@Injectable()
export class EntitlementMapService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEntitlementMap(appId: string): Promise<EntitlementLookup> {
    const products = await this.prisma.product.findMany({
      where: { appId },
      select: {
        storeProductId: true,
        entitlements: { select: { entitlement: { select: { identifier: true } } } },
      },
    });

    const map: Map<string, string[]> = new Map();
    for (const product of products) {
      const identifiers = product.entitlements.map((pe) => pe.entitlement.identifier);
      if (identifiers.length === 0) continue;
      map.set(product.storeProductId, identifiers);
    }
    return map;
  }

  /**
   * Project-wide variant (MyRevenueCat Customers design §1.3's dashboard detail read): merges the
   * catalog entitlement mapping across EVERY App in the project, not just one. A dashboard
   * customer-detail read has no single-App request context — unlike the SDK
   * (`resolveEntitlementMap`, always called with the requesting App's `publicSdkKey`-resolved
   * `appId`), a Customer can hold subscriptions across every App in its project (e.g. the same
   * `app_user_id` purchasing on both the iOS and Android build of one mobile app).
   * `Product.projectId` is a direct column (design §2), so this mirrors `ProductsService.list`'s
   * `where: { projectId }` scoping rather than joining through App. A `storeProductId` reused by
   * two different Apps in the same project (schema allows it — the unique constraint
   * `@@unique([appId, storeProductId])` is per-App) has its last-seen entitlement list win;
   * harmless in practice since store product identifiers are store-specific strings that don't
   * collide across platforms.
   */
  async resolveEntitlementMapForProject(projectId: string): Promise<EntitlementLookup> {
    const products = await this.prisma.product.findMany({
      where: { projectId },
      select: {
        storeProductId: true,
        entitlements: { select: { entitlement: { select: { identifier: true } } } },
      },
    });

    const map: Map<string, string[]> = new Map();
    for (const product of products) {
      const identifiers = product.entitlements.map((pe) => pe.entitlement.identifier);
      if (identifiers.length === 0) continue;
      map.set(product.storeProductId, identifiers);
    }
    return map;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend/mobile_purchase && npx jest src/subscribers/services/entitlement-map.service.spec.ts --verbose`
Expected: PASS — 7 tests passed

- [ ] **Step 5: Write the failing test for project-wide assembly (appId omitted)**

Read `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts` (current content — post-B1, per this task's Interfaces assumption), then insert a new `it` block immediately before the outer `describe`'s closing `});`, after the last existing test. Replace this trailing fragment:

```ts
    expect(info.subscriptions).toHaveLength(1);
    expect(info.subscriptions[0]).toMatchObject({ storeProductId: 'com.a.b.monthly', isActive: true });
  });
});
```

with:

```ts
    expect(info.subscriptions).toHaveLength(1);
    expect(info.subscriptions[0]).toMatchObject({ storeProductId: 'com.a.b.monthly', isActive: true });
  });

  it('resolves entitlements project-wide when appId is omitted — a subscription on a DIFFERENT App in the same project still resolves', async () => {
    const androidApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Android',
        platform: 'ANDROID',
        packageName: `com.a.b.android.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    const androidProduct = await prisma.product.create({
      data: {
        projectId,
        appId: androidApp.id,
        storeProductId: 'com.a.b.android.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Android Monthly',
      },
    });
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'cross-platform', displayName: 'Cross-platform' },
    });
    await prisma.productEntitlement.create({ data: { productId: androidProduct.id, entitlementId: entitlement.id } });

    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'cross-platform-user' } });
    await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: androidApp.id,
        productId: androidProduct.id,
        storeProductId: 'com.a.b.android.monthly',
        store: 'PLAY_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        purchaseToken: `token-${randomUUID()}`,
        purchasedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        autoRenewStatus: true,
      },
    });

    // No `appId` in params — this customer's App is Android, not the `appId` iOS App created in
    // beforeEach; a single-App-scoped resolution would miss this entitlement entirely.
    const info = await service.assemble({ projectId, customer }, NOW);

    expect(Object.keys(info.entitlements.active)).toEqual(['cross-platform']);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest src/subscribers/services/customer-info-assembler.service.spec.ts --verbose`
Expected: FAIL — TypeScript compile error, `error TS2345: Argument of type '{ projectId: string; customer: Customer; }' is not assignable to parameter of type 'AssembleCustomerInfoParams'. Property 'appId' is missing`

- [ ] **Step 7: Write the minimal implementation**

Replace `backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts` entirely with:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Customer } from '../../../generated/client';
import { computeCustomerInfo } from '../../entitlements/compute-customer-info';
import type { CustomerInfo } from '../../entitlements/customer-info.types';
import { EntitlementMapService } from './entitlement-map.service';
import { projectCustomer, projectSubscription, projectTransaction } from '../support/prisma-projections';

export interface AssembleCustomerInfoParams {
  projectId: string;
  /** Optional (MyRevenueCat Customers design §1.3 — dashboard detail read): when provided,
   * entitlement resolution is scoped to that single App (the SDK's existing single-App request
   * context). When omitted, the customer's entitlements are resolved PROJECT-WIDE (every App in
   * the project) — the shape a dashboard customer detail read needs, since Customer has no single
   * `appId` of its own (a customer can hold subscriptions across every App in a project, e.g. the
   * same app_user_id used on both the iOS and Android build of one mobile app). */
  appId?: string;
  customer: Customer;
}

/**
 * Loads a Customer's `Subscription`/`Transaction` rows, its non-revoked promotional-entitlement
 * grants, and the App's catalog entitlement mapping, projects them into M4b's pure input shape,
 * and calls `computeCustomerInfo`. This is the "CustomerInfo assembly" step design §5 assigns to
 * the SDK-facing endpoints — the impurity (DB I/O, `nowMs` as an injected argument) lives here so
 * `computeCustomerInfo` itself stays pure. Shared by every endpoint that needs a customer's
 * current CustomerInfo: M5a's read, M5b's receipt intake, and the MyRevenueCat Customers
 * dashboard detail read (design §1.3, `appId` omitted — project-wide resolution).
 */
@Injectable()
export class CustomerInfoAssemblerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementMap: EntitlementMapService,
  ) {}

  async assemble(params: AssembleCustomerInfoParams, nowMs: number): Promise<CustomerInfo> {
    const { projectId, appId, customer } = params;

    const [subscriptions, transactions, entitlementsByStoreProductId, promotionalGrants] = await Promise.all([
      this.prisma.subscription.findMany({ where: { projectId, customerId: customer.id } }),
      this.prisma.transaction.findMany({ where: { projectId, customerId: customer.id } }),
      appId ? this.entitlementMap.resolveEntitlementMap(appId) : this.entitlementMap.resolveEntitlementMapForProject(projectId),
      this.prisma.promotionalEntitlement.findMany({
        where: { projectId, customerId: customer.id, revokedAt: null },
        include: { entitlement: { select: { identifier: true } } },
      }),
    ]);

    return computeCustomerInfo(
      {
        customer: projectCustomer(customer),
        subscriptions: subscriptions.map(projectSubscription),
        transactions: transactions.map(projectTransaction),
        entitlementsByStoreProductId,
        promotionalEntitlements: promotionalGrants.map((grant) => ({
          entitlementIdentifier: grant.entitlement.identifier,
          expiresAtMs: grant.expiresAt ? grant.expiresAt.getTime() : null,
        })),
      },
      nowMs,
    );
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd backend/mobile_purchase && npx jest src/subscribers/services/customer-info-assembler.service.spec.ts --verbose`
Expected: PASS — 3 tests passed

- [ ] **Step 9: Write the failing Testcontainers test for the detail service**

Create `backend/mobile_purchase/src/customers/services/customer-detail.service.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../../generated/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { EntitlementMapService } from '../../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';
import { CustomerDetailService } from './customer-detail.service';

jest.setTimeout(180000);

describe('CustomerDetailService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: CustomerDetailService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new CustomerDetailService(
      prisma as never,
      new CustomerInfoAssemblerService(prisma as never, new EntitlementMapService(prisma as never)),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  beforeEach(() => {
    projectId = randomUUID();
  });

  it('404s when the customer does not exist in the project', async () => {
    await expect(service.getDetail(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('404s when the customer exists but belongs to a DIFFERENT project', async () => {
    const otherCustomer = await prisma.customer.create({ data: { projectId: randomUUID(), appUserId: 'not-mine' } });
    await expect(service.getDetail(projectId, otherCustomer.id)).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('returns the customer profile + empty customerInfo/subscriptions/transactions/promotionalEntitlements for a brand-new customer', async () => {
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'brand-new' } });

    const detail = await service.getDetail(projectId, customer.id);

    expect(detail.customer).toEqual({
      id: customer.id,
      appUserId: 'brand-new',
      appleAppAccountToken: null,
      googleObfuscatedId: null,
      attributes: null,
      createdAt: customer.createdAt,
      lastSeenAt: null,
    });
    expect(detail.customerInfo.entitlements.active).toEqual({});
    expect(detail.subscriptions).toEqual([]);
    expect(detail.transactions).toEqual([]);
    expect(detail.promotionalEntitlements).toEqual([]);
  });

  it('returns subscriptions and transactions most-recent-first', async () => {
    const app = await prisma.app.create({
      data: { projectId, name: 'iOS', platform: 'IOS', bundleId: `com.d.${randomUUID()}`, publicSdkKey: `mp_pub_test_${randomUUID()}` },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'history-user' } });
    const older = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'p1',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'EXPIRED',
        originalTransactionId: `orig-old-${randomUUID()}`,
        purchasedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const newer = await prisma.subscription.create({
      data: {
        projectId,
        customerId: customer.id,
        appId: app.id,
        storeProductId: 'p1',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        originalTransactionId: `orig-new-${randomUUID()}`,
        purchasedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });

    const detail = await service.getDetail(projectId, customer.id);
    expect(detail.subscriptions.map((s) => s.id)).toEqual([newer.id, older.id]);
  });

  it('includes promotional entitlements (active + revoked) and reflects an active grant in customerInfo', async () => {
    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'vip', displayName: 'VIP' },
    });
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'promo-user' } });
    const activeGrant = await prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: null,
        note: 'support goodwill',
      },
    });
    const revokedGrant = await prisma.promotionalEntitlement.create({
      data: {
        projectId,
        customerId: customer.id,
        entitlementId: entitlement.id,
        startsAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: new Date('2025-06-01T00:00:00.000Z'),
        revokedAt: new Date('2025-05-01T00:00:00.000Z'),
      },
    });

    const detail = await service.getDetail(projectId, customer.id);

    expect(detail.promotionalEntitlements.map((g) => g.id).sort()).toEqual([activeGrant.id, revokedGrant.id].sort());
    const activeRow = detail.promotionalEntitlements.find((g) => g.id === activeGrant.id);
    expect(activeRow).toMatchObject({ entitlementIdentifier: 'vip', expiresAt: null, revokedAt: null, note: 'support goodwill' });
    expect(detail.customerInfo.entitlements.active.vip).toMatchObject({ isActive: true, productIdentifier: 'promotional' });
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest src/customers/services/customer-detail.service.spec.ts --verbose`
Expected: FAIL — `Cannot find module './customer-detail.service' from 'src/customers/services/customer-detail.service.spec.ts'`

- [ ] **Step 11: Write the minimal implementation**

Create `backend/mobile_purchase/src/customers/services/customer-detail.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { CustomerInfoAssemblerService } from '../../subscribers/services/customer-info-assembler.service';

export interface PromotionalEntitlementRow {
  id: string;
  entitlementIdentifier: string;
  grantedAt: Date;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  note: string | null;
}

/**
 * Dashboard-facing customer DETAIL (design §1.3): the customer's PII-bearing profile fields, its
 * assembled `CustomerInfo` (via the shared assembler — entitlements incl. promotional, design
 * §1.2, project-wide resolution since a dashboard read has no single-App context), every
 * Subscription/Transaction row (most-recent first), and its full promotional-entitlement grant
 * history (active + revoked — the dashboard needs revoked grants too, to render history, not just
 * what is currently active).
 */
@Injectable()
export class CustomerDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assembler: CustomerInfoAssemblerService,
  ) {}

  async getDetail(projectId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId } });
    if (!customer) {
      throw new ProblemException({ status: 404, title: 'Customer not found' });
    }

    const [customerInfo, subscriptions, transactions, promotionalGrants] = await Promise.all([
      this.assembler.assemble({ projectId, customer }, Date.now()),
      this.prisma.subscription.findMany({ where: { projectId, customerId }, orderBy: { purchasedAt: 'desc' } }),
      this.prisma.transaction.findMany({ where: { projectId, customerId }, orderBy: { purchasedAt: 'desc' } }),
      this.prisma.promotionalEntitlement.findMany({
        where: { projectId, customerId },
        orderBy: { grantedAt: 'desc' },
        include: { entitlement: { select: { identifier: true } } },
      }),
    ]);

    const promotionalEntitlements: PromotionalEntitlementRow[] = promotionalGrants.map((grant) => ({
      id: grant.id,
      entitlementIdentifier: grant.entitlement.identifier,
      grantedAt: grant.grantedAt,
      startsAt: grant.startsAt,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      note: grant.note,
    }));

    return {
      customer: {
        id: customer.id,
        appUserId: customer.appUserId,
        appleAppAccountToken: customer.appleAppAccountToken,
        googleObfuscatedId: customer.googleObfuscatedId,
        attributes: customer.attributes,
        createdAt: customer.createdAt,
        lastSeenAt: customer.lastSeenAt,
      },
      customerInfo,
      subscriptions,
      transactions,
      promotionalEntitlements,
    };
  }
}
```

- [ ] **Step 12: Run it to verify it passes**

Run: `cd backend/mobile_purchase && npx jest src/customers/services/customer-detail.service.spec.ts --verbose`
Expected: PASS — 5 tests passed

- [ ] **Step 13: Write the failing e2e tests for the detail route**

Read `backend/mobile_purchase/test/e2e/customers.e2e-spec.ts` (current content, from B2.1), then insert three new `it` blocks immediately before the outer `describe`'s closing `});`. Replace this trailing fragment:

```ts
  it('GET /customers — 403 when the caller is not a project member', async () => {
    fakeAccess.role = null;
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .set('Authorization', 'Bearer stranger-token')
      .expect(403);
  });
});
```

with:

```ts
  it('GET /customers — 403 when the caller is not a project member', async () => {
    fakeAccess.role = null;
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers`)
      .set('Authorization', 'Bearer stranger-token')
      .expect(403);
  });

  it('GET /customers/:customerId — 200 as viewer, includes customer/customerInfo/subscriptions/transactions/promotionalEntitlements', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'detail-user' } });

    const res = await request(http)
      .get(`/api/v1/projects/${projectId}/customers/${customer.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(200);

    expect(res.body).toMatchObject({
      customer: { id: customer.id, appUserId: 'detail-user' },
      customerInfo: { entitlements: { active: {}, all: {} }, subscriptions: [] },
      subscriptions: [],
      transactions: [],
      promotionalEntitlements: [],
    });
  });

  it('GET /customers/:customerId — 403 when the caller is not a project member', async () => {
    fakeAccess.role = null;
    const projectId = randomUUID();
    const customer = await prisma.customer.create({ data: { projectId, appUserId: 'forbidden-user' } });
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers/${customer.id}`)
      .set('Authorization', 'Bearer stranger-token')
      .expect(403);
  });

  it('GET /customers/:customerId — 404 for an unknown customerId, and 404 for a customer in a different project', async () => {
    fakeAccess.role = 'viewer';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    await request(http)
      .get(`/api/v1/projects/${projectId}/customers/${randomUUID()}`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(404);

    const otherProjectCustomer = await prisma.customer.create({
      data: { projectId: randomUUID(), appUserId: 'someone-elses' },
    });
    await request(http)
      .get(`/api/v1/projects/${projectId}/customers/${otherProjectCustomer.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .expect(404);
  });
});
```

- [ ] **Step 14: Run it to verify it fails**

Run: `cd backend/mobile_purchase && npx jest test/e2e/customers.e2e-spec.ts --verbose`
Expected: FAIL — the new 200-case test's `.expect(200)` fails with `expected 200 "OK", got 404 "Not Found"` (the `:customerId` route is not mounted yet).

- [ ] **Step 15: Wire the detail route and module providers**

Replace `backend/mobile_purchase/src/customers/controllers/customers.controller.ts` entirely with:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectAccessGuard } from '../../authz/project-access.guard';
import { RequireProjectRole } from '../../authz/require-project-role.decorator';
import { parseOrThrow } from '../../common/zod';
import { customersListQuerySchema } from '../support/customers.schemas';
import { CustomersQueryService } from '../services/customers-query.service';
import { CustomerDetailService } from '../services/customer-detail.service';

@Controller('api/v1/projects/:projectId/customers')
@UseGuards(ProjectAccessGuard)
export class CustomersController {
  constructor(
    private readonly queryService: CustomersQueryService,
    private readonly detailService: CustomerDetailService,
  ) {}

  @Get()
  @RequireProjectRole('viewer')
  list(@Param('projectId') projectId: string, @Query() query: unknown) {
    return this.queryService.list(projectId, parseOrThrow(customersListQuerySchema, query));
  }

  @Get(':customerId')
  @RequireProjectRole('viewer')
  detail(@Param('projectId') projectId: string, @Param('customerId') customerId: string) {
    return this.detailService.getDetail(projectId, customerId);
  }
}
```

Replace `backend/mobile_purchase/src/customers/customers.module.ts` entirely with:

```ts
import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { CustomersService } from './services/customers.service';
import { CustomersQueryService } from './services/customers-query.service';
import { CustomerDetailService } from './services/customer-detail.service';
import { CustomersController } from './controllers/customers.controller';
import { EntitlementMapService } from '../subscribers/services/entitlement-map.service';
import { CustomerInfoAssemblerService } from '../subscribers/services/customer-info-assembler.service';

/**
 * M1: persistence (`CustomersService`, exported so M2/M3/M5 can resolve customers without
 * re-mounting this module). B2 (MyRevenueCat Customers design §1.3) additive: mounts the
 * dashboard-facing customers LIST + DETAIL reads, behind AuthzModule's ProjectAccessGuard +
 * @RequireProjectRole('viewer'). `EntitlementMapService`/`CustomerInfoAssemblerService` are
 * provided here as SECOND instances (not imported from SubscribersModule) to avoid a circular
 * module dependency — SubscribersModule already imports CustomersModule for CustomersService.
 * Both are stateless wrappers over the @Global() PrismaService, so a second registered instance
 * costs nothing.
 */
@Module({
  imports: [AuthzModule],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomersQueryService,
    CustomerDetailService,
    EntitlementMapService,
    CustomerInfoAssemblerService,
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
```

- [ ] **Step 16: Run the e2e test to verify it passes**

Run: `cd backend/mobile_purchase && npx jest test/e2e/customers.e2e-spec.ts --verbose`
Expected: PASS — 7 tests passed

- [ ] **Step 17: Typecheck the whole service**

Run: `cd backend/mobile_purchase && npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 18: Commit**

```bash
git add backend/mobile_purchase/src/subscribers/services/entitlement-map.service.ts \
        backend/mobile_purchase/src/subscribers/services/entitlement-map.service.spec.ts \
        backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.ts \
        backend/mobile_purchase/src/subscribers/services/customer-info-assembler.service.spec.ts \
        backend/mobile_purchase/src/customers/services/customer-detail.service.ts \
        backend/mobile_purchase/src/customers/services/customer-detail.service.spec.ts \
        backend/mobile_purchase/src/customers/controllers/customers.controller.ts \
        backend/mobile_purchase/src/customers/customers.module.ts \
        backend/mobile_purchase/test/e2e/customers.e2e-spec.ts
git commit -m "feat(mobile_purchase): customer detail endpoint (CustomerInfo + subs + transactions + promo grants)"
```


---

### Task B3.1: GRANT — POST /api/v1/projects/:projectId/customers/:customerId/promotional-entitlements

**Files**

- Create: `backend/mobile_purchase/src/customers/support/promotional-duration.ts`
- Create: `backend/mobile_purchase/src/customers/support/promotional-duration.spec.ts`
- Create: `backend/mobile_purchase/src/customers/support/promotional-entitlement.schemas.ts`
- Create: `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts`
- Test: `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts` (Testcontainers, direct service — created here, `describe('revoke', …)` appended by B3.2)
- Create: `backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts`
- Create: `backend/mobile_purchase/src/customers/customer-writes.module.ts`
- Modify: `backend/mobile_purchase/src/app.module.ts`
- Test: `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts` (Testcontainers + supertest — created here, appended by B3.2/B3.3)

**Interfaces**

Consumes (produced by B1 — migration + `prisma generate`, executed before this section per the design's §5 build order; **not** produced by this task):
- Prisma model `PromotionalEntitlement` on `PrismaService`/`PrismaClient` (`backend/mobile_purchase/generated/client`), accessor `prisma.promotionalEntitlement`, shape `{ id: string; projectId: string; customerId: string; entitlementId: string; grantedAt: Date; startsAt: Date; expiresAt: Date | null; revokedAt: Date | null; note: string | null }` (design §1.1).
- Pre-existing `prisma.customer` (`{ id, projectId, appUserId, … }`) and `prisma.entitlement` (`{ id, projectId, identifier, displayName, … }`) models — unchanged by B1.

Consumes (pre-existing shared infra, unrelated to B1/B2):
- `PrismaService` — `backend/mobile_purchase/src/prisma/prisma.service.ts`.
- `ProblemException`, `ProblemInit` — `backend/mobile_purchase/src/common/problem-details.ts`.
- `parseOrThrow<T>(schema, body)` — `backend/mobile_purchase/src/common/zod.ts`.
- `ProjectAccessGuard`, `RequireProjectRole(role)` — `backend/mobile_purchase/src/authz/{project-access.guard,require-project-role.decorator}.ts`.
- `AuthzModule` — `backend/mobile_purchase/src/authz/authz.module.ts`.
- `startPostgresContainer()` — `backend/mobile_purchase/test/integration/helpers/containers.ts`.

Produces (this section's own later tasks rely on these):
- `PROMOTIONAL_DURATIONS` (readonly tuple) and `type PromotionalDuration = (typeof PROMOTIONAL_DURATIONS)[number]`, `function computePromotionalExpiresAt(grantedAt: Date, duration: PromotionalDuration): Date | null` — `support/promotional-duration.ts`.
- `grantPromotionalEntitlementSchema` (Zod) — `support/promotional-entitlement.schemas.ts`.
- `class PromotionalEntitlementsService { grant(projectId: string, customerId: string, input: GrantPromotionalEntitlement): Promise<PromotionalEntitlementGrant> }` — B3.2 adds a `revoke(projectId: string, customerId: string, grantId: string): Promise<void>` method to this same class/file.
- `class PromotionalEntitlementsController` mounted at `api/v1/projects/:projectId/customers/:customerId/promotional-entitlements` — B3.2 adds a `DELETE :grantId` handler to this same class/file.
- `class CustomerWritesModule` (`customer-writes.module.ts`) — B3.3 adds `CustomerDeletionController` + `CustomerDeletionService` to its `controllers`/`providers` arrays.
- `test/e2e/customer-writes.e2e-spec.ts` — the shared e2e file; B3.2 and B3.3 each append one more `it(...)` inside the existing `describe(...)` block, reusing the `seedCustomerAndEntitlement` helper defined here.

---

- [ ] **Step 1: Write the failing pure-function unit test for the duration helper**

  Create `backend/mobile_purchase/src/customers/support/promotional-duration.spec.ts`:

  ```ts
  import { computePromotionalExpiresAt } from './promotional-duration';

  describe('computePromotionalExpiresAt', () => {
    const grantedAt = new Date('2026-07-20T12:00:00.000Z');

    it('daily -> +1 UTC day', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'daily')).toEqual(new Date('2026-07-21T12:00:00.000Z'));
    });

    it('three_day -> +3 UTC days', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'three_day')).toEqual(new Date('2026-07-23T12:00:00.000Z'));
    });

    it('weekly -> +7 UTC days', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'weekly')).toEqual(new Date('2026-07-27T12:00:00.000Z'));
    });

    it('monthly -> +1 UTC calendar month', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'monthly')).toEqual(new Date('2026-08-20T12:00:00.000Z'));
    });

    it('two_month -> +2 UTC calendar months', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'two_month')).toEqual(new Date('2026-09-20T12:00:00.000Z'));
    });

    it('three_month -> +3 UTC calendar months', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'three_month')).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    });

    it('six_month -> +6 UTC calendar months', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'six_month')).toEqual(new Date('2027-01-20T12:00:00.000Z'));
    });

    it('yearly -> +1 UTC calendar year', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'yearly')).toEqual(new Date('2027-07-20T12:00:00.000Z'));
    });

    it('lifetime -> null (never expires)', () => {
      expect(computePromotionalExpiresAt(grantedAt, 'lifetime')).toBeNull();
    });

    it('monthly from a month-end date rolls forward across a shorter next month (plain calendar-month arithmetic, no clamping)', () => {
      const jan31 = new Date('2026-01-31T00:00:00.000Z');
      // 2026 is not a leap year: Feb has 28 days, so day 31 overflows to Mar 3.
      expect(computePromotionalExpiresAt(jan31, 'monthly')).toEqual(new Date('2026-03-03T00:00:00.000Z'));
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/support/promotional-duration.spec.ts
  ```
  Expected failure: ts-jest fails to compile — `Cannot find module './promotional-duration' from 'src/customers/support/promotional-duration.spec.ts'`.

- [ ] **Step 2: Implement the duration helper — minimal impl to pass**

  Create `backend/mobile_purchase/src/customers/support/promotional-duration.ts`:

  ```ts
  /**
   * Promotional-entitlement grant durations (design §1.1). `lifetime` has no expiry; every other
   * duration computes `expiresAt` from `grantedAt` via UTC date math: `daily`/`three_day`/`weekly`
   * add whole UTC days, `monthly`/`two_month`/`three_month`/`six_month`/`yearly` add whole UTC
   * calendar months (JS `Date.UTC` month-overflow rolls forward, e.g. Jan 31 + 1 month -> Mar 3 —
   * plain calendar-month arithmetic, no end-of-month clamping).
   */
  export const PROMOTIONAL_DURATIONS = [
    'daily',
    'three_day',
    'weekly',
    'monthly',
    'two_month',
    'three_month',
    'six_month',
    'yearly',
    'lifetime',
  ] as const;

  export type PromotionalDuration = (typeof PROMOTIONAL_DURATIONS)[number];

  /** Pure function: computes a promotional grant's `expiresAt` from `grantedAt` + `duration`,
   * using UTC date math. `lifetime` -> `null` (never expires). */
  export function computePromotionalExpiresAt(grantedAt: Date, duration: PromotionalDuration): Date | null {
    switch (duration) {
      case 'daily':
        return addUtcDays(grantedAt, 1);
      case 'three_day':
        return addUtcDays(grantedAt, 3);
      case 'weekly':
        return addUtcDays(grantedAt, 7);
      case 'monthly':
        return addUtcMonths(grantedAt, 1);
      case 'two_month':
        return addUtcMonths(grantedAt, 2);
      case 'three_month':
        return addUtcMonths(grantedAt, 3);
      case 'six_month':
        return addUtcMonths(grantedAt, 6);
      case 'yearly':
        return addUtcMonths(grantedAt, 12);
      case 'lifetime':
        return null;
      default: {
        const exhaustive: never = duration;
        throw new Error(`Unhandled promotional duration: ${exhaustive as string}`);
      }
    }
  }

  function addUtcDays(date: Date, days: number): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() + days,
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );
  }

  function addUtcMonths(date: Date, months: number): Date {
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + months,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
      ),
    );
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/support/promotional-duration.spec.ts
  ```
  Expected: `PASS src/customers/support/promotional-duration.spec.ts` — 10 passed.

- [ ] **Step 3: Write the failing Testcontainers unit test for `PromotionalEntitlementsService.grant`**

  Create `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts`:

  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { PromotionalEntitlementsService } from './promotional-entitlements.service';

  jest.setTimeout(180000);

  describe('PromotionalEntitlementsService', () => {
    let container: StartedPostgreSqlContainer;
    let prisma: PrismaClient;
    let service: PromotionalEntitlementsService;
    let projectId: string;

    beforeAll(async () => {
      const started = await startPostgresContainer();
      container = started.container;
      prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
      service = new PromotionalEntitlementsService(prisma as never);
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await container.stop();
    });

    beforeEach(() => {
      projectId = randomUUID();
    });

    async function seedCustomerAndEntitlement() {
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `u-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'pro', displayName: 'Pro' },
      });
      return { customer, entitlement };
    }

    describe('grant', () => {
      it('creates a lifetime grant with expiresAt null', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();

        const grant = await service.grant(projectId, customer.id, {
          entitlementId: entitlement.id,
          duration: 'lifetime',
        });

        expect(grant).toMatchObject({
          entitlementIdentifier: 'pro',
          expiresAt: null,
          revokedAt: null,
          note: null,
        });
        const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
        expect(persisted).toMatchObject({ projectId, customerId: customer.id, entitlementId: entitlement.id });
      });

      it('creates a monthly grant with expiresAt after grantedAt, and persists the note', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();

        const grant = await service.grant(projectId, customer.id, {
          entitlementId: entitlement.id,
          duration: 'monthly',
          note: 'goodwill credit',
        });

        expect(grant.expiresAt).not.toBeNull();
        expect((grant.expiresAt as Date).getTime()).toBeGreaterThan(grant.grantedAt.getTime());
        expect(grant.note).toBe('goodwill credit');

        const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
        expect(persisted?.note).toBe('goodwill credit');
      });

      it('404s when the customer does not belong to the project', async () => {
        const { entitlement } = await seedCustomerAndEntitlement();
        const otherProjectCustomer = await prisma.customer.create({
          data: { projectId: randomUUID(), appUserId: `u-${randomUUID()}` },
        });

        await expect(
          service.grant(projectId, otherProjectCustomer.id, { entitlementId: entitlement.id, duration: 'daily' }),
        ).rejects.toMatchObject({ problem: { status: 404, title: 'Customer not found' } });
      });

      it('404s when the entitlement does not belong to the project', async () => {
        const { customer } = await seedCustomerAndEntitlement();
        const otherProjectEntitlement = await prisma.entitlement.create({
          data: { projectId: randomUUID(), identifier: 'foreign', displayName: 'Foreign' },
        });

        await expect(
          service.grant(projectId, customer.id, { entitlementId: otherProjectEntitlement.id, duration: 'daily' }),
        ).rejects.toMatchObject({ problem: { status: 404, title: 'Entitlement not found' } });
      });
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/promotional-entitlements.service.spec.ts
  ```
  Expected failure: `Cannot find module './promotional-entitlements.service' from 'src/customers/services/promotional-entitlements.service.spec.ts'`.

- [ ] **Step 4: Implement the Zod schema + `PromotionalEntitlementsService.grant` — minimal impl to pass**

  Create `backend/mobile_purchase/src/customers/support/promotional-entitlement.schemas.ts`:

  ```ts
  import { z } from 'zod';
  import { PROMOTIONAL_DURATIONS } from './promotional-duration';

  export const grantPromotionalEntitlementSchema = z.object({
    entitlementId: z.string().uuid(),
    duration: z.enum(PROMOTIONAL_DURATIONS),
    note: z.string().min(1).max(2000).optional(),
  });
  ```

  Create `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts`:

  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import { computePromotionalExpiresAt } from '../support/promotional-duration';
  import type { grantPromotionalEntitlementSchema } from '../support/promotional-entitlement.schemas';

  type GrantPromotionalEntitlement = z.infer<typeof grantPromotionalEntitlementSchema>;

  export interface PromotionalEntitlementGrant {
    id: string;
    entitlementIdentifier: string;
    grantedAt: Date;
    startsAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    note: string | null;
  }

  /**
   * Promotional-entitlement grant/revoke writes (design §1.4). `grant` validates the customer AND
   * the entitlement both belong to `projectId` (404 otherwise, ownership-404 pattern), computes
   * `expiresAt` from `duration` via the pure `promotional-duration` helper, and creates the grant.
   */
  @Injectable()
  export class PromotionalEntitlementsService {
    constructor(private readonly prisma: PrismaService) {}

    async grant(
      projectId: string,
      customerId: string,
      input: GrantPromotionalEntitlement,
    ): Promise<PromotionalEntitlementGrant> {
      const [customer, entitlement] = await Promise.all([
        this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } }),
        this.prisma.entitlement.findFirst({
          where: { id: input.entitlementId, projectId },
          select: { id: true, identifier: true },
        }),
      ]);
      if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });
      if (!entitlement) throw new ProblemException({ status: 404, title: 'Entitlement not found' });

      const grantedAt = new Date();
      const expiresAt = computePromotionalExpiresAt(grantedAt, input.duration);

      const grant = await this.prisma.promotionalEntitlement.create({
        data: {
          projectId,
          customerId,
          entitlementId: entitlement.id,
          grantedAt,
          startsAt: grantedAt,
          expiresAt,
          note: input.note ?? null,
        },
      });

      return {
        id: grant.id,
        entitlementIdentifier: entitlement.identifier,
        grantedAt: grant.grantedAt,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
        note: grant.note,
      };
    }
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/promotional-entitlements.service.spec.ts
  ```
  Expected: `PASS src/customers/services/promotional-entitlements.service.spec.ts` — 4 passed.

- [ ] **Step 5: Write the failing e2e test for the HTTP route**

  Create `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts`:

  ```ts
  import { randomUUID } from 'node:crypto';
  import type { INestApplication } from '@nestjs/common';
  import { Test } from '@nestjs/testing';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import request from 'supertest';
  import { AppModule } from '../../src/app.module';
  import { ProjectAccessService, type ProjectRole } from '../../src/authz/project-access.service';
  import { PrismaService } from '../../src/prisma/prisma.service';
  import { startPostgresContainer } from '../integration/helpers/containers';

  jest.setTimeout(180000);

  /** Stands in for the real ProjectAccessService — see catalog.e2e-spec.ts. */
  class FakeProjectAccessService {
    role: ProjectRole | null = 'admin';
    async getProjectRole(_projectId: string, _authHeader: string | undefined): Promise<ProjectRole | null> {
      return this.role;
    }
  }

  describe('Customer write endpoints e2e — promotional entitlements + delete customer', () => {
    let container: StartedPostgreSqlContainer;
    let app: INestApplication;
    let prisma: PrismaService;
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

      prisma = app.get(PrismaService);
      fakeAccess = app.get(ProjectAccessService) as unknown as FakeProjectAccessService;
    });

    afterAll(async () => {
      await app.close();
      await container.stop();
    });

    async function seedCustomerAndEntitlement(projectId: string) {
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `e2e-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({
        data: { projectId, identifier: 'pro', displayName: 'Pro' },
      });
      return { customer, entitlement };
    }

    it('POST .../promotional-entitlements — 201 as admin (persists + returns entitlementIdentifier/expiresAt), 403 as viewer, 404 for a cross-project customer, 404 for a cross-project entitlement', async () => {
      fakeAccess.role = 'admin';
      const projectId = randomUUID();
      const http = app.getHttpServer();
      const { customer, entitlement } = await seedCustomerAndEntitlement(projectId);

      const res = await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
        .set('Authorization', 'Bearer admin-token')
        .send({ entitlementId: entitlement.id, duration: 'monthly', note: 'support goodwill' })
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        entitlementIdentifier: 'pro',
        revokedAt: null,
        note: 'support goodwill',
      });
      expect(res.body.expiresAt).not.toBeNull();

      const persisted = await prisma.promotionalEntitlement.findUnique({ where: { id: res.body.id } });
      expect(persisted).toMatchObject({ projectId, customerId: customer.id, entitlementId: entitlement.id });

      fakeAccess.role = 'viewer';
      await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
        .set('Authorization', 'Bearer viewer-token')
        .send({ entitlementId: entitlement.id, duration: 'daily' })
        .expect(403);

      fakeAccess.role = 'admin';
      await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${randomUUID()}/promotional-entitlements`)
        .set('Authorization', 'Bearer admin-token')
        .send({ entitlementId: entitlement.id, duration: 'daily' })
        .expect(404);

      await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
        .set('Authorization', 'Bearer admin-token')
        .send({ entitlementId: randomUUID(), duration: 'daily' })
        .expect(404);
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected failure: the first assertion fails — `Error: expected 201 "Created", got 404 "Not Found"` (no controller is mounted for this route yet).

- [ ] **Step 6: Wire the controller + module — minimal impl to pass**

  Create `backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts`:

  ```ts
  import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { grantPromotionalEntitlementSchema } from '../support/promotional-entitlement.schemas';
  import { PromotionalEntitlementsService } from '../services/promotional-entitlements.service';

  @Controller('api/v1/projects/:projectId/customers/:customerId/promotional-entitlements')
  @UseGuards(ProjectAccessGuard)
  export class PromotionalEntitlementsController {
    constructor(private readonly service: PromotionalEntitlementsService) {}

    @Post()
    @RequireProjectRole('admin')
    grant(
      @Param('projectId') projectId: string,
      @Param('customerId') customerId: string,
      @Body() body: unknown,
    ) {
      return this.service.grant(projectId, customerId, parseOrThrow(grantPromotionalEntitlementSchema, body));
    }
  }
  ```

  Create `backend/mobile_purchase/src/customers/customer-writes.module.ts`:

  ```ts
  import { Module } from '@nestjs/common';
  import { AuthzModule } from '../authz/authz.module';
  import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
  import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';

  /**
   * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
   * (this task) and customer deletion (`CustomerDeletionController`/`CustomerDeletionService`,
   * added by B3.3 to this same module). Deliberately separate from `CustomersModule` (M1 ingest
   * persistence) and the read-side customers controller (B2) — no route collision, since every
   * controller here owns a distinct HTTP method + path under
   * `api/v1/projects/:projectId/customers`.
   */
  @Module({
    imports: [AuthzModule],
    controllers: [PromotionalEntitlementsController],
    providers: [PromotionalEntitlementsService],
  })
  export class CustomerWritesModule {}
  ```

  Modify `backend/mobile_purchase/src/app.module.ts` — register the new module:

  old:
  ```ts
  import { CustomersModule } from './customers/customers.module';
  import { SubscribersModule } from './subscribers/subscribers.module';
  ```
  new:
  ```ts
  import { CustomersModule } from './customers/customers.module';
  import { CustomerWritesModule } from './customers/customer-writes.module';
  import { SubscribersModule } from './subscribers/subscribers.module';
  ```

  old:
  ```ts
      CatalogModule,
      CustomersModule,
      SubscribersModule,
  ```
  new:
  ```ts
      CatalogModule,
      CustomersModule,
      CustomerWritesModule,
      SubscribersModule,
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected: `PASS test/e2e/customer-writes.e2e-spec.ts` — 1 passed.

- [ ] **Step 7: Typecheck, then commit**

  Run:
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  ```bash
  git add backend/mobile_purchase/src/customers/support/promotional-duration.ts backend/mobile_purchase/src/customers/support/promotional-duration.spec.ts backend/mobile_purchase/src/customers/support/promotional-entitlement.schemas.ts backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts backend/mobile_purchase/src/customers/customer-writes.module.ts backend/mobile_purchase/src/app.module.ts backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts
  git commit -m "feat(mobile_purchase): grant promotional entitlement endpoint"
  ```

---

### Task B3.2: REVOKE — DELETE /api/v1/projects/:projectId/customers/:customerId/promotional-entitlements/:grantId

**Files**

- Modify: `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts`
- Modify: `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts`
- Modify: `backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts`
- Modify: `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts`

**Interfaces**

Consumes:
- `PromotionalEntitlementsService` class and `prisma.promotionalEntitlement` model (both from B3.1).
- `ProblemException` — `backend/mobile_purchase/src/common/problem-details.ts`.

Produces:
- `PromotionalEntitlementsService.revoke(projectId: string, customerId: string, grantId: string): Promise<void>` — used only by this task's controller handler; no later B3 task depends on it.

---

- [ ] **Step 1: Write the failing Testcontainers unit tests for `revoke`**

  In `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts`, add a `describe('revoke', …)` block as a sibling of `describe('grant', …)` (inside the outer `describe('PromotionalEntitlementsService', …)`, after the `grant` block closes):

  old:
  ```ts
        await expect(
          service.grant(projectId, customer.id, { entitlementId: otherProjectEntitlement.id, duration: 'daily' }),
        ).rejects.toMatchObject({ problem: { status: 404, title: 'Entitlement not found' } });
      });
    });
  });
  ```
  new:
  ```ts
        await expect(
          service.grant(projectId, customer.id, { entitlementId: otherProjectEntitlement.id, duration: 'daily' }),
        ).rejects.toMatchObject({ problem: { status: 404, title: 'Entitlement not found' } });
      });
    });

    describe('revoke', () => {
      it('sets revokedAt', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();
        const grant = await service.grant(projectId, customer.id, { entitlementId: entitlement.id, duration: 'lifetime' });

        await service.revoke(projectId, customer.id, grant.id);

        const revoked = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
        expect(revoked?.revokedAt).not.toBeNull();
      });

      it('is idempotent — revoking an already-revoked grant does not throw or change revokedAt', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();
        const grant = await service.grant(projectId, customer.id, { entitlementId: entitlement.id, duration: 'lifetime' });
        await service.revoke(projectId, customer.id, grant.id);
        const firstRevokedAt = (await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } }))?.revokedAt;

        await service.revoke(projectId, customer.id, grant.id);

        const secondRevokedAt = (await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } }))?.revokedAt;
        expect(secondRevokedAt).toEqual(firstRevokedAt);
      });

      it('404s when the grant does not belong to the given customer', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();
        const grant = await service.grant(projectId, customer.id, { entitlementId: entitlement.id, duration: 'lifetime' });
        const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });

        await expect(service.revoke(projectId, otherCustomer.id, grant.id)).rejects.toMatchObject({
          problem: { status: 404, title: 'Promotional entitlement grant not found' },
        });
      });

      it('404s when the customer does not belong to the project', async () => {
        const { customer, entitlement } = await seedCustomerAndEntitlement();
        const grant = await service.grant(projectId, customer.id, { entitlementId: entitlement.id, duration: 'lifetime' });
        const otherProjectId = randomUUID();

        await expect(service.revoke(otherProjectId, customer.id, grant.id)).rejects.toMatchObject({
          problem: { status: 404, title: 'Customer not found' },
        });
      });
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/promotional-entitlements.service.spec.ts
  ```
  Expected failure: `TypeError: service.revoke is not a function`.

- [ ] **Step 2: Implement `revoke` — minimal impl to pass**

  In `backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts`, add the method to the existing class:

  old:
  ```ts
      return {
        id: grant.id,
        entitlementIdentifier: entitlement.identifier,
        grantedAt: grant.grantedAt,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
        note: grant.note,
      };
    }
  }
  ```
  new:
  ```ts
      return {
        id: grant.id,
        entitlementIdentifier: entitlement.identifier,
        grantedAt: grant.grantedAt,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
        revokedAt: grant.revokedAt,
        note: grant.note,
      };
    }

    /**
     * Revokes a promotional grant (design §1.4). Double-scoped: the customer must belong to
     * `projectId`, and the grant must belong to that customer — either mismatch 404s. Idempotent:
     * revoking an already-revoked grant is a silent no-op (no second `revokedAt` write).
     */
    async revoke(projectId: string, customerId: string, grantId: string): Promise<void> {
      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } });
      if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });

      const grant = await this.prisma.promotionalEntitlement.findFirst({
        where: { id: grantId, customerId },
        select: { id: true, revokedAt: true },
      });
      if (!grant) throw new ProblemException({ status: 404, title: 'Promotional entitlement grant not found' });
      if (grant.revokedAt) return;

      await this.prisma.promotionalEntitlement.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
    }
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/promotional-entitlements.service.spec.ts
  ```
  Expected: `PASS src/customers/services/promotional-entitlements.service.spec.ts` — 8 passed.

- [ ] **Step 3: Write the failing e2e test for the HTTP route**

  In `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts`, append a new `it(...)` inside the existing `describe(...)` block, after the grant test:

  old:
  ```ts
      await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
        .set('Authorization', 'Bearer admin-token')
        .send({ entitlementId: randomUUID(), duration: 'daily' })
        .expect(404);
    });
  });
  ```
  new:
  ```ts
      await request(http)
        .post(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements`)
        .set('Authorization', 'Bearer admin-token')
        .send({ entitlementId: randomUUID(), duration: 'daily' })
        .expect(404);
    });

    it('DELETE .../promotional-entitlements/:grantId — 204 as admin (revokes, idempotent on repeat), 403 as viewer, 404 for a grant scoped to a different customer', async () => {
      fakeAccess.role = 'admin';
      const projectId = randomUUID();
      const http = app.getHttpServer();
      const { customer, entitlement } = await seedCustomerAndEntitlement(projectId);
      const grant = await prisma.promotionalEntitlement.create({
        data: { projectId, customerId: customer.id, entitlementId: entitlement.id, expiresAt: null },
      });

      fakeAccess.role = 'viewer';
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(403);

      fakeAccess.role = 'admin';
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(204);

      const revoked = await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } });
      expect(revoked?.revokedAt).not.toBeNull();

      // idempotent: revoking an already-revoked grant is still a no-op 204
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${customer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(204);

      const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${otherCustomer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(404);
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected failure: the 403 assertion fails — `Error: expected 403 "Forbidden", got 404 "Not Found"` (no `DELETE :grantId` route mounted yet).

- [ ] **Step 4: Wire the controller route — minimal impl to pass**

  In `backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts`:

  old:
  ```ts
  import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
  ```
  new:
  ```ts
  import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
  ```

  old:
  ```ts
      grant(
        @Param('projectId') projectId: string,
        @Param('customerId') customerId: string,
        @Body() body: unknown,
      ) {
        return this.service.grant(projectId, customerId, parseOrThrow(grantPromotionalEntitlementSchema, body));
      }
  }
  ```
  new:
  ```ts
      grant(
        @Param('projectId') projectId: string,
        @Param('customerId') customerId: string,
        @Body() body: unknown,
      ) {
        return this.service.grant(projectId, customerId, parseOrThrow(grantPromotionalEntitlementSchema, body));
      }

      @Delete(':grantId')
      @HttpCode(204)
      @RequireProjectRole('admin')
      revoke(
        @Param('projectId') projectId: string,
        @Param('customerId') customerId: string,
        @Param('grantId') grantId: string,
      ) {
        return this.service.revoke(projectId, customerId, grantId);
      }
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected: `PASS test/e2e/customer-writes.e2e-spec.ts` — 2 passed.

- [ ] **Step 5: Typecheck, then commit**

  Run:
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  ```bash
  git add backend/mobile_purchase/src/customers/services/promotional-entitlements.service.ts backend/mobile_purchase/src/customers/services/promotional-entitlements.service.spec.ts backend/mobile_purchase/src/customers/controllers/promotional-entitlements.controller.ts backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts
  git commit -m "feat(mobile_purchase): revoke promotional entitlement endpoint"
  ```

---

### Task B3.3: DELETE CUSTOMER — DELETE /api/v1/projects/:projectId/customers/:customerId

**Files**

- Create: `backend/mobile_purchase/src/customers/services/customer-deletion.service.ts`
- Create: `backend/mobile_purchase/src/customers/services/customer-deletion.service.spec.ts` (Testcontainers, direct service)
- Create: `backend/mobile_purchase/src/customers/controllers/customer-deletion.controller.ts`
- Modify: `backend/mobile_purchase/src/customers/customer-writes.module.ts`
- Modify: `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts`

**Interfaces**

Consumes (produced by B1, per design §1.1/§0; not produced by this task):
- `PromotionalEntitlement.customerId -> Customer` relation with `onDelete: Cascade`.

Consumes (pre-existing schema, unchanged by B1/B2/B3 — `backend/mobile_purchase/prisma/schema.prisma`):
- `Subscription.customer -> Customer` relation with `onDelete: Cascade`.
- `Transaction.customer -> Customer` relation with `onDelete: SetNull` (`Transaction.customerId` is nullable).
- `CustomerWritesModule`, `AuthzModule`, `PrismaService`, `ProblemException`, `ProjectAccessGuard`, `RequireProjectRole` (all from B3.1/pre-existing infra).

Produces: nothing further — this is the last task in the section.

---

- [ ] **Step 1: Write the failing Testcontainers unit tests for `CustomerDeletionService`**

  Create `backend/mobile_purchase/src/customers/services/customer-deletion.service.spec.ts`:

  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { CustomerDeletionService } from './customer-deletion.service';

  jest.setTimeout(180000);

  describe('CustomerDeletionService', () => {
    let container: StartedPostgreSqlContainer;
    let prisma: PrismaClient;
    let service: CustomerDeletionService;
    let projectId: string;

    beforeAll(async () => {
      const started = await startPostgresContainer();
      container = started.container;
      prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
      service = new CustomerDeletionService(prisma as never);
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await container.stop();
    });

    beforeEach(() => {
      projectId = randomUUID();
    });

    it('deletes the customer, cascades subscriptions + promotional entitlements, and preserves transactions with customerId set to NULL', async () => {
      const app = await prisma.app.create({
        data: {
          projectId,
          name: 'iOS',
          platform: 'IOS',
          bundleId: `com.del.${randomUUID()}`,
          publicSdkKey: `mp_pub_${randomUUID()}`,
        },
      });
      const customer = await prisma.customer.create({ data: { projectId, appUserId: `del-${randomUUID()}` } });
      const entitlement = await prisma.entitlement.create({ data: { projectId, identifier: 'pro', displayName: 'Pro' } });

      const subscription = await prisma.subscription.create({
        data: {
          projectId,
          customerId: customer.id,
          appId: app.id,
          storeProductId: 'sub.monthly',
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          status: 'ACTIVE',
          originalTransactionId: `orig-${randomUUID()}`,
          purchasedAt: new Date(),
        },
      });
      const grant = await prisma.promotionalEntitlement.create({
        data: { projectId, customerId: customer.id, entitlementId: entitlement.id, expiresAt: null },
      });
      const transaction = await prisma.transaction.create({
        data: {
          projectId,
          customerId: customer.id,
          appId: app.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `txn-${randomUUID()}`,
          storeProductId: 'sub.monthly',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date(),
          rawPayload: {},
        },
      });

      await service.remove(projectId, customer.id);

      expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();
      expect(await prisma.subscription.findUnique({ where: { id: subscription.id } })).toBeNull();
      expect(await prisma.promotionalEntitlement.findUnique({ where: { id: grant.id } })).toBeNull();

      const survivingTransaction = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(survivingTransaction).not.toBeNull();
      expect(survivingTransaction?.customerId).toBeNull();
    });

    it('404s deleting a non-existent or cross-tenant customer', async () => {
      await expect(service.remove(projectId, randomUUID())).rejects.toMatchObject({ problem: { status: 404 } });

      const otherProjectId = randomUUID();
      const foreignCustomer = await prisma.customer.create({
        data: { projectId: otherProjectId, appUserId: `foreign-${randomUUID()}` },
      });
      await expect(service.remove(projectId, foreignCustomer.id)).rejects.toMatchObject({ problem: { status: 404 } });
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/customer-deletion.service.spec.ts
  ```
  Expected failure: `Cannot find module './customer-deletion.service' from 'src/customers/services/customer-deletion.service.spec.ts'`.

- [ ] **Step 2: Implement `CustomerDeletionService` — minimal impl to pass**

  Create `backend/mobile_purchase/src/customers/services/customer-deletion.service.ts`:

  ```ts
  import { Injectable } from '@nestjs/common';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';

  /**
   * Deletes a Customer (design §1.4). `prisma.customer.delete` cascades onto `Subscription` and
   * `PromotionalEntitlement` (both `onDelete: Cascade`); `Transaction` rows are preserved with
   * `customerId` set to NULL (`onDelete: SetNull`) — the revenue ledger survives, anonymized of
   * the customer's PII (appUserId, store tokens, attributes).
   */
  @Injectable()
  export class CustomerDeletionService {
    constructor(private readonly prisma: PrismaService) {}

    async remove(projectId: string, customerId: string): Promise<void> {
      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, projectId }, select: { id: true } });
      if (!customer) throw new ProblemException({ status: 404, title: 'Customer not found' });
      await this.prisma.customer.delete({ where: { id: customerId } });
    }
  }
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/customers/services/customer-deletion.service.spec.ts
  ```
  Expected: `PASS src/customers/services/customer-deletion.service.spec.ts` — 2 passed.

- [ ] **Step 3: Write the failing e2e test for the HTTP route**

  In `backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts`, append a new `it(...)` inside the existing `describe(...)` block, after the revoke test:

  old:
  ```ts
      const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${otherCustomer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(404);
    });
  });
  ```
  new:
  ```ts
      const otherCustomer = await prisma.customer.create({ data: { projectId, appUserId: `other-${randomUUID()}` } });
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${otherCustomer.id}/promotional-entitlements/${grant.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(404);
    });

    it('DELETE /customers/:customerId — 204 as admin (removes the customer, keeps transactions with customerId NULL), 403 as viewer, 404 for unknown id', async () => {
      fakeAccess.role = 'admin';
      const projectId = randomUUID();
      const http = app.getHttpServer();
      const { customer } = await seedCustomerAndEntitlement(projectId);
      const sdkApp = await prisma.app.create({
        data: {
          projectId,
          name: 'iOS',
          platform: 'IOS',
          bundleId: `com.del.e2e.${randomUUID()}`,
          publicSdkKey: `mp_pub_${randomUUID()}`,
        },
      });
      const transaction = await prisma.transaction.create({
        data: {
          projectId,
          customerId: customer.id,
          appId: sdkApp.id,
          store: 'APP_STORE',
          environment: 'PRODUCTION',
          storeTransactionId: `txn-e2e-${randomUUID()}`,
          storeProductId: 'sub.monthly',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          purchasedAt: new Date(),
          rawPayload: {},
        },
      });

      fakeAccess.role = 'viewer';
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${customer.id}`)
        .set('Authorization', 'Bearer viewer-token')
        .expect(403);

      fakeAccess.role = 'admin';
      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${customer.id}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(204);

      expect(await prisma.customer.findUnique({ where: { id: customer.id } })).toBeNull();
      const survivingTransaction = await prisma.transaction.findUnique({ where: { id: transaction.id } });
      expect(survivingTransaction?.customerId).toBeNull();

      await request(http)
        .delete(`/api/v1/projects/${projectId}/customers/${randomUUID()}`)
        .set('Authorization', 'Bearer admin-token')
        .expect(404);
    });
  });
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected failure: the 403 assertion fails — `Error: expected 403 "Forbidden", got 404 "Not Found"` (no `CustomerDeletionController` mounted yet).

- [ ] **Step 4: Wire the controller + module — minimal impl to pass**

  Create `backend/mobile_purchase/src/customers/controllers/customer-deletion.controller.ts`:

  ```ts
  import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { CustomerDeletionService } from '../services/customer-deletion.service';

  @Controller('api/v1/projects/:projectId/customers')
  @UseGuards(ProjectAccessGuard)
  export class CustomerDeletionController {
    constructor(private readonly service: CustomerDeletionService) {}

    @Delete(':customerId')
    @HttpCode(204)
    @RequireProjectRole('admin')
    remove(@Param('projectId') projectId: string, @Param('customerId') customerId: string) {
      return this.service.remove(projectId, customerId);
    }
  }
  ```

  Modify `backend/mobile_purchase/src/customers/customer-writes.module.ts`:

  old:
  ```ts
  import { Module } from '@nestjs/common';
  import { AuthzModule } from '../authz/authz.module';
  import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
  import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';

  /**
   * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
   * (this task) and customer deletion (`CustomerDeletionController`/`CustomerDeletionService`,
   * added by B3.3 to this same module). Deliberately separate from `CustomersModule` (M1 ingest
   * persistence) and the read-side customers controller (B2) — no route collision, since every
   * controller here owns a distinct HTTP method + path under
   * `api/v1/projects/:projectId/customers`.
   */
  @Module({
    imports: [AuthzModule],
    controllers: [PromotionalEntitlementsController],
    providers: [PromotionalEntitlementsService],
  })
  export class CustomerWritesModule {}
  ```
  new:
  ```ts
  import { Module } from '@nestjs/common';
  import { AuthzModule } from '../authz/authz.module';
  import { PromotionalEntitlementsController } from './controllers/promotional-entitlements.controller';
  import { CustomerDeletionController } from './controllers/customer-deletion.controller';
  import { PromotionalEntitlementsService } from './services/promotional-entitlements.service';
  import { CustomerDeletionService } from './services/customer-deletion.service';

  /**
   * Dashboard-facing customer WRITE endpoints (design §1.4): promotional-entitlement grant/revoke
   * (B3.1/B3.2) and customer deletion (this task). Deliberately separate from `CustomersModule`
   * (M1 ingest persistence) and the read-side customers controller (B2) — no route collision,
   * since every controller here owns a distinct HTTP method + path under
   * `api/v1/projects/:projectId/customers`.
   */
  @Module({
    imports: [AuthzModule],
    controllers: [PromotionalEntitlementsController, CustomerDeletionController],
    providers: [PromotionalEntitlementsService, CustomerDeletionService],
  })
  export class CustomerWritesModule {}
  ```

  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/customer-writes.e2e-spec.ts
  ```
  Expected: `PASS test/e2e/customer-writes.e2e-spec.ts` — 3 passed.

- [ ] **Step 5: Typecheck, then commit**

  Run:
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

  ```bash
  git add backend/mobile_purchase/src/customers/services/customer-deletion.service.ts backend/mobile_purchase/src/customers/services/customer-deletion.service.spec.ts backend/mobile_purchase/src/customers/controllers/customer-deletion.controller.ts backend/mobile_purchase/src/customers/customer-writes.module.ts backend/mobile_purchase/test/e2e/customer-writes.e2e-spec.ts
  git commit -m "feat(mobile_purchase): delete customer endpoint (cascades subscriptions + promo grants, preserves transaction ledger)"
  ```


---

### Task B4.1: Dashboard `customers-api.ts` hooks over `purchaseApiFetch`

**Files**
- Create: `dashboard/src/features/revenuecat/customers-api.ts`
- Create: `dashboard/src/features/revenuecat/customers-api.test.ts`
- Test: `dashboard/src/features/revenuecat/customers-api.test.ts` (`npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic`, run from `dashboard/`)

**Interfaces**

*Consumes:*
- `purchaseApiFetch<T>(path, options?)` — `dashboard/src/lib/api/purchase-client.ts`.
- `RcProductType` (type-only) — `dashboard/src/features/revenuecat/catalog-api.ts` (reused verbatim for `RcTransactionRow.type`, since `Transaction.type` reuses the catalog `ProductType` enum per `prisma/schema.prisma`).
- Test-only: `server` (`dashboard/src/test/msw/server.ts`), `TEST_PROJECT`/`TEST_USER`/`VALID_ACCESS_TOKEN` (`dashboard/src/test/msw/handlers.ts`), `authStore` (`dashboard/src/features/auth/store.ts`).

*Produces (consumed by B5 `RcCustomersPage` and B6 `RcCustomerDetailPage`):*
- Types: `RcCustomerRow`, `RcCustomerList { items, nextCursor }`, `RcStore`, `RcEntitlementStore`, `RcEntitlementPeriodType`, `RcOwnershipType`, `RcEntitlementInfo`, `RcCustomerInfoSubscription`, `RcCustomerInfo`, `RcCustomerDetailCustomer`, `RcRawStore`, `RcEnvironment`, `RcSubscriptionStatus`, `RcRawPeriodType`, `RcSubscriptionRow`, `RcTransactionRow`, `RcPromotionalEntitlement`, `RcCustomerDetail { customer, customerInfo, subscriptions, transactions, promotionalEntitlements }`, `RcPromotionalDuration`, `GrantPromotionalEntitlementInput { entitlementId, duration, note? }`.
- Query-key helpers: `rcCustomersListKey(projectId: string, search: string) => readonly ['rc-customers', string, 'list', string]`; `rcCustomerDetailKey(projectId: string, customerId: string) => readonly ['rc-customers', string, 'detail', string]`.
- Hooks:
  - `useRcCustomers(projectId: string, opts: { search: string }): UseInfiniteQueryResult<InfiniteData<RcCustomerList>>` — GET `/api/v1/projects/:projectId/customers?search=&limit=25&cursor=`, keyset-paginated on `nextCursor`.
  - `useRcCustomer(projectId: string, customerId: string): UseQueryResult<RcCustomerDetail>` — GET `/api/v1/projects/:projectId/customers/:customerId`.
  - `useGrantPromotionalEntitlement(projectId: string, customerId: string): UseMutationResult<RcPromotionalEntitlement, ApiError, GrantPromotionalEntitlementInput>` — POST `.../promotional-entitlements`; invalidates `rcCustomerDetailKey(projectId, customerId)`.
  - `useRevokePromotionalEntitlement(projectId: string, customerId: string): UseMutationResult<void, ApiError, string>` (mutate arg = `grantId`) — DELETE `.../promotional-entitlements/:grantId`; invalidates `rcCustomerDetailKey(projectId, customerId)`.
  - `useDeleteCustomer(projectId: string): UseMutationResult<void, ApiError, string>` (mutate arg = `customerId`) — DELETE `.../customers/:customerId`; invalidates both `rcCustomerDetailKey(projectId, customerId)` and every cached `rcCustomersListKey(projectId, *)` (partial-key invalidate on `['rc-customers', projectId, 'list']`).

---

- [ ] **Step 1: Write the failing test for the list hook (`useRcCustomers`)**

  Create `dashboard/src/features/revenuecat/customers-api.test.ts`:

  ```ts
  import { createElement, type ReactNode } from 'react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { act, renderHook, waitFor } from '@testing-library/react';
  import { http, HttpResponse } from 'msw';
  import { describe, expect, it } from 'vitest';
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import {
    rcCustomersListKey,
    useRcCustomers,
    type RcCustomerList,
    type RcCustomerRow,
  } from './customers-api';

  const PID = TEST_PROJECT.id;
  const BASE = `/api/v1/projects/${PID}/customers`;

  const CUSTOMER_ROW: RcCustomerRow = {
    id: 'cust-1',
    appUserId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    activeSubscriptionCount: 1,
    totalSpentCents: 999,
    currency: 'USD',
  };

  const CUSTOMER_ROW_2: RcCustomerRow = {
    id: 'cust-2',
    appUserId: 'user-2',
    createdAt: '2026-01-02T00:00:00.000Z',
    lastSeenAt: null,
    activeSubscriptionCount: 0,
    totalSpentCents: 0,
    currency: null,
  };

  function wrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  describe('rcCustomersListKey', () => {
    it('is keyed by project, the list tag, and search', () => {
      expect(rcCustomersListKey(PID, '')).toEqual(['rc-customers', PID, 'list', '']);
      expect(rcCustomersListKey(PID, 'ada')).not.toEqual(rcCustomersListKey(PID, ''));
    });
  });

  describe('useRcCustomers', () => {
    it('GETs the list path with search + limit and parses items/nextCursor', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      const page: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
      server.use(
        http.get(BASE, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(page);
        }),
      );

      const { result } = renderHook(() => useRcCustomers(PID, { search: 'user' }), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}?search=user&limit=25`);
      expect(result.current.data?.pages).toEqual([page]);
    });

    it('fetchNextPage sends the previous page nextCursor as the cursor param', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      const seenUrls: string[] = [];
      const page1: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
      const page2: RcCustomerList = { items: [CUSTOMER_ROW_2], nextCursor: null };
      server.use(
        http.get(BASE, ({ request }) => {
          seenUrls.push(request.url);
          return HttpResponse.json(seenUrls.length === 1 ? page1 : page2);
        }),
      );

      const { result } = renderHook(() => useRcCustomers(PID, { search: '' }), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      act(() => {
        void result.current.fetchNextPage();
      });

      await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
      expect(seenUrls[1]).toBe(
        `http://localhost:3000${BASE}?search=&limit=25&cursor=cust-1%7C2026-01-01`,
      );
      expect(result.current.data?.pages[1]).toEqual(page2);
    });
  });
  ```

- [ ] **Step 2: Run and confirm it fails**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected failure — the module doesn't exist yet, so Vite's resolver errors before any test runs:
  ```
  FAIL  src/features/revenuecat/customers-api.test.ts [ src/features/revenuecat/customers-api.test.ts ]
  Error: Failed to resolve import "./customers-api" from "src/features/revenuecat/customers-api.test.ts". Does the file exist?
  Test Files  1 failed (1)
  ```

- [ ] **Step 3: Write the minimal implementation (list hook only)**

  Create `dashboard/src/features/revenuecat/customers-api.ts`:

  ```ts
  import { useInfiniteQuery } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';

  /**
   * TanStack Query hooks over the `mobile_purchase` customers API (design
   * `2026-07-20-myrevenuecat-customers-design.md` §2/§7) — the subscriber list + per-customer detail
   * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
   * grant/revoke/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
   * RFC-7807 → `ApiError`), mirroring `catalog-api.ts`. Query keys are `['rc-customers', projectId, …]`.
   */

  // --- List row (§1.3/§7: `GET …/customers` → `{ items: RcCustomerRow[], nextCursor }`) ---

  export interface RcCustomerRow {
    id: string;
    appUserId: string;
    createdAt: string;
    lastSeenAt: string | null;
    activeSubscriptionCount: number;
    totalSpentCents: number;
    currency: string | null;
  }

  export interface RcCustomerList {
    items: RcCustomerRow[];
    nextCursor: string | null;
  }

  // --- Query keys & base URL ---

  const customersBase = (projectId: string) => `/api/v1/projects/${projectId}/customers`;

  /** `['rc-customers', projectId, 'list', search]` (spec §2). */
  export function rcCustomersListKey(projectId: string, search: string) {
    return ['rc-customers', projectId, 'list', search] as const;
  }

  // --- List hook ---

  const CUSTOMERS_PAGE_SIZE = 25;

  /** Keyset-paginated subscriber list (§1.3: `search` matches `appUserId`, contains, case-insensitive). */
  export function useRcCustomers(projectId: string, { search }: { search: string }) {
    return useInfiniteQuery({
      queryKey: rcCustomersListKey(projectId, search),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
        return purchaseApiFetch<RcCustomerList>(
          `${customersBase(projectId)}?search=${encodeURIComponent(search)}&limit=${CUSTOMERS_PAGE_SIZE}${cursor}`,
        );
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
  }
  ```

- [ ] **Step 4: Run and confirm it passes**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected:
  ```
  ✓ src/features/revenuecat/customers-api.test.ts (3 tests)

  Test Files  1 passed (1)
       Tests  3 passed (3)
  ```

- [ ] **Step 5: Extend the test file with the failing detail-hook test**

  Overwrite `dashboard/src/features/revenuecat/customers-api.test.ts` (adds the `rcCustomerDetailKey` import, the `RcCustomerDetail`/`RcPromotionalEntitlement` type imports, the `CUSTOMER_DETAIL`/`PROMO_ENTITLEMENT` fixtures, and the two new `describe` blocks at the end — everything from Step 1 is unchanged above the marked additions):

  ```ts
  import { createElement, type ReactNode } from 'react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { act, renderHook, waitFor } from '@testing-library/react';
  import { http, HttpResponse } from 'msw';
  import { describe, expect, it } from 'vitest';
  import { server } from '../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../test/msw/handlers';
  import { authStore } from '../auth/store';
  import {
    rcCustomerDetailKey,
    rcCustomersListKey,
    useRcCustomer,
    useRcCustomers,
    type RcCustomerDetail,
    type RcCustomerList,
    type RcCustomerRow,
    type RcPromotionalEntitlement,
  } from './customers-api';

  const PID = TEST_PROJECT.id;
  const BASE = `/api/v1/projects/${PID}/customers`;

  const CUSTOMER_ROW: RcCustomerRow = {
    id: 'cust-1',
    appUserId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    activeSubscriptionCount: 1,
    totalSpentCents: 999,
    currency: 'USD',
  };

  const CUSTOMER_ROW_2: RcCustomerRow = {
    id: 'cust-2',
    appUserId: 'user-2',
    createdAt: '2026-01-02T00:00:00.000Z',
    lastSeenAt: null,
    activeSubscriptionCount: 0,
    totalSpentCents: 0,
    currency: null,
  };

  const PROMO_ENTITLEMENT: RcPromotionalEntitlement = {
    id: 'promo-1',
    entitlementIdentifier: 'pro',
    grantedAt: '2026-07-01T00:00:00.000Z',
    startsAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    revokedAt: null,
    note: 'VIP',
  };

  const CUSTOMER_DETAIL: RcCustomerDetail = {
    customer: {
      id: 'cust-1',
      appUserId: 'user-1',
      appleAppAccountToken: null,
      googleObfuscatedId: null,
      attributes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-07-01T00:00:00.000Z',
    },
    customerInfo: {
      entitlements: {
        active: {
          pro: {
            isActive: true,
            willRenew: true,
            periodType: 'normal',
            latestPurchaseDate: '2026-06-01T00:00:00.000Z',
            originalPurchaseDate: '2026-01-01T00:00:00.000Z',
            expirationDate: '2026-08-01T00:00:00.000Z',
            store: 'app_store',
            productIdentifier: 'pro_monthly',
            unsubscribeDetectedAt: null,
            billingIssueDetectedAt: null,
            ownershipType: 'PURCHASED',
          },
        },
        all: {},
      },
      subscriptions: [],
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-07-01T00:00:00.000Z',
    },
    subscriptions: [
      {
        id: 'sub-1',
        projectId: PID,
        customerId: 'cust-1',
        appId: 'app-1',
        productId: 'prod-1',
        storeProductId: 'pro_monthly',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        status: 'ACTIVE',
        periodType: 'NORMAL',
        ownershipType: 'PURCHASED',
        originalTransactionId: 'txn-orig-1',
        purchaseToken: null,
        purchasedAt: '2026-06-01T00:00:00.000Z',
        originalPurchasedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:00.000Z',
        autoRenewStatus: true,
        autoRenewProductId: null,
        unsubscribeDetectedAt: null,
        billingIssueDetectedAt: null,
        gracePeriodExpiresAt: null,
        refundedAt: null,
        priceCents: 999,
        currency: 'USD',
        lastEventAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: 'txn-1',
        projectId: PID,
        customerId: 'cust-1',
        appId: 'app-1',
        subscriptionId: 'sub-1',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        storeTransactionId: 'store-txn-1',
        originalTransactionId: 'txn-orig-1',
        storeProductId: 'pro_monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        purchasedAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2026-08-01T00:00:00.000Z',
        priceCents: 999,
        currency: 'USD',
        isTrialPeriod: false,
        revokedAt: null,
        rawPayload: { raw: true },
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    promotionalEntitlements: [PROMO_ENTITLEMENT],
  };

  function wrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  describe('rcCustomersListKey', () => {
    it('is keyed by project, the list tag, and search', () => {
      expect(rcCustomersListKey(PID, '')).toEqual(['rc-customers', PID, 'list', '']);
      expect(rcCustomersListKey(PID, 'ada')).not.toEqual(rcCustomersListKey(PID, ''));
    });
  });

  describe('rcCustomerDetailKey', () => {
    it('is keyed by project, the detail tag, and customerId', () => {
      expect(rcCustomerDetailKey(PID, 'cust-1')).toEqual(['rc-customers', PID, 'detail', 'cust-1']);
    });
  });

  describe('useRcCustomers', () => {
    it('GETs the list path with search + limit and parses items/nextCursor', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      const page: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
      server.use(
        http.get(BASE, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(page);
        }),
      );

      const { result } = renderHook(() => useRcCustomers(PID, { search: 'user' }), {
        wrapper: wrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}?search=user&limit=25`);
      expect(result.current.data?.pages).toEqual([page]);
    });

    it('fetchNextPage sends the previous page nextCursor as the cursor param', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      const seenUrls: string[] = [];
      const page1: RcCustomerList = { items: [CUSTOMER_ROW], nextCursor: 'cust-1|2026-01-01' };
      const page2: RcCustomerList = { items: [CUSTOMER_ROW_2], nextCursor: null };
      server.use(
        http.get(BASE, ({ request }) => {
          seenUrls.push(request.url);
          return HttpResponse.json(seenUrls.length === 1 ? page1 : page2);
        }),
      );

      const { result } = renderHook(() => useRcCustomers(PID, { search: '' }), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      act(() => {
        void result.current.fetchNextPage();
      });

      await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
      expect(seenUrls[1]).toBe(
        `http://localhost:3000${BASE}?search=&limit=25&cursor=cust-1%7C2026-01-01`,
      );
      expect(result.current.data?.pages[1]).toEqual(page2);
    });
  });

  describe('useRcCustomer', () => {
    it('GETs the detail path and returns the parsed body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.get(`${BASE}/:customerId`, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
      );

      const { result } = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1`);
      expect(result.current.data).toEqual(CUSTOMER_DETAIL);
    });
  });
  ```

- [ ] **Step 6: Run and confirm it fails**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected failure — `customers-api.ts` doesn't export `rcCustomerDetailKey`/`useRcCustomer` yet, so the ESM import throws before any test runs:
  ```
  FAIL  src/features/revenuecat/customers-api.test.ts [ src/features/revenuecat/customers-api.test.ts ]
  SyntaxError: The requested module './customers-api.ts' does not provide an export named 'useRcCustomer'
  Test Files  1 failed (1)
  ```

- [ ] **Step 7: Extend the implementation with the CustomerInfo mirror, detail sub-types, and `useRcCustomer`**

  Overwrite `dashboard/src/features/revenuecat/customers-api.ts`:

  ```ts
  import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  import type { RcProductType } from './catalog-api';

  /**
   * TanStack Query hooks over the `mobile_purchase` customers API (design
   * `2026-07-20-myrevenuecat-customers-design.md` §2/§7) — the subscriber list + per-customer detail
   * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
   * grant/revoke/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
   * RFC-7807 → `ApiError`), mirroring `catalog-api.ts`. Query keys are `['rc-customers', projectId, …]`.
   */

  // --- List row (§1.3/§7: `GET …/customers` → `{ items: RcCustomerRow[], nextCursor }`) ---

  export interface RcCustomerRow {
    id: string;
    appUserId: string;
    createdAt: string;
    lastSeenAt: string | null;
    activeSubscriptionCount: number;
    totalSpentCents: number;
    currency: string | null;
  }

  export interface RcCustomerList {
    items: RcCustomerRow[];
    nextCursor: string | null;
  }

  // --- CustomerInfo mirror (§1.2/§1.3 — the extended assembler output; the SDK-facing shape from
  // `entitlements/customer-info.types.ts`, wire-shaped: `Date` fields serialize as ISO strings) ---

  /** The real store a subscription/transaction came from. */
  export type RcStore = 'app_store' | 'play_store';

  /** §1.2: a promotionally-sourced `EntitlementInfo.store` reads `'promotional'` instead of a real store. */
  export type RcEntitlementStore = RcStore | 'promotional';

  export type RcEntitlementPeriodType = 'normal' | 'trial' | 'intro' | 'promo';
  export type RcOwnershipType = 'PURCHASED' | 'FAMILY_SHARED';

  export interface RcEntitlementInfo {
    isActive: boolean;
    willRenew: boolean;
    periodType: RcEntitlementPeriodType;
    latestPurchaseDate: string;
    originalPurchaseDate: string;
    expirationDate: string | null;
    store: RcEntitlementStore;
    /** §1.2: `'promotional'` for a promotionally-sourced entitlement. */
    productIdentifier: string;
    unsubscribeDetectedAt: string | null;
    billingIssueDetectedAt: string | null;
    ownershipType: RcOwnershipType;
  }

  export interface RcCustomerInfoSubscription {
    storeProductId: string;
    store: RcStore;
    isActive: boolean;
    willRenew: boolean;
    expirationDate: string | null;
    periodType: RcEntitlementPeriodType;
  }

  export interface RcCustomerInfo {
    entitlements: {
      /** Only entitlements with `isActive === true`. Subset of `all`. */
      active: Record<string, RcEntitlementInfo>;
      /** Every entitlement identifier the customer has ever held, active or not. */
      all: Record<string, RcEntitlementInfo>;
    };
    subscriptions: RcCustomerInfoSubscription[];
    firstSeen: string;
    lastSeen: string;
    managementURL?: string;
  }

  // --- Detail sub-types (§1.3: raw `Customer`/`Subscription`/`Transaction` rows + promotional
  // entitlements, wire-shaped) ---

  export interface RcCustomerDetailCustomer {
    id: string;
    appUserId: string;
    appleAppAccountToken: string | null;
    googleObfuscatedId: string | null;
    attributes: Record<string, unknown> | null;
    createdAt: string;
    lastSeenAt: string | null;
  }

  /** Raw Prisma `Store` enum, as returned on `Subscription`/`Transaction` rows (uppercase — distinct
   *  from the lowercase `RcStore` the computed `CustomerInfo` uses). */
  export type RcRawStore = 'APP_STORE' | 'PLAY_STORE';
  export type RcEnvironment = 'SANDBOX' | 'PRODUCTION';
  export type RcSubscriptionStatus =
    | 'TRIAL'
    | 'INTRO'
    | 'ACTIVE'
    | 'CANCELLED'
    | 'GRACE_PERIOD'
    | 'BILLING_RETRY'
    | 'PAUSED'
    | 'EXPIRED'
    | 'REVOKED';
  export type RcRawPeriodType = 'NORMAL' | 'TRIAL' | 'INTRO' | 'PROMO';

  export interface RcSubscriptionRow {
    id: string;
    projectId: string;
    customerId: string;
    appId: string;
    productId: string | null;
    storeProductId: string;
    store: RcRawStore;
    environment: RcEnvironment;
    status: RcSubscriptionStatus;
    periodType: RcRawPeriodType;
    ownershipType: RcOwnershipType;
    originalTransactionId: string | null;
    purchaseToken: string | null;
    purchasedAt: string;
    originalPurchasedAt: string | null;
    expiresAt: string | null;
    autoRenewStatus: boolean;
    autoRenewProductId: string | null;
    unsubscribeDetectedAt: string | null;
    billingIssueDetectedAt: string | null;
    gracePeriodExpiresAt: string | null;
    refundedAt: string | null;
    priceCents: number | null;
    currency: string | null;
    lastEventAt: string | null;
    updatedAt: string;
  }

  export interface RcTransactionRow {
    id: string;
    projectId: string;
    customerId: string | null;
    appId: string;
    subscriptionId: string | null;
    store: RcRawStore;
    environment: RcEnvironment;
    storeTransactionId: string;
    originalTransactionId: string | null;
    storeProductId: string;
    type: RcProductType;
    purchasedAt: string;
    expiresAt: string | null;
    priceCents: number | null;
    currency: string | null;
    isTrialPeriod: boolean;
    revokedAt: string | null;
    rawPayload: unknown;
    createdAt: string;
  }

  export interface RcPromotionalEntitlement {
    id: string;
    entitlementIdentifier: string;
    grantedAt: string;
    startsAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    note: string | null;
  }

  export interface RcCustomerDetail {
    customer: RcCustomerDetailCustomer;
    customerInfo: RcCustomerInfo;
    subscriptions: RcSubscriptionRow[];
    transactions: RcTransactionRow[];
    promotionalEntitlements: RcPromotionalEntitlement[];
  }

  // --- Query keys & base URL ---

  const customersBase = (projectId: string) => `/api/v1/projects/${projectId}/customers`;

  /** `['rc-customers', projectId, 'list', search]` (spec §2). */
  export function rcCustomersListKey(projectId: string, search: string) {
    return ['rc-customers', projectId, 'list', search] as const;
  }

  /** `['rc-customers', projectId, 'detail', customerId]` — every mutation invalidates this. */
  export function rcCustomerDetailKey(projectId: string, customerId: string) {
    return ['rc-customers', projectId, 'detail', customerId] as const;
  }

  // --- List hook ---

  const CUSTOMERS_PAGE_SIZE = 25;

  /** Keyset-paginated subscriber list (§1.3: `search` matches `appUserId`, contains, case-insensitive). */
  export function useRcCustomers(projectId: string, { search }: { search: string }) {
    return useInfiniteQuery({
      queryKey: rcCustomersListKey(projectId, search),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
        return purchaseApiFetch<RcCustomerList>(
          `${customersBase(projectId)}?search=${encodeURIComponent(search)}&limit=${CUSTOMERS_PAGE_SIZE}${cursor}`,
        );
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
  }

  // --- Detail hook ---

  export function useRcCustomer(projectId: string, customerId: string) {
    return useQuery({
      queryKey: rcCustomerDetailKey(projectId, customerId),
      queryFn: () => purchaseApiFetch<RcCustomerDetail>(`${customersBase(projectId)}/${customerId}`),
    });
  }
  ```

- [ ] **Step 8: Run and confirm it passes**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected:
  ```
  ✓ src/features/revenuecat/customers-api.test.ts (5 tests)

  Test Files  1 passed (1)
       Tests  5 passed (5)
  ```

- [ ] **Step 9: Extend the test file with the failing grant-mutation test**

  Overwrite `dashboard/src/features/revenuecat/customers-api.test.ts` — same as Step 5's file, but with `useGrantPromotionalEntitlement` added to the import from `./customers-api`, and this new `describe` block appended at the end:

  ```ts
  describe('useGrantPromotionalEntitlement', () => {
    it('POSTs the body to the nested promotional-entitlements path and invalidates the detail query', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      let detailCalls = 0;
      server.use(
        http.get(`${BASE}/:customerId`, () => {
          detailCalls += 1;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
        http.post(`${BASE}/:customerId/promotional-entitlements`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json(PROMO_ENTITLEMENT, { status: 201 });
        }),
      );

      const Wrapper = wrapper();
      const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
      await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
      expect(detailCalls).toBe(1);

      const grant = renderHook(() => useGrantPromotionalEntitlement(PID, 'cust-1'), {
        wrapper: Wrapper,
      });
      act(() => {
        grant.result.current.mutate({ entitlementId: 'ent-1', duration: 'monthly', note: 'VIP' });
      });

      await waitFor(() => expect(grant.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/promotional-entitlements`);
      expect(seenBody).toEqual({ entitlementId: 'ent-1', duration: 'monthly', note: 'VIP' });
      expect(grant.result.current.data).toEqual(PROMO_ENTITLEMENT);
      await waitFor(() => expect(detailCalls).toBe(2));
    });
  });
  ```

  (The full file's import block now reads:)

  ```ts
  import {
    rcCustomerDetailKey,
    rcCustomersListKey,
    useGrantPromotionalEntitlement,
    useRcCustomer,
    useRcCustomers,
    type RcCustomerDetail,
    type RcCustomerList,
    type RcCustomerRow,
    type RcPromotionalEntitlement,
  } from './customers-api';
  ```

- [ ] **Step 10: Run and confirm it fails**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected failure:
  ```
  FAIL  src/features/revenuecat/customers-api.test.ts [ src/features/revenuecat/customers-api.test.ts ]
  SyntaxError: The requested module './customers-api.ts' does not provide an export named 'useGrantPromotionalEntitlement'
  Test Files  1 failed (1)
  ```

- [ ] **Step 11: Extend the implementation with `useGrantPromotionalEntitlement`**

  Apply these edits to `dashboard/src/features/revenuecat/customers-api.ts` (via the Edit tool):

  1. Widen the top import:
     ```ts
     import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
     ```
  2. After the `RcCustomerDetail` interface, add:
     ```ts
     // --- Grant input (§1.1's duration set) ---

     export type RcPromotionalDuration =
       | 'daily'
       | 'three_day'
       | 'weekly'
       | 'monthly'
       | 'two_month'
       | 'three_month'
       | 'six_month'
       | 'yearly'
       | 'lifetime';

     export interface GrantPromotionalEntitlementInput {
       entitlementId: string;
       duration: RcPromotionalDuration;
       note?: string;
     }
     ```
  3. After `rcCustomerDetailKey`, add:
     ```ts
     function invalidateDetail(
       queryClient: ReturnType<typeof useQueryClient>,
       projectId: string,
       customerId: string,
     ) {
       void queryClient.invalidateQueries({ queryKey: rcCustomerDetailKey(projectId, customerId) });
     }
     ```
  4. After `useRcCustomer`, add:
     ```ts
     // --- Mutations ---

     /** `POST …/customers/:customerId/promotional-entitlements` (§1.4) — returns the created grant. */
     export function useGrantPromotionalEntitlement(projectId: string, customerId: string) {
       const queryClient = useQueryClient();
       return useMutation({
         mutationFn: (input: GrantPromotionalEntitlementInput) =>
           purchaseApiFetch<RcPromotionalEntitlement>(
             `${customersBase(projectId)}/${customerId}/promotional-entitlements`,
             { method: 'POST', body: input },
           ),
         onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
       });
     }
     ```

  Resulting complete file:

  ```ts
  import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';
  import type { RcProductType } from './catalog-api';

  /**
   * TanStack Query hooks over the `mobile_purchase` customers API (design
   * `2026-07-20-myrevenuecat-customers-design.md` §2/§7) — the subscriber list + per-customer detail
   * (entitlements, subscriptions, transactions, promotional entitlements) and the admin
   * grant/revoke/delete actions. Every call goes through {@link purchaseApiFetch} (bearer JWT +
   * RFC-7807 → `ApiError`), mirroring `catalog-api.ts`. Query keys are `['rc-customers', projectId, …]`.
   */

  // --- List row (§1.3/§7: `GET …/customers` → `{ items: RcCustomerRow[], nextCursor }`) ---

  export interface RcCustomerRow {
    id: string;
    appUserId: string;
    createdAt: string;
    lastSeenAt: string | null;
    activeSubscriptionCount: number;
    totalSpentCents: number;
    currency: string | null;
  }

  export interface RcCustomerList {
    items: RcCustomerRow[];
    nextCursor: string | null;
  }

  // --- CustomerInfo mirror (§1.2/§1.3 — the extended assembler output; the SDK-facing shape from
  // `entitlements/customer-info.types.ts`, wire-shaped: `Date` fields serialize as ISO strings) ---

  export type RcStore = 'app_store' | 'play_store';
  export type RcEntitlementStore = RcStore | 'promotional';
  export type RcEntitlementPeriodType = 'normal' | 'trial' | 'intro' | 'promo';
  export type RcOwnershipType = 'PURCHASED' | 'FAMILY_SHARED';

  export interface RcEntitlementInfo {
    isActive: boolean;
    willRenew: boolean;
    periodType: RcEntitlementPeriodType;
    latestPurchaseDate: string;
    originalPurchaseDate: string;
    expirationDate: string | null;
    store: RcEntitlementStore;
    productIdentifier: string;
    unsubscribeDetectedAt: string | null;
    billingIssueDetectedAt: string | null;
    ownershipType: RcOwnershipType;
  }

  export interface RcCustomerInfoSubscription {
    storeProductId: string;
    store: RcStore;
    isActive: boolean;
    willRenew: boolean;
    expirationDate: string | null;
    periodType: RcEntitlementPeriodType;
  }

  export interface RcCustomerInfo {
    entitlements: {
      active: Record<string, RcEntitlementInfo>;
      all: Record<string, RcEntitlementInfo>;
    };
    subscriptions: RcCustomerInfoSubscription[];
    firstSeen: string;
    lastSeen: string;
    managementURL?: string;
  }

  export interface RcCustomerDetailCustomer {
    id: string;
    appUserId: string;
    appleAppAccountToken: string | null;
    googleObfuscatedId: string | null;
    attributes: Record<string, unknown> | null;
    createdAt: string;
    lastSeenAt: string | null;
  }

  export type RcRawStore = 'APP_STORE' | 'PLAY_STORE';
  export type RcEnvironment = 'SANDBOX' | 'PRODUCTION';
  export type RcSubscriptionStatus =
    | 'TRIAL'
    | 'INTRO'
    | 'ACTIVE'
    | 'CANCELLED'
    | 'GRACE_PERIOD'
    | 'BILLING_RETRY'
    | 'PAUSED'
    | 'EXPIRED'
    | 'REVOKED';
  export type RcRawPeriodType = 'NORMAL' | 'TRIAL' | 'INTRO' | 'PROMO';

  export interface RcSubscriptionRow {
    id: string;
    projectId: string;
    customerId: string;
    appId: string;
    productId: string | null;
    storeProductId: string;
    store: RcRawStore;
    environment: RcEnvironment;
    status: RcSubscriptionStatus;
    periodType: RcRawPeriodType;
    ownershipType: RcOwnershipType;
    originalTransactionId: string | null;
    purchaseToken: string | null;
    purchasedAt: string;
    originalPurchasedAt: string | null;
    expiresAt: string | null;
    autoRenewStatus: boolean;
    autoRenewProductId: string | null;
    unsubscribeDetectedAt: string | null;
    billingIssueDetectedAt: string | null;
    gracePeriodExpiresAt: string | null;
    refundedAt: string | null;
    priceCents: number | null;
    currency: string | null;
    lastEventAt: string | null;
    updatedAt: string;
  }

  export interface RcTransactionRow {
    id: string;
    projectId: string;
    customerId: string | null;
    appId: string;
    subscriptionId: string | null;
    store: RcRawStore;
    environment: RcEnvironment;
    storeTransactionId: string;
    originalTransactionId: string | null;
    storeProductId: string;
    type: RcProductType;
    purchasedAt: string;
    expiresAt: string | null;
    priceCents: number | null;
    currency: string | null;
    isTrialPeriod: boolean;
    revokedAt: string | null;
    rawPayload: unknown;
    createdAt: string;
  }

  export interface RcPromotionalEntitlement {
    id: string;
    entitlementIdentifier: string;
    grantedAt: string;
    startsAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    note: string | null;
  }

  export interface RcCustomerDetail {
    customer: RcCustomerDetailCustomer;
    customerInfo: RcCustomerInfo;
    subscriptions: RcSubscriptionRow[];
    transactions: RcTransactionRow[];
    promotionalEntitlements: RcPromotionalEntitlement[];
  }

  // --- Grant input (§1.1's duration set) ---

  export type RcPromotionalDuration =
    | 'daily'
    | 'three_day'
    | 'weekly'
    | 'monthly'
    | 'two_month'
    | 'three_month'
    | 'six_month'
    | 'yearly'
    | 'lifetime';

  export interface GrantPromotionalEntitlementInput {
    entitlementId: string;
    duration: RcPromotionalDuration;
    note?: string;
  }

  // --- Query keys & base URL ---

  const customersBase = (projectId: string) => `/api/v1/projects/${projectId}/customers`;

  export function rcCustomersListKey(projectId: string, search: string) {
    return ['rc-customers', projectId, 'list', search] as const;
  }

  export function rcCustomerDetailKey(projectId: string, customerId: string) {
    return ['rc-customers', projectId, 'detail', customerId] as const;
  }

  function invalidateDetail(
    queryClient: ReturnType<typeof useQueryClient>,
    projectId: string,
    customerId: string,
  ) {
    void queryClient.invalidateQueries({ queryKey: rcCustomerDetailKey(projectId, customerId) });
  }

  // --- List hook ---

  const CUSTOMERS_PAGE_SIZE = 25;

  export function useRcCustomers(projectId: string, { search }: { search: string }) {
    return useInfiniteQuery({
      queryKey: rcCustomersListKey(projectId, search),
      queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
        const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
        return purchaseApiFetch<RcCustomerList>(
          `${customersBase(projectId)}?search=${encodeURIComponent(search)}&limit=${CUSTOMERS_PAGE_SIZE}${cursor}`,
        );
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });
  }

  // --- Detail hook ---

  export function useRcCustomer(projectId: string, customerId: string) {
    return useQuery({
      queryKey: rcCustomerDetailKey(projectId, customerId),
      queryFn: () => purchaseApiFetch<RcCustomerDetail>(`${customersBase(projectId)}/${customerId}`),
    });
  }

  // --- Mutations ---

  /** `POST …/customers/:customerId/promotional-entitlements` (§1.4) — returns the created grant. */
  export function useGrantPromotionalEntitlement(projectId: string, customerId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: GrantPromotionalEntitlementInput) =>
        purchaseApiFetch<RcPromotionalEntitlement>(
          `${customersBase(projectId)}/${customerId}/promotional-entitlements`,
          { method: 'POST', body: input },
        ),
      onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
    });
  }
  ```

- [ ] **Step 12: Run and confirm it passes**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected:
  ```
  ✓ src/features/revenuecat/customers-api.test.ts (6 tests)

  Test Files  1 passed (1)
       Tests  6 passed (6)
  ```

- [ ] **Step 13: Extend the test file with the failing revoke-mutation test**

  Add `useRevokePromotionalEntitlement` to the `./customers-api` import, and append:

  ```ts
  describe('useRevokePromotionalEntitlement', () => {
    it('DELETEs the nested promotional-entitlements/:grantId path and invalidates the detail query', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let detailCalls = 0;
      server.use(
        http.get(`${BASE}/:customerId`, () => {
          detailCalls += 1;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
        http.delete(`${BASE}/:customerId/promotional-entitlements/:grantId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const Wrapper = wrapper();
      const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
      await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
      expect(detailCalls).toBe(1);

      const revoke = renderHook(() => useRevokePromotionalEntitlement(PID, 'cust-1'), {
        wrapper: Wrapper,
      });
      act(() => {
        revoke.result.current.mutate('promo-1');
      });

      await waitFor(() => expect(revoke.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1/promotional-entitlements/promo-1`);
      await waitFor(() => expect(detailCalls).toBe(2));
    });
  });
  ```

- [ ] **Step 14: Run and confirm it fails**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected failure:
  ```
  FAIL  src/features/revenuecat/customers-api.test.ts [ src/features/revenuecat/customers-api.test.ts ]
  SyntaxError: The requested module './customers-api.ts' does not provide an export named 'useRevokePromotionalEntitlement'
  Test Files  1 failed (1)
  ```

- [ ] **Step 15: Extend the implementation with `useRevokePromotionalEntitlement`**

  Edit `dashboard/src/features/revenuecat/customers-api.ts` — append immediately after `useGrantPromotionalEntitlement`:

  ```ts

  /** `DELETE …/customers/:customerId/promotional-entitlements/:grantId` (§1.4) — idempotent revoke. */
  export function useRevokePromotionalEntitlement(projectId: string, customerId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (grantId: string) =>
        purchaseApiFetch<void>(
          `${customersBase(projectId)}/${customerId}/promotional-entitlements/${grantId}`,
          { method: 'DELETE' },
        ),
      onSuccess: () => invalidateDetail(queryClient, projectId, customerId),
    });
  }
  ```

- [ ] **Step 16: Run and confirm it passes**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected:
  ```
  ✓ src/features/revenuecat/customers-api.test.ts (7 tests)

  Test Files  1 passed (1)
       Tests  7 passed (7)
  ```

- [ ] **Step 17: Extend the test file with the failing delete-customer test**

  Add `useDeleteCustomer` to the `./customers-api` import, and append:

  ```ts
  describe('useDeleteCustomer', () => {
    it('DELETEs the customer path and invalidates both the detail and the list query', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let detailCalls = 0;
      let listCalls = 0;
      server.use(
        http.get(`${BASE}/:customerId`, () => {
          detailCalls += 1;
          return HttpResponse.json(CUSTOMER_DETAIL);
        }),
        http.get(BASE, () => {
          listCalls += 1;
          return HttpResponse.json({ items: [CUSTOMER_ROW], nextCursor: null });
        }),
        http.delete(`${BASE}/:customerId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const Wrapper = wrapper();
      const detail = renderHook(() => useRcCustomer(PID, 'cust-1'), { wrapper: Wrapper });
      const list = renderHook(() => useRcCustomers(PID, { search: '' }), { wrapper: Wrapper });
      await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
      expect(detailCalls).toBe(1);
      expect(listCalls).toBe(1);

      const del = renderHook(() => useDeleteCustomer(PID), { wrapper: Wrapper });
      act(() => {
        del.result.current.mutate('cust-1');
      });

      await waitFor(() => expect(del.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/cust-1`);
      await waitFor(() => expect(detailCalls).toBe(2));
      await waitFor(() => expect(listCalls).toBe(2));
    });
  });
  ```

  The test file's full import block is now:

  ```ts
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

- [ ] **Step 18: Run and confirm it fails**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected failure:
  ```
  FAIL  src/features/revenuecat/customers-api.test.ts [ src/features/revenuecat/customers-api.test.ts ]
  SyntaxError: The requested module './customers-api.ts' does not provide an export named 'useDeleteCustomer'
  Test Files  1 failed (1)
  ```

- [ ] **Step 19: Extend the implementation with `useDeleteCustomer`**

  Edit `dashboard/src/features/revenuecat/customers-api.ts`:

  1. After `invalidateDetail`, add:
     ```ts

     /** Invalidates every cached list page regardless of `search` (partial key match). */
     function invalidateList(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
       void queryClient.invalidateQueries({ queryKey: ['rc-customers', projectId, 'list'] });
     }
     ```
  2. Append at the end of the file, after `useRevokePromotionalEntitlement`:
     ```ts

     /** `DELETE …/customers/:customerId` (§1.4) — cascades subs + promo grants; invalidates the detail
      *  AND the list (the row disappears from the list too). */
     export function useDeleteCustomer(projectId: string) {
       const queryClient = useQueryClient();
       return useMutation({
         mutationFn: (customerId: string) =>
           purchaseApiFetch<void>(`${customersBase(projectId)}/${customerId}`, { method: 'DELETE' }),
         onSuccess: (_data, customerId) => {
           invalidateDetail(queryClient, projectId, customerId);
           invalidateList(queryClient, projectId);
         },
       });
     }
     ```

  The complete, final `dashboard/src/features/revenuecat/customers-api.ts` is Step 11's file with these two additions inserted in place (the `invalidateList` function right after `invalidateDetail`, and `useDeleteCustomer` appended after `useRevokePromotionalEntitlement` from Step 15).

- [ ] **Step 20: Run and confirm it passes**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat/customers-api.test.ts --reporter=basic
  ```

  Expected:
  ```
  ✓ src/features/revenuecat/customers-api.test.ts (8 tests)

  Test Files  1 passed (1)
       Tests  8 passed (8)
  ```

- [ ] **Step 21: WIP-safety check and commit**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --short
  ```

  Confirm the only changes are the two new files:
  ```
  ?? dashboard/src/features/revenuecat/customers-api.ts
  ?? dashboard/src/features/revenuecat/customers-api.test.ts
  ```
  If anything under `dashboard/src/components/layout/`, `dashboard/src/features/revenuecat/nav-model.ts` (does not exist — verify no such file was touched), `dashboard/src/features/command-palette/CommandPalette.tsx`, or `dashboard/src/test/render-app.tsx` appears, STOP and investigate before committing — this task must never touch collapse-rail WIP.

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add dashboard/src/features/revenuecat/customers-api.ts dashboard/src/features/revenuecat/customers-api.test.ts
  git commit -m "$(cat <<'EOF'
  feat(rc-customers): dashboard customers-api hooks over purchaseApiFetch
  EOF
  )"
  ```

  Expected: commit succeeds; `git status --short` afterward shows a clean tree for these two files (no `??`/`M` remaining for them).


---

### Task B5.1: RcCustomersPage list + wire `/rc/customers`

**Files**
- Create: `dashboard/src/features/revenuecat/components/RcCustomersPage.tsx`
- Create: `dashboard/src/features/revenuecat/components/rc-customers.test.tsx`
- Modify: `dashboard/src/router.tsx` (swap `rcCustomersRoute`'s `component:` from the inline `RcPlaceholderPage` render to `RcCustomersPage`; `RcPlaceholderPage`'s import stays — `rcPaywallsRoute` still uses it)
- Test: `npx vitest run src/features/revenuecat/components/rc-customers.test.tsx --reporter=basic` (run from `dashboard/`)

**Interfaces**

*Consumes* — `dashboard/src/features/revenuecat/customers-api.ts` (produced by B4; shape locked by design §1.3/§7, not this task's guess):
```ts
export interface RcCustomerListRow {
  id: string;
  appUserId: string;
  createdAt: string;   // ISO
  lastSeenAt: string;  // ISO
  activeSubscriptionCount: number;
  totalSpentCents: number;
  currency: string | null;
}

export interface RcCustomersListResponse {
  items: RcCustomerListRow[];
  nextCursor: string | null;
}

// GET /api/v1/projects/:projectId/customers?search=&limit=&cursor=
export function useRcCustomers(
  projectId: string,
  options?: { search?: string },
): UseInfiniteQueryResult<InfiniteData<RcCustomersListResponse>, unknown>;
// consumed as: { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage }
// data.pages: RcCustomersListResponse[]
```
Also consumes `useProjects` (`dashboard/src/features/projects/api.ts`, exact signature already in the tree) and `formatCurrency` (`dashboard/src/features/analytics/format.ts`, exact signature already in the tree) and `PageShell`/`DataTable`/`Input`/`Button`/`Card*`/`EmptyState` from `dashboard/src/components/ui/*` (exact props already in the tree).

*Produces* — `RcCustomersPage()` (default gate-then-mount page component), wired at route `/projects/$projectId/rc/customers`. Row click calls `useNavigate()` with `{ to: '/projects/$projectId/rc/customers/$customerId', params: { projectId, customerId } }`. **Note for B6**: that nested route isn't registered until B6 adds `rcCustomerDetailRoute`; until then this `to` literal is outside the router's currently-registered path union. `vitest` (esbuild transpile, no type-check) is unaffected — this is caught only by `tsc --noEmit`, which is B7's job, by which point B6 has landed the route and the type is valid again. Do not run `tsc --noEmit` as part of this task's own verification.

---

- [ ] **Step 1: Write the failing test — `rc-customers.test.tsx`**

  Create `dashboard/src/features/revenuecat/components/rc-customers.test.tsx`:
  ```tsx
  import { describe, expect, it } from 'vitest';
  import { screen, waitFor, within } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { http, HttpResponse } from 'msw';
  import { renderApp } from '../../../test/render-app';
  import { server } from '../../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
  import { authStore } from '../../auth/store';
  import type { RcCustomerListRow } from '../customers-api';

  const PID = TEST_PROJECT.id;
  const CUSTOMERS_URL = `/projects/${PID}/rc/customers`;
  const base = `/api/v1/projects/${PID}/customers`;

  const ALICE: RcCustomerListRow = {
    id: 'cust-alice',
    appUserId: 'alice-app-user',
    createdAt: '2026-01-05T12:00:00.000Z',
    lastSeenAt: '2026-07-10T12:00:00.000Z',
    activeSubscriptionCount: 1,
    totalSpentCents: 2999,
    currency: 'USD',
  };
  const BOB: RcCustomerListRow = {
    id: 'cust-bob',
    appUserId: 'bob-app-user',
    createdAt: '2026-02-01T12:00:00.000Z',
    lastSeenAt: '2026-06-15T12:00:00.000Z',
    activeSubscriptionCount: 0,
    totalSpentCents: 0,
    currency: null,
  };
  const CAROL: RcCustomerListRow = {
    id: 'cust-carol',
    appUserId: 'carol-app-user',
    createdAt: '2026-03-11T12:00:00.000Z',
    lastSeenAt: '2026-07-01T12:00:00.000Z',
    activeSubscriptionCount: 2,
    totalSpentCents: 15998,
    currency: 'USD',
  };

  /**
   * Registers a stateful in-memory mock of the `customers` list endpoint (design §1.3/§7) — this
   * sub-project's first dashboard consumer, so there's no shared fixture yet. Paginates 2 rows per
   * page (independent of whatever `limit` the real hook requests) so "load more" is exercisable
   * with just 3 seed rows, and filters `search` against `appUserId` exactly like the real endpoint's
   * case-insensitive contains — proving the filter happens via the request, not client-side.
   */
  function mockCustomers(rows: RcCustomerListRow[]) {
    const PAGE_SIZE = 2;
    server.use(
      http.get(base, ({ request }) => {
        const url = new URL(request.url);
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const cursor = url.searchParams.get('cursor');
        const filtered = search
          ? rows.filter((row) => row.appUserId.toLowerCase().includes(search))
          : rows;
        const startIndex = cursor ? filtered.findIndex((row) => row.id === cursor) + 1 : 0;
        const page = filtered.slice(startIndex, startIndex + PAGE_SIZE);
        const nextIndex = startIndex + PAGE_SIZE;
        const nextCursor = nextIndex < filtered.length ? (page[page.length - 1]?.id ?? null) : null;
        return HttpResponse.json({ items: page, nextCursor });
      }),
    );
  }

  function signInOwner() {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  }

  describe('RcCustomersPage', () => {
    it('renders the first page of customers with formatted dates, active subs, and spend', async () => {
      signInOwner();
      mockCustomers([ALICE, BOB, CAROL]);
      renderApp(CUSTOMERS_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('alice-app-user')).toBeInTheDocument();
      expect(main.getByText('bob-app-user')).toBeInTheDocument();
      expect(main.queryByText('carol-app-user')).not.toBeInTheDocument(); // page 2, not loaded yet

      const aliceRow = main.getByText('alice-app-user').closest('tr') as HTMLElement;
      expect(within(aliceRow).getByText('Jan 5, 2026')).toBeInTheDocument(); // first seen
      expect(within(aliceRow).getByText('Jul 10, 2026')).toBeInTheDocument(); // last seen
      expect(within(aliceRow).getByText('1')).toBeInTheDocument(); // active subs
      expect(within(aliceRow).getByText('$29.99')).toBeInTheDocument(); // spend

      const bobRow = main.getByText('bob-app-user').closest('tr') as HTMLElement;
      expect(within(bobRow).getByText('—')).toBeInTheDocument(); // no spend yet

      expect(main.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    });

    it('filters via the request when searching', async () => {
      signInOwner();
      mockCustomers([ALICE, BOB, CAROL]);
      renderApp(CUSTOMERS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('alice-app-user');

      await userEvent.type(main.getByLabelText('Search by app user ID'), 'carol');

      // "carol" is the 3rd seed row (page 2 under the default order), so it only appears once the
      // debounced request actually re-fires with `search=carol` — proving the filter is server-side.
      expect(await main.findByText('carol-app-user')).toBeInTheDocument();
      expect(main.queryByText('alice-app-user')).not.toBeInTheDocument();
      expect(main.queryByText('bob-app-user')).not.toBeInTheDocument();
    });

    it('fetches page 2 via Load more', async () => {
      signInOwner();
      mockCustomers([ALICE, BOB, CAROL]);
      renderApp(CUSTOMERS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('alice-app-user');

      await userEvent.click(main.getByRole('button', { name: 'Load more' }));

      expect(await main.findByText('carol-app-user')).toBeInTheDocument();
      await waitFor(() =>
        expect(main.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
      );
    });

    it('shows an empty state when the project has no customers', async () => {
      signInOwner();
      mockCustomers([]);
      renderApp(CUSTOMERS_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('No customers yet')).toBeInTheDocument();
      expect(
        main.getByText('They appear here after their first purchase/SDK call.'),
      ).toBeInTheDocument();
    });

    it('navigates to the customer detail route on row click', async () => {
      signInOwner();
      mockCustomers([ALICE, BOB, CAROL]);
      const { router } = renderApp(CUSTOMERS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('alice-app-user');

      await userEvent.click(main.getByText('alice-app-user'));

      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/projects/${PID}/rc/customers/${ALICE.id}`),
      );
    });
  });
  ```

- [ ] **Step 2: Run the test — confirm it fails**

  From `dashboard/`:
  ```bash
  npx vitest run src/features/revenuecat/components/rc-customers.test.tsx --reporter=basic
  ```
  Expected failure: the route `/projects/$projectId/rc/customers` still renders `RcPlaceholderPage` (router.tsx hasn't been swapped, `RcCustomersPage.tsx` doesn't exist yet), whose `EmptyState` reads "Customers is not built yet" — none of the seeded `appUserId`s ever render. Every test in the file fails with a `TestingLibraryElementError: Unable to find an element with the text: alice-app-user` (thrown by the `await main.findByText('alice-app-user')` / `await screen.findByRole(...)` calls), e.g.:
  ```
  FAIL  src/features/revenuecat/components/rc-customers.test.tsx > RcCustomersPage > renders the first page of customers with formatted dates, active subs, and spend
  TestingLibraryElementError: Unable to find an element with the text: alice-app-user.

   Test Files  1 failed (1)
        Tests  5 failed (5)
  ```

- [ ] **Step 3: Minimal impl (part 1) — create `RcCustomersPage.tsx`**

  Create `dashboard/src/features/revenuecat/components/RcCustomersPage.tsx`:
  ```tsx
  import { useEffect, useState } from 'react';
  import { useNavigate, useParams } from '@tanstack/react-router';
  import { PageShell } from '../../../components/layout/PageShell';
  import { Button } from '../../../components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
  import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
  import { EmptyState } from '../../../components/ui/empty-state';
  import { Input } from '../../../components/ui/input';
  import { ApiError } from '../../../lib/api/problem';
  import { formatCurrency } from '../../analytics/format';
  import { useProjects } from '../../projects/api';
  import { useRcCustomers, type RcCustomerListRow } from '../customers-api';

  const SEARCH_DEBOUNCE_MS = 250;

  /** Settles `value` after `delayMs` of no changes — throttles the customer search request so every
   *  keystroke doesn't refetch. Duplicated locally (rather than imported) because its only existing
   *  instance lives in `CommandPalette.tsx`, collapse-rail WIP no other feature may touch. */
  function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
      const id = window.setTimeout(() => setDebounced(value), delayMs);
      return () => window.clearTimeout(id);
    }, [value, delayMs]);
    return debounced;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
    return fallback;
  }

  /**
   * MyRevenueCat → Customers (design 2026-07-20-myrevenuecat-customers-design.md §2). A searchable,
   * keyset-paginated subscriber list — app user id, first/last seen, active subscription count, and
   * lifetime spend — reading the billing-authority `mobile_purchase` service directly. Design §0: NO
   * connect gate; the only gate is `useProjects()` resolving (mirrors `RcOfferingsPage`'s
   * gate-then-mount so a still-loading project is never mistaken for a missing one). The page is
   * entirely read-only — every mutation (grant/revoke/delete) lives on the per-customer detail page
   * added in B6 — so there is no `useProjectRole` gating here beyond the row-click navigation to
   * that detail route.
   */
  export function RcCustomersPage() {
    const { projectId } = useParams({ from: '/private/projects/$projectId/rc/customers' });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Customers"
          description="Browse subscribers, their entitlements, and their purchase history."
          breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Customers' }]}
        >
          {null}
        </PageShell>
      );
    }

    return <CustomersList projectId={projectId} />;
  }

  function CustomersList({ projectId }: { projectId: string }) {
    const navigate = useNavigate();
    const [searchInput, setSearchInput] = useState('');
    const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

    const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
      useRcCustomers(projectId, { search });

    const customers = data?.pages.flatMap((page) => page.items) ?? [];

    const goToCustomer = (customer: RcCustomerListRow) => {
      void navigate({
        to: '/projects/$projectId/rc/customers/$customerId',
        params: { projectId, customerId: customer.id },
      });
    };

    const columns: Array<DataTableColumn<RcCustomerListRow>> = [
      { key: 'appUserId', header: 'App user ID' },
      { key: 'createdAt', header: 'First seen', render: (row) => formatDate(row.createdAt) },
      { key: 'lastSeenAt', header: 'Last seen', render: (row) => formatDate(row.lastSeenAt) },
      { key: 'activeSubscriptionCount', header: 'Active subs', align: 'right' },
      {
        key: 'spend',
        header: 'Spend',
        align: 'right',
        render: (row) =>
          row.totalSpentCents > 0
            ? formatCurrency(row.totalSpentCents / 100, row.currency ?? 'USD')
            : '—',
      },
    ];

    return (
      <PageShell
        projectId={projectId}
        title="Customers"
        description="Browse subscribers, their entitlements, and their purchase history."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Customers' }]}
      >
        <div className="max-w-sm">
          <label htmlFor="customer-search" className="mb-1.5 block text-sm font-medium">
            Search by app user ID
          </label>
          <Input
            id="customer-search"
            placeholder="Search customers…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        {isPending && <p role="status">Loading customers…</p>}
        {isError && (
          <p role="alert" className="text-danger">
            {apiErrorMessage(error, 'Could not load customers.')}
          </p>
        )}

        {!isPending && !isError && (
          <Card>
            <CardHeader>
              <CardTitle>Customers</CardTitle>
              <CardDescription>Every subscriber recorded for this project.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {customers.length > 0 ? (
                <>
                  <DataTable
                    caption="RevenueCat customers"
                    columns={columns}
                    rows={customers}
                    rowKey={(row) => row.id}
                    onRowClick={goToCustomer}
                  />
                  {hasNextPage && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="self-start"
                      onClick={() => void fetchNextPage()}
                      disabled={isFetchingNextPage}
                    >
                      {isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </Button>
                  )}
                </>
              ) : (
                <EmptyState
                  title="No customers yet"
                  description="They appear here after their first purchase/SDK call."
                />
              )}
            </CardContent>
          </Card>
        )}
      </PageShell>
    );
  }
  ```

- [ ] **Step 4: Minimal impl (part 2) — wire the route**

  Read `dashboard/src/router.tsx`, then:

  Add the import next to the other `Rc*Page` imports (after the `RcOfferingsPage` import line):
  ```ts
  import { RcOfferingsPage } from './features/revenuecat/components/RcOfferingsPage';
  import { RcCustomersPage } from './features/revenuecat/components/RcCustomersPage';
  ```

  Swap `rcCustomersRoute`'s `component:`:
  ```ts
  const rcCustomersRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/customers',
    component: () => (
      <RcPlaceholderPage
        title="Customers"
        description="Browse subscribers, their entitlements, and their purchase history."
      />
    ),
  });
  ```
  becomes:
  ```ts
  const rcCustomersRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/customers',
    component: RcCustomersPage,
  });
  ```
  (`RcPlaceholderPage`'s import is untouched — `rcPaywallsRoute` still renders it.)

- [ ] **Step 5: Run the test — confirm it passes**

  From `dashboard/`:
  ```bash
  npx vitest run src/features/revenuecat/components/rc-customers.test.tsx --reporter=basic
  ```
  Expected output:
  ```
  ✓ src/features/revenuecat/components/rc-customers.test.tsx (5 tests)

   Test Files  1 passed (1)
        Tests  5 passed (5)
  ```

- [ ] **Step 6: WIP-safety check**

  ```bash
  git status --short dashboard/src
  ```
  Expected: only the three touched files show —
  ```
   M dashboard/src/router.tsx
  ?? dashboard/src/features/revenuecat/components/RcCustomersPage.tsx
  ?? dashboard/src/features/revenuecat/components/rc-customers.test.tsx
  ```
  Confirm none of `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, any layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, or `dashboard/src/test/render-app.tsx` appear in the output — this task never touches them.

- [ ] **Step 7: Commit**

  ```bash
  git add dashboard/src/router.tsx dashboard/src/features/revenuecat/components/RcCustomersPage.tsx dashboard/src/features/revenuecat/components/rc-customers.test.tsx
  git commit -m "feat(rc-customers): RcCustomersPage list + wire /rc/customers"
  ```
  No co-author trailer.


---

### Task B6.1: RcCustomerDetailPage + actions + nested route

**Files**
- Create: `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx`
- Create: `dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx`
- Modify: `dashboard/src/router.tsx` (add the `RcCustomerDetailPage` import + a new sibling `rcCustomerDetailRoute` for the nested `/rc/customers/$customerId` path, registered in the `privateRoute.addChildren([...])` array; B5's `rcCustomersRoute`/`RcCustomersPage` wiring and `RcPlaceholderPage`'s import for `/rc/paywalls` stay untouched)
- Test: `npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx --reporter=basic` (run from `dashboard/`)

**Interfaces**

*Consumes* — `dashboard/src/features/revenuecat/customers-api.ts`, produced by B4. Exact shape quoted from B4's own plan (not this task's guess) — the subset this page actually imports:
```ts
// Hooks
export function useRcCustomer(projectId: string, customerId: string): UseQueryResult<RcCustomerDetail>;
// GET /api/v1/projects/:projectId/customers/:customerId — queryKey rcCustomerDetailKey(projectId, customerId)

export function useGrantPromotionalEntitlement(
  projectId: string,
  customerId: string,
): UseMutationResult<RcPromotionalEntitlement, unknown, GrantPromotionalEntitlementInput>;
// POST …/customers/:customerId/promotional-entitlements; onSuccess invalidates the detail query

export function useRevokePromotionalEntitlement(
  projectId: string,
  customerId: string,
): UseMutationResult<void, unknown, string /* grantId, the mutate() arg */>;
// DELETE …/customers/:customerId/promotional-entitlements/:grantId; onSuccess invalidates the detail query

export function useDeleteCustomer(projectId: string): UseMutationResult<void, unknown, string /* customerId */>;
// DELETE …/customers/:customerId; onSuccess invalidates the detail query AND every cached list page

// Types
export interface RcCustomerDetailCustomer {
  id: string;
  appUserId: string;
  appleAppAccountToken: string | null;
  googleObfuscatedId: string | null;
  attributes: Record<string, unknown> | null;
  createdAt: string;
  lastSeenAt: string | null;
}
export type RcStore = 'app_store' | 'play_store';
export type RcEntitlementStore = RcStore | 'promotional'; // §1.2's engine union marks a promo grant this way
export type RcEntitlementPeriodType = 'normal' | 'trial' | 'intro' | 'promo';
export type RcOwnershipType = 'PURCHASED' | 'FAMILY_SHARED';
export interface RcEntitlementInfo {
  isActive: boolean;
  willRenew: boolean;
  periodType: RcEntitlementPeriodType;
  latestPurchaseDate: string;
  originalPurchaseDate: string;
  expirationDate: string | null;
  store: RcEntitlementStore;
  productIdentifier: string;
  unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null;
  ownershipType: RcOwnershipType;
}
export interface RcCustomerInfoSubscription {
  storeProductId: string;
  store: RcStore;
  isActive: boolean;
  willRenew: boolean;
  expirationDate: string | null;
  periodType: RcEntitlementPeriodType;
}
export interface RcCustomerInfo {
  entitlements: { active: Record<string, RcEntitlementInfo>; all: Record<string, RcEntitlementInfo> };
  subscriptions: RcCustomerInfoSubscription[];
  firstSeen: string;
  lastSeen: string;
  managementURL?: string;
}
export type RcRawStore = 'APP_STORE' | 'PLAY_STORE';
export type RcEnvironment = 'SANDBOX' | 'PRODUCTION';
export type RcSubscriptionStatus =
  | 'TRIAL' | 'INTRO' | 'ACTIVE' | 'CANCELLED' | 'GRACE_PERIOD' | 'BILLING_RETRY' | 'PAUSED' | 'EXPIRED' | 'REVOKED';
export type RcRawPeriodType = 'NORMAL' | 'TRIAL' | 'INTRO' | 'PROMO';
export interface RcSubscriptionRow {
  id: string; projectId: string; customerId: string; appId: string; productId: string | null;
  storeProductId: string; store: RcRawStore; environment: RcEnvironment; status: RcSubscriptionStatus;
  periodType: RcRawPeriodType; ownershipType: RcOwnershipType; originalTransactionId: string | null;
  purchaseToken: string | null; purchasedAt: string; originalPurchasedAt: string | null; expiresAt: string | null;
  autoRenewStatus: boolean; autoRenewProductId: string | null; unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null; gracePeriodExpiresAt: string | null; refundedAt: string | null;
  priceCents: number | null; currency: string | null; lastEventAt: string | null; updatedAt: string;
}
export interface RcTransactionRow {
  id: string; projectId: string; customerId: string | null; appId: string; subscriptionId: string | null;
  store: RcRawStore; environment: RcEnvironment; storeTransactionId: string; originalTransactionId: string | null;
  storeProductId: string; type: RcProductType /* from catalog-api.ts, B1 */; purchasedAt: string;
  expiresAt: string | null; priceCents: number | null; currency: string | null; isTrialPeriod: boolean;
  revokedAt: string | null; rawPayload: unknown; createdAt: string;
}
export interface RcPromotionalEntitlement {
  id: string; entitlementIdentifier: string; grantedAt: string; startsAt: string;
  expiresAt: string | null; revokedAt: string | null; note: string | null;
}
export interface RcCustomerDetail {
  customer: RcCustomerDetailCustomer;
  customerInfo: RcCustomerInfo;
  subscriptions: RcSubscriptionRow[];
  transactions: RcTransactionRow[];
  promotionalEntitlements: RcPromotionalEntitlement[];
}
export type RcPromotionalDuration =
  | 'daily' | 'three_day' | 'weekly' | 'monthly' | 'two_month' | 'three_month' | 'six_month' | 'yearly' | 'lifetime';
export interface GrantPromotionalEntitlementInput { entitlementId: string; duration: RcPromotionalDuration; note?: string; }
```
Also consumes, already in the tree: `useRcEntitlements(projectId): UseQueryResult<RcEntitlement[]>` and `RcEntitlement { id: string; identifier: string; displayName: string }` (`dashboard/src/features/revenuecat/catalog-api.ts`, B1); `useProjectRole`/`useProjects` (`dashboard/src/features/projects/api.ts`); `formatCurrency` (`dashboard/src/features/analytics/format.ts`); `PageShell` (`dashboard/src/components/layout/PageShell.tsx`); `AlertDialog`/`AlertDialogAction`/`AlertDialogCancel`/`AlertDialogContent`/`AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogTitle`, `Badge`, `Button`, `Card`/`CardContent`/`CardDescription`/`CardHeader`/`CardTitle`, `DataTable`/`DataTableColumn`, `Dialog`/`DialogContent`/`DialogDescription`/`DialogTitle`, `EmptyState`, `fieldLook`/`Input`, `Label` (`dashboard/src/components/ui/*`); `ApiError` (`dashboard/src/lib/api/problem.ts`); `cn` (`dashboard/src/lib/cn.ts`).

Also consumes the route B5 already registered: `RcCustomersPage`'s row click calls `navigate({ to: '/projects/$projectId/rc/customers/$customerId', params: { projectId, customerId } })` — B5's own plan flags that `to` literal as outside the router's registered path union until this task lands `rcCustomerDetailRoute` (only `tsc --noEmit`, run in B7, catches it — `vitest`'s esbuild transpile does not).

*Produces* — `RcCustomerDetailPage()`, mounted at the new `rcCustomerDetailRoute` (`/projects/$projectId/rc/customers/$customerId`), completing the navigation target B5 already wrote. Nothing later in the build order (B6 is the last dashboard sub-task before B7's verify gate) consumes further exports from this file.

---

- [ ] **Step 1: Write the failing test — `rc-customer-detail.test.tsx`**

  Create `dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx`:
  ```tsx
  import { describe, expect, it } from 'vitest';
  import { screen, waitFor, within } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { http, HttpResponse } from 'msw';
  import { renderApp } from '../../../test/render-app';
  import { server } from '../../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
  import { authStore } from '../../auth/store';
  import type { RcEntitlement } from '../catalog-api';
  import type {
    RcCustomerDetail,
    RcCustomerDetailCustomer,
    RcCustomerInfo,
    RcPromotionalEntitlement,
    RcSubscriptionRow,
    RcTransactionRow,
  } from '../customers-api';

  const PID = TEST_PROJECT.id;
  const CUSTOMER_ID = 'cust-1';
  const DETAIL_URL = `/projects/${PID}/rc/customers/${CUSTOMER_ID}`;
  const customersBase = `/api/v1/projects/${PID}/customers`;
  const catalogBase = `/api/v1/projects/${PID}/catalog`;

  function problem(status: number, title: string) {
    return HttpResponse.json(
      { type: 'about:blank', title, status },
      { status, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const ENTITLEMENT_VIP: RcEntitlement = { id: 'ent-vip', identifier: 'vip', displayName: 'VIP Access' };

  const CUSTOMER: RcCustomerDetailCustomer = {
    id: CUSTOMER_ID,
    appUserId: 'user-42',
    appleAppAccountToken: null,
    googleObfuscatedId: null,
    attributes: { plan: 'gold' },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
  };

  const SUBSCRIPTION: RcSubscriptionRow = {
    id: 'sub-1',
    projectId: PID,
    customerId: CUSTOMER_ID,
    appId: 'app-1',
    productId: 'prod-1',
    storeProductId: 'com.example.monthly',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    status: 'ACTIVE',
    periodType: 'NORMAL',
    ownershipType: 'PURCHASED',
    originalTransactionId: 'txn-orig-1',
    purchaseToken: null,
    purchasedAt: '2026-05-01T00:00:00.000Z',
    originalPurchasedAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    autoRenewStatus: true,
    autoRenewProductId: null,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    refundedAt: null,
    priceCents: 999,
    currency: 'USD',
    lastEventAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  const TRANSACTION: RcTransactionRow = {
    id: 'txn-1',
    projectId: PID,
    customerId: CUSTOMER_ID,
    appId: 'app-1',
    subscriptionId: 'sub-1',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    storeTransactionId: 'store-txn-1',
    originalTransactionId: 'txn-orig-1',
    storeProductId: 'com.example.monthly',
    type: 'AUTO_RENEWABLE_SUBSCRIPTION',
    purchasedAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    priceCents: 999,
    currency: 'USD',
    isTrialPeriod: false,
    revokedAt: null,
    rawPayload: { raw: true },
    createdAt: '2026-05-01T00:00:00.000Z',
  };

  function customerInfoFixture(): RcCustomerInfo {
    const premium = {
      isActive: true,
      willRenew: true,
      periodType: 'normal' as const,
      latestPurchaseDate: '2026-05-01T00:00:00.000Z',
      originalPurchaseDate: '2026-05-01T00:00:00.000Z',
      expirationDate: '2026-08-01T00:00:00.000Z',
      store: 'app_store' as const,
      productIdentifier: 'com.example.monthly',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED' as const,
    };
    return {
      entitlements: { active: { premium }, all: { premium } },
      subscriptions: [],
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-06-01T00:00:00.000Z',
    };
  }

  /** The `EntitlementInfo` shape a promotional grant produces per design §1.2's union rule. */
  function promotionalEntitlementInfo(grant: RcPromotionalEntitlement) {
    return {
      isActive: true,
      willRenew: false,
      periodType: 'promo' as const,
      latestPurchaseDate: grant.grantedAt,
      originalPurchaseDate: grant.grantedAt,
      expirationDate: grant.expiresAt,
      store: 'promotional' as const,
      productIdentifier: 'promotional',
      unsubscribeDetectedAt: null,
      billingIssueDetectedAt: null,
      ownershipType: 'PURCHASED' as const,
    };
  }

  /**
   * Registers a stateful in-memory mock of the customer-detail + catalog-entitlements +
   * promotional grant/revoke + delete-customer endpoints for one test, mirroring
   * `RcOfferingsPage`'s `mockCatalog` helper — mutates the seeded state in place so a
   * grant/revoke/delete is visible on the next GET (read-your-writes, like the real service).
   */
  function mockCustomerDetail(seedGrants: RcPromotionalEntitlement[] = []) {
    const state: RcCustomerDetail = {
      customer: { ...CUSTOMER },
      customerInfo: customerInfoFixture(),
      subscriptions: [SUBSCRIPTION],
      transactions: [TRANSACTION],
      promotionalEntitlements: seedGrants,
    };
    let deleted = false;
    let nextGrantId = 1;

    server.use(
      http.get(`${catalogBase}/entitlements`, () => HttpResponse.json([ENTITLEMENT_VIP])),
      http.get(`${customersBase}/:customerId`, () => {
        if (deleted) return problem(404, 'Customer not found');
        return HttpResponse.json(state);
      }),
      http.post(`${customersBase}/:customerId/promotional-entitlements`, async ({ request }) => {
        const body = (await request.json()) as { entitlementId: string; duration: string; note?: string };
        if (body.entitlementId !== ENTITLEMENT_VIP.id) return problem(404, 'Entitlement not found');
        const grant: RcPromotionalEntitlement = {
          id: `grant-${nextGrantId++}`,
          entitlementIdentifier: ENTITLEMENT_VIP.identifier,
          grantedAt: '2026-07-20T00:00:00.000Z',
          startsAt: '2026-07-20T00:00:00.000Z',
          expiresAt: body.duration === 'lifetime' ? null : '2026-08-20T00:00:00.000Z',
          revokedAt: null,
          note: body.note ?? null,
        };
        state.promotionalEntitlements = [...state.promotionalEntitlements, grant];
        state.customerInfo = {
          ...state.customerInfo,
          entitlements: {
            active: {
              ...state.customerInfo.entitlements.active,
              [ENTITLEMENT_VIP.identifier]: promotionalEntitlementInfo(grant),
            },
            all: {
              ...state.customerInfo.entitlements.all,
              [ENTITLEMENT_VIP.identifier]: promotionalEntitlementInfo(grant),
            },
          },
        };
        return HttpResponse.json(grant, { status: 201 });
      }),
      http.delete(`${customersBase}/:customerId/promotional-entitlements/:grantId`, ({ params }) => {
        state.promotionalEntitlements = state.promotionalEntitlements.map((grant) =>
          grant.id === params.grantId ? { ...grant, revokedAt: '2026-07-20T01:00:00.000Z' } : grant,
        );
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${customersBase}/:customerId`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  }

  function signInOwner() {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  }

  describe('RcCustomerDetailPage', () => {
    it('renders entitlements, subscriptions, transactions, attributes, and a back-link to the list', async () => {
      signInOwner();
      mockCustomerDetail([
        {
          id: 'grant-existing',
          entitlementIdentifier: 'vip',
          grantedAt: '2026-06-01T00:00:00.000Z',
          startsAt: '2026-06-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          note: 'VIP comp',
        },
      ]);
      renderApp(DETAIL_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('user-42')).toBeInTheDocument();

      const entitlementsTable = within(screen.getByRole('table', { name: 'Customer entitlements' }));
      expect(entitlementsTable.getByText('premium')).toBeInTheDocument();
      expect(entitlementsTable.getByText('Active')).toBeInTheDocument();

      const subsTable = within(screen.getByRole('table', { name: 'Customer subscriptions' }));
      expect(subsTable.getByText('com.example.monthly')).toBeInTheDocument();

      const txTable = within(screen.getByRole('table', { name: 'Customer transactions' }));
      expect(txTable.getByText('com.example.monthly')).toBeInTheDocument();
      expect(txTable.getByText('$9.99')).toBeInTheDocument();

      const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
      expect(grantsTable.getByText('vip')).toBeInTheDocument();
      expect(grantsTable.getByText('VIP comp')).toBeInTheDocument();

      const attributesTable = within(screen.getByRole('table', { name: 'Customer attributes' }));
      expect(attributesTable.getByText('plan')).toBeInTheDocument();
      expect(attributesTable.getByText('gold')).toBeInTheDocument();

      const link = main.getByRole('link', { name: 'Customers' });
      expect(link).toHaveAttribute('href', `/projects/${PID}/rc/customers`);
    });

    it('grants a promotional entitlement via the dialog, which appears with a Promotional badge', async () => {
      signInOwner();
      // Seed a revoked, unrelated grant so the "Promotional entitlements" list starts non-empty —
      // otherwise the "Grant promotional entitlement" button renders TWICE (card header + the
      // EmptyState action), same duplication `RcOfferingsPage`'s own "Add package" button has, and
      // its test avoids the same way (seed a non-empty list before clicking).
      mockCustomerDetail([
        {
          id: 'grant-legacy',
          entitlementIdentifier: 'legacy',
          grantedAt: '2026-01-01T00:00:00.000Z',
          startsAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-02-01T00:00:00.000Z',
          revokedAt: '2026-02-01T00:00:00.000Z',
          note: null,
        },
      ]);
      renderApp(DETAIL_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('user-42');

      await userEvent.click(main.getByRole('button', { name: 'Grant promotional entitlement' }));
      const dialog = within(await screen.findByRole('dialog'));
      await userEvent.selectOptions(dialog.getByLabelText('Entitlement'), ENTITLEMENT_VIP.id);
      await userEvent.selectOptions(dialog.getByLabelText('Duration'), 'lifetime');
      await userEvent.type(dialog.getByLabelText('Note (optional)'), 'Comped by support');
      await userEvent.click(dialog.getByRole('button', { name: 'Grant' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
      expect(await grantsTable.findByText('Comped by support')).toBeInTheDocument();
      const vipGrantRow = grantsTable.getByText('vip').closest('tr') as HTMLElement;
      expect(within(vipGrantRow).getByText('Active')).toBeInTheDocument();

      const entitlementsTable = within(screen.getByRole('table', { name: 'Customer entitlements' }));
      const vipEntitlementRow = entitlementsTable.getByText('vip').closest('tr') as HTMLElement;
      expect(within(vipEntitlementRow).getByText('Promotional')).toBeInTheDocument();
    });

    it('revokes an active promotional grant', async () => {
      signInOwner();
      mockCustomerDetail([
        {
          id: 'grant-1',
          entitlementIdentifier: 'vip',
          grantedAt: '2026-06-01T00:00:00.000Z',
          startsAt: '2026-06-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          note: null,
        },
      ]);
      renderApp(DETAIL_URL);
      await screen.findByText('user-42');
      const grantsTable = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }));
      const grantRow = grantsTable.getByText('vip').closest('tr') as HTMLElement;

      await userEvent.click(within(grantRow).getByRole('button', { name: 'Revoke' }));
      const alert = within(await screen.findByRole('alertdialog'));
      await userEvent.click(alert.getByRole('button', { name: 'Revoke' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      await waitFor(() => {
        const refreshedRow = within(screen.getByRole('table', { name: 'Promotional entitlement grants' }))
          .getByText('vip')
          .closest('tr') as HTMLElement;
        expect(within(refreshedRow).getByText('Revoked')).toBeInTheDocument();
        expect(within(refreshedRow).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
      });
    });

    it('deletes the customer after confirming, then navigates back to the customers list', async () => {
      signInOwner();
      mockCustomerDetail();
      const { router } = renderApp(DETAIL_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('user-42');

      await userEvent.click(main.getByRole('button', { name: 'Delete customer' }));
      const alert = within(await screen.findByRole('alertdialog'));
      await userEvent.click(alert.getByRole('button', { name: 'Delete customer' }));

      await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${PID}/rc/customers`));
    });

    it('renders read-only for a viewer: reads are visible, no write controls render', async () => {
      signInOwner();
      server.use(
        http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
      );
      mockCustomerDetail([
        {
          id: 'grant-1',
          entitlementIdentifier: 'vip',
          grantedAt: '2026-06-01T00:00:00.000Z',
          startsAt: '2026-06-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          note: null,
        },
      ]);
      renderApp(DETAIL_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('user-42')).toBeInTheDocument();
      expect(main.getByText('vip')).toBeInTheDocument(); // reads still visible to a viewer

      expect(main.queryByRole('button', { name: 'Grant promotional entitlement' })).not.toBeInTheDocument();
      expect(main.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
      expect(main.queryByRole('button', { name: 'Delete customer' })).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the test — confirm it fails**

  From `dashboard/`:
  ```bash
  npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx --reporter=basic
  ```
  Expected failure: the route `/projects/$projectId/rc/customers/$customerId` doesn't exist yet (only B5's `/projects/$projectId/rc/customers` is registered) — TanStack Router's `notFoundComponent` (`NotFoundPage`) renders instead, an `<h1>Page not found</h1>`. None of the seeded customer data ever renders. Every test fails with a `TestingLibraryElementError: Unable to find an element with the text: user-42` (thrown by `await main.findByText('user-42')` or the earlier `screen.findByRole('main')` chain), e.g.:
  ```
  FAIL  src/features/revenuecat/components/rc-customer-detail.test.tsx > RcCustomerDetailPage > renders entitlements, subscriptions, transactions, attributes, and a back-link to the list
  TestingLibraryElementError: Unable to find an element with the text: user-42.

   Test Files  1 failed (1)
        Tests  5 failed (5)
  ```

- [ ] **Step 3: Minimal impl (part 1) — create `RcCustomerDetailPage.tsx`**

  Create `dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx`:
  ```tsx
  import { useState, type FormEvent } from 'react';
  import { useNavigate, useParams } from '@tanstack/react-router';
  import { PageShell } from '../../../components/layout/PageShell';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogTitle,
  } from '../../../components/ui/alert-dialog';
  import { Badge } from '../../../components/ui/badge';
  import { Button } from '../../../components/ui/button';
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
  import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
  import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
  import { EmptyState } from '../../../components/ui/empty-state';
  import { fieldLook, Input } from '../../../components/ui/input';
  import { Label } from '../../../components/ui/label';
  import { formatCurrency } from '../../analytics/format';
  import { ApiError } from '../../../lib/api/problem';
  import { cn } from '../../../lib/cn';
  import { useProjectRole, useProjects } from '../../projects/api';
  import { useRcEntitlements } from '../catalog-api';
  import {
    useDeleteCustomer,
    useGrantPromotionalEntitlement,
    useRcCustomer,
    useRevokePromotionalEntitlement,
    type RcEntitlementInfo,
    type RcPromotionalDuration,
    type RcPromotionalEntitlement,
    type RcSubscriptionRow,
    type RcTransactionRow,
  } from '../customers-api';

  /** Every `PromotionalEntitlement` duration `createPromotionalEntitlementSchema` accepts (design
   *  §1.1) — daily..lifetime, UTC date math on the server. */
  const DURATIONS: RcPromotionalDuration[] = [
    'daily',
    'three_day',
    'weekly',
    'monthly',
    'two_month',
    'three_month',
    'six_month',
    'yearly',
    'lifetime',
  ];

  const DURATION_LABELS: Record<RcPromotionalDuration, string> = {
    daily: 'Daily',
    three_day: '3 days',
    weekly: 'Weekly',
    monthly: 'Monthly',
    two_month: '2 months',
    three_month: '3 months',
    six_month: '6 months',
    yearly: 'Yearly',
    lifetime: 'Lifetime',
  };

  /** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
   *  shows the server's actual reason inline and keeps the dialog open (design §3); any other error
   *  keeps a generic fallback. Mirrors `RcOfferingsPage.dialogs.tsx`'s helper of the same name. */
  function apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
    return fallback;
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  /** `null` means "never expires" (design §1.1's lifetime grant, or a promotionally-unioned
   *  entitlement's expiry per §1.2) — distinct from the `—` used for other absent optional fields. */
  function formatExpiry(iso: string | null): string {
    return iso === null ? 'Never expires' : formatDate(iso);
  }

  /** A `CustomerInfo` entitlement is promotionally-sourced when the engine's union (design §1.2)
   *  marked it `store: 'promotional'`. */
  function isPromotional(entitlement: RcEntitlementInfo): boolean {
    return entitlement.store === 'promotional';
  }

  /**
   * MyRevenueCat → Customer detail (design `2026-07-20-myrevenuecat-customers-design.md` §2). The
   * nested `/rc/customers/$customerId` route: computed `CustomerInfo` entitlements (active/expired,
   * flagging promotionally-sourced ones), the raw subscriptions/transactions tables, attributes, and
   * the three admin-only mutations — grant/revoke a promotional entitlement, delete the customer.
   * Design §0: NO connect gate; the only gate is `useProjects()` resolving (mirrors
   * `RcOfferingsPage`'s gate-then-mount). Writes are gated on `useProjectRole ∈ {admin, owner}`; a
   * viewer sees the same sections fully read-only.
   */
  export function RcCustomerDetailPage() {
    const { projectId, customerId } = useParams({
      from: '/private/projects/$projectId/rc/customers/$customerId',
    });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

    // Don't mount the customer-detail hooks below until `useProjects()` has resolved, or a
    // still-loading flag briefly flashes an empty shell (same discipline as `RcOfferingsPage`).
    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Customer"
          description="Entitlements, subscriptions, and purchase history for this customer."
          breadcrumbs={[
            { label: 'MyRevenueCat' },
            { label: 'Customers', to: '/projects/$projectId/rc/customers', params: { projectId } },
          ]}
        >
          {null}
        </PageShell>
      );
    }

    return <CustomerDetailManager projectId={projectId} customerId={customerId} />;
  }

  function CustomerDetailManager({ projectId, customerId }: { projectId: string; customerId: string }) {
    const role = useProjectRole(projectId);
    const canManage = role === 'admin' || role === 'owner';
    const navigate = useNavigate();

    const detailQuery = useRcCustomer(projectId, customerId);
    const entitlementsQuery = useRcEntitlements(projectId);
    const grantEntitlement = useGrantPromotionalEntitlement(projectId, customerId);
    const revokeEntitlement = useRevokePromotionalEntitlement(projectId, customerId);
    const deleteCustomer = useDeleteCustomer(projectId);

    const [showGrant, setShowGrant] = useState(false);
    const [grantEntitlementId, setGrantEntitlementId] = useState('');
    const [grantDuration, setGrantDuration] = useState<RcPromotionalDuration>('monthly');
    const [grantNote, setGrantNote] = useState('');
    const [grantError, setGrantError] = useState<string | null>(null);

    const [revokeTarget, setRevokeTarget] = useState<RcPromotionalEntitlement | null>(null);
    const [revokeError, setRevokeError] = useState<string | null>(null);

    const [showDelete, setShowDelete] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const catalogEntitlements = entitlementsQuery.data ?? [];
    const customer = detailQuery.data?.customer;
    const customerInfo = detailQuery.data?.customerInfo;
    const subscriptions = detailQuery.data?.subscriptions ?? [];
    const transactions = detailQuery.data?.transactions ?? [];
    const promotionalGrants = detailQuery.data?.promotionalEntitlements ?? [];
    const attributeEntries = Object.entries(customer?.attributes ?? {});
    const entitlementRows = customerInfo
      ? Object.entries(customerInfo.entitlements.all).map(([identifier, info]) => ({ identifier, info }))
      : [];

    const openGrant = () => {
      grantEntitlement.reset();
      setGrantError(null);
      setGrantEntitlementId(catalogEntitlements[0]?.id ?? '');
      setGrantDuration('monthly');
      setGrantNote('');
      setShowGrant(true);
    };

    const handleGrantSubmit = (event: FormEvent) => {
      event.preventDefault();
      setGrantError(null);
      if (!grantEntitlementId) {
        setGrantError('Choose an entitlement.');
        return;
      }
      grantEntitlement.mutate(
        { entitlementId: grantEntitlementId, duration: grantDuration, note: grantNote.trim() || undefined },
        {
          onSuccess: () => setShowGrant(false),
          onError: (error) => setGrantError(apiErrorMessage(error, 'Could not grant the entitlement.')),
        },
      );
    };

    const entitlementColumns: Array<DataTableColumn<{ identifier: string; info: RcEntitlementInfo }>> = [
      { key: 'identifier', header: 'Entitlement', sortable: true },
      {
        key: 'status',
        header: 'Status',
        render: ({ info }) =>
          info.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="default">Expired</Badge>,
      },
      {
        key: 'source',
        header: 'Source',
        render: ({ info }) =>
          isPromotional(info) ? <Badge variant="accent">Promotional</Badge> : info.productIdentifier,
      },
      { key: 'expirationDate', header: 'Expires', render: ({ info }) => formatExpiry(info.expirationDate) },
    ];

    const grantColumns: Array<DataTableColumn<RcPromotionalEntitlement>> = [
      { key: 'entitlementIdentifier', header: 'Entitlement', sortable: true },
      { key: 'grantedAt', header: 'Granted', render: (grant) => formatDate(grant.grantedAt) },
      { key: 'expiresAt', header: 'Expires', render: (grant) => formatExpiry(grant.expiresAt) },
      { key: 'note', header: 'Note', render: (grant) => grant.note ?? '—' },
      {
        key: 'status',
        header: 'Status',
        render: (grant) =>
          grant.revokedAt === null ? <Badge variant="success">Active</Badge> : <Badge variant="default">Revoked</Badge>,
      },
      ...(canManage
        ? [
            {
              key: 'actions',
              header: 'Actions',
              align: 'right' as const,
              render: (grant: RcPromotionalEntitlement) =>
                grant.revokedAt === null ? (
                  <div className="flex justify-end">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        revokeEntitlement.reset();
                        setRevokeError(null);
                        setRevokeTarget(grant);
                      }}
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null,
            },
          ]
        : []),
    ];

    const subscriptionColumns: Array<DataTableColumn<RcSubscriptionRow>> = [
      { key: 'store', header: 'Store' },
      { key: 'storeProductId', header: 'Product', sortable: true },
      { key: 'status', header: 'Status' },
      { key: 'autoRenewStatus', header: 'Auto-renew', render: (sub) => (sub.autoRenewStatus ? 'Yes' : 'No') },
      { key: 'purchasedAt', header: 'Purchased', render: (sub) => formatDate(sub.purchasedAt) },
      { key: 'expiresAt', header: 'Expires', render: (sub) => formatExpiry(sub.expiresAt) },
    ];

    const transactionColumns: Array<DataTableColumn<RcTransactionRow>> = [
      { key: 'store', header: 'Store' },
      { key: 'storeProductId', header: 'Product', sortable: true },
      { key: 'type', header: 'Type' },
      { key: 'purchasedAt', header: 'Purchased', render: (tx) => formatDate(tx.purchasedAt) },
      {
        key: 'priceCents',
        header: 'Price',
        align: 'right',
        render: (tx) => (tx.priceCents === null ? '—' : formatCurrency(tx.priceCents / 100, tx.currency ?? 'USD')),
      },
      {
        key: 'revokedAt',
        header: 'Status',
        render: (tx) => (tx.revokedAt === null ? 'Valid' : <Badge variant="danger">Revoked</Badge>),
      },
    ];

    const attributeColumns: Array<DataTableColumn<{ key: string; value: string }>> = [
      { key: 'key', header: 'Key', sortable: true },
      { key: 'value', header: 'Value' },
    ];

    const grantButton = (
      <Button size="sm" onClick={openGrant}>
        Grant promotional entitlement
      </Button>
    );

    return (
      <PageShell
        projectId={projectId}
        title={customer?.appUserId ?? 'Customer'}
        description="Entitlements, subscriptions, and purchase history for this customer."
        breadcrumbs={[
          { label: 'MyRevenueCat' },
          { label: 'Customers', to: '/projects/$projectId/rc/customers', params: { projectId } },
          { label: customer?.appUserId ?? customerId },
        ]}
        actions={
          canManage ? (
            <Button
              variant="danger"
              onClick={() => {
                deleteCustomer.reset();
                setDeleteError(null);
                setShowDelete(true);
              }}
            >
              Delete customer
            </Button>
          ) : undefined
        }
      >
        {detailQuery.isPending && <p role="status">Loading customer…</p>}
        {detailQuery.isError && (
          <p role="alert" className="text-danger">
            {apiErrorMessage(detailQuery.error, 'Could not load this customer.')}
          </p>
        )}

        {!detailQuery.isPending && !detailQuery.isError && customerInfo && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Entitlements</CardTitle>
                <CardDescription>Every entitlement this customer has ever held, active or not.</CardDescription>
              </CardHeader>
              <CardContent>
                {entitlementRows.length > 0 ? (
                  <DataTable
                    caption="Customer entitlements"
                    columns={entitlementColumns}
                    rows={entitlementRows}
                    rowKey={(row) => row.identifier}
                  />
                ) : (
                  <EmptyState title="No entitlements yet" description="This customer has never held an entitlement." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Promotional entitlements</CardTitle>
                  <CardDescription>Grants made directly from this dashboard, independent of the stores.</CardDescription>
                </div>
                {canManage && grantButton}
              </CardHeader>
              <CardContent>
                {promotionalGrants.length > 0 ? (
                  <DataTable
                    caption="Promotional entitlement grants"
                    columns={grantColumns}
                    rows={promotionalGrants}
                    rowKey={(grant) => grant.id}
                  />
                ) : (
                  <EmptyState
                    title="No promotional grants"
                    description={
                      canManage
                        ? 'Grant a promotional entitlement to comp this customer access.'
                        : 'No promotional entitlements have been granted to this customer.'
                    }
                    action={canManage ? grantButton : undefined}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Subscriptions</CardTitle>
                <CardDescription>
                  Every store subscription this customer has, whether or not it’s currently active.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {subscriptions.length > 0 ? (
                  <DataTable
                    caption="Customer subscriptions"
                    columns={subscriptionColumns}
                    rows={subscriptions}
                    rowKey={(sub) => sub.id}
                  />
                ) : (
                  <EmptyState title="No subscriptions" description="This customer has no store subscriptions yet." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Transactions</CardTitle>
                <CardDescription>Purchase history, most recent first.</CardDescription>
              </CardHeader>
              <CardContent>
                {transactions.length > 0 ? (
                  <DataTable
                    caption="Customer transactions"
                    columns={transactionColumns}
                    rows={transactions}
                    rowKey={(tx) => tx.id}
                  />
                ) : (
                  <EmptyState title="No transactions" description="This customer has no purchase history yet." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Attributes</CardTitle>
                <CardDescription>Subscriber attributes recorded for this customer (read-only).</CardDescription>
              </CardHeader>
              <CardContent>
                {attributeEntries.length > 0 ? (
                  <DataTable
                    caption="Customer attributes"
                    columns={attributeColumns}
                    rows={attributeEntries.map(([key, value]) => ({ key, value: String(value) }))}
                    rowKey={(row) => row.key}
                  />
                ) : (
                  <EmptyState
                    title="No attributes set"
                    description="No subscriber attributes have been recorded for this customer."
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}

        {canManage && (
          <Dialog
            open={showGrant}
            onOpenChange={(open) => {
              setShowGrant(open);
              if (!open) {
                grantEntitlement.reset();
                setGrantError(null);
              }
            }}
          >
            <DialogContent>
              <DialogTitle>Grant promotional entitlement</DialogTitle>
              <DialogDescription>Comp this customer access to an entitlement without a store purchase.</DialogDescription>
              {catalogEntitlements.length === 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-sm text-text-muted">
                    Create an entitlement first (Entitlements page) — there’s nothing to grant yet.
                  </p>
                  <div className="flex justify-end">
                    <Button type="button" variant="secondary" onClick={() => setShowGrant(false)}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleGrantSubmit} className="mt-4 flex flex-col gap-3">
                  <div>
                    <Label className="mb-1 block">Entitlement</Label>
                    <select
                      aria-label="Entitlement"
                      className={cn(fieldLook, 'w-full')}
                      value={grantEntitlementId}
                      onChange={(event) => setGrantEntitlementId(event.target.value)}
                    >
                      {catalogEntitlements.map((entitlement) => (
                        <option key={entitlement.id} value={entitlement.id}>
                          {entitlement.displayName} ({entitlement.identifier})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="mb-1 block">Duration</Label>
                    <select
                      aria-label="Duration"
                      className={cn(fieldLook, 'w-full')}
                      value={grantDuration}
                      onChange={(event) => setGrantDuration(event.target.value as RcPromotionalDuration)}
                    >
                      {DURATIONS.map((duration) => (
                        <option key={duration} value={duration}>
                          {DURATION_LABELS[duration]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="grant-note" className="mb-1 block">
                      Note (optional)
                    </Label>
                    <Input id="grant-note" value={grantNote} onChange={(event) => setGrantNote(event.target.value)} />
                  </div>
                  {grantError && (
                    <p role="alert" className="text-sm text-danger">
                      {grantError}
                    </p>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setShowGrant(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={grantEntitlement.isPending}>
                      {grantEntitlement.isPending ? 'Granting…' : 'Grant'}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>
        )}

        {canManage && revokeTarget && (
          <AlertDialog open onOpenChange={(next) => !next && setRevokeTarget(null)}>
            <AlertDialogContent>
              <AlertDialogTitle>Revoke {revokeTarget.entitlementIdentifier}?</AlertDialogTitle>
              <AlertDialogDescription>
                This customer immediately loses this promotionally-granted entitlement. This cannot be undone.
              </AlertDialogDescription>
              {revokeError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {revokeError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    variant="danger"
                    disabled={revokeEntitlement.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      setRevokeError(null);
                      revokeEntitlement.mutate(revokeTarget.id, {
                        onSuccess: () => setRevokeTarget(null),
                        onError: (error) => setRevokeError(apiErrorMessage(error, 'Could not revoke this entitlement.')),
                      });
                    }}
                  >
                    {revokeEntitlement.isPending ? 'Revoking…' : 'Revoke'}
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canManage && showDelete && (
          <AlertDialog open onOpenChange={(next) => !next && setShowDelete(false)}>
            <AlertDialogContent>
              <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the customer’s personal data (app user id, store tokens, attributes) and their
                subscriptions and promotional grants. Their past transactions stay on the revenue ledger,
                anonymized. This cannot be undone.
              </AlertDialogDescription>
              {deleteError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {deleteError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    variant="danger"
                    disabled={deleteCustomer.isPending}
                    onClick={(event) => {
                      event.preventDefault();
                      setDeleteError(null);
                      deleteCustomer.mutate(customerId, {
                        onSuccess: () => {
                          setShowDelete(false);
                          void navigate({ to: '/projects/$projectId/rc/customers', params: { projectId } });
                        },
                        onError: (error) => setDeleteError(apiErrorMessage(error, 'Could not delete this customer.')),
                      });
                    }}
                  >
                    {deleteCustomer.isPending ? 'Deleting…' : 'Delete customer'}
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </PageShell>
    );
  }
  ```

- [ ] **Step 4: Minimal impl (part 2) — wire the nested route**

  Read `dashboard/src/router.tsx`, then apply these edits:

  Add the import next to the other `Rc*Page` imports (after B5's `RcCustomersPage` import line):
  ```ts
  import { RcOfferingsPage } from './features/revenuecat/components/RcOfferingsPage';
  import { RcCustomersPage } from './features/revenuecat/components/RcCustomersPage';
  ```
  becomes:
  ```ts
  import { RcOfferingsPage } from './features/revenuecat/components/RcOfferingsPage';
  import { RcCustomersPage } from './features/revenuecat/components/RcCustomersPage';
  import { RcCustomerDetailPage } from './features/revenuecat/components/RcCustomerDetailPage';
  ```

  Add the new sibling route right after `rcCustomersRoute` (B5's route, untouched):
  ```ts
  const rcCustomersRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/customers',
    component: RcCustomersPage,
  });

  const rcProductsRoute = createRoute({
  ```
  becomes:
  ```ts
  const rcCustomersRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/customers',
    component: RcCustomersPage,
  });

  const rcCustomerDetailRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/customers/$customerId',
    component: RcCustomerDetailPage,
  });

  const rcProductsRoute = createRoute({
  ```

  Register it in the route tree, right after `rcCustomersRoute,`:
  ```ts
      rcCustomersRoute,
      rcProductsRoute,
  ```
  becomes:
  ```ts
      rcCustomersRoute,
      rcCustomerDetailRoute,
      rcProductsRoute,
  ```

- [ ] **Step 5: Run the test — confirm it passes**

  From `dashboard/`:
  ```bash
  npx vitest run src/features/revenuecat/components/rc-customer-detail.test.tsx --reporter=basic
  ```
  Expected output:
  ```
  ✓ src/features/revenuecat/components/rc-customer-detail.test.tsx (5 tests)

   Test Files  1 passed (1)
        Tests  5 passed (5)
  ```

- [ ] **Step 6: WIP-safety check**

  ```bash
  git status --short
  ```
  Expected — only this task's three files show as changed (assuming B1–B5 already landed and were committed on this branch):
  ```
   M dashboard/src/router.tsx
  ?? dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx
  ?? dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx
  ```
  Confirm none of `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, any layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, or `dashboard/src/test/render-app.tsx` appear in the output — this task never touches them. If anything else unexpected shows, STOP and investigate before staging.

- [ ] **Step 7: Commit**

  ```bash
  git add dashboard/src/router.tsx dashboard/src/features/revenuecat/components/RcCustomerDetailPage.tsx dashboard/src/features/revenuecat/components/rc-customer-detail.test.tsx
  git commit -m "feat(rc-customers): RcCustomerDetailPage + actions + nested route"
  ```
  No co-author trailer.

---

### Task B7.1: Verify gate — both backends + dashboard typecheck/tests green, WIP-safety

**Files**
- None. This task makes no code changes — it verifies the combined output of B1–B6.

**Interfaces**
- None. This task produces and consumes no new interface; it asserts that everything B1–B6 produced compiles and tests together.

---

- [ ] **Step 1: `backend/mobile_purchase` — typecheck**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: exits `0` with no output — clean compile across B1's `PromotionalEntitlement` migration/Prisma-client regen + engine extension, B2's read endpoints, and B3's write endpoints.

- [ ] **Step 2: `backend/mobile_purchase` — focused Jest suite**

  Requires the Testcontainers Postgres on `:5433` to be reachable (per `test/integration/helpers/containers.ts`).
  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_purchase && npx jest src/customers src/entitlements src/subscribers test/e2e/customers.e2e-spec.ts
  ```
  Expected: every suite under `src/customers` (B1's `PromotionalEntitlement` persistence + B2/B3's services), `src/entitlements` (B1's `computeCustomerInfo` promotional-union unit tests), `src/subscribers` (B1's extended `CustomerInfoAssemblerService`), and `test/e2e/customers.e2e-spec.ts` (B2/B3's route-level 200/403/404 coverage) passes:
  ```
  Test Suites: N passed, N total
  Tests:       M passed, M total
  Snapshots:   0 total
  ```
  0 failed, exit code `0`.

- [ ] **Step 3: `backend/mobile_analytics` — typecheck (per-service isolation, design §0)**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: exits `0` with no output — confirms `mobile_purchase`'s new migration/Prisma-client regen (own generated client, design §0) never leaked a type dependency into `mobile_analytics`'s own build.

- [ ] **Step 4: `dashboard` — typecheck**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npm run typecheck
  ```
  Expected: exits `0` with no output. This is also the first point B5's `RcCustomersPage` row-click `navigate({ to: '/projects/$projectId/rc/customers/$customerId', ... })` type-checks against a real registered route — B5's own plan flagged that call as outside the router's path union until this task's `rcCustomerDetailRoute` landed; a failure here pointing at `RcCustomersPage.tsx`'s `navigate` call means B6's router wiring (Step 4 above) is missing or mistyped.

- [ ] **Step 5: `dashboard` — full `revenuecat` feature suite**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard && npx vitest run src/features/revenuecat --reporter=basic
  ```
  Expected: every file under `src/features/revenuecat/**` passes — `api.test.ts`, `catalog-api.test.ts`, `customers-api.test.ts` (B4), `purchase-metrics-api.test.ts`, and every `components/*.test.tsx` (`rc-charts`, `rc-connect`, `rc-entitlements`, `rc-nav`, `rc-offerings`, `rc-pages`, `rc-products`, `rc-customers` (B5), `rc-customer-detail` (B6)):
  ```
  Test Files  N passed (N)
       Tests  M passed (M)
  ```
  0 failed.

- [ ] **Step 6: WIP-safety assertion**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --short
  ```
  Expected: a clean tree (everything B1–B6 produced was already committed by its own task). Confirm nothing under `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, any layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, or `dashboard/src/test/render-app.tsx` shows as modified or untracked. If any of those appear, STOP — a prior sub-task touched collapse-rail WIP and it must be reverted before this gate can be considered passed.

No commit for this task — it is a verification gate only (per the "no new files" instruction); there is nothing to add to git.


---

