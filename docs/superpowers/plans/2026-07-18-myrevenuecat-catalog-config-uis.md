# MyRevenueCat Catalog Config UIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `RcPlaceholderPage` stubs for MyRevenueCat's **Products, Entitlements, and Offerings** with real dashboard config pages that drive the `mobile_purchase` catalog admin API, plus the minimal additive server **PATCH** endpoints for in-place editing.

**Architecture:** Server-first. (C1) Add scoped `PATCH` update endpoints to the existing `mobile_purchase` catalog controllers/services (create+delete-only today). (C2) A dashboard `catalog-api.ts` TanStack-Query layer over the existing `purchaseApiFetch` seam. (C3–C5) Three config pages (Entitlements, Products+Apps, Offerings+Packages) mirroring the Charts-slice gating and the project-settings CRUD pattern, each swapped in via a single `router.tsx` line. (C6) A verification gate.

**Tech Stack:** NestJS 11 + Prisma 6 + Zod + Jest/Testcontainers (`backend/mobile_purchase`); React + TanStack Router/Query + the dashboard ui-kit + Vitest/MSW (`dashboard`).

**Design spec:** `docs/superpowers/specs/2026-07-18-myrevenuecat-catalog-config-uis-design.md` — the binding contract for the endpoint shapes (§1, §9), the reach/role rules (§0), and the pages (§3).

## Global Constraints

- **Server PATCH is additive and scoped:** each new `PATCH` handler is `@UseGuards(ProjectAccessGuard)` + `@RequireProjectRole('admin')`, `projectId`-scoped (ownership assert → 404 like the existing `remove()`), body validated by a partial `parseOrThrow` schema. Editable fields EXACTLY: product `{displayName?, priceCents?, currency?, durationIso8601?, subscriptionGroupId?}`; entitlement `{displayName?}`; offering `{displayName?, metadata?}`; package `{packageType?, sortOrder?}`. Immutable fields (product `appId`/`storeProductId`/`type`; identifiers; package `productId`) are ABSENT from the update schemas. Empty body → 400.
- **No schema/migration change** — PATCH reuses existing columns. After any regen, `backend/mobile_analytics` `tsc` stays 0 (per-service Prisma isolation).
- **Reach seam reused, not rebuilt:** dashboard → `purchaseApiFetch<T>(path, options?)` (`dashboard/src/lib/api/purchase-client.ts`); base `/api/v1/projects/${projectId}/catalog`; query keys `['rc-catalog', projectId, <resource>]`; mutations invalidate their resource key on success (attach/detach → invalidate products; setCurrent → invalidate offerings).
- **Role gating:** every write control is gated on `useProjectRole(projectId)` ∈ {`admin`, `owner`}; viewers get a read-only surface (no create/edit/delete/reorder controls rendered). Reads are `viewer`.
- **Page gating:** each page gates on `useRcEnabled(projectId)` + a resolved `useProjects()` and renders `RcConnectPage` when RC isn't connected — identical to `RcChartsPage`.
- **UI reuse:** `components/ui/{DataTable,dialog,alert-dialog,combobox,select,button,badge,input,label,textarea,checkbox}` and the project-settings members/tokens CRUD pattern (`DataTable` + `dialog` create/edit + `alert-dialog` delete). Read the actual component prop APIs before use — do not invent props.
- **Routing:** three single-line `router.tsx` `component:` swaps (`rcProductsRoute`, `rcEntitlementsRoute`, `rcOfferingsRoute`) + three imports; `RcPlaceholderPage` stays imported (Customers + Paywalls still use it).
- **HARD WIP rule:** never create/modify/stage/format any collapse-rail WIP — `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, layout `*.test.tsx`, `features/command-palette/CommandPalette.tsx`, `test/render-app.tsx`. **`nav-model.ts` is NOT edited at all.** `git add` only the exact task files; every dashboard task ends with a `git status` WIP check.
- **Out of scope:** Paywalls (`/rc/paywalls`, roadmap P6), Customers (`/rc/customers`, sub-project B), store auto-sync (creds-gated), optimistic UI, drag-reorder. No co-author trailers on any commit.

## Task index & build order

- **C1** (C1.1–C1.4) — server PATCH: products / entitlements / offerings / offering-packages (update schema + service `update` + `@Patch` handler + Testcontainers + e2e per resource).
- **C2** (C2.1) — dashboard `catalog-api.ts` hooks (apps/products/entitlements/offerings CRUD + attach/detach + packages + setCurrent) + MSW hook tests. **Produces** the hooks C3–C5 consume.
- **C3** (C3.1) — `RcEntitlementsPage` + router swap + MSW page tests.
- **C4** (C4.1) — `RcProductsPage` (apps context + products + entitlement links) + router swap + MSW page tests.
- **C5** (C5.1) — `RcOfferingsPage` (offerings + packages, consumes products) + router swap + MSW page tests.
- **C6** (C6.1) — verify gate (both backends tsc 0; catalog+e2e green; dashboard tsc 0 + revenuecat suite green; WIP-safety `git status`).

**Build order: C1 → C2 → C3 → C4 → C5 → C6.**

## File structure

- `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts` — **modify**: add `updateProductSchema` / `updateEntitlementSchema` / `updateOfferingSchema` / `updatePackageSchema`.
- `backend/mobile_purchase/src/catalog/services/{products,entitlements,offerings}.service.ts` — **modify**: add `update(...)` (offerings service also `updatePackage`).
- `backend/mobile_purchase/src/catalog/controllers/{products,entitlements,offerings}.controller.ts` — **modify**: add `@Patch` handlers.
- `backend/mobile_purchase/src/catalog/services/*.spec.ts` + `test/e2e/catalog.e2e-spec.ts` — **modify/add**: update-method + PATCH-route coverage.
- `dashboard/src/features/revenuecat/catalog-api.ts` (+ `catalog-api.test.ts`) — **create**: the query/mutation hooks + response types.
- `dashboard/src/features/revenuecat/components/RcEntitlementsPage.tsx` / `RcProductsPage.tsx` / `RcOfferingsPage.tsx` (+ `rc-entitlements.test.tsx` / `rc-products.test.tsx` / `rc-offerings.test.tsx`) — **create**: the three pages + MSW tests.
- `dashboard/src/router.tsx` — **modify**: three `component:` swaps + three imports (no nav-model change).

---

### Task C1.1: PATCH `products/:productId` (edit displayName, priceCents, currency, durationIso8601, subscriptionGroupId)

**Files**
- Modify: `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`
- Modify: `backend/mobile_purchase/src/catalog/services/products.service.ts`
- Test: `backend/mobile_purchase/src/catalog/services/products.service.spec.ts`
- Modify: `backend/mobile_purchase/src/catalog/controllers/products.controller.ts`
- Test: `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`

**Interfaces**
- Consumes: `ProblemException` (`../../common/problem-details`), `parseOrThrow` (`../../common/zod`), `ProjectAccessGuard`/`RequireProjectRole` (`../../authz/*`), the `remove()` ownership pattern already in `products.service.ts` (`findFirst({id, projectId})` → 404), `startPostgresContainer()` (`test/integration/helpers/containers.ts`), `FakeProjectAccessService` (`test/e2e/catalog.e2e-spec.ts`).
- Produces (Section 2's `catalog-api.ts` consumes this contract for `useUpdateRcProduct`):
  - `updateProductSchema` exported from `catalog.schemas.ts` — Zod shape `{ displayName?: string; priceCents?: number; currency?: string; durationIso8601?: string; subscriptionGroupId?: string }`, refined to reject an empty object. `appId`, `storeProductId`, `type` are **absent** from the shape (Zod strips unknown keys by default, so they are silently dropped even if sent).
  - `ProductsService.update(projectId: string, productId: string, patch: UpdateProduct): Promise<Product>` — bare `Product` row (no `entitlements` relation, matching `create()`'s return shape). Throws `ProblemException({status:404, title:'Product not found'})` when `{id: productId, projectId}` matches no row.
  - Route `PATCH /api/v1/projects/:projectId/catalog/products/:productId`, `@RequireProjectRole('admin')` → `200` updated `Product` row | `400` (empty body / bad field) | `403` (non-admin) | `404` (unknown/cross-project id).
- No `isUniqueViolation`/`isForeignKeyViolation` wrapping is needed: the only unique constraint on `Product` is `@@unique([appId, storeProductId])`, and both `appId` and `storeProductId` are immutable/absent from `updateProductSchema`, so a `PATCH` can never trip it.

- [ ] **Step 1: Add `updateProductSchema` to `catalog.schemas.ts`.**
  Open `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`. Immediately after the `createProductSchema` block (ends at line 24, `});`) and before `export const createEntitlementSchema`, insert:
  ```ts
  export const updateProductSchema = z
    .object({
      displayName: z.string().min(1).max(256).optional(),
      priceCents: z.number().int().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      durationIso8601: z.string().min(2).max(16).optional(),
      subscriptionGroupId: z.string().min(1).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
  ```

- [ ] **Step 2 (RED): Add the failing service spec cases.**
  Open `backend/mobile_purchase/src/catalog/services/products.service.spec.ts`. Change the import block at the top from:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { ProductsService } from './products.service';
  ```
  to:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { updateProductSchema } from '../support/catalog.schemas';
  import { parseOrThrow } from '../../common/zod';
  import { ProblemException } from '../../common/problem-details';
  import { ProductsService } from './products.service';
  ```
  Then, immediately before the final `it('remove() 409s a product that is still referenced by a package', ...)` test's closing (i.e. right before the describe block's closing `});` at the end of the file, after the `remove() 409s...` test), append these four tests:
  ```ts
  it('updates a product’s editable fields', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'update.happy.product',
      type: 'CONSUMABLE',
      displayName: 'Original',
    });

    const updated = await service.update(projectId, product.id, {
      displayName: 'Updated Name',
      priceCents: 1999,
      currency: 'USD',
    });

    expect(updated).toMatchObject({
      id: product.id,
      displayName: 'Updated Name',
      priceCents: 1999,
      currency: 'USD',
    });
  });

  it('update() 404s for a cross-project or non-existent product', async () => {
    const otherProjectId = randomUUID();
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'update.guard.product',
      type: 'CONSUMABLE',
      displayName: 'Guarded',
    });

    await expect(service.update(otherProjectId, product.id, { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.update(projectId, randomUUID(), { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('updateProductSchema rejects an empty body (400)', () => {
    let caught: unknown;
    try {
      parseOrThrow(updateProductSchema, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({ status: 400 });
  });

  it('updateProductSchema strips immutable fields (appId, storeProductId, type), so they survive an update untouched', async () => {
    const product = await service.create(projectId, {
      appId,
      storeProductId: 'update.immutable.product',
      type: 'CONSUMABLE',
      displayName: 'Before',
    });
    const otherApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Other App',
        platform: 'ANDROID',
        packageName: `com.other.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });

    const patch = parseOrThrow(updateProductSchema, {
      appId: otherApp.id,
      storeProductId: 'hijacked.id',
      type: 'NON_CONSUMABLE',
      displayName: 'After',
    });
    expect(patch).toEqual({ displayName: 'After' });

    const updated = await service.update(projectId, product.id, patch);
    expect(updated).toMatchObject({
      appId,
      storeProductId: 'update.immutable.product',
      type: 'CONSUMABLE',
      displayName: 'After',
    });
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/products.service.spec.ts
  ```
  Expected failure (ts-jest fails the whole suite at compile time because `update` doesn't exist yet on `ProductsService`):
  ```
  FAIL src/catalog/services/products.service.spec.ts
    ● Test suite failed to run

      src/catalog/services/products.service.spec.ts:194:35 - error TS2339: Property 'update' does not exist on type 'ProductsService'.

  Test Suites: 1 failed, 1 total
  Tests:       0 total
  ```

- [ ] **Step 3 (GREEN): Implement `ProductsService.update()`.**
  Open `backend/mobile_purchase/src/catalog/services/products.service.ts`. Change the top import block from:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createProductSchema } from '../support/catalog.schemas';

  type CreateProduct = z.infer<typeof createProductSchema>;
  ```
  to:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createProductSchema, updateProductSchema } from '../support/catalog.schemas';

  type CreateProduct = z.infer<typeof createProductSchema>;
  type UpdateProduct = z.infer<typeof updateProductSchema>;
  ```
  Then insert the following method between `list()` and `remove()`:
  ```ts
    async update(projectId: string, productId: string, patch: UpdateProduct) {
      const existing = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
      if (!existing) throw new ProblemException({ status: 404, title: 'Product not found' });
      return this.prisma.product.update({ where: { id: productId }, data: patch });
    }

  ```
  (i.e. the file reads `create()` → `list()` → `update()` → `remove()` → `attachEntitlement()` → `detachEntitlement()`.)
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/products.service.spec.ts
  ```
  Expected:
  ```
  PASS src/catalog/services/products.service.spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       14 passed, 14 total
  ```

- [ ] **Step 4 (RED): Add the failing e2e route test.**
  Open `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`. Immediately before the describe block's closing `});` (i.e. after the existing `it('proves the public SDK endpoint...')` test), append:
  ```ts
  it('PATCH products/:productId — 200 as admin (updates editable fields), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const patchApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Patch App',
        platform: 'IOS',
        bundleId: `com.patch.${randomUUID()}`,
        publicSdkKey: generatePublicSdkKey(),
      },
    });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: patchApp.id,
        storeProductId: 'patch.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${product.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Monthly Plus', priceCents: 1999, currency: 'USD' })
      .expect(200);
    expect(res.body).toMatchObject({ id: product.id, displayName: 'Monthly Plus', priceCents: 1999, currency: 'USD' });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${product.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ displayName: 'Blocked' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/products/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Nope' })
      .expect(404);
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected failure (no `PATCH` route is mounted on `ProductsController` yet, so Nest's router falls through to its default 404 handler before `ProjectAccessGuard` even runs — the `.expect(200)` assertion fails):
  ```
  FAIL test/e2e/catalog.e2e-spec.ts
    ● Catalog e2e — module wiring, both guards, public SDK offerings endpoint › PATCH products/:productId — 200 as admin ...

      Error: expected 200 "OK", got 404 "Not Found"

  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 2 passed, 3 total
  ```

- [ ] **Step 5 (GREEN): Add the `@Patch(':productId')` controller handler.**
  Open `backend/mobile_purchase/src/catalog/controllers/products.controller.ts`. Change the top imports from:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { attachEntitlementSchema, createProductSchema } from '../support/catalog.schemas';
  import { ProductsService } from '../services/products.service';
  ```
  to:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { attachEntitlementSchema, createProductSchema, updateProductSchema } from '../support/catalog.schemas';
  import { ProductsService } from '../services/products.service';
  ```
  Then insert the following handler between `create()` and `remove()`:
  ```ts
    @Patch(':productId')
    @RequireProjectRole('admin')
    update(@Param('projectId') projectId: string, @Param('productId') productId: string, @Body() body: unknown) {
      return this.service.update(projectId, productId, parseOrThrow(updateProductSchema, body));
    }

  ```
  (i.e. `list()` → `create()` → `update()` → `remove()` → `attachEntitlement()` → `detachEntitlement()`.)
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected:
  ```
  PASS test/e2e/catalog.e2e-spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       3 passed, 3 total
  ```

- [ ] **Step 6: Typecheck.**
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

- [ ] **Step 7: Commit.**
  ```bash
  cd backend/mobile_purchase && git add src/catalog/support/catalog.schemas.ts src/catalog/services/products.service.ts src/catalog/services/products.service.spec.ts src/catalog/controllers/products.controller.ts test/e2e/catalog.e2e-spec.ts
  git commit -m "$(cat <<'EOF'
  feat(mobile_purchase): PATCH products (edit displayName, priceCents, currency, durationIso8601, subscriptionGroupId)
  EOF
  )"
  ```
  Expected: commit succeeds; `git status` shows a clean tree for these five files.

---

### Task C1.2: PATCH `entitlements/:entitlementId` (edit displayName)

**Files**
- Modify: `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`
- Modify: `backend/mobile_purchase/src/catalog/services/entitlements.service.ts`
- Test: `backend/mobile_purchase/src/catalog/services/entitlements.service.spec.ts`
- Modify: `backend/mobile_purchase/src/catalog/controllers/entitlements.controller.ts`
- Test: `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`

**Interfaces**
- Consumes: same primitives as C1.1 (`ProblemException`, `parseOrThrow`, `ProjectAccessGuard`/`RequireProjectRole`, the `remove()` ownership pattern in `entitlements.service.ts`). Edits `catalog.schemas.ts` and `test/e2e/catalog.e2e-spec.ts`, the same files C1.1 touched — apply this task **after C1.1 is committed** so the `old_string` anchors below (which quote C1.1's post-edit file state for the e2e file) match; the two tasks' schema edits land at different, non-overlapping locations in `catalog.schemas.ts` so there is no logical conflict, only a sequencing one.
- Produces (Section 2's `catalog-api.ts` consumes this for `useUpdateRcEntitlement`):
  - `updateEntitlementSchema` exported from `catalog.schemas.ts` — `{ displayName?: string }`, refined to reject an empty object. `identifier` is absent from the shape.
  - `EntitlementsService.update(projectId: string, entitlementId: string, patch: UpdateEntitlement): Promise<Entitlement>` — bare `Entitlement` row. Throws `ProblemException({status:404, title:'Entitlement not found'})` on unknown/cross-project id.
  - Route `PATCH /api/v1/projects/:projectId/catalog/entitlements/:entitlementId`, `@RequireProjectRole('admin')` → `200` updated `Entitlement` row | `400` | `403` | `404`.
- No `isUniqueViolation` wrapping needed: `Entitlement`'s only unique constraint is `@@unique([projectId, identifier])`, and `identifier` is immutable/absent from the schema.

- [ ] **Step 1: Add `updateEntitlementSchema` to `catalog.schemas.ts`.**
  Immediately after the `createEntitlementSchema` block and before `export const attachEntitlementSchema`, insert:
  ```ts
  export const updateEntitlementSchema = z
    .object({
      displayName: z.string().min(1).max(256).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
  ```

- [ ] **Step 2 (RED): Add the failing service spec cases.**
  Open `backend/mobile_purchase/src/catalog/services/entitlements.service.spec.ts`. Change the imports from:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { EntitlementsService } from './entitlements.service';
  ```
  to:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { updateEntitlementSchema } from '../support/catalog.schemas';
  import { parseOrThrow } from '../../common/zod';
  import { ProblemException } from '../../common/problem-details';
  import { EntitlementsService } from './entitlements.service';
  ```
  Then append these four tests immediately before the describe block's closing `});` (i.e. after the existing `'404s removing a non-existent or cross-tenant entitlement'` test):
  ```ts
  it('updates an entitlement’s displayName', async () => {
    const ent = await service.create(projectId, { identifier: 'update-happy', displayName: 'Before' });

    const updated = await service.update(projectId, ent.id, { displayName: 'After' });

    expect(updated).toMatchObject({ id: ent.id, displayName: 'After' });
  });

  it('update() 404s for a cross-project or non-existent entitlement', async () => {
    const otherProjectId = randomUUID();
    const ent = await service.create(projectId, { identifier: 'update-guard', displayName: 'Guarded' });

    await expect(service.update(otherProjectId, ent.id, { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.update(projectId, randomUUID(), { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('updateEntitlementSchema rejects an empty body (400)', () => {
    let caught: unknown;
    try {
      parseOrThrow(updateEntitlementSchema, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({ status: 400 });
  });

  it('updateEntitlementSchema strips the immutable identifier field, so it survives an update untouched', async () => {
    const ent = await service.create(projectId, { identifier: 'update-immutable', displayName: 'Before' });

    const patch = parseOrThrow(updateEntitlementSchema, { identifier: 'hijacked-identifier', displayName: 'After' });
    expect(patch).toEqual({ displayName: 'After' });

    const updated = await service.update(projectId, ent.id, patch);
    expect(updated).toMatchObject({ identifier: 'update-immutable', displayName: 'After' });
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/entitlements.service.spec.ts
  ```
  Expected failure:
  ```
  FAIL src/catalog/services/entitlements.service.spec.ts
    ● Test suite failed to run

      src/catalog/services/entitlements.service.spec.ts:34:29 - error TS2339: Property 'update' does not exist on type 'EntitlementsService'.

  Test Suites: 1 failed, 1 total
  Tests:       0 total
  ```

- [ ] **Step 3 (GREEN): Implement `EntitlementsService.update()`.**
  Open `backend/mobile_purchase/src/catalog/services/entitlements.service.ts`. Change the top imports from:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createEntitlementSchema } from '../support/catalog.schemas';

  type CreateEntitlement = z.infer<typeof createEntitlementSchema>;
  ```
  to:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createEntitlementSchema, updateEntitlementSchema } from '../support/catalog.schemas';

  type CreateEntitlement = z.infer<typeof createEntitlementSchema>;
  type UpdateEntitlement = z.infer<typeof updateEntitlementSchema>;
  ```
  Insert the following method between `list()` and `remove()`:
  ```ts
    async update(projectId: string, entitlementId: string, patch: UpdateEntitlement) {
      const existing = await this.prisma.entitlement.findFirst({ where: { id: entitlementId, projectId } });
      if (!existing) throw new ProblemException({ status: 404, title: 'Entitlement not found' });
      return this.prisma.entitlement.update({ where: { id: entitlementId }, data: patch });
    }

  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/entitlements.service.spec.ts
  ```
  Expected:
  ```
  PASS src/catalog/services/entitlements.service.spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       7 passed, 7 total
  ```

- [ ] **Step 4 (RED): Add the failing e2e route test.**
  Open `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`. Append immediately before the describe block's closing `});` (i.e. after C1.1's `PATCH products/:productId` test):
  ```ts
  it('PATCH entitlements/:entitlementId — 200 as admin (updates displayName), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const entitlement = await prisma.entitlement.create({
      data: { projectId, identifier: 'patch-ent', displayName: 'Before' },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${entitlement.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'After' })
      .expect(200);
    expect(res.body).toMatchObject({ id: entitlement.id, displayName: 'After', identifier: 'patch-ent' });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${entitlement.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ displayName: 'Blocked' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/entitlements/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Nope' })
      .expect(404);
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected failure:
  ```
  FAIL test/e2e/catalog.e2e-spec.ts
    ● Catalog e2e — module wiring, both guards, public SDK offerings endpoint › PATCH entitlements/:entitlementId — 200 as admin ...

      Error: expected 200 "OK", got 404 "Not Found"

  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 3 passed, 4 total
  ```

- [ ] **Step 5 (GREEN): Add the `@Patch(':entitlementId')` controller handler.**
  Open `backend/mobile_purchase/src/catalog/controllers/entitlements.controller.ts`. Change the top imports from:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { createEntitlementSchema } from '../support/catalog.schemas';
  import { EntitlementsService } from '../services/entitlements.service';
  ```
  to:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { createEntitlementSchema, updateEntitlementSchema } from '../support/catalog.schemas';
  import { EntitlementsService } from '../services/entitlements.service';
  ```
  Insert the following handler between `create()` and `remove()`:
  ```ts
    @Patch(':entitlementId')
    @RequireProjectRole('admin')
    update(@Param('projectId') projectId: string, @Param('entitlementId') entitlementId: string, @Body() body: unknown) {
      return this.service.update(projectId, entitlementId, parseOrThrow(updateEntitlementSchema, body));
    }

  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected:
  ```
  PASS test/e2e/catalog.e2e-spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       4 passed, 4 total
  ```

- [ ] **Step 6: Typecheck.**
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

- [ ] **Step 7: Commit.**
  ```bash
  cd backend/mobile_purchase && git add src/catalog/support/catalog.schemas.ts src/catalog/services/entitlements.service.ts src/catalog/services/entitlements.service.spec.ts src/catalog/controllers/entitlements.controller.ts test/e2e/catalog.e2e-spec.ts
  git commit -m "$(cat <<'EOF'
  feat(mobile_purchase): PATCH entitlements (edit displayName)
  EOF
  )"
  ```
  Expected: commit succeeds; `git status` shows a clean tree for these five files.

---

### Task C1.3: PATCH `offerings/:offeringId` (edit displayName, metadata)

**Files**
- Modify: `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`
- Modify: `backend/mobile_purchase/src/catalog/services/offerings.service.ts`
- Test: `backend/mobile_purchase/src/catalog/services/offerings.service.spec.ts`
- Modify: `backend/mobile_purchase/src/catalog/controllers/offerings.controller.ts`
- Test: `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`

**Interfaces**
- Consumes: same primitives as C1.1/C1.2. Apply **after C1.2** (sequential, same shared files: `catalog.schemas.ts`, `test/e2e/catalog.e2e-spec.ts`). C1.4 (offering-packages) depends on this task landing first: it edits the same `offerings.service.ts` type-import line and the same `offerings.controller.ts` schema-import line that this task introduces (see C1.4's Step 3/5 "Before" blocks, which quote this task's post-edit state).
- Produces:
  - `updateOfferingSchema` exported from `catalog.schemas.ts` — `{ displayName?: string; metadata?: unknown }`, refined to reject an empty object. `identifier` and `isCurrent` are absent from the shape — flipping `isCurrent` stays exclusively on `POST /:offeringId/current`.
  - `OfferingsService.update(projectId: string, offeringId: string, patch: UpdateOffering): Promise<Offering>` — bare `Offering` row (no `packages` relation, matching `create()`'s return shape). Throws `ProblemException({status:404, title:'Offering not found'})` on unknown/cross-project id.
  - Route `PATCH /api/v1/projects/:projectId/catalog/offerings/:offeringId`, `@RequireProjectRole('admin')` → `200` updated `Offering` row | `400` | `403` | `404`.
- No `isUniqueViolation` wrapping needed: `Offering`'s only unique constraint is `@@unique([projectId, identifier])`, and `identifier` is immutable/absent from the schema.

- [ ] **Step 1: Add `updateOfferingSchema` to `catalog.schemas.ts`.**
  Immediately after the `createOfferingSchema` block and before `export const createPackageSchema`, insert:
  ```ts
  export const updateOfferingSchema = z
    .object({
      displayName: z.string().min(1).max(256).optional(),
      metadata: z.unknown().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
  ```

- [ ] **Step 2 (RED): Add the failing service spec cases.**
  Open `backend/mobile_purchase/src/catalog/services/offerings.service.spec.ts`. Change the imports from:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { OfferingsService } from './offerings.service';
  ```
  to:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { updateOfferingSchema } from '../support/catalog.schemas';
  import { parseOrThrow } from '../../common/zod';
  import { ProblemException } from '../../common/problem-details';
  import { OfferingsService } from './offerings.service';
  ```
  Then append these four tests immediately before the describe block's closing `});` (i.e. after the existing `'remove() deletes an offering and 404s for a cross-project or non-existent offering'` test):
  ```ts
  it('updates an offering’s displayName and metadata', async () => {
    const offering = await service.create(projectId, { identifier: 'update-happy', displayName: 'Before' });

    const updated = await service.update(projectId, offering.id, {
      displayName: 'After',
      metadata: { banner: 'summer-sale' },
    });

    expect(updated).toMatchObject({ id: offering.id, displayName: 'After', metadata: { banner: 'summer-sale' } });
  });

  it('update() 404s for a cross-project or non-existent offering', async () => {
    const otherProjectId = randomUUID();
    const offering = await service.create(projectId, { identifier: 'update-guard', displayName: 'Guarded' });

    await expect(service.update(otherProjectId, offering.id, { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.update(projectId, randomUUID(), { displayName: 'Nope' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('updateOfferingSchema rejects an empty body (400)', () => {
    let caught: unknown;
    try {
      parseOrThrow(updateOfferingSchema, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({ status: 400 });
  });

  it('updateOfferingSchema strips immutable fields (identifier, isCurrent), so they survive an update untouched', async () => {
    const offering = await service.create(projectId, {
      identifier: 'update-immutable',
      displayName: 'Before',
      isCurrent: true,
    });

    const patch = parseOrThrow(updateOfferingSchema, {
      identifier: 'hijacked-identifier',
      isCurrent: false,
      displayName: 'After',
    });
    expect(patch).toEqual({ displayName: 'After' });

    const updated = await service.update(projectId, offering.id, patch);
    expect(updated).toMatchObject({ identifier: 'update-immutable', isCurrent: true, displayName: 'After' });
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/offerings.service.spec.ts
  ```
  Expected failure:
  ```
  FAIL src/catalog/services/offerings.service.spec.ts
    ● Test suite failed to run

      src/catalog/services/offerings.service.spec.ts:52:33 - error TS2339: Property 'update' does not exist on type 'OfferingsService'.

  Test Suites: 1 failed, 1 total
  Tests:       0 total
  ```

- [ ] **Step 3 (GREEN): Implement `OfferingsService.update()`.**
  Open `backend/mobile_purchase/src/catalog/services/offerings.service.ts`. Change the top imports from:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';

  type CreateOffering = z.infer<typeof createOfferingSchema>;
  type CreatePackage = z.infer<typeof createPackageSchema>;
  ```
  to:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createOfferingSchema, createPackageSchema, updateOfferingSchema } from '../support/catalog.schemas';

  type CreateOffering = z.infer<typeof createOfferingSchema>;
  type CreatePackage = z.infer<typeof createPackageSchema>;
  type UpdateOffering = z.infer<typeof updateOfferingSchema>;
  ```
  Insert the following method between `list()` and `remove()`:
  ```ts
    async update(projectId: string, offeringId: string, patch: UpdateOffering) {
      const existing = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
      if (!existing) throw new ProblemException({ status: 404, title: 'Offering not found' });
      return this.prisma.offering.update({
        where: { id: offeringId },
        data: { displayName: patch.displayName, metadata: patch.metadata as never },
      });
    }

  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/offerings.service.spec.ts
  ```
  Expected:
  ```
  PASS src/catalog/services/offerings.service.spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       15 passed, 15 total
  ```

- [ ] **Step 4 (RED): Add the failing e2e route test.**
  Open `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`. Append immediately before the describe block's closing `});` (i.e. after C1.2's `PATCH entitlements/:entitlementId` test):
  ```ts
  it('PATCH offerings/:offeringId — 200 as admin (updates displayName/metadata), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'patch-offering', displayName: 'Before' },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${offering.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'After', metadata: { banner: 'sale' } })
      .expect(200);
    expect(res.body).toMatchObject({ id: offering.id, displayName: 'After', metadata: { banner: 'sale' } });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${offering.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ displayName: 'Blocked' })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ displayName: 'Nope' })
      .expect(404);
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected failure:
  ```
  FAIL test/e2e/catalog.e2e-spec.ts
    ● Catalog e2e — module wiring, both guards, public SDK offerings endpoint › PATCH offerings/:offeringId — 200 as admin ...

      Error: expected 200 "OK", got 404 "Not Found"

  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 4 passed, 5 total
  ```

- [ ] **Step 5 (GREEN): Add the `@Patch(':offeringId')` controller handler.**
  Open `backend/mobile_purchase/src/catalog/controllers/offerings.controller.ts`. Change the top imports from:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';
  import { OfferingsService } from '../services/offerings.service';
  ```
  to:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { createOfferingSchema, createPackageSchema, updateOfferingSchema } from '../support/catalog.schemas';
  import { OfferingsService } from '../services/offerings.service';
  ```
  Insert the following handler between `setCurrent()` and `remove()`:
  ```ts
    @Patch(':offeringId')
    @RequireProjectRole('admin')
    update(@Param('projectId') projectId: string, @Param('offeringId') offeringId: string, @Body() body: unknown) {
      return this.service.update(projectId, offeringId, parseOrThrow(updateOfferingSchema, body));
    }

  ```
  (i.e. `list()` → `create()` → `setCurrent()` → `update()` → `remove()` → `addPackage()` → `removePackage()`.)
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected:
  ```
  PASS test/e2e/catalog.e2e-spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       5 passed, 5 total
  ```

- [ ] **Step 6: Typecheck.**
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```
  Expected: no output, exit code 0.

- [ ] **Step 7: Commit.**
  ```bash
  cd backend/mobile_purchase && git add src/catalog/support/catalog.schemas.ts src/catalog/services/offerings.service.ts src/catalog/services/offerings.service.spec.ts src/catalog/controllers/offerings.controller.ts test/e2e/catalog.e2e-spec.ts
  git commit -m "$(cat <<'EOF'
  feat(mobile_purchase): PATCH offerings (edit displayName, metadata)
  EOF
  )"
  ```
  Expected: commit succeeds; `git status` shows a clean tree for these five files.

---

### Task C1.4: PATCH `offerings/:offeringId/packages/:packageId` (edit packageType, sortOrder)

**Files**
- Modify: `backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`
- Modify: `backend/mobile_purchase/src/catalog/services/offerings.service.ts`
- Test: `backend/mobile_purchase/src/catalog/services/offerings.service.spec.ts`
- Modify: `backend/mobile_purchase/src/catalog/controllers/offerings.controller.ts`
- Test: `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`

**Interfaces**
- Consumes: same primitives as C1.1-C1.3. Apply **after C1.3** — this task's Step 3/5 "Before" blocks quote `offerings.service.ts`/`offerings.controller.ts` exactly as C1.3 left them (with `updateOfferingSchema` already imported and `update()`/`@Patch(':offeringId')` already present).
- Produces (Section 2's `catalog-api.ts` consumes this for `useUpdatePackage`):
  - `updatePackageSchema` exported from `catalog.schemas.ts` — `{ packageType?: PackageType; sortOrder?: number }`, refined to reject an empty object. `identifier` and `productId` are absent from the shape.
  - `OfferingsService.updatePackage(projectId: string, offeringId: string, packageId: string, patch: UpdatePackage): Promise<Package>` — bare `Package` row (matching `addPackage()`'s return shape). Throws `ProblemException({status:404, title:'Offering not found'})` if `{id: offeringId, projectId}` matches no offering, or `ProblemException({status:404, title:'Package not found'})` if `{id: packageId, offeringId}` matches no package (covers a foreign offeringId, an unknown packageId, and a packageId that belongs to a *different* offering in the same project).
  - Route `PATCH /api/v1/projects/:projectId/catalog/offerings/:offeringId/packages/:packageId`, `@RequireProjectRole('admin')` → `200` updated `Package` row | `400` | `403` | `404`.
- No `isUniqueViolation` wrapping needed: `Package`'s only unique constraint is `@@unique([offeringId, identifier])`, and `identifier` is immutable/absent from the schema.
- This is the last task in Section 1: its final step also runs the one-time `mobile_analytics` `tsc --noEmit` check called for in the design's §0 per-service-isolation constraint.

- [ ] **Step 1: Add `updatePackageSchema` to `catalog.schemas.ts`.**
  Immediately after the `createPackageSchema` block, at the end of the file, insert:
  ```ts
  export const updatePackageSchema = z
    .object({
      packageType: z
        .enum(['UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY'])
        .optional(),
      sortOrder: z.number().int().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
  ```

- [ ] **Step 2 (RED): Add the failing service spec cases.**
  Open `backend/mobile_purchase/src/catalog/services/offerings.service.spec.ts`. Change the imports from (C1.3's post-edit state):
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { updateOfferingSchema } from '../support/catalog.schemas';
  import { parseOrThrow } from '../../common/zod';
  import { ProblemException } from '../../common/problem-details';
  import { OfferingsService } from './offerings.service';
  ```
  to:
  ```ts
  import { randomUUID } from 'node:crypto';
  import { PrismaClient } from '../../../generated/client';
  import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
  import { startPostgresContainer } from '../../../test/integration/helpers/containers';
  import { updateOfferingSchema, updatePackageSchema } from '../support/catalog.schemas';
  import { parseOrThrow } from '../../common/zod';
  import { ProblemException } from '../../common/problem-details';
  import { OfferingsService } from './offerings.service';
  ```
  Then append these four tests immediately before the describe block's closing `});` (i.e. after C1.3's four `updateOfferingSchema`/`update()` tests):
  ```ts
  it('updates a package’s packageType and sortOrder', async () => {
    const offering = await service.create(projectId, { identifier: 'pkg-update-happy', displayName: 'Pkg Update' });
    const pkg = await service.addPackage(projectId, offering.id, {
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      productId,
    });

    const updated = await service.updatePackage(projectId, offering.id, pkg.id, {
      packageType: 'ANNUAL',
      sortOrder: 3,
    });

    expect(updated).toMatchObject({ id: pkg.id, packageType: 'ANNUAL', sortOrder: 3 });
  });

  it('updatePackage() 404s for a cross-project/non-existent offering, or a package from a different offering', async () => {
    const otherProjectId = randomUUID();
    const offering = await service.create(projectId, { identifier: 'pkg-update-guard', displayName: 'Guard' });
    const pkg = await service.addPackage(projectId, offering.id, {
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      productId,
    });
    const otherOffering = await service.create(projectId, { identifier: 'pkg-update-guard-2', displayName: 'Guard 2' });

    await expect(service.updatePackage(otherProjectId, offering.id, pkg.id, { sortOrder: 1 })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(service.updatePackage(projectId, randomUUID(), pkg.id, { sortOrder: 1 })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(
      service.updatePackage(projectId, otherOffering.id, pkg.id, { sortOrder: 1 }),
    ).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('updatePackageSchema rejects an empty body (400)', () => {
    let caught: unknown;
    try {
      parseOrThrow(updatePackageSchema, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProblemException);
    expect((caught as ProblemException).problem).toMatchObject({ status: 400 });
  });

  it('updatePackageSchema strips immutable fields (identifier, productId), so they survive an update untouched', async () => {
    const offering = await service.create(projectId, { identifier: 'pkg-update-immutable', displayName: 'Immutable' });
    const pkg = await service.addPackage(projectId, offering.id, {
      identifier: '$rc_monthly',
      packageType: 'MONTHLY',
      productId,
    });
    const otherApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Other App',
        platform: 'ANDROID',
        packageName: `com.other.pkgtest.${randomUUID()}`,
        publicSdkKey: `mp_pub_test_${randomUUID()}`,
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        projectId,
        appId: otherApp.id,
        storeProductId: 'other.product',
        type: 'CONSUMABLE',
        displayName: 'Other Product',
      },
    });

    const patch = parseOrThrow(updatePackageSchema, {
      identifier: 'hijacked-identifier',
      productId: otherProduct.id,
      sortOrder: 5,
    });
    expect(patch).toEqual({ sortOrder: 5 });

    const updated = await service.updatePackage(projectId, offering.id, pkg.id, patch);
    expect(updated).toMatchObject({ identifier: '$rc_monthly', productId, sortOrder: 5 });
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/offerings.service.spec.ts
  ```
  Expected failure:
  ```
  FAIL src/catalog/services/offerings.service.spec.ts
    ● Test suite failed to run

      src/catalog/services/offerings.service.spec.ts:200:35 - error TS2339: Property 'updatePackage' does not exist on type 'OfferingsService'.

  Test Suites: 1 failed, 1 total
  Tests:       0 total
  ```

- [ ] **Step 3 (GREEN): Implement `OfferingsService.updatePackage()`.**
  Open `backend/mobile_purchase/src/catalog/services/offerings.service.ts`. Change the top imports from (C1.3's post-edit state):
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type { createOfferingSchema, createPackageSchema, updateOfferingSchema } from '../support/catalog.schemas';

  type CreateOffering = z.infer<typeof createOfferingSchema>;
  type CreatePackage = z.infer<typeof createPackageSchema>;
  type UpdateOffering = z.infer<typeof updateOfferingSchema>;
  ```
  to:
  ```ts
  import { Injectable } from '@nestjs/common';
  import type { z } from 'zod';
  import { PrismaService } from '../../prisma/prisma.service';
  import { ProblemException } from '../../common/problem-details';
  import type {
    createOfferingSchema,
    createPackageSchema,
    updateOfferingSchema,
    updatePackageSchema,
  } from '../support/catalog.schemas';

  type CreateOffering = z.infer<typeof createOfferingSchema>;
  type CreatePackage = z.infer<typeof createPackageSchema>;
  type UpdateOffering = z.infer<typeof updateOfferingSchema>;
  type UpdatePackage = z.infer<typeof updatePackageSchema>;
  ```
  Insert the following method between `addPackage()` and `removePackage()`:
  ```ts
    async updatePackage(projectId: string, offeringId: string, packageId: string, patch: UpdatePackage) {
      const offering = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
      if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
      const pkg = await this.prisma.package.findFirst({ where: { id: packageId, offeringId } });
      if (!pkg) throw new ProblemException({ status: 404, title: 'Package not found' });
      return this.prisma.package.update({
        where: { id: packageId },
        data: { packageType: patch.packageType, sortOrder: patch.sortOrder },
      });
    }

  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest src/catalog/services/offerings.service.spec.ts
  ```
  Expected:
  ```
  PASS src/catalog/services/offerings.service.spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       19 passed, 19 total
  ```

- [ ] **Step 4 (RED): Add the failing e2e route test.**
  Open `backend/mobile_purchase/test/e2e/catalog.e2e-spec.ts`. Append immediately before the describe block's closing `});` (i.e. after C1.3's `PATCH offerings/:offeringId` test):
  ```ts
  it('PATCH offerings/:offeringId/packages/:packageId — 200 as admin (updates packageType/sortOrder), 403 as viewer, 404 for unknown id', async () => {
    fakeAccess.role = 'admin';
    const projectId = randomUUID();
    const http = app.getHttpServer();

    const pkgApp = await prisma.app.create({
      data: {
        projectId,
        name: 'Pkg App',
        platform: 'IOS',
        bundleId: `com.pkg.${randomUUID()}`,
        publicSdkKey: generatePublicSdkKey(),
      },
    });
    const product = await prisma.product.create({
      data: {
        projectId,
        appId: pkgApp.id,
        storeProductId: 'pkg.monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Monthly',
      },
    });
    const offering = await prisma.offering.create({
      data: { projectId, identifier: 'pkg-patch-offering', displayName: 'Pkg Patch' },
    });
    const pkg = await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_monthly', packageType: 'MONTHLY', productId: product.id },
    });

    const res = await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${offering.id}/packages/${pkg.id}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ packageType: 'ANNUAL', sortOrder: 2 })
      .expect(200);
    expect(res.body).toMatchObject({ id: pkg.id, packageType: 'ANNUAL', sortOrder: 2 });

    fakeAccess.role = 'viewer';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${offering.id}/packages/${pkg.id}`)
      .set('Authorization', 'Bearer viewer-token')
      .send({ sortOrder: 9 })
      .expect(403);

    fakeAccess.role = 'admin';
    await request(http)
      .patch(`/api/v1/projects/${projectId}/catalog/offerings/${offering.id}/packages/${randomUUID()}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ sortOrder: 9 })
      .expect(404);
  });
  ```
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected failure:
  ```
  FAIL test/e2e/catalog.e2e-spec.ts
    ● Catalog e2e — module wiring, both guards, public SDK offerings endpoint › PATCH offerings/:offeringId/packages/:packageId — 200 as admin ...

      Error: expected 200 "OK", got 404 "Not Found"

  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 5 passed, 6 total
  ```

- [ ] **Step 5 (GREEN): Add the `@Patch(':offeringId/packages/:packageId')` controller handler.**
  Open `backend/mobile_purchase/src/catalog/controllers/offerings.controller.ts`. Change the top imports from (C1.3's post-edit state):
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import { createOfferingSchema, createPackageSchema, updateOfferingSchema } from '../support/catalog.schemas';
  import { OfferingsService } from '../services/offerings.service';
  ```
  to:
  ```ts
  import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
  import { parseOrThrow } from '../../common/zod';
  import { ProjectAccessGuard } from '../../authz/project-access.guard';
  import { RequireProjectRole } from '../../authz/require-project-role.decorator';
  import {
    createOfferingSchema,
    createPackageSchema,
    updateOfferingSchema,
    updatePackageSchema,
  } from '../support/catalog.schemas';
  import { OfferingsService } from '../services/offerings.service';
  ```
  Insert the following handler between `addPackage()` and `removePackage()`:
  ```ts
    @Patch(':offeringId/packages/:packageId')
    @RequireProjectRole('admin')
    updatePackage(
      @Param('projectId') projectId: string,
      @Param('offeringId') offeringId: string,
      @Param('packageId') packageId: string,
      @Body() body: unknown,
    ) {
      return this.service.updatePackage(projectId, offeringId, packageId, parseOrThrow(updatePackageSchema, body));
    }

  ```
  (i.e. `list()` → `create()` → `setCurrent()` → `update()` → `remove()` → `addPackage()` → `updatePackage()` → `removePackage()`.)
  Run:
  ```bash
  cd backend/mobile_purchase && npx jest test/e2e/catalog.e2e-spec.ts
  ```
  Expected:
  ```
  PASS test/e2e/catalog.e2e-spec.ts
  Test Suites: 1 passed, 1 total
  Tests:       6 passed, 6 total
  ```

- [ ] **Step 6: Typecheck both backends (per §0's per-service-isolation constraint — this is the one-time `mobile_analytics` check for Section 1).**
  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  cd backend/mobile_analytics && npx tsc --noEmit
  ```
  Expected: no output from either command, exit code 0 for both. (`mobile_analytics` is unaffected — Section 1 makes no Prisma schema change and touches no `mobile_analytics` file.)

- [ ] **Step 7: Commit.**
  ```bash
  cd backend/mobile_purchase && git add src/catalog/support/catalog.schemas.ts src/catalog/services/offerings.service.ts src/catalog/services/offerings.service.spec.ts src/catalog/controllers/offerings.controller.ts test/e2e/catalog.e2e-spec.ts
  git commit -m "$(cat <<'EOF'
  feat(mobile_purchase): PATCH offering packages (edit packageType, sortOrder)
  EOF
  )"
  ```
  Expected: commit succeeds; `git status` shows a clean tree for these five files.


---

### Task C2.1: Dashboard catalog-api hooks over `purchaseApiFetch`

**Files**
- Create: `dashboard/src/features/revenuecat/catalog-api.ts`
- Create: `dashboard/src/features/revenuecat/catalog-api.test.ts`

**Interfaces**

Consumes:
- `purchaseApiFetch<T>(path, options?)` from `dashboard/src/lib/api/purchase-client.ts` — `signature: (path: string, options?: ApiFetchOptions) => Promise<T>` where `ApiFetchOptions = { method?, body?: unknown, headers?, ...RequestInit-minus-body/headers }`. Bearer JWT from `authStore.getState().accessToken`, RFC-7807 → `ApiError`, 204 → `undefined as T`.
- `authStore.setSession(accessToken, user)` from `dashboard/src/features/auth/store.ts` — used only in the test file to authenticate the MSW-mocked calls.
- `TEST_PROJECT`, `TEST_USER`, `VALID_ACCESS_TOKEN` from `dashboard/src/test/msw/handlers.ts` — used only in the test file.

Produces (consumed by later Products/Entitlements/Offerings page tasks, C3.x+):
- Response types: `RcApp`, `RcEntitlement`, `RcProduct` (with `entitlements: RcEntitlement[]`), `RcOffering` (with `packages: RcPackage[]`), `RcPackage`, plus the platform/type unions `RcAppPlatform`, `RcProductType`, `RcPackageType`.
- Request-body types: `CreateRcAppInput`, `CreateRcEntitlementInput`, `UpdateRcEntitlementInput`, `CreateRcProductInput`, `UpdateRcProductInput`, `CreateRcOfferingInput`, `UpdateRcOfferingInput`, `CreateRcPackageInput`, `UpdateRcPackageInput`.
- `rcCatalogKey(projectId: string, resource: 'apps' | 'entitlements' | 'products' | 'offerings')` — the exact query-key tuple `['rc-catalog', projectId, resource]`.
- Query hooks (each `(projectId: string) => UseQueryResult<T[]>`): `useRcApps`, `useRcEntitlements`, `useRcProducts`, `useRcOfferings`.
- Mutation hooks (each `(projectId: string) => UseMutationResult<...>`, `mutate` argument shown per hook):
  - `useCreateRcApp` — `mutate(input: CreateRcAppInput)` → `RcApp`
  - `useDeleteRcApp` — `mutate(appId: string)` → `void`
  - `useCreateRcEntitlement` — `mutate(input: CreateRcEntitlementInput)` → `RcEntitlement`
  - `useUpdateRcEntitlement` — `mutate({ id: string } & UpdateRcEntitlementInput)` → `RcEntitlement`
  - `useDeleteRcEntitlement` — `mutate(entitlementId: string)` → `void`
  - `useCreateRcProduct` — `mutate(input: CreateRcProductInput)` → `RcProduct`
  - `useUpdateRcProduct` — `mutate({ id: string } & UpdateRcProductInput)` → `RcProduct`
  - `useDeleteRcProduct` — `mutate(productId: string)` → `void`
  - `useAttachEntitlement` — `mutate({ productId: string; entitlementId: string })` → `void`
  - `useDetachEntitlement` — `mutate({ productId: string; entitlementId: string })` → `void`
  - `useCreateRcOffering` — `mutate(input: CreateRcOfferingInput)` → `RcOffering`
  - `useUpdateRcOffering` — `mutate({ id: string } & UpdateRcOfferingInput)` → `RcOffering`
  - `useDeleteRcOffering` — `mutate(offeringId: string)` → `void`
  - `useSetCurrentOffering` — `mutate(offeringId: string)` → `void`
  - `useAddPackage` — `mutate({ offeringId: string } & CreateRcPackageInput)` → `RcPackage`
  - `useUpdatePackage` — `mutate({ offeringId: string; packageId: string } & UpdateRcPackageInput)` → `RcPackage`
  - `useRemovePackage` — `mutate({ offeringId: string; packageId: string })` → `void`

All list queries use `rcCatalogKey(projectId, resource)` as their `queryKey`; every mutation's `onSuccess` invalidates that same key (attach/detach entitlement and add/update/remove-package invalidate `'products'`/`'offerings'` respectively since they nest under and are returned inline with those resources — this **is** the cross-invalidation spec §2/§4 calls for, not an additional third key).

**HARD WIP RULE**: this task creates only the two files listed above under `dashboard/src/features/revenuecat/`. Never create, modify, stage, or format `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, any layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, or `dashboard/src/test/render-app.tsx`. `nav-model.ts` is never edited. `git add` only the two exact files this task creates. End with a `git status` WIP check (Step 6).

---

- [ ] **Step 1: Write the failing test file `catalog-api.test.ts`**

  Create `dashboard/src/features/revenuecat/catalog-api.test.ts` with the complete content below. It mirrors the `purchase-metrics-api.test.ts` MSW hook-test pattern exactly (`QueryClientProvider` wrapper via `renderHook`, `authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER)` before each test, `server.use(...)` per-test overrides) and additionally uses `act` from `@testing-library/react` to fire mutations (the same `act`+`renderHook` pairing already used in `dashboard/src/features/analytics/annotations.test.ts`). It covers, per resource: the list hook's GET path + parsed body, a create hook's POST body, an update hook's PATCH path+body, a delete hook's DELETE path, plus the two named nested/cross-cutting cases — `useAttachEntitlement` POSTing to `products/:id/entitlements` and proving the `products` list query is invalidated (a second `useRcProducts` GET fires after the mutation succeeds), `useDetachEntitlement` DELETEing the same nested path, `useSetCurrentOffering` POSTing to `offerings/:id/current` and proving the `offerings` list query is invalidated, and `useAddPackage`/`useUpdatePackage`/`useRemovePackage` hitting `offerings/:id/packages(/:id)`.

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
    rcCatalogKey,
    useAddPackage,
    useAttachEntitlement,
    useCreateRcApp,
    useCreateRcEntitlement,
    useCreateRcOffering,
    useCreateRcProduct,
    useDeleteRcApp,
    useDeleteRcEntitlement,
    useDeleteRcOffering,
    useDeleteRcProduct,
    useDetachEntitlement,
    useRcApps,
    useRcEntitlements,
    useRcOfferings,
    useRcProducts,
    useRemovePackage,
    useSetCurrentOffering,
    useUpdatePackage,
    useUpdateRcEntitlement,
    useUpdateRcOffering,
    useUpdateRcProduct,
    type RcApp,
    type RcEntitlement,
    type RcOffering,
    type RcPackage,
    type RcProduct,
  } from './catalog-api';

  const PID = TEST_PROJECT.id;
  const BASE = `/api/v1/projects/${PID}/catalog`;

  const APP: RcApp = {
    id: 'app-1',
    name: 'Demo iOS',
    platform: 'IOS',
    bundleId: 'com.demo.app',
    packageName: null,
    publicSdkKey: 'mp_pub_abc123',
  };

  const ENTITLEMENT: RcEntitlement = { id: 'ent-1', identifier: 'pro', displayName: 'Pro' };

  const PRODUCT: RcProduct = {
    id: 'prod-1',
    appId: 'app-1',
    storeProductId: 'pro_monthly',
    type: 'AUTO_RENEWABLE_SUBSCRIPTION',
    displayName: 'Pro Monthly',
    priceCents: 999,
    currency: 'USD',
    durationIso8601: 'P1M',
    subscriptionGroupId: null,
    entitlements: [ENTITLEMENT],
  };

  const PACKAGE: RcPackage = {
    id: 'pkg-1',
    identifier: '$rc_monthly',
    packageType: 'MONTHLY',
    productId: 'prod-1',
    sortOrder: 0,
  };

  const OFFERING: RcOffering = {
    id: 'off-1',
    identifier: 'default',
    displayName: 'Default',
    isCurrent: true,
    metadata: null,
    packages: [PACKAGE],
  };

  function wrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  describe('rcCatalogKey', () => {
    it('is keyed by project and resource', () => {
      expect(rcCatalogKey(PID, 'apps')).toEqual(['rc-catalog', PID, 'apps']);
      expect(rcCatalogKey(PID, 'products')).not.toEqual(rcCatalogKey(PID, 'offerings'));
    });
  });

  describe('apps', () => {
    it('useRcApps GETs the apps list and returns the parsed body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.get(`${BASE}/apps`, ({ request }) => {
          seenUrl = request.url;
          return HttpResponse.json([APP]);
        }),
      );

      const { result } = renderHook(() => useRcApps(PID), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([APP]);
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/apps`);
    });

    it('useCreateRcApp POSTs the body and returns the created app', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenBody: unknown;
      server.use(
        http.post(`${BASE}/apps`, async ({ request }) => {
          seenBody = await request.json();
          return HttpResponse.json(APP, { status: 201 });
        }),
      );

      const { result } = renderHook(() => useCreateRcApp(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ name: 'Demo iOS', platform: 'IOS', bundleId: 'com.demo.app' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenBody).toEqual({ name: 'Demo iOS', platform: 'IOS', bundleId: 'com.demo.app' });
      expect(result.current.data).toEqual(APP);
    });

    it('useDeleteRcApp DELETEs the app by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/apps/:appId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useDeleteRcApp(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate('app-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/apps/app-1`);
    });
  });

  describe('entitlements', () => {
    it('useRcEntitlements GETs the entitlements list and returns the parsed body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      server.use(http.get(`${BASE}/entitlements`, () => HttpResponse.json([ENTITLEMENT])));

      const { result } = renderHook(() => useRcEntitlements(PID), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([ENTITLEMENT]);
    });

    it('useCreateRcEntitlement POSTs the body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenBody: unknown;
      server.use(
        http.post(`${BASE}/entitlements`, async ({ request }) => {
          seenBody = await request.json();
          return HttpResponse.json(ENTITLEMENT, { status: 201 });
        }),
      );

      const { result } = renderHook(() => useCreateRcEntitlement(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ identifier: 'pro', displayName: 'Pro' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenBody).toEqual({ identifier: 'pro', displayName: 'Pro' });
    });

    it('useUpdateRcEntitlement PATCHes the entitlement by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      server.use(
        http.patch(`${BASE}/entitlements/:entitlementId`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json({ ...ENTITLEMENT, displayName: 'Pro tier' });
        }),
      );

      const { result } = renderHook(() => useUpdateRcEntitlement(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ id: 'ent-1', displayName: 'Pro tier' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/entitlements/ent-1`);
      expect(seenBody).toEqual({ displayName: 'Pro tier' });
      expect(result.current.data?.displayName).toBe('Pro tier');
    });

    it('useDeleteRcEntitlement DELETEs the entitlement by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/entitlements/:entitlementId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useDeleteRcEntitlement(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate('ent-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/entitlements/ent-1`);
    });
  });

  describe('products', () => {
    it('useRcProducts GETs the products list including nested entitlements', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      server.use(http.get(`${BASE}/products`, () => HttpResponse.json([PRODUCT])));

      const { result } = renderHook(() => useRcProducts(PID), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([PRODUCT]);
      expect(result.current.data?.[0]?.entitlements).toEqual([ENTITLEMENT]);
    });

    it('useCreateRcProduct POSTs the body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenBody: unknown;
      server.use(
        http.post(`${BASE}/products`, async ({ request }) => {
          seenBody = await request.json();
          return HttpResponse.json(PRODUCT, { status: 201 });
        }),
      );

      const { result } = renderHook(() => useCreateRcProduct(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({
          appId: 'app-1',
          storeProductId: 'pro_monthly',
          type: 'AUTO_RENEWABLE_SUBSCRIPTION',
          displayName: 'Pro Monthly',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenBody).toEqual({
        appId: 'app-1',
        storeProductId: 'pro_monthly',
        type: 'AUTO_RENEWABLE_SUBSCRIPTION',
        displayName: 'Pro Monthly',
      });
    });

    it('useUpdateRcProduct PATCHes the product by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      server.use(
        http.patch(`${BASE}/products/:productId`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json({ ...PRODUCT, displayName: 'Pro Monthly (renamed)' });
        }),
      );

      const { result } = renderHook(() => useUpdateRcProduct(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ id: 'prod-1', displayName: 'Pro Monthly (renamed)' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1`);
      expect(seenBody).toEqual({ displayName: 'Pro Monthly (renamed)' });
    });

    it('useDeleteRcProduct DELETEs the product by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/products/:productId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useDeleteRcProduct(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate('prod-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1`);
    });

    it('useAttachEntitlement POSTs to the nested products/:id/entitlements path and invalidates products', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      let listCalls = 0;
      server.use(
        http.get(`${BASE}/products`, () => {
          listCalls += 1;
          return HttpResponse.json([PRODUCT]);
        }),
        http.post(`${BASE}/products/:productId/entitlements`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const Wrapper = wrapper();
      const list = renderHook(() => useRcProducts(PID), { wrapper: Wrapper });
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
      expect(listCalls).toBe(1);

      const attach = renderHook(() => useAttachEntitlement(PID), { wrapper: Wrapper });
      act(() => {
        attach.result.current.mutate({ productId: 'prod-1', entitlementId: 'ent-2' });
      });

      await waitFor(() => expect(attach.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1/entitlements`);
      expect(seenBody).toEqual({ entitlementId: 'ent-2' });
      // The products list query was invalidated by the attach mutation and refetched.
      await waitFor(() => expect(listCalls).toBe(2));
    });

    it('useDetachEntitlement DELETEs the nested products/:id/entitlements/:id path', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/products/:productId/entitlements/:entitlementId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useDetachEntitlement(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ productId: 'prod-1', entitlementId: 'ent-1' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/products/prod-1/entitlements/ent-1`);
    });
  });

  describe('offerings', () => {
    it('useRcOfferings GETs the offerings list including nested packages', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      server.use(http.get(`${BASE}/offerings`, () => HttpResponse.json([OFFERING])));

      const { result } = renderHook(() => useRcOfferings(PID), { wrapper: wrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([OFFERING]);
      expect(result.current.data?.[0]?.packages).toEqual([PACKAGE]);
    });

    it('useCreateRcOffering POSTs the body', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenBody: unknown;
      server.use(
        http.post(`${BASE}/offerings`, async ({ request }) => {
          seenBody = await request.json();
          return HttpResponse.json(OFFERING, { status: 201 });
        }),
      );

      const { result } = renderHook(() => useCreateRcOffering(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ identifier: 'default', displayName: 'Default' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenBody).toEqual({ identifier: 'default', displayName: 'Default' });
    });

    it('useUpdateRcOffering PATCHes the offering by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      server.use(
        http.patch(`${BASE}/offerings/:offeringId`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json({ ...OFFERING, displayName: 'Default (renamed)' });
        }),
      );

      const { result } = renderHook(() => useUpdateRcOffering(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ id: 'off-1', displayName: 'Default (renamed)' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1`);
      expect(seenBody).toEqual({ displayName: 'Default (renamed)' });
    });

    it('useDeleteRcOffering DELETEs the offering by id', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/offerings/:offeringId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useDeleteRcOffering(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate('off-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1`);
    });

    it('useSetCurrentOffering POSTs to offerings/:id/current and invalidates offerings', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let listCalls = 0;
      server.use(
        http.get(`${BASE}/offerings`, () => {
          listCalls += 1;
          return HttpResponse.json([OFFERING]);
        }),
        http.post(`${BASE}/offerings/:offeringId/current`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const Wrapper = wrapper();
      const list = renderHook(() => useRcOfferings(PID), { wrapper: Wrapper });
      await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
      expect(listCalls).toBe(1);

      const setCurrent = renderHook(() => useSetCurrentOffering(PID), { wrapper: Wrapper });
      act(() => {
        setCurrent.result.current.mutate('off-2');
      });

      await waitFor(() => expect(setCurrent.result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-2/current`);
      await waitFor(() => expect(listCalls).toBe(2));
    });

    it('useAddPackage POSTs to the nested offerings/:id/packages path', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      server.use(
        http.post(`${BASE}/offerings/:offeringId/packages`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json(PACKAGE, { status: 201 });
        }),
      );

      const { result } = renderHook(() => useAddPackage(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({
          offeringId: 'off-1',
          identifier: '$rc_monthly',
          packageType: 'MONTHLY',
          productId: 'prod-1',
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages`);
      expect(seenBody).toEqual({ identifier: '$rc_monthly', packageType: 'MONTHLY', productId: 'prod-1' });
    });

    it('useUpdatePackage PATCHes the nested offerings/:id/packages/:id path', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      let seenBody: unknown;
      server.use(
        http.patch(`${BASE}/offerings/:offeringId/packages/:packageId`, async ({ request }) => {
          seenUrl = request.url;
          seenBody = await request.json();
          return HttpResponse.json({ ...PACKAGE, sortOrder: 2 });
        }),
      );

      const { result } = renderHook(() => useUpdatePackage(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ offeringId: 'off-1', packageId: 'pkg-1', sortOrder: 2 });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages/pkg-1`);
      expect(seenBody).toEqual({ sortOrder: 2 });
    });

    it('useRemovePackage DELETEs the nested offerings/:id/packages/:id path', async () => {
      authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
      let seenUrl = '';
      server.use(
        http.delete(`${BASE}/offerings/:offeringId/packages/:packageId`, ({ request }) => {
          seenUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { result } = renderHook(() => useRemovePackage(PID), { wrapper: wrapper() });
      act(() => {
        result.current.mutate({ offeringId: 'off-1', packageId: 'pkg-1' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(seenUrl).toBe(`http://localhost:3000${BASE}/offerings/off-1/packages/pkg-1`);
    });
  });
  ```

- [ ] **Step 2: Run the test file and confirm it fails because `catalog-api.ts` does not exist yet**

  Command (from `dashboard/`):
  ```bash
  npx vitest run src/features/revenuecat/catalog-api.test.ts
  ```
  Expected failure — a resolve-import error, since the module has not been created:
  ```
   RUN  v3.2.6 /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard

  ⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

   FAIL  src/features/revenuecat/catalog-api.test.ts [ src/features/revenuecat/catalog-api.test.ts ]
  Error: Failed to resolve import "./catalog-api" from "src/features/revenuecat/catalog-api.test.ts". Does the file exist?
  ...
   Test Files  1 failed (1)
        Tests  no tests
  ```

- [ ] **Step 3: Write the implementation `catalog-api.ts`**

  Create `dashboard/src/features/revenuecat/catalog-api.ts` with the complete content below. It mirrors `purchase-metrics-api.ts`'s base-URL/query-key pattern and `features/projects/api.ts`'s `useMutation` + `useQueryClient().invalidateQueries` mutation pattern (including its `({ id, ...body })` combined-argument convention for id+body mutations, e.g. `useUpdateProjectMemberRole`'s `({ userId, role })`).

  ```ts
  import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
  import { purchaseApiFetch } from '../../lib/api/purchase-client';

  /**
   * TanStack Query hooks over the `mobile_purchase` catalog admin API (design
   * `2026-07-18-myrevenuecat-catalog-config-uis-design.md` §2/§9) — the RevenueCat-shaped catalog
   * model: App → Products (attach Entitlements) → Offerings group Packages, each wrapping a Product.
   * Every mutation goes through {@link purchaseApiFetch} (bearer JWT + RFC-7807 → `ApiError`,
   * mirroring `purchaseMetricsBase`/`purchaseApiFetch` from `purchase-metrics-api.ts`) and invalidates
   * its resource's list query on success; §2's two documented cross-invalidations (attaching/detaching
   * an entitlement changes the *products* list; setting the current offering changes the *offerings*
   * list) are handled by invalidating that resource's key directly, since both nest under it.
   */

  // --- Apps (§9: `GET …/catalog/apps` → `RcApp[]`; storeCredentials never returned) ---

  export type RcAppPlatform = 'IOS' | 'ANDROID' | 'MACOS' | 'AMAZON' | 'WEB';

  export interface RcApp {
    id: string;
    name: string;
    platform: RcAppPlatform;
    bundleId?: string | null;
    packageName?: string | null;
    publicSdkKey: string;
  }

  export interface CreateRcAppInput {
    name: string;
    platform: RcAppPlatform;
    bundleId?: string;
    packageName?: string;
  }

  // --- Entitlements (§9: `GET …/catalog/entitlements` → `RcEntitlement[]`) ---

  export interface RcEntitlement {
    id: string;
    identifier: string;
    displayName: string;
  }

  export interface CreateRcEntitlementInput {
    identifier: string;
    displayName: string;
  }

  /** §1: only `displayName` is editable via `PATCH …/catalog/entitlements/:id`; `identifier` is immutable. */
  export interface UpdateRcEntitlementInput {
    displayName: string;
  }

  // --- Products (§9: `GET …/catalog/products` → `RcProduct[]`, with `entitlements: RcEntitlement[]`) ---

  export type RcProductType =
    | 'AUTO_RENEWABLE_SUBSCRIPTION'
    | 'NON_RENEWING_SUBSCRIPTION'
    | 'CONSUMABLE'
    | 'NON_CONSUMABLE';

  export interface RcProduct {
    id: string;
    appId: string;
    storeProductId: string;
    type: RcProductType;
    displayName: string;
    priceCents?: number | null;
    currency?: string | null;
    durationIso8601?: string | null;
    subscriptionGroupId?: string | null;
    entitlements: RcEntitlement[];
  }

  export interface CreateRcProductInput {
    appId: string;
    storeProductId: string;
    type: RcProductType;
    displayName: string;
    priceCents?: number;
    currency?: string;
    durationIso8601?: string;
    subscriptionGroupId?: string;
  }

  /** §1: editable fields only; `appId`/`storeProductId`/`type` are immutable via `PATCH …/products/:id`. */
  export interface UpdateRcProductInput {
    displayName?: string;
    priceCents?: number;
    currency?: string;
    durationIso8601?: string;
    subscriptionGroupId?: string;
  }

  // --- Offerings & Packages (§9: `GET …/catalog/offerings` → `RcOffering[]`, with `packages: RcPackage[]`) ---

  export type RcPackageType =
    | 'UNKNOWN'
    | 'CUSTOM'
    | 'LIFETIME'
    | 'ANNUAL'
    | 'SIX_MONTH'
    | 'THREE_MONTH'
    | 'TWO_MONTH'
    | 'MONTHLY'
    | 'WEEKLY';

  export interface RcPackage {
    id: string;
    identifier: string;
    packageType: RcPackageType;
    productId: string;
    sortOrder: number;
  }

  export interface RcOffering {
    id: string;
    identifier: string;
    displayName: string;
    isCurrent: boolean;
    metadata: unknown;
    packages: RcPackage[];
  }

  export interface CreateRcOfferingInput {
    identifier: string;
    displayName: string;
    isCurrent?: boolean;
    metadata?: unknown;
  }

  /** §1: editable fields only; `identifier`/`isCurrent` are immutable via `PATCH …/offerings/:id`
   *  (use `useSetCurrentOffering` for `isCurrent`). */
  export interface UpdateRcOfferingInput {
    displayName?: string;
    metadata?: unknown;
  }

  export interface CreateRcPackageInput {
    identifier: string;
    packageType: RcPackageType;
    productId: string;
    sortOrder?: number;
  }

  /** §1: editable fields only; `identifier`/`productId` are immutable via
   *  `PATCH …/offerings/:offeringId/packages/:packageId`. */
  export interface UpdateRcPackageInput {
    packageType?: RcPackageType;
    sortOrder?: number;
  }

  // --- Query keys & base URL ---

  type RcCatalogResource = 'apps' | 'entitlements' | 'products' | 'offerings';

  const catalogBase = (projectId: string) => `/api/v1/projects/${projectId}/catalog`;

  /** `['rc-catalog', projectId, <resource>]` (spec §2) — packages have no key of their own since
   *  every package endpoint nests under, and is returned inline with, `offerings`. */
  export function rcCatalogKey(projectId: string, resource: RcCatalogResource) {
    return ['rc-catalog', projectId, resource] as const;
  }

  function invalidateResource(
    queryClient: ReturnType<typeof useQueryClient>,
    projectId: string,
    resource: RcCatalogResource,
  ) {
    void queryClient.invalidateQueries({ queryKey: rcCatalogKey(projectId, resource) });
  }

  // --- Apps hooks ---

  export function useRcApps(projectId: string) {
    return useQuery({
      queryKey: rcCatalogKey(projectId, 'apps'),
      queryFn: () => purchaseApiFetch<RcApp[]>(`${catalogBase(projectId)}/apps`),
    });
  }

  export function useCreateRcApp(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: CreateRcAppInput) =>
        purchaseApiFetch<RcApp>(`${catalogBase(projectId)}/apps`, { method: 'POST', body: input }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'apps'),
    });
  }

  export function useDeleteRcApp(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (appId: string) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/apps/${appId}`, { method: 'DELETE' }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'apps'),
    });
  }

  // --- Entitlements hooks ---

  export function useRcEntitlements(projectId: string) {
    return useQuery({
      queryKey: rcCatalogKey(projectId, 'entitlements'),
      queryFn: () => purchaseApiFetch<RcEntitlement[]>(`${catalogBase(projectId)}/entitlements`),
    });
  }

  export function useCreateRcEntitlement(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: CreateRcEntitlementInput) =>
        purchaseApiFetch<RcEntitlement>(`${catalogBase(projectId)}/entitlements`, {
          method: 'POST',
          body: input,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
    });
  }

  export function useUpdateRcEntitlement(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, ...body }: { id: string } & UpdateRcEntitlementInput) =>
        purchaseApiFetch<RcEntitlement>(`${catalogBase(projectId)}/entitlements/${id}`, {
          method: 'PATCH',
          body,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
    });
  }

  export function useDeleteRcEntitlement(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (entitlementId: string) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/entitlements/${entitlementId}`, {
          method: 'DELETE',
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'entitlements'),
    });
  }

  // --- Products hooks ---

  export function useRcProducts(projectId: string) {
    return useQuery({
      queryKey: rcCatalogKey(projectId, 'products'),
      queryFn: () => purchaseApiFetch<RcProduct[]>(`${catalogBase(projectId)}/products`),
    });
  }

  export function useCreateRcProduct(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: CreateRcProductInput) =>
        purchaseApiFetch<RcProduct>(`${catalogBase(projectId)}/products`, {
          method: 'POST',
          body: input,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
    });
  }

  export function useUpdateRcProduct(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, ...body }: { id: string } & UpdateRcProductInput) =>
        purchaseApiFetch<RcProduct>(`${catalogBase(projectId)}/products/${id}`, {
          method: 'PATCH',
          body,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
    });
  }

  export function useDeleteRcProduct(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (productId: string) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/products/${productId}`, {
          method: 'DELETE',
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
    });
  }

  /** `POST …/products/:productId/entitlements` (§9: attach returns 204) — cross-invalidates
   *  `products` (its own resource: the change is only visible on the product's `entitlements` array). */
  export function useAttachEntitlement(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ productId, entitlementId }: { productId: string; entitlementId: string }) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/products/${productId}/entitlements`, {
          method: 'POST',
          body: { entitlementId },
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
    });
  }

  /** `DELETE …/products/:productId/entitlements/:entitlementId` (§9: detach returns 204). */
  export function useDetachEntitlement(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ productId, entitlementId }: { productId: string; entitlementId: string }) =>
        purchaseApiFetch<void>(
          `${catalogBase(projectId)}/products/${productId}/entitlements/${entitlementId}`,
          { method: 'DELETE' },
        ),
      onSuccess: () => invalidateResource(queryClient, projectId, 'products'),
    });
  }

  // --- Offerings & Packages hooks ---

  export function useRcOfferings(projectId: string) {
    return useQuery({
      queryKey: rcCatalogKey(projectId, 'offerings'),
      queryFn: () => purchaseApiFetch<RcOffering[]>(`${catalogBase(projectId)}/offerings`),
    });
  }

  export function useCreateRcOffering(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: CreateRcOfferingInput) =>
        purchaseApiFetch<RcOffering>(`${catalogBase(projectId)}/offerings`, {
          method: 'POST',
          body: input,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  export function useUpdateRcOffering(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, ...body }: { id: string } & UpdateRcOfferingInput) =>
        purchaseApiFetch<RcOffering>(`${catalogBase(projectId)}/offerings/${id}`, {
          method: 'PATCH',
          body,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  export function useDeleteRcOffering(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (offeringId: string) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/offerings/${offeringId}`, {
          method: 'DELETE',
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  /** `POST …/offerings/:offeringId/current` (§9/§1: flips the project's single current offering,
   *  204 no body) — invalidates `offerings` so the flip is reflected across the list. */
  export function useSetCurrentOffering(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (offeringId: string) =>
        purchaseApiFetch<void>(`${catalogBase(projectId)}/offerings/${offeringId}/current`, {
          method: 'POST',
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  /** `POST …/offerings/:offeringId/packages` — packages are returned inline on `offerings`, so this
   *  invalidates `offerings` rather than a separate packages key. */
  export function useAddPackage(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ offeringId, ...body }: { offeringId: string } & CreateRcPackageInput) =>
        purchaseApiFetch<RcPackage>(`${catalogBase(projectId)}/offerings/${offeringId}/packages`, {
          method: 'POST',
          body,
        }),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  export function useUpdatePackage(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({
        offeringId,
        packageId,
        ...body
      }: { offeringId: string; packageId: string } & UpdateRcPackageInput) =>
        purchaseApiFetch<RcPackage>(
          `${catalogBase(projectId)}/offerings/${offeringId}/packages/${packageId}`,
          { method: 'PATCH', body },
        ),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }

  /** `DELETE …/offerings/:offeringId/packages/:packageId` (§9: removePackage returns 204). */
  export function useRemovePackage(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ offeringId, packageId }: { offeringId: string; packageId: string }) =>
        purchaseApiFetch<void>(
          `${catalogBase(projectId)}/offerings/${offeringId}/packages/${packageId}`,
          { method: 'DELETE' },
        ),
      onSuccess: () => invalidateResource(queryClient, projectId, 'offerings'),
    });
  }
  ```

- [ ] **Step 4: Run the test file again and confirm it passes**

  Command (from `dashboard/`):
  ```bash
  npx vitest run src/features/revenuecat/catalog-api.test.ts
  ```
  Expected output (verified — this exact command was run against this exact pair of files):
  ```
   RUN  v3.2.6 /Users/aimeric/Documents/personnal-project/MyAmpix/dashboard

   ✓ src/features/revenuecat/catalog-api.test.ts (22 tests) 1338ms

   Test Files  1 passed (1)
        Tests  22 passed (22)
  ```

- [ ] **Step 5: Typecheck and lint**

  Commands (from `dashboard/`):
  ```bash
  npx tsc --noEmit
  npx eslint src/features/revenuecat/catalog-api.ts src/features/revenuecat/catalog-api.test.ts
  ```
  Both produce no output (0 errors) — verified. (`data?.[0]` on an array under `noUncheckedIndexedAccess` types as `RcProduct | undefined`, so the two nested-shape assertions in Step 1's test use `data?.[0]?.entitlements` / `data?.[0]?.packages`, not `data?.[0].entitlements` — already reflected in the Step 1 code above.)

- [ ] **Step 6: WIP-safety check, then commit**

  ```bash
  git status --porcelain -- dashboard/src/features/revenuecat/
  ```
  Expected: only the two new files, both untracked (`??`):
  ```
  ?? dashboard/src/features/revenuecat/catalog-api.test.ts
  ?? dashboard/src/features/revenuecat/catalog-api.ts
  ```
  Confirm none of the collapse-rail WIP paths appear (`dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, any layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, `dashboard/src/test/render-app.tsx`) — if any of them show as modified in the wider `git status`, they were already dirty before this task and must NOT be staged.

  Stage only this task's two files and commit:
  ```bash
  git add dashboard/src/features/revenuecat/catalog-api.ts dashboard/src/features/revenuecat/catalog-api.test.ts
  git commit -m "feat(rc-catalog): dashboard catalog-api hooks over purchaseApiFetch"
  ```


---

### Task C3.1: `RcEntitlementsPage` + wire `/rc/entitlements`

**Files:**
- Create: `dashboard/src/features/revenuecat/components/RcEntitlementsPage.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-entitlements.test.tsx`
- Modify: `dashboard/src/router.tsx` (one new import + the `rcEntitlementsRoute` `component:` line)

**Interfaces:**
- Consumes (from Section 2, `dashboard/src/features/revenuecat/catalog-api.ts` — assumed already produced):
  - `export interface RcEntitlement { id: string; identifier: string; displayName: string; }`
  - `export function useRcEntitlements(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcEntitlement[]>` — standard TanStack Query result (`data`, `isPending`, `isError`, `error`); `opts.enabled` defaults to `true` and must be respected (mirrors `useRcStatus`/`useRcRevenue`'s `opts.enabled` pattern in the existing `revenuecat` slice) so this page can suppress the fetch until RC is confirmed connected.
  - `export function useCreateRcEntitlement(projectId: string): UseMutationResult<RcEntitlement, unknown, { identifier: string; displayName: string }>` — invalidates the entitlements list query on success.
  - `export function useUpdateRcEntitlement(projectId: string): UseMutationResult<RcEntitlement, unknown, { id: string; displayName: string }>` — invalidates the entitlements list query on success.
  - `export function useDeleteRcEntitlement(projectId: string): UseMutationResult<void, unknown, string>` — mutate variable is the entitlement `id` directly (mirrors `useRevokeToken(projectId)`/`useRemoveProjectMember(projectId)` in `features/projects/api.ts`, both of which take the target id as the bare mutate argument); invalidates the entitlements list query on success.
  - Reused as-is (no changes): `useProjects`/`useProjectRole` (`features/projects/api.ts`), `useRcEnabled` (`features/revenuecat/api.ts`), `RcConnectPage`, `PageShell`, `DataTable`, `Dialog*`, `AlertDialog*`, `Button`, `Input`, `Label`, `EmptyState`, `ApiError` (`lib/api/problem.ts`).
- Produces: `export function RcEntitlementsPage(): JSX.Element` from `RcEntitlementsPage.tsx` — consumed directly by `router.tsx`'s `rcEntitlementsRoute.component`.
- Note: spec §3.1's optional "row count of products granting it" column is **not** included — it depends on `useRcProducts` (Task C4.x, not yet built) and is explicitly optional in the spec; this task ships the required `identifier`/`displayName` columns plus row actions only.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/features/revenuecat/components/rc-entitlements.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  orgsState,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';
import type { RcEntitlement } from '../catalog-api';

const ENTITLEMENTS_URL = `/projects/${TEST_PROJECT.id}/rc/entitlements`;
const ENTITLEMENTS_BASE = '/api/v1/projects/:projectId/catalog/entitlements';

const PRO: RcEntitlement = { id: 'ent-pro', identifier: 'pro', displayName: 'Pro' };
const PREMIUM: RcEntitlement = { id: 'ent-premium', identifier: 'premium', displayName: 'Premium' };

function signInAsOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function signInAsAdmin() {
  authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
}

/** Downgrades MFA_USER's explicit role on TEST_PROJECT for the duration of one test — mirrors the
 *  "analyst (read-only)" downgrade in project-members.test.tsx. `resetOrgsState()` (test/setup.ts
 *  afterEach) restores it automatically, so no manual cleanup is needed. */
function downgradeAdminTo(role: 'viewer') {
  const membership = orgsState.projectMemberships.find(
    (m) => m.projectId === TEST_PROJECT.id && m.user.id === MFA_USER.id,
  );
  if (membership) membership.role = role;
}

/** A tiny in-memory CRUD backend for the entitlements endpoints, scoped to one test via
 *  `server.use()` — mirrors rc-charts.test.tsx's local `metrics()` helper. Not shared with
 *  Section 2's hook tests; each test file owns its own MSW fixtures. */
function entitlementsHandlers(initial: RcEntitlement[]) {
  let entitlements = [...initial];
  server.use(
    http.get(ENTITLEMENTS_BASE, () => HttpResponse.json(entitlements)),
    http.post(ENTITLEMENTS_BASE, async ({ request }) => {
      const body = (await request.json()) as { identifier: string; displayName: string };
      const created: RcEntitlement = { id: `ent-${entitlements.length + 1}`, ...body };
      entitlements = [...entitlements, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(`${ENTITLEMENTS_BASE}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { displayName: string };
      const existing = entitlements.find((e) => e.id === params.id);
      if (!existing) {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Entitlement not found', status: 404 },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      const updated: RcEntitlement = { ...existing, displayName: body.displayName };
      entitlements = entitlements.map((e) => (e.id === updated.id ? updated : e));
      return HttpResponse.json(updated);
    }),
    http.delete(`${ENTITLEMENTS_BASE}/:id`, ({ params }) => {
      entitlements = entitlements.filter((e) => e.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

describe('RcEntitlementsPage', () => {
  it('renders the entitlements list', async () => {
    signInAsOwner();
    entitlementsHandlers([PRO, PREMIUM]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('pro')).toBeInTheDocument();
    expect(main.getByText('Pro')).toBeInTheDocument();
    expect(main.getByText('premium')).toBeInTheDocument();
    expect(main.getByText('Premium')).toBeInTheDocument();
  });

  it('lets an admin create a new entitlement via the dialog', async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    await userEvent.click(main.getByRole('button', { name: 'New entitlement' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Identifier'), 'premium');
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Premium');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Premium')).toBeInTheDocument();
  });

  it("lets an admin edit an entitlement's display name, with identifier read-only", async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    await userEvent.click(main.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const identifierField = within(dialog).getByLabelText('Identifier');
    expect(identifierField).toHaveValue('pro');
    expect(identifierField).toBeDisabled();

    const displayNameField = within(dialog).getByLabelText('Display name');
    await userEvent.clear(displayNameField);
    await userEvent.type(displayNameField, 'Pro tier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Pro tier')).toBeInTheDocument();
  });

  it('lets an admin delete an entitlement after confirming', async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO, PREMIUM]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    const proRow = main.getByText('pro').closest('tr') as HTMLElement;
    await userEvent.click(within(proRow).getByRole('button', { name: 'Delete' }));

    const alertDialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(alertDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(main.queryByText('pro')).not.toBeInTheDocument());
    expect(main.getByText('premium')).toBeInTheDocument();
  });

  it('shows a read-only surface with no write controls for a viewer', async () => {
    signInAsAdmin();
    downgradeAdminTo('viewer');
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    expect(main.queryByRole('button', { name: 'New entitlement' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows the connect upsell (not the entitlements table) when RevenueCat is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    signInAsOwner();
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.queryByText('pro')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `dashboard/`): `npx vitest run src/features/revenuecat/components/rc-entitlements.test.tsx`

Expected: FAIL. `router.tsx` still maps `/rc/entitlements` to the inline `RcPlaceholderPage` (title "Entitlements", no table, no "New entitlement" button), so the first test times out:

```
FAIL src/features/revenuecat/components/rc-entitlements.test.tsx > RcEntitlementsPage > renders the entitlements list
TestingLibraryElementError: Unable to find an element with the text: pro.
```

The remaining tests fail the same way (no "New entitlement" button, no dialog, no rows to click).

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/src/features/revenuecat/components/RcEntitlementsPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
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
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api/problem';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcEnabled } from '../api';
import {
  useCreateRcEntitlement,
  useDeleteRcEntitlement,
  useRcEntitlements,
  useUpdateRcEntitlement,
  type RcEntitlement,
} from '../catalog-api';
import { RcConnectPage } from './RcConnectPage';

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
 *  shows the server's actual reason inline and keeps the dialog open (design §4); any other error
 *  keeps a generic fallback. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * MyRevenueCat → Entitlements (design §3.1). The simplest of the three catalog config pages: a flat
 * list of the project's entitlements with admin-gated create/edit/delete. Mirrors RcChartsPage's
 * gating discipline (don't decide "not connected" until `useProjects()` has resolved) and
 * `ProjectMembersSection`'s DataTable + controlled-dialog CRUD pattern.
 */
export function RcEntitlementsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/entitlements' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const rcEnabled = useRcEnabled(projectId);
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const [createOpen, setCreateOpen] = useState(false);
  const [createIdentifier, setCreateIdentifier] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [editing, setEditing] = useState<RcEntitlement | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [deleting, setDeleting] = useState<RcEntitlement | null>(null);

  // Hooks are called unconditionally (rules of hooks); the "not connected"/"still loading" early
  // returns come after, mirroring RcChartsPage.
  const entitlementsQuery = useRcEntitlements(projectId, { enabled: rcEnabled });
  const createEntitlement = useCreateRcEntitlement(projectId);
  const updateEntitlement = useUpdateRcEntitlement(projectId);
  const deleteEntitlement = useDeleteRcEntitlement(projectId);

  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Entitlements"
        description="The access levels your products grant, and who currently holds them."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Entitlements' }]}
      >
        {null}
      </PageShell>
    );
  }

  if (!rcEnabled) return <RcConnectPage projectId={projectId} />;

  const entitlements = entitlementsQuery.data ?? [];

  const openEdit = (entitlement: RcEntitlement) => {
    updateEntitlement.reset();
    setEditDisplayName(entitlement.displayName);
    setEditing(entitlement);
  };

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    const identifier = createIdentifier.trim();
    const displayName = createDisplayName.trim();
    if (!identifier || !displayName) return;
    createEntitlement.mutate(
      { identifier, displayName },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setCreateIdentifier('');
          setCreateDisplayName('');
        },
      },
    );
  };

  const handleEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const displayName = editDisplayName.trim();
    if (!displayName) return;
    updateEntitlement.mutate({ id: editing.id, displayName }, { onSuccess: () => setEditing(null) });
  };

  const columns: Array<DataTableColumn<RcEntitlement>> = [
    { key: 'identifier', header: 'Identifier', sortable: true },
    { key: 'displayName', header: 'Display name', sortable: true },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (entitlement: RcEntitlement) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => openEdit(entitlement)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteEntitlement.reset();
                    setDeleting(entitlement);
                  }}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <PageShell
      projectId={projectId}
      title="Entitlements"
      description="The access levels your products grant, and who currently holds them."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Entitlements' }]}
      actions={
        canManage ? (
          <Button
            onClick={() => {
              createEntitlement.reset();
              setCreateOpen(true);
            }}
          >
            New entitlement
          </Button>
        ) : undefined
      }
    >
      {entitlementsQuery.isPending && <p role="status">Loading entitlements…</p>}
      {entitlementsQuery.isError && (
        <p role="alert" className="text-danger">
          {apiErrorMessage(entitlementsQuery.error, 'Could not load entitlements.')}
        </p>
      )}
      {!entitlementsQuery.isPending &&
        !entitlementsQuery.isError &&
        (entitlements.length > 0 ? (
          <DataTable
            caption="RevenueCat entitlements"
            columns={columns}
            rows={entitlements}
            rowKey={(entitlement) => entitlement.id}
          />
        ) : (
          <EmptyState
            title="No entitlements yet."
            description={
              canManage
                ? 'Create your first entitlement to grant access to your products.'
                : 'No entitlements have been created for this project yet.'
            }
          />
        ))}

      {canManage && (
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              setCreateIdentifier('');
              setCreateDisplayName('');
              createEntitlement.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>New entitlement</DialogTitle>
            <DialogDescription>
              Entitlements are the access levels your products grant.
            </DialogDescription>
            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="new-entitlement-identifier" className="mb-1 block">
                  Identifier
                </Label>
                <Input
                  id="new-entitlement-identifier"
                  value={createIdentifier}
                  onChange={(event) => setCreateIdentifier(event.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="new-entitlement-display-name" className="mb-1 block">
                  Display name
                </Label>
                <Input
                  id="new-entitlement-display-name"
                  value={createDisplayName}
                  onChange={(event) => setCreateDisplayName(event.target.value)}
                  required
                />
              </div>
              {createEntitlement.isError && (
                <p role="alert" className="text-sm text-danger">
                  {apiErrorMessage(createEntitlement.error, 'Could not create entitlement.')}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateIdentifier('');
                    setCreateDisplayName('');
                    createEntitlement.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createEntitlement.isPending}>
                  {createEntitlement.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              updateEntitlement.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>Edit entitlement</DialogTitle>
            <DialogDescription>
              The identifier is immutable once created; only the display name can change.
            </DialogDescription>
            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="edit-entitlement-identifier" className="mb-1 block">
                  Identifier
                </Label>
                <Input id="edit-entitlement-identifier" value={editing?.identifier ?? ''} disabled readOnly />
              </div>
              <div>
                <Label htmlFor="edit-entitlement-display-name" className="mb-1 block">
                  Display name
                </Label>
                <Input
                  id="edit-entitlement-display-name"
                  value={editDisplayName}
                  onChange={(event) => setEditDisplayName(event.target.value)}
                  required
                />
              </div>
              {updateEntitlement.isError && (
                <p role="alert" className="text-sm text-danger">
                  {apiErrorMessage(updateEntitlement.error, 'Could not update entitlement.')}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    updateEntitlement.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEntitlement.isPending}>
                  {updateEntitlement.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <AlertDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(null);
              deleteEntitlement.reset();
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogTitle>Delete this entitlement?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `"${deleting.displayName}" (${deleting.identifier}) will no longer be grantable by any product. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
            {deleteEntitlement.isError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {apiErrorMessage(deleteEntitlement.error, 'Could not delete entitlement.')}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="secondary">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="danger"
                  disabled={deleteEntitlement.isPending}
                  onClick={(event) => {
                    // Prevent Radix's default auto-close so a failed delete keeps the dialog open
                    // with the inline error visible (design §4); we close it manually on success.
                    event.preventDefault();
                    if (!deleting) return;
                    deleteEntitlement.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
                  }}
                >
                  {deleteEntitlement.isPending ? 'Deleting…' : 'Delete'}
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

- [ ] **Step 4: Wire the route — swap the `RcPlaceholderPage` stub for the real page**

In `dashboard/src/router.tsx`, add the import next to the other RC page imports:

```ts
import { RcChartsPage } from './features/revenuecat/components/RcChartsPage';
import { RcEntitlementsPage } from './features/revenuecat/components/RcEntitlementsPage';
```

Then replace the `rcEntitlementsRoute` definition:

```ts
const rcEntitlementsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/entitlements',
  component: () => (
    <RcPlaceholderPage
      title="Entitlements"
      description="The access levels your products grant, and who currently holds them."
    />
  ),
});
```

with:

```ts
const rcEntitlementsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/entitlements',
  component: RcEntitlementsPage,
});
```

`RcPlaceholderPage` stays imported and used by `rcCustomersRoute`, `rcProductsRoute`, `rcOfferingsRoute`, and `rcPaywallsRoute` — do not remove its import. No other line in `router.tsx` changes.

- [ ] **Step 5: Run the test to verify it passes**

Run (from `dashboard/`): `npx vitest run src/features/revenuecat/components/rc-entitlements.test.tsx`

Expected: PASS — all 6 tests green:

```
✓ src/features/revenuecat/components/rc-entitlements.test.tsx (6)
  ✓ RcEntitlementsPage > renders the entitlements list
  ✓ RcEntitlementsPage > lets an admin create a new entitlement via the dialog
  ✓ RcEntitlementsPage > lets an admin edit an entitlement's display name, with identifier read-only
  ✓ RcEntitlementsPage > lets an admin delete an entitlement after confirming
  ✓ RcEntitlementsPage > shows a read-only surface with no write controls for a viewer
  ✓ RcEntitlementsPage > shows the connect upsell (not the entitlements table) when RevenueCat is not connected

Test Files  1 passed (1)
     Tests  6 passed (6)
```

- [ ] **Step 6: Pre-stage WIP check**

Run (from `dashboard/`): `git status`

Confirm the change list contains **only**:
- `src/features/revenuecat/components/RcEntitlementsPage.tsx` (new)
- `src/features/revenuecat/components/rc-entitlements.test.tsx` (new)
- `src/router.tsx` (modified)

Confirm **none** of the following appear (HARD WIP rule): `src/components/layout/AppLayout.tsx`, `src/components/layout/OrgSwitcher.tsx`, `src/components/layout/ProjectSwitcher.tsx`, `src/components/layout/ToolRail.tsx`, `src/components/layout/nav-model.ts`, `src/components/layout/RailInitial.tsx`, any `src/components/layout/*.test.tsx`, `src/features/command-palette/CommandPalette.tsx`, `src/test/render-app.tsx`. If any of these appear, stop and investigate before staging — do not add or commit them.

- [ ] **Step 7: Stage the task's files**

```bash
git add dashboard/src/features/revenuecat/components/RcEntitlementsPage.tsx dashboard/src/features/revenuecat/components/rc-entitlements.test.tsx dashboard/src/router.tsx
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(rc-catalog): RcEntitlementsPage + wire /rc/entitlements route"
```

- [ ] **Step 9: Final git status WIP check**

Run (from `dashboard/`): `git status`

Expected: working tree clean (the three staged files are now committed) and no collapse-rail WIP file was touched by this task. This closes Task C3.1.


---

### Task C4.1: `RcProductsPage` — apps context + products table + entitlement links, wire `/rc/products`

**Dependency check (do this before writing any UI code, not a fix owned by this task):** `backend/mobile_purchase/src/catalog/services/products.service.ts#list()` currently does `prisma.product.findMany({ where: { projectId }, include: { entitlements: true } })`. `Product.entitlements` is the `ProductEntitlement[]` join relation (`productId`, `entitlementId` only — see `prisma/schema.prisma` `model ProductEntitlement`), so `include: { entitlements: true }` returns bare join rows, **not** nested `Entitlement` objects (`identifier`/`displayName`). Design §2/§9 require `RcProduct.entitlements: RcEntitlement[]` (full objects) from `GET .../catalog/products`. Section 2's `catalog-api.ts` (assumed already built per the build order) must either (a) have had the service query changed to `include: { entitlements: { include: { entitlement: true } } }` plus a `.map(pe => pe.entitlement)` flatten in the controller/service response, or (b) be doing that flattening some other way. Run this before Step 1:
```bash
grep -n "include: { entitlements" backend/mobile_purchase/src/catalog/services/products.service.ts
```
If it still reads `include: { entitlements: true }` (no nested `{ include: { entitlement: true } } }`), the entitlement badges (Step 6) and the "Manage entitlements" checkbox list (Step 5) will render `undefined`/empty labels against real data even though the tests in this task (which mock the HTTP layer directly and control the JSON shape themselves) will still pass. Flag this to whoever owns Section 1/2 rather than fixing it here — it's outside this task's file set.

**Files**
- Create: `dashboard/src/features/revenuecat/rc-product-format.ts` — pure formatting/labelling helpers shared by the page and its dialogs.
- Create: `dashboard/src/features/revenuecat/components/RcProductsPage.dialogs.tsx` — the six dialogs (New/Delete app, New/Edit/Delete product, Manage entitlements).
- Create: `dashboard/src/features/revenuecat/components/RcProductsPage.tsx` — gating, `PageShell`, app selector, products `DataTable`, dialog wiring.
- Create: `dashboard/src/features/revenuecat/components/rc-products.test.tsx` — MSW page tests.
- Modify: `dashboard/src/router.tsx` — one new import + swap `rcProductsRoute`'s `component:` from the `RcPlaceholderPage` inline render to `RcProductsPage`.

**Interfaces**

*Consumes* — the exact `catalog-api.ts` contract this task is written against (per spec §2/§9; Section 2 is assumed to already export these):
```ts
// dashboard/src/features/revenuecat/catalog-api.ts (Section 2, assumed)
export type RcAppPlatform = 'IOS' | 'ANDROID' | 'MACOS' | 'AMAZON' | 'WEB';
export interface RcApp {
  id: string;
  name: string;
  platform: RcAppPlatform;
  bundleId?: string | null;
  packageName?: string | null;
  publicSdkKey: string;
}
export interface CreateRcAppInput {
  name: string;
  platform: RcAppPlatform;
  bundleId?: string;
  packageName?: string;
}
export function useRcApps(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcApp[], ApiError>;
export function useCreateRcApp(projectId: string): UseMutationResult<RcApp, ApiError, CreateRcAppInput>;
/** onSuccess MUST invalidate `['rc-catalog', projectId, 'apps']`; SHOULD also invalidate
 *  `['rc-catalog', projectId, 'products']` (deleting an app cascades to its products server-side —
 *  Product.app is `onDelete: Cascade`). */
export function useDeleteRcApp(projectId: string): UseMutationResult<void, ApiError, string /* appId */>;

export interface RcEntitlement { id: string; identifier: string; displayName: string }
export function useRcEntitlements(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcEntitlement[], ApiError>;

export type RcProductType =
  | 'AUTO_RENEWABLE_SUBSCRIPTION'
  | 'NON_RENEWING_SUBSCRIPTION'
  | 'CONSUMABLE'
  | 'NON_CONSUMABLE';
export interface RcProduct {
  id: string;
  appId: string;
  storeProductId: string;
  type: RcProductType;
  displayName: string;
  priceCents?: number | null;
  currency?: string | null;
  durationIso8601?: string | null;
  subscriptionGroupId?: string | null;
  entitlements: RcEntitlement[];
}
export interface CreateRcProductInput {
  appId: string;
  storeProductId: string;
  type: RcProductType;
  displayName: string;
  priceCents?: number;
  currency?: string;
  durationIso8601?: string;
  subscriptionGroupId?: string;
}
export interface UpdateRcProductInput {
  displayName?: string;
  priceCents?: number;
  currency?: string;
  durationIso8601?: string;
  subscriptionGroupId?: string;
}
export function useRcProducts(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcProduct[], ApiError>;
export function useCreateRcProduct(projectId: string): UseMutationResult<RcProduct, ApiError, CreateRcProductInput>;
export function useUpdateRcProduct(
  projectId: string,
): UseMutationResult<RcProduct, ApiError, { productId: string; patch: UpdateRcProductInput }>;
export function useDeleteRcProduct(projectId: string): UseMutationResult<void, ApiError, string /* productId */>;
/** Both MUST invalidate `['rc-catalog', projectId, 'products']` on success — ManageEntitlementsDialog
 *  (Step 5) re-derives its checkbox state from the refetched product, not from an optimistic patch. */
export function useAttachEntitlement(
  projectId: string,
): UseMutationResult<void, ApiError, { productId: string; entitlementId: string }>;
export function useDetachEntitlement(
  projectId: string,
): UseMutationResult<void, ApiError, { productId: string; entitlementId: string }>;
```
Also consumes: `useProjectRole`, `useProjects` (`dashboard/src/features/projects/api.ts`); `useRcEnabled` (`dashboard/src/features/revenuecat/api.ts`); `RcConnectPage` (same directory); `PageShell` (`dashboard/src/components/layout/PageShell.tsx`); `formatCurrency` (`dashboard/src/features/analytics/format.ts`); `ApiError` (`dashboard/src/lib/api/problem.ts`); ui kit `DataTable`, `Dialog*`, `AlertDialog*`, `Button`, `Badge`, `Input`, `Label`, `Checkbox`, `EmptyState`, `Reveal`, `fieldLook`; `cn` (`dashboard/src/lib/cn.ts`).

Design note on why plain `<select>` over `combobox.tsx`: `combobox.tsx` exports only `filterOptions`/`useCloseComboboxOnOutsideClick`/`ComboboxListbox` — building-block helpers for a type-ahead popover, not a drop-in `<Combobox>` component. The app selector and the platform/type pickers below use a plain `<select className={fieldLook}>`, exactly like `RcChartsPage`'s granularity control and `ProjectMembersSection`'s role picker — no new combobox component is built.

Design note on `AlertDialogAction`: `alert-dialog.tsx` has no usage precedent outside its own kit test (`overlays-kit.test.tsx`). `AlertDialogAction` is `Dialog.Close` under the hood (`@radix-ui/react-alert-dialog` → `DialogPrimitive.Close`) and auto-closes on click. Wrapping the destructive confirm button in it would swallow a failed-mutation error behind an already-dismissed dialog, contradicting design §4 ("keep the dialog open" on failure). The three delete/confirm dialogs below therefore use a **plain `Button`** (not `AlertDialogAction`) for the destructive action, closing only from the mutation's `onSuccess` — `AlertDialogCancel asChild` is still used for Cancel, which has no such concern.

Design note on dialog target state: `RcProductsPage` holds edit/delete/manage-entitlements targets as **IDs**, not row objects, and re-derives the live row from `products.data`/`apps.data` on every render. Storing the row object itself would freeze the dialog on the stale snapshot captured when it opened — after an attach/detach mutation invalidates and refetches the products list (no optimistic updates, design §4), the "Manage entitlements" checkbox for the entitlement just toggled would otherwise never flip to reflect the real server state.

*Produces* — `RcProductsPage` (default export is **not** used; named export only, matching every other RC page), consumed solely by `router.tsx`'s `rcProductsRoute`.

**Steps**

- [ ] **Step 1: Write the failing page test — `dashboard/src/features/revenuecat/components/rc-products.test.tsx`**

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  orgsState,
  projectsHandlerWithoutRc,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const PRODUCTS_URL = `/projects/${TEST_PROJECT.id}/rc/products`;
const catalogBase = `/api/v1/projects/${TEST_PROJECT.id}/catalog`;

function problem(status: number, title: string) {
  return HttpResponse.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

interface FixtureApp {
  id: string;
  name: string;
  platform: string;
  bundleId: string | null;
  packageName: string | null;
  publicSdkKey: string;
}
interface FixtureEntitlement {
  id: string;
  identifier: string;
  displayName: string;
}
interface FixtureProduct {
  id: string;
  appId: string;
  storeProductId: string;
  type: string;
  displayName: string;
  priceCents: number | null;
  currency: string | null;
  durationIso8601: string | null;
  subscriptionGroupId: string | null;
  entitlementIds: string[];
}

let apps: FixtureApp[];
let entitlements: FixtureEntitlement[];
let products: FixtureProduct[];
let nextId: number;

function resetCatalogFixture() {
  apps = [
    {
      id: 'app-1',
      name: 'App One',
      platform: 'IOS',
      bundleId: 'com.example.one',
      packageName: null,
      publicSdkKey: 'mp_pub_one',
    },
    {
      id: 'app-2',
      name: 'App Two',
      platform: 'ANDROID',
      bundleId: null,
      packageName: 'com.example.two',
      publicSdkKey: 'mp_pub_two',
    },
  ];
  entitlements = [
    { id: 'ent-pro', identifier: 'pro', displayName: 'Pro access' },
    { id: 'ent-plus', identifier: 'pro_plus', displayName: 'Pro Plus' },
  ];
  products = [
    {
      id: 'prod-1',
      appId: 'app-1',
      storeProductId: 'pro_monthly',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Pro Monthly',
      priceCents: 999,
      currency: 'USD',
      durationIso8601: 'P1M',
      subscriptionGroupId: 'group-1',
      entitlementIds: ['ent-pro'],
    },
    {
      id: 'prod-2',
      appId: 'app-1',
      storeProductId: 'coins_100',
      type: 'CONSUMABLE',
      displayName: '100 Coins',
      priceCents: null,
      currency: null,
      durationIso8601: null,
      subscriptionGroupId: null,
      entitlementIds: [],
    },
    {
      id: 'prod-3',
      appId: 'app-2',
      storeProductId: 'pro_annual_android',
      type: 'AUTO_RENEWABLE_SUBSCRIPTION',
      displayName: 'Pro Annual',
      priceCents: 5999,
      currency: 'USD',
      durationIso8601: 'P1Y',
      subscriptionGroupId: null,
      entitlementIds: ['ent-pro', 'ent-plus'],
    },
  ];
  nextId = 1;
}

function toRcApp(a: FixtureApp) {
  return {
    id: a.id,
    name: a.name,
    platform: a.platform,
    bundleId: a.bundleId,
    packageName: a.packageName,
    publicSdkKey: a.publicSdkKey,
  };
}
function toRcEntitlement(e: FixtureEntitlement) {
  return { id: e.id, identifier: e.identifier, displayName: e.displayName };
}
function toRcProduct(p: FixtureProduct) {
  return {
    id: p.id,
    appId: p.appId,
    storeProductId: p.storeProductId,
    type: p.type,
    displayName: p.displayName,
    priceCents: p.priceCents,
    currency: p.currency,
    durationIso8601: p.durationIso8601,
    subscriptionGroupId: p.subscriptionGroupId,
    entitlements: p.entitlementIds.map((id) => toRcEntitlement(entitlements.find((e) => e.id === id)!)),
  };
}

function installCatalogHandlers() {
  server.use(
    http.get(`${catalogBase}/apps`, () => HttpResponse.json(apps.map(toRcApp))),
    http.post(`${catalogBase}/apps`, async ({ request }) => {
      const body = (await request.json()) as {
        name: string;
        platform: string;
        bundleId?: string;
        packageName?: string;
      };
      nextId += 1;
      const created: FixtureApp = {
        id: `app-${nextId}`,
        name: body.name,
        platform: body.platform,
        bundleId: body.bundleId ?? null,
        packageName: body.packageName ?? null,
        publicSdkKey: `mp_pub_${nextId}`,
      };
      apps.push(created);
      return HttpResponse.json(toRcApp(created), { status: 201 });
    }),
    http.delete(`${catalogBase}/apps/:appId`, ({ params }) => {
      const appId = params.appId as string;
      if (!apps.some((a) => a.id === appId)) return problem(404, 'App not found');
      apps = apps.filter((a) => a.id !== appId);
      products = products.filter((p) => p.appId !== appId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(`${catalogBase}/entitlements`, () => HttpResponse.json(entitlements.map(toRcEntitlement))),
    http.get(`${catalogBase}/products`, () => HttpResponse.json(products.map(toRcProduct))),
    http.post(`${catalogBase}/products`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      nextId += 1;
      const created: FixtureProduct = {
        id: `prod-${nextId}`,
        appId: body.appId as string,
        storeProductId: body.storeProductId as string,
        type: body.type as string,
        displayName: body.displayName as string,
        priceCents: (body.priceCents as number | undefined) ?? null,
        currency: (body.currency as string | undefined) ?? null,
        durationIso8601: (body.durationIso8601 as string | undefined) ?? null,
        subscriptionGroupId: (body.subscriptionGroupId as string | undefined) ?? null,
        entitlementIds: [],
      };
      products.push(created);
      return HttpResponse.json(toRcProduct(created), { status: 201 });
    }),
    http.patch(`${catalogBase}/products/:productId`, async ({ params, request }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.displayName === 'string') product.displayName = body.displayName;
      if ('priceCents' in body) product.priceCents = (body.priceCents as number | undefined) ?? null;
      if ('currency' in body) product.currency = (body.currency as string | undefined) ?? null;
      if ('durationIso8601' in body) {
        product.durationIso8601 = (body.durationIso8601 as string | undefined) ?? null;
      }
      if ('subscriptionGroupId' in body) {
        product.subscriptionGroupId = (body.subscriptionGroupId as string | undefined) ?? null;
      }
      return HttpResponse.json(toRcProduct(product));
    }),
    http.delete(`${catalogBase}/products/:productId`, ({ params }) => {
      if (!products.some((p) => p.id === params.productId)) return problem(404, 'Product not found');
      products = products.filter((p) => p.id !== params.productId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${catalogBase}/products/:productId/entitlements`, async ({ params, request }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      const { entitlementId } = (await request.json()) as { entitlementId: string };
      if (!product.entitlementIds.includes(entitlementId)) product.entitlementIds.push(entitlementId);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(`${catalogBase}/products/:productId/entitlements/:entitlementId`, ({ params }) => {
      const product = products.find((p) => p.id === params.productId);
      if (!product) return problem(404, 'Product not found');
      product.entitlementIds = product.entitlementIds.filter((id) => id !== params.entitlementId);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

beforeEach(() => {
  resetCatalogFixture();
  installCatalogHandlers();
});

describe('RcProductsPage', () => {
  it('shows the connect upsell (not products) when RevenueCat is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.queryByLabelText('App')).not.toBeInTheDocument();
  });

  it('lists the apps in the selector and filters products to the selected app', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));

    const appSelect = (await main.findByLabelText('App')) as HTMLSelectElement;
    expect(appSelect).toHaveValue('app-1');
    expect(await main.findByText('pro_monthly')).toBeInTheDocument();
    expect(main.getByText('100 Coins')).toBeInTheDocument();
    expect(main.queryByText('pro_annual_android')).not.toBeInTheDocument();

    await userEvent.selectOptions(appSelect, 'app-2');
    expect(await main.findByText('pro_annual_android')).toBeInTheDocument();
    expect(main.queryByText('pro_monthly')).not.toBeInTheDocument();
  });

  it('renders price, duration, type badge, and entitlement badges from the fixture', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    expect(within(row).getByText('$9.99')).toBeInTheDocument();
    expect(within(row).getByText('P1M')).toBeInTheDocument();
    expect(within(row).getByText('pro')).toBeInTheDocument();
    expect(within(row).getByText(/auto-renewable subscription/i)).toBeInTheDocument();

    const coinsRow = main.getByText('100 Coins').closest('tr') as HTMLElement;
    // No price, no duration, no entitlements — three separate dash cells on this row.
    expect(within(coinsRow).getAllByText('—')).toHaveLength(3);
  });

  it('creates a new product via the New product dialog', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    await userEvent.click(main.getByRole('button', { name: 'New product' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Store product ID'), 'pro_yearly');
    await userEvent.type(dialog.getByLabelText('Display name'), 'Pro Yearly');
    await userEvent.click(dialog.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('pro_yearly')).toBeInTheDocument();
  });

  it('attaches and detaches entitlements via Manage entitlements, updating the row live', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly'); // fixture: only "pro" attached

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Manage entitlements' }));

    const dialog = within(await screen.findByRole('dialog'));
    const proCheckbox = dialog.getByRole('checkbox', { name: /pro access/i });
    const proPlusCheckbox = dialog.getByRole('checkbox', { name: /pro plus/i });
    expect(proCheckbox).toBeChecked();
    expect(proPlusCheckbox).not.toBeChecked();

    await userEvent.click(proPlusCheckbox); // attach
    await waitFor(() => expect(proPlusCheckbox).toBeChecked());
    await userEvent.click(proCheckbox); // detach
    await waitFor(() => expect(proCheckbox).not.toBeChecked());

    await userEvent.click(dialog.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const updatedRow = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    expect(within(updatedRow).getByText('pro_plus')).toBeInTheDocument();
    expect(within(updatedRow).queryByText('pro')).not.toBeInTheDocument();
  });

  it('edits a product, keeping storeProductId and type read-only', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    const row = main.getByText('pro_monthly').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByLabelText('Store product ID')).not.toBeInTheDocument();
    expect(dialog.getByText(/pro_monthly/)).toBeInTheDocument(); // read-only identity line
    const nameField = dialog.getByLabelText('Display name');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Pro Monthly (renamed)');
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Pro Monthly (renamed)')).toBeInTheDocument();
  });

  it('deletes a product via the confirm alert-dialog', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('100 Coins');

    const row = main.getByText('100 Coins').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    const alert = within(await screen.findByRole('alertdialog'));
    await userEvent.click(alert.getByRole('button', { name: 'Delete product' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText('100 Coins')).not.toBeInTheDocument();
  });

  it('creates a new app and auto-selects it in the app selector', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    await userEvent.click(main.getByRole('button', { name: 'New app' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Name'), 'App Three');
    await userEvent.type(dialog.getByLabelText('Bundle ID'), 'com.example.three'); // platform defaults to IOS
    await userEvent.click(dialog.getByRole('button', { name: 'Create app' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const appSelect = main.getByLabelText('App') as HTMLSelectElement;
    await waitFor(() => {
      const selected = within(appSelect).getByRole('option', { selected: true });
      expect(selected.textContent).toContain('App Three');
    });
    expect(await main.findByText(/no products yet/i)).toBeInTheDocument();
  });

  it('deletes an app via the confirm alert-dialog, removing it and its products', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly'); // App One selected by default

    await userEvent.click(main.getByRole('button', { name: 'Delete app' }));
    const alert = within(await screen.findByRole('alertdialog'));
    expect(alert.getByText(/removes the app and every product/i)).toBeInTheDocument();
    await userEvent.click(alert.getByRole('button', { name: 'Delete app' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const appSelect = (await main.findByLabelText('App')) as HTMLSelectElement;
    expect(within(appSelect).queryByRole('option', { name: /App One/ })).not.toBeInTheDocument();
    expect(await main.findByText('pro_annual_android')).toBeInTheDocument();
    expect(main.queryByText('pro_monthly')).not.toBeInTheDocument();
  });

  it('shows an empty state prompting New app when the project has no apps yet', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    server.use(http.get(`${catalogBase}/apps`, () => HttpResponse.json([])));
    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText(/no apps yet/i)).toBeInTheDocument();
    expect(main.getByRole('button', { name: 'New app' })).toBeInTheDocument();
    expect(main.queryByLabelText('App')).not.toBeInTheDocument();
  });

  it('shows a fully read-only surface for a viewer, with no write controls', async () => {
    // Downgrade MFA_USER (an admin on TEST_PROJECT) to viewer for this scenario only — same pattern
    // as ProjectMembersSection's "analyst (read-only)" test.
    const membership = orgsState.projectMemberships.find(
      (m) => m.projectId === TEST_PROJECT.id && m.user.id === MFA_USER.id,
    );
    if (membership) membership.role = 'viewer';
    authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);

    renderApp(PRODUCTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro_monthly');

    expect(main.getByLabelText('App')).toBeInTheDocument(); // the read surface stays visible
    expect(main.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'New app' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete app' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Manage entitlements' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails red**

```bash
cd dashboard && npx vitest run src/features/revenuecat/components/rc-products.test.tsx
```

Expected failure: `router.tsx`'s `rcProductsRoute` still renders the inline `RcPlaceholderPage` (title "Products", body copy `/not built yet/i`), which has no `App` label, no `dialog`/`alertdialog` role, and doesn't gate on `useRcEnabled` at all — every assertion looking for the real surface times out. Representative output:
```
FAIL  src/features/revenuecat/components/rc-products.test.tsx > RcProductsPage > shows the connect upsell (not products) when RevenueCat is not connected
TestingLibraryElementError: Unable to find role="heading" and name `/connect revenuecat/i`

FAIL  src/features/revenuecat/components/rc-products.test.tsx > RcProductsPage > lists the apps in the selector and filters products to the selected app
TestingLibraryElementError: Unable to find a label with the text of: App
...
Test Files  1 failed (1)
     Tests  11 failed (11)
```

- [ ] **Step 3: Create `dashboard/src/features/revenuecat/rc-product-format.ts`**

```ts
import type { BadgeProps } from '../../components/ui/badge';
import { ApiError } from '../../lib/api/problem';
import type { RcAppPlatform, RcProductType } from './catalog-api';

/** Every `App.platform` value `createAppSchema` accepts (`backend/mobile_purchase/src/catalog/support/catalog.schemas.ts`). */
export const APP_PLATFORMS: RcAppPlatform[] = ['IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB'];

/** Every `Product.type` value `createProductSchema` accepts, same source. */
export const PRODUCT_TYPES: RcProductType[] = [
  'AUTO_RENEWABLE_SUBSCRIPTION',
  'NON_RENEWING_SUBSCRIPTION',
  'CONSUMABLE',
  'NON_CONSUMABLE',
];

/** Human label for a `RcProductType` value — the raw enum reads fine in code but not in a picker. */
export function productTypeLabel(type: RcProductType): string {
  switch (type) {
    case 'AUTO_RENEWABLE_SUBSCRIPTION':
      return 'Auto-renewable subscription';
    case 'NON_RENEWING_SUBSCRIPTION':
      return 'Non-renewing subscription';
    case 'CONSUMABLE':
      return 'Consumable';
    case 'NON_CONSUMABLE':
      return 'Non-consumable';
    default:
      return type;
  }
}

/** Subscriptions (renewing or not) get the accent badge; one-off purchases stay neutral. */
export function productTypeBadgeVariant(type: RcProductType): BadgeProps['variant'] {
  return type === 'AUTO_RENEWABLE_SUBSCRIPTION' || type === 'NON_RENEWING_SUBSCRIPTION'
    ? 'accent'
    : 'default';
}

/** `ApiError`'s problem `detail` (falls back to `title`), or a generic fallback for non-`ApiError`
 *  failures — shared by every dialog's inline-error slot (design §4). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}
```

- [ ] **Step 4: Create `dashboard/src/features/revenuecat/components/RcProductsPage.dialogs.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { fieldLook, Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { cn } from '../../../lib/cn';
import {
  useAttachEntitlement,
  useCreateRcApp,
  useCreateRcProduct,
  useDeleteRcApp,
  useDeleteRcProduct,
  useDetachEntitlement,
  useUpdateRcProduct,
  type RcApp,
  type RcAppPlatform,
  type RcEntitlement,
  type RcProduct,
  type RcProductType,
} from '../catalog-api';
import { apiErrorMessage, APP_PLATFORMS, productTypeLabel, PRODUCT_TYPES } from '../rc-product-format';

/** New app (design §3.2 header action): name, platform, and the platform-conditional store
 *  identifier (`bundleId` for iOS, `packageName` for Android — matches `createAppSchema`'s
 *  `.refine`s; macOS/Amazon/Web have no required identifier in v1). */
export function NewAppDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (appId: string) => void;
}) {
  const createApp = useCreateRcApp(projectId);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<RcAppPlatform>('IOS');
  const [bundleId, setBundleId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setPlatform('IOS');
    setBundleId('');
    setPackageName('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createApp.mutate(
      {
        name,
        platform,
        bundleId: platform === 'IOS' ? bundleId : undefined,
        packageName: platform === 'ANDROID' ? packageName : undefined,
      },
      {
        onSuccess: (app) => {
          onCreated(app.id);
          handleOpenChange(false);
        },
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not create app.')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>New app</DialogTitle>
        <DialogDescription>Register a store app to hold products.</DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="new-app-name">Name</Label>
            <Input
              id="new-app-name"
              className="mt-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-app-platform">Platform</Label>
            <select
              id="new-app-platform"
              className={cn(fieldLook, 'mt-1 w-full')}
              value={platform}
              onChange={(event) => setPlatform(event.target.value as RcAppPlatform)}
            >
              {APP_PLATFORMS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          {platform === 'IOS' && (
            <div>
              <Label htmlFor="new-app-bundle-id">Bundle ID</Label>
              <Input
                id="new-app-bundle-id"
                className="mt-1"
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                required
              />
            </div>
          )}
          {platform === 'ANDROID' && (
            <div>
              <Label htmlFor="new-app-package-name">Package name</Label>
              <Input
                id="new-app-package-name"
                className="mt-1"
                value={packageName}
                onChange={(event) => setPackageName(event.target.value)}
                required
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createApp.isPending}>
              {createApp.isPending ? 'Creating…' : 'Create app'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete app (design §3.2): permanently deletes the app AND every product listed under it
 *  (`Product.app` is `onDelete: Cascade` in `prisma/schema.prisma`), so the copy says so explicitly
 *  instead of leaving that a surprise. */
export function DeleteAppAlertDialog({
  projectId,
  app,
  onClose,
}: {
  projectId: string;
  app: RcApp;
  onClose: () => void;
}) {
  const deleteApp = useDeleteRcApp(projectId);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    deleteApp.mutate(app.id, {
      onSuccess: () => onClose(),
      onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not delete app.')),
    });
  };

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes the app and every product listed under it, including their entitlement
          links. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          {/* A plain Button, not `AlertDialogAction` — see the "Design note on AlertDialogAction"
             in this task's Interfaces section: AlertDialogAction auto-closes on click, which would
             hide a failed-mutation error behind an already-dismissed dialog. */}
          <Button variant="danger" disabled={deleteApp.isPending} onClick={handleConfirm}>
            {deleteApp.isPending ? 'Deleting…' : 'Delete app'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** New product (design §3.2 header action): `appId` is fixed to the selected app, not a field. */
export function NewProductDialog({
  projectId,
  appId,
  open,
  onOpenChange,
}: {
  projectId: string;
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createProduct = useCreateRcProduct(projectId);
  const [storeProductId, setStoreProductId] = useState('');
  const [type, setType] = useState<RcProductType>('AUTO_RENEWABLE_SUBSCRIPTION');
  const [displayName, setDisplayName] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('');
  const [duration, setDuration] = useState('');
  const [subscriptionGroupId, setSubscriptionGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStoreProductId('');
    setType('AUTO_RENEWABLE_SUBSCRIPTION');
    setDisplayName('');
    setPrice('');
    setCurrency('');
    setDuration('');
    setSubscriptionGroupId('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    createProduct.mutate(
      {
        appId,
        storeProductId,
        type,
        displayName,
        priceCents: price.trim() ? Math.round(parseFloat(price) * 100) : undefined,
        currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
        durationIso8601: duration.trim() || undefined,
        subscriptionGroupId: subscriptionGroupId.trim() || undefined,
      },
      {
        onSuccess: () => handleOpenChange(false),
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not create product.')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>New product</DialogTitle>
        <DialogDescription>Add a store product for the selected app.</DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="new-product-store-id">Store product ID</Label>
            <Input
              id="new-product-store-id"
              className="mt-1"
              value={storeProductId}
              onChange={(event) => setStoreProductId(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="new-product-type">Type</Label>
            <select
              id="new-product-type"
              className={cn(fieldLook, 'mt-1 w-full')}
              value={type}
              onChange={(event) => setType(event.target.value as RcProductType)}
            >
              {PRODUCT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {productTypeLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="new-product-display-name">Display name</Label>
            <Input
              id="new-product-display-name"
              className="mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-product-price">Price</Label>
              <Input
                id="new-product-price"
                className="mt-1"
                inputMode="decimal"
                placeholder="9.99"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-product-currency">Currency</Label>
              <Input
                id="new-product-currency"
                className="mt-1"
                placeholder="USD"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="new-product-duration">Duration (ISO 8601)</Label>
            <Input
              id="new-product-duration"
              className="mt-1"
              placeholder="P1M"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-product-group">Subscription group ID</Label>
            <Input
              id="new-product-group"
              className="mt-1"
              value={subscriptionGroupId}
              onChange={(event) => setSubscriptionGroupId(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProduct.isPending}>
              {createProduct.isPending ? 'Creating…' : 'Create product'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit product (design §3.2): `storeProductId`/`type` are identity fields the server's PATCH
 *  rejects (design §1), so they're shown as read-only text, not inputs. */
export function EditProductDialog({
  projectId,
  product,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  onClose: () => void;
}) {
  const updateProduct = useUpdateRcProduct(projectId);
  const [displayName, setDisplayName] = useState(product.displayName);
  const [price, setPrice] = useState(
    product.priceCents != null ? (product.priceCents / 100).toFixed(2) : '',
  );
  const [currency, setCurrency] = useState(product.currency ?? '');
  const [duration, setDuration] = useState(product.durationIso8601 ?? '');
  const [subscriptionGroupId, setSubscriptionGroupId] = useState(product.subscriptionGroupId ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    updateProduct.mutate(
      {
        productId: product.id,
        patch: {
          displayName,
          priceCents: price.trim() ? Math.round(parseFloat(price) * 100) : undefined,
          currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
          durationIso8601: duration.trim() || undefined,
          subscriptionGroupId: subscriptionGroupId.trim() || undefined,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not update product.')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Edit product</DialogTitle>
        <DialogDescription>
          {product.storeProductId} · {productTypeLabel(product.type)}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="edit-product-display-name">Display name</Label>
            <Input
              id="edit-product-display-name"
              className="mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-product-price">Price</Label>
              <Input
                id="edit-product-price"
                className="mt-1"
                inputMode="decimal"
                placeholder="9.99"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="edit-product-currency">Currency</Label>
              <Input
                id="edit-product-currency"
                className="mt-1"
                placeholder="USD"
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-product-duration">Duration (ISO 8601)</Label>
            <Input
              id="edit-product-duration"
              className="mt-1"
              placeholder="P1M"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="edit-product-group">Subscription group ID</Label>
            <Input
              id="edit-product-group"
              className="mt-1"
              value={subscriptionGroupId}
              onChange={(event) => setSubscriptionGroupId(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateProduct.isPending}>
              {updateProduct.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Manage entitlements (design §3.2): a checkbox per project entitlement, toggled = attach,
 *  untoggled = detach — each toggle is its own mutation (no batched "Save"), matching the "Done"-only
 *  footer. `checked` reads off `product.entitlements` — the caller (`RcProductsPage`) re-derives
 *  `product` from the refetched list on every render, so a toggle's real state (post invalidate) is
 *  what's shown, never an optimistic guess (design §4: no optimistic updates). */
export function ManageEntitlementsDialog({
  projectId,
  product,
  entitlements,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  entitlements: RcEntitlement[];
  onClose: () => void;
}) {
  const attach = useAttachEntitlement(projectId);
  const detach = useDetachEntitlement(projectId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attachedIds = new Set(product.entitlements.map((entitlement) => entitlement.id));

  const handleToggle = (entitlementId: string, checked: boolean) => {
    setError(null);
    setPendingId(entitlementId);
    const mutation = checked ? attach : detach;
    mutation.mutate(
      { productId: product.id, entitlementId },
      {
        onSuccess: () => setPendingId(null),
        onError: (mutationError) => {
          setPendingId(null);
          setError(apiErrorMessage(mutationError, 'Could not update entitlements.'));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Manage entitlements — {product.displayName}</DialogTitle>
        <DialogDescription>
          Choose which entitlements this product grants when purchased.
        </DialogDescription>
        {entitlements.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">No entitlements defined yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {entitlements.map((entitlement) => (
              <li key={entitlement.id} className="flex items-center gap-2">
                <Checkbox
                  id={`entitlement-${entitlement.id}`}
                  checked={attachedIds.has(entitlement.id)}
                  disabled={pendingId === entitlement.id}
                  onCheckedChange={(checked) => handleToggle(entitlement.id, checked === true)}
                />
                <Label htmlFor={`entitlement-${entitlement.id}`}>
                  {entitlement.displayName} ({entitlement.identifier})
                </Label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Delete product (design §3.2): also removes its entitlement links (`ProductEntitlement` cascades
 *  off `Product`), stated in the copy so it isn't a surprise. */
export function DeleteProductAlertDialog({
  projectId,
  product,
  onClose,
}: {
  projectId: string;
  product: RcProduct;
  onClose: () => void;
}) {
  const deleteProduct = useDeleteRcProduct(projectId);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    setError(null);
    deleteProduct.mutate(product.id, {
      onSuccess: () => onClose(),
      onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not delete product.')),
    });
  };

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete {product.displayName}?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes {product.storeProductId} and its entitlement links. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <Button variant="danger" disabled={deleteProduct.isPending} onClick={handleConfirm}>
            {deleteProduct.isPending ? 'Deleting…' : 'Delete product'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Create `dashboard/src/features/revenuecat/components/RcProductsPage.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Reveal } from '../../../components/ui/reveal';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { EmptyState } from '../../../components/ui/empty-state';
import { fieldLook } from '../../../components/ui/input';
import { cn } from '../../../lib/cn';
import { formatCurrency } from '../../analytics/format';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcEnabled } from '../api';
import { RcConnectPage } from './RcConnectPage';
import { useRcApps, useRcEntitlements, useRcProducts, type RcProduct } from '../catalog-api';
import { productTypeBadgeVariant, productTypeLabel } from '../rc-product-format';
import {
  DeleteAppAlertDialog,
  DeleteProductAlertDialog,
  EditProductDialog,
  ManageEntitlementsDialog,
  NewAppDialog,
  NewProductDialog,
} from './RcProductsPage.dialogs';

/**
 * MyRevenueCat → Products (design §3.2): pick an app, manage its store products, and link each
 * product to the entitlements it grants. Mirrors `RcChartsPage`'s gating (RC-connect upsell,
 * `PageShell`) and `ProjectMembersSection`'s CRUD shape (`DataTable` + `dialog` create/edit +
 * `alert-dialog` delete confirm), scoped to `useProjectRole` for every write control.
 *
 * Dialog targets are held as IDs, not the row object itself, and the live row is re-derived from
 * `products.data`/`apps.data` on every render — see `RcProductsPage.dialogs.tsx`'s doc comment on
 * `ManageEntitlementsDialog` for why that matters.
 */
export function RcProductsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/products' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const rcEnabled = useRcEnabled(projectId);
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const [selectedAppId, setSelectedAppId] = useState('');
  const [newAppOpen, setNewAppOpen] = useState(false);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [deleteAppId, setDeleteAppId] = useState<string | null>(null);
  const [editProductId, setEditProductId] = useState<string | null>(null);
  const [manageEntitlementsProductId, setManageEntitlementsProductId] = useState<string | null>(null);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  // Hooks are called unconditionally (rules of hooks); `enabled: rcEnabled` suppresses the fetch for
  // a disconnected project. The early returns below decide what to *render*, not which hooks run —
  // mirrors RcChartsPage.
  const apps = useRcApps(projectId, { enabled: rcEnabled });
  const products = useRcProducts(projectId, { enabled: rcEnabled });
  const entitlements = useRcEntitlements(projectId, { enabled: rcEnabled });

  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Products"
        description="The store products synced from RevenueCat, with their pricing and performance."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Products' }]}
      >
        {null}
      </PageShell>
    );
  }

  if (!rcEnabled) return <RcConnectPage projectId={projectId} />;

  const appList = apps.data ?? [];
  const currentAppId =
    selectedAppId && appList.some((app) => app.id === selectedAppId)
      ? selectedAppId
      : (appList[0]?.id ?? '');
  const currentApp = appList.find((app) => app.id === currentAppId) ?? null;
  const allProducts = products.data ?? [];
  const appProducts = allProducts.filter((product) => product.appId === currentAppId);
  const entitlementList = entitlements.data ?? [];

  const deleteAppTarget = deleteAppId ? (appList.find((app) => app.id === deleteAppId) ?? null) : null;
  const editProductTarget = editProductId
    ? (allProducts.find((product) => product.id === editProductId) ?? null)
    : null;
  const manageEntitlementsTarget = manageEntitlementsProductId
    ? (allProducts.find((product) => product.id === manageEntitlementsProductId) ?? null)
    : null;
  const deleteProductTarget = deleteProductId
    ? (allProducts.find((product) => product.id === deleteProductId) ?? null)
    : null;

  return (
    <PageShell
      projectId={projectId}
      title="Products"
      description="The store products synced from RevenueCat, with their pricing and performance."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Products' }]}
      actions={
        canManage && currentApp ? (
          <Button onClick={() => setNewProductOpen(true)}>New product</Button>
        ) : undefined
      }
    >
      {apps.isPending && (
        <Reveal index={0}>
          <p role="status">Loading apps…</p>
        </Reveal>
      )}
      {apps.isError && (
        <Reveal index={0}>
          <p role="alert" className="text-danger">
            Could not load apps.
          </p>
        </Reveal>
      )}

      {!apps.isPending && !apps.isError && appList.length === 0 && (
        <Reveal index={0}>
          <EmptyState
            title="No apps yet."
            description={
              canManage
                ? 'Add an app to start listing its products.'
                : 'Ask a project admin to add an app.'
            }
            action={
              canManage ? <Button onClick={() => setNewAppOpen(true)}>New app</Button> : undefined
            }
          />
        </Reveal>
      )}

      {appList.length > 0 && (
        <>
          <Reveal index={0}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-col gap-1 text-sm text-text-muted">
                <span>App</span>
                <select
                  aria-label="App"
                  className={cn(fieldLook, 'h-9 w-64')}
                  value={currentAppId}
                  onChange={(event) => setSelectedAppId(event.target.value)}
                >
                  {appList.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name} ({app.platform})
                    </option>
                  ))}
                </select>
              </label>
              {canManage && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setNewAppOpen(true)}>
                    New app
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!currentApp}
                    onClick={() => currentApp && setDeleteAppId(currentApp.id)}
                  >
                    Delete app
                  </Button>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal index={1}>
            {products.isPending ? (
              <p role="status">Loading products…</p>
            ) : products.isError ? (
              <p role="alert" className="text-danger">
                Could not load products.
              </p>
            ) : (
              <ProductsTable
                products={appProducts}
                canManage={canManage}
                onEdit={(product) => setEditProductId(product.id)}
                onManageEntitlements={(product) => setManageEntitlementsProductId(product.id)}
                onDelete={(product) => setDeleteProductId(product.id)}
              />
            )}
          </Reveal>
        </>
      )}

      {canManage && (
        <NewAppDialog
          projectId={projectId}
          open={newAppOpen}
          onOpenChange={setNewAppOpen}
          onCreated={setSelectedAppId}
        />
      )}
      {canManage && deleteAppTarget && (
        <DeleteAppAlertDialog
          projectId={projectId}
          app={deleteAppTarget}
          onClose={() => setDeleteAppId(null)}
        />
      )}
      {canManage && currentApp && (
        <NewProductDialog
          projectId={projectId}
          appId={currentApp.id}
          open={newProductOpen}
          onOpenChange={setNewProductOpen}
        />
      )}
      {canManage && editProductTarget && (
        <EditProductDialog
          projectId={projectId}
          product={editProductTarget}
          onClose={() => setEditProductId(null)}
        />
      )}
      {canManage && manageEntitlementsTarget && (
        <ManageEntitlementsDialog
          projectId={projectId}
          product={manageEntitlementsTarget}
          entitlements={entitlementList}
          onClose={() => setManageEntitlementsProductId(null)}
        />
      )}
      {canManage && deleteProductTarget && (
        <DeleteProductAlertDialog
          projectId={projectId}
          product={deleteProductTarget}
          onClose={() => setDeleteProductId(null)}
        />
      )}
    </PageShell>
  );
}

function ProductsTable({
  products,
  canManage,
  onEdit,
  onManageEntitlements,
  onDelete,
}: {
  products: RcProduct[];
  canManage: boolean;
  onEdit: (product: RcProduct) => void;
  onManageEntitlements: (product: RcProduct) => void;
  onDelete: (product: RcProduct) => void;
}) {
  if (products.length === 0) {
    return (
      <EmptyState
        title="No products yet."
        description="Products entered for this app will appear here."
      />
    );
  }

  const columns: Array<DataTableColumn<RcProduct>> = [
    { key: 'storeProductId', header: 'Store product ID', sortable: true },
    {
      key: 'type',
      header: 'Type',
      render: (product) => (
        <Badge variant={productTypeBadgeVariant(product.type)}>{productTypeLabel(product.type)}</Badge>
      ),
    },
    { key: 'displayName', header: 'Display name', sortable: true },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      sortValue: (product) => product.priceCents ?? -1,
      render: (product) =>
        product.priceCents != null && product.currency
          ? formatCurrency(product.priceCents / 100, product.currency)
          : '—',
    },
    {
      key: 'durationIso8601',
      header: 'Duration',
      render: (product) => product.durationIso8601 ?? '—',
    },
    {
      key: 'entitlements',
      header: 'Entitlements',
      render: (product) =>
        product.entitlements.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {product.entitlements.map((entitlement) => (
              <Badge key={entitlement.id} variant="info">
                {entitlement.identifier}
              </Badge>
            ))}
          </div>
        ) : (
          '—'
        ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (product: RcProduct) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => onEdit(product)}>
                  Edit
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onManageEntitlements(product)}>
                  Manage entitlements
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(product)}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      caption="Products for the selected app"
      columns={columns}
      rows={products}
      rowKey={(product) => product.id}
      initialSort={{ key: 'storeProductId', dir: 'asc' }}
    />
  );
}
```

- [ ] **Step 6: Wire the route — `dashboard/src/router.tsx`**

Add the import (next to the other RC page imports):
```tsx
import { RcChartsPage } from './features/revenuecat/components/RcChartsPage';
import { RcProductsPage } from './features/revenuecat/components/RcProductsPage';
```

Swap `rcProductsRoute`'s `component:` from the inline placeholder to the real page:
```tsx
const rcProductsRoute = createRoute({
  getParentRoute: () => privateRoute,
  path: '/projects/$projectId/rc/products',
  component: RcProductsPage,
});
```
(Deletes the `component: () => (<RcPlaceholderPage title="Products" description="..." />)` block for this route only. `RcPlaceholderPage`'s import stays — Customers/Entitlements/Offerings/Paywalls routes still use it.)

- [ ] **Step 7: Run the test file again — expect green**

```bash
cd dashboard && npx vitest run src/features/revenuecat/components/rc-products.test.tsx
```
Expected:
```
✓ src/features/revenuecat/components/rc-products.test.tsx (11 tests)

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] **Step 8: Typecheck the dashboard**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: no output, exit code 0 (per CLAUDE.md: "ALWAYS verify build succeeds before making changes").

- [ ] **Step 9: Stage exactly this task's files**

```bash
cd dashboard && git add \
  src/features/revenuecat/rc-product-format.ts \
  src/features/revenuecat/components/RcProductsPage.tsx \
  src/features/revenuecat/components/RcProductsPage.dialogs.tsx \
  src/features/revenuecat/components/rc-products.test.tsx \
  src/router.tsx
```

- [ ] **Step 10: Commit**

```bash
git commit -m "feat(rc-catalog): RcProductsPage (apps + products + entitlement links) + wire /rc/products route"
```
(No `Co-Authored-By` trailer.)

- [ ] **Step 11: WIP-safety check (HARD RULE)**

```bash
git status
```
Expected: only this task's five files appear as committed/clean; `git status` shows **no** changes under `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, no layout `*.test.tsx`, no `dashboard/src/features/command-palette/CommandPalette.tsx`, and no `dashboard/src/test/render-app.tsx`. `nav-model.ts` was not opened or edited by this task.


---

### Task C5.1: `RcOfferingsPage` (offerings + packages) + wire `/rc/offerings` route

The real `/rc/offerings` page (spec §3.3): a master-detail surface — an offerings `DataTable`
(identifier, displayName, current badge, package count) up top, and a single packages panel below
for whichever offering is selected (defaulting to the current offering, then the first one, so the
detail pane is never empty on load). "View packages" is a per-row control available to every role
(it only changes local selection, it isn't a mutation); **New offering** (header action), **Set
current**, **Edit**, **Delete** (offering row actions), and **Add package**, **Edit**, **Remove**
(package row actions) are admin-only, gated on `useProjectRole` ∈ {admin, owner} exactly like
`RcChartsPage`/`RcConnectPage`. Packages resolve their `productId` against `useRcProducts` for
display and for the Add-package product picker. Composition mirrors `RcChartsPage`'s `rcEnabled`
gating (`RcConnectPage` when not connected) and the project-settings members/tokens CRUD pattern
(`DataTable` + `dialog` create/edit + `alert-dialog` delete confirm) named in spec §3.

**Files**
- Create: `dashboard/src/features/revenuecat/components/RcOfferingsPage.tsx`
- Test: `dashboard/src/features/revenuecat/components/rc-offerings.test.tsx`
- Modify: `dashboard/src/router.tsx` (one import line + one `component:` line — well outside every
  WIP file)

**Interfaces**
- Consumes (from Section 2's `dashboard/src/features/revenuecat/catalog-api.ts` — types and hook
  signatures this task is written against; Section 2 owns the file, these are the exact shapes this
  task requires from it):

  ```ts
  export type RcPackageType =
    | 'UNKNOWN' | 'CUSTOM' | 'LIFETIME' | 'ANNUAL' | 'SIX_MONTH'
    | 'THREE_MONTH' | 'TWO_MONTH' | 'MONTHLY' | 'WEEKLY';

  export interface RcEntitlement { id: string; identifier: string; displayName: string; }

  export interface RcProduct {
    id: string;
    appId: string;
    storeProductId: string;
    type: 'AUTO_RENEWABLE_SUBSCRIPTION' | 'NON_RENEWING_SUBSCRIPTION' | 'CONSUMABLE' | 'NON_CONSUMABLE';
    displayName: string;
    priceCents: number | null;
    currency: string | null;
    durationIso8601: string | null;
    subscriptionGroupId: string | null;
    entitlements: RcEntitlement[];
  }

  export interface RcPackage {
    id: string;
    identifier: string;
    packageType: RcPackageType;
    productId: string;
    sortOrder: number;
  }

  export interface RcOffering {
    id: string;
    identifier: string;
    displayName: string;
    isCurrent: boolean;
    metadata: unknown;
    packages: RcPackage[];
  }

  // Reads — both take an optional `enabled` so a disconnected/still-loading project never fires
  // the purchase-service request (mirrors `RcMetricOptions` in purchase-metrics-api.ts).
  function useRcOfferings(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcOffering[], ApiError>;
  function useRcProducts(projectId: string, opts?: { enabled?: boolean }): UseQueryResult<RcProduct[], ApiError>;

  // Writes — each `.mutate(...)` payload combines path params with the body fields (mirrors
  // `useUpdateProjectMemberRole`/`useRemoveProjectMember` in features/projects/api.ts). Every one
  // of these invalidates the `['rc-catalog', projectId, 'offerings']` list query on success — that
  // includes the package mutations, since packages are nested under `RcOffering.packages` with no
  // separate list endpoint of their own.
  function useCreateRcOffering(projectId: string): UseMutationResult<
    RcOffering, ApiError, { identifier: string; displayName: string; metadata?: unknown }>;
  function useUpdateRcOffering(projectId: string): UseMutationResult<
    RcOffering, ApiError, { offeringId: string; displayName?: string; metadata?: unknown }>;
  function useDeleteRcOffering(projectId: string): UseMutationResult<void, ApiError, string /* offeringId */>;
  function useSetCurrentOffering(projectId: string): UseMutationResult<void, ApiError, string /* offeringId */>;
  function useAddPackage(projectId: string): UseMutationResult<RcPackage, ApiError, {
    offeringId: string; identifier: string; packageType: RcPackageType; productId: string; sortOrder?: number;
  }>;
  function useUpdatePackage(projectId: string): UseMutationResult<RcPackage, ApiError, {
    offeringId: string; packageId: string; packageType?: RcPackageType; sortOrder?: number;
  }>;
  function useRemovePackage(projectId: string): UseMutationResult<void, ApiError, { offeringId: string; packageId: string }>;
  ```

  Plus, unchanged from earlier tasks: `useRcEnabled(projectId)` (`../api`); `useProjectRole`,
  `useProjects` (`../../projects/api`); `RcConnectPage` (`./RcConnectPage`); `PageShell`
  (`../../../components/layout/PageShell`); `ApiError` (`../../../lib/api/problem`); the ui kit —
  `AlertDialog`/`AlertDialogAction`/`AlertDialogCancel`/`AlertDialogContent`/
  `AlertDialogDescription`/`AlertDialogFooter`/`AlertDialogTitle`, `Badge`, `Button`,
  `Card`/`CardContent`/`CardDescription`/`CardHeader`/`CardTitle`, `DataTable`/`DataTableColumn`,
  `Dialog`/`DialogContent`/`DialogDescription`/`DialogTitle`, `EmptyState`, `Input`, `Label`,
  `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`, `Textarea`, `useToast`.
- Produces: `RcOfferingsPage(): JSX.Element` (no props — reads `projectId` off the route). After
  the router edit, `/projects/$projectId/rc/offerings` renders it. No later task in this sub-project
  consumes it directly (C6.1 is a verify-only gate).

**TDD steps**

- [ ] **Step 1: Write the failing page test.** Create
  `dashboard/src/features/revenuecat/components/rc-offerings.test.tsx`:

  ```tsx
  import { describe, expect, it } from 'vitest';
  import { screen, waitFor, within } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { http, HttpResponse } from 'msw';
  import { renderApp } from '../../../test/render-app';
  import { server } from '../../../test/msw/server';
  import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN, projectsHandlerWithoutRc } from '../../../test/msw/handlers';
  import { authStore } from '../../auth/store';
  import type { RcOffering, RcPackageType, RcProduct } from '../catalog-api';

  const PID = TEST_PROJECT.id;
  const OFFERINGS_URL = `/projects/${PID}/rc/offerings`;
  const base = `/api/v1/projects/${PID}/catalog`;

  function problem(status: number, title: string) {
    return HttpResponse.json(
      { type: 'about:blank', title, status },
      { status, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }

  const PRODUCT_MONTHLY: RcProduct = {
    id: 'prod-monthly',
    appId: 'app-1',
    storeProductId: 'com.example.monthly',
    type: 'AUTO_RENEWABLE_SUBSCRIPTION',
    displayName: 'Monthly Pro',
    priceCents: 999,
    currency: 'USD',
    durationIso8601: 'P1M',
    subscriptionGroupId: null,
    entitlements: [],
  };
  const PRODUCT_ANNUAL: RcProduct = {
    id: 'prod-annual',
    appId: 'app-1',
    storeProductId: 'com.example.annual',
    type: 'AUTO_RENEWABLE_SUBSCRIPTION',
    displayName: 'Annual Pro',
    priceCents: 8999,
    currency: 'USD',
    durationIso8601: 'P1Y',
    subscriptionGroupId: null,
    entitlements: [],
  };

  const OFFERING_DEFAULT: RcOffering = {
    id: 'off-default',
    identifier: 'default',
    displayName: 'Default',
    isCurrent: true,
    metadata: null,
    packages: [
      { id: 'pkg-monthly', identifier: '$rc_monthly', packageType: 'MONTHLY', productId: PRODUCT_MONTHLY.id, sortOrder: 1 },
    ],
  };
  const OFFERING_PROMO: RcOffering = {
    id: 'off-promo',
    identifier: 'promo',
    displayName: 'Promo',
    isCurrent: false,
    metadata: { campaign: 'summer' },
    packages: [],
  };

  /**
   * Registers a stateful in-memory mock of the `catalog` offerings + products endpoints for one
   * test — `mobile_purchase` isn't reachable from a dashboard test, and none of these routes live in
   * the shared `handlers.ts` fixture (this sub-project is their first dashboard consumer). Mutates
   * the seeded arrays in place so a create/set-current/add/edit/remove is visible on the next GET,
   * mirroring the real service's read-your-writes behavior.
   */
  function mockCatalog(offerings: RcOffering[], products: RcProduct[]) {
    const state = { offerings: offerings.map((o) => ({ ...o, packages: [...o.packages] })), products };
    let nextOfferingId = 1;
    let nextPackageId = 1;

    server.use(
      http.get(`${base}/offerings`, () => HttpResponse.json(state.offerings)),
      http.get(`${base}/products`, () => HttpResponse.json(state.products)),
      http.post(`${base}/offerings`, async ({ request }) => {
        const body = (await request.json()) as { identifier: string; displayName: string; metadata?: unknown };
        const created: RcOffering = {
          id: `off-new-${nextOfferingId++}`,
          identifier: body.identifier,
          displayName: body.displayName,
          isCurrent: false,
          metadata: body.metadata ?? null,
          packages: [],
        };
        state.offerings.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
      http.post(`${base}/offerings/:offeringId/current`, ({ params }) => {
        state.offerings = state.offerings.map((o) => ({ ...o, isCurrent: o.id === params.offeringId }));
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch(`${base}/offerings/:offeringId`, async ({ params, request }) => {
        const index = state.offerings.findIndex((o) => o.id === params.offeringId);
        if (index === -1) return problem(404, 'Offering not found');
        const body = (await request.json()) as { displayName?: string; metadata?: unknown };
        state.offerings[index] = { ...state.offerings[index], ...body };
        return HttpResponse.json(state.offerings[index]);
      }),
      http.delete(`${base}/offerings/:offeringId`, ({ params }) => {
        state.offerings = state.offerings.filter((o) => o.id !== params.offeringId);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${base}/offerings/:offeringId/packages`, async ({ params, request }) => {
        const offering = state.offerings.find((o) => o.id === params.offeringId);
        if (!offering) return problem(404, 'Offering not found');
        const body = (await request.json()) as {
          identifier: string;
          packageType: RcPackageType;
          productId: string;
          sortOrder?: number;
        };
        const created = {
          id: `pkg-new-${nextPackageId++}`,
          identifier: body.identifier,
          packageType: body.packageType,
          productId: body.productId,
          sortOrder: body.sortOrder ?? 0,
        };
        offering.packages = [...offering.packages, created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.patch(`${base}/offerings/:offeringId/packages/:packageId`, async ({ params, request }) => {
        const offering = state.offerings.find((o) => o.id === params.offeringId);
        if (!offering) return problem(404, 'Offering not found');
        const index = offering.packages.findIndex((p) => p.id === params.packageId);
        if (index === -1) return problem(404, 'Package not found');
        const body = (await request.json()) as { packageType?: RcPackageType; sortOrder?: number };
        offering.packages[index] = { ...offering.packages[index], ...body };
        return HttpResponse.json(offering.packages[index]);
      }),
      http.delete(`${base}/offerings/:offeringId/packages/:packageId`, ({ params }) => {
        const offering = state.offerings.find((o) => o.id === params.offeringId);
        if (offering) offering.packages = offering.packages.filter((p) => p.id !== params.packageId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
  }

  function signInOwner() {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
  }

  describe('RcOfferingsPage', () => {
    it('renders offerings with a current badge, package counts, and the current offering’s packages resolved to product names', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY, PRODUCT_ANNUAL]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('default')).toBeInTheDocument();
      expect(main.getByText('promo')).toBeInTheDocument();
      expect(main.getByText('Current')).toBeInTheDocument(); // only "default" carries the badge

      const defaultRow = main.getByText('default').closest('tr') as HTMLElement;
      expect(within(defaultRow).getByText('1')).toBeInTheDocument(); // package count
      const promoRow = main.getByText('promo').closest('tr') as HTMLElement;
      expect(within(promoRow).getByText('0')).toBeInTheDocument();

      // Detail pane defaults to the current offering ("default").
      expect(main.getByText(/packages — default/i)).toBeInTheDocument();
      expect(main.getByText('$rc_monthly')).toBeInTheDocument();
      expect(main.getByText('MONTHLY')).toBeInTheDocument();
      expect(main.getByText('Monthly Pro (com.example.monthly)')).toBeInTheDocument();
    });

    it('creates an offering via the New offering dialog', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('default');

      await userEvent.click(main.getByRole('button', { name: 'New offering' }));
      const dialog = within(await screen.findByRole('dialog'));
      await userEvent.type(dialog.getByLabelText('Identifier'), 'promo');
      await userEvent.type(dialog.getByLabelText('Display name'), 'Promo');
      await userEvent.click(dialog.getByRole('button', { name: 'Create offering' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await main.findByText('promo')).toBeInTheDocument();
    });

    it('flips the current badge to a different offering after Set current', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('promo');

      const promoRow = main.getByText('promo').closest('tr') as HTMLElement;
      await userEvent.click(within(promoRow).getByRole('button', { name: 'Set current' }));

      await waitFor(() => {
        const refreshedPromoRow = main.getByText('promo').closest('tr') as HTMLElement;
        expect(within(refreshedPromoRow).getByText('Current')).toBeInTheDocument();
      });
      const defaultRow = main.getByText('default').closest('tr') as HTMLElement;
      expect(within(defaultRow).queryByText('Current')).not.toBeInTheDocument();
    });

    it('adds a package via the dialog, picking the product from useRcProducts', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY, PRODUCT_ANNUAL]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));
      await main.findByText('$rc_monthly');

      await userEvent.click(main.getByRole('button', { name: 'Add package' }));
      const dialog = within(await screen.findByRole('dialog'));
      await userEvent.type(dialog.getByLabelText('Identifier'), '$rc_annual');

      await userEvent.click(dialog.getByRole('combobox', { name: 'Product' }));
      await userEvent.click(await screen.findByRole('option', { name: /Annual Pro/ }), { pointerEventsCheck: 0 });

      await userEvent.click(dialog.getByRole('button', { name: 'Add package' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await main.findByText('$rc_annual')).toBeInTheDocument();
      expect(main.getByText('Annual Pro (com.example.annual)')).toBeInTheDocument();
    });

    it('edits a package’s type and sort order', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));
      const packageRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;

      await userEvent.click(within(packageRow).getByRole('button', { name: 'Edit' }));
      const dialog = within(await screen.findByRole('dialog'));

      await userEvent.click(dialog.getByRole('combobox', { name: 'Package type' }));
      await userEvent.click(await screen.findByRole('option', { name: 'ANNUAL' }), { pointerEventsCheck: 0 });

      const sortOrderInput = dialog.getByLabelText('Sort order');
      await userEvent.clear(sortOrderInput);
      await userEvent.type(sortOrderInput, '5');

      await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const updatedRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;
      expect(within(updatedRow).getByText('ANNUAL')).toBeInTheDocument();
      expect(within(updatedRow).getByText('5')).toBeInTheDocument();
    });

    it('removes a package via the alert-dialog confirm', async () => {
      signInOwner();
      mockCatalog([OFFERING_DEFAULT], [PRODUCT_MONTHLY]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));
      const packageRow = (await main.findByText('$rc_monthly')).closest('tr') as HTMLElement;

      await userEvent.click(within(packageRow).getByRole('button', { name: 'Remove' }));
      const alert = within(await screen.findByRole('alertdialog'));
      await userEvent.click(alert.getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(main.queryByText('$rc_monthly')).not.toBeInTheDocument();
      expect(await main.findByText('No packages in this offering')).toBeInTheDocument();
    });

    it('renders read-only for a viewer: offerings and packages are visible, no write controls render', async () => {
      signInOwner();
      server.use(
        http.get('/api/v1/projects', () => HttpResponse.json({ projects: [{ ...TEST_PROJECT, role: 'viewer' }] })),
      );
      mockCatalog([OFFERING_DEFAULT, OFFERING_PROMO], [PRODUCT_MONTHLY]);
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByText('default')).toBeInTheDocument();
      expect(main.getByText('$rc_monthly')).toBeInTheDocument(); // packages still visible to a viewer

      expect(main.queryByRole('button', { name: 'New offering' })).not.toBeInTheDocument();
      expect(main.queryByRole('button', { name: 'Set current' })).not.toBeInTheDocument();
      expect(main.queryByRole('button', { name: 'Add package' })).not.toBeInTheDocument();
      expect(main.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0);
      expect(main.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0);
      expect(main.queryAllByRole('button', { name: 'Remove' })).toHaveLength(0);
      // The read-only "View packages" toggle is still available.
      expect(main.getAllByRole('button', { name: 'View packages' }).length).toBeGreaterThan(0);
    });

    it('shows the connect upsell (not the offerings table) when RevenueCat is not connected', async () => {
      server.use(projectsHandlerWithoutRc());
      signInOwner();
      renderApp(OFFERINGS_URL);
      const main = within(await screen.findByRole('main'));

      expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
      expect(main.queryByText('New offering')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run — expect fail (route still shows the placeholder).**

  ```bash
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-offerings.test.tsx
  ```

  Expected failure: the first test times out inside `main.findByText('default')` (and every
  subsequent test fails the same way) — `/rc/offerings` still resolves to `RcPlaceholderPage`
  ("Offerings is not built yet"), so none of the offerings/packages content ever appears. Nothing
  imports `RcOfferingsPage` yet, so this is a content-assertion failure, not a module-resolution
  error; creating the component (Step 3) and swapping the router (Step 4) are both needed before it
  goes green.

- [ ] **Step 3: Implement `RcOfferingsPage`.** Create
  `dashboard/src/features/revenuecat/components/RcOfferingsPage.tsx`:

  ```tsx
  import { useState, type FormEvent, type ReactNode } from 'react';
  import { useParams } from '@tanstack/react-router';
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
  import { Input } from '../../../components/ui/input';
  import { Label } from '../../../components/ui/label';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
  import { Textarea } from '../../../components/ui/textarea';
  import { useToast } from '../../../components/ui/toast';
  import { ApiError } from '../../../lib/api/problem';
  import { useProjectRole, useProjects } from '../../projects/api';
  import { useRcEnabled } from '../api';
  import {
    useAddPackage,
    useCreateRcOffering,
    useDeleteRcOffering,
    useRcOfferings,
    useRcProducts,
    useRemovePackage,
    useSetCurrentOffering,
    useUpdatePackage,
    useUpdateRcOffering,
    type RcOffering,
    type RcPackage,
    type RcPackageType,
    type RcProduct,
  } from '../catalog-api';
  import { RcConnectPage } from './RcConnectPage';

  const PACKAGE_TYPES: RcPackageType[] = [
    'UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY',
  ];

  /** `${displayName} (${storeProductId})` — the label used everywhere a product is picked or shown. */
  function productLabel(product: RcProduct): string {
    return `${product.displayName} (${product.storeProductId})`;
  }

  /** Resolves a package's `productId` against the loaded product list; "Unknown product" while
   *  `useRcProducts` is still in flight or for a stale/deleted id, rather than crashing. */
  function resolveProductLabel(products: RcProduct[], productId: string): string {
    const product = products.find((p) => p.id === productId);
    return product ? productLabel(product) : 'Unknown product';
  }

  function errorTitle(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.problem.title : fallback;
  }

  function mutationErrorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : fallback;
  }

  /**
   * MyRevenueCat → Offerings (spec §3.3). Master-detail: the offerings `DataTable` up top
   * (identifier, displayName, current badge, package count), and a single packages panel below for
   * whichever offering is selected — defaulting to the current offering, then the first one, so the
   * detail pane is never empty on load. "View packages" is available to every role (it's a read, not
   * a mutation); New/Set current/Edit/Delete and the package Add/Edit/Remove controls are admin-only.
   */
  export function RcOfferingsPage() {
    const { projectId } = useParams({ from: '/private/projects/$projectId/rc/offerings' });
    const { data: projectsData } = useProjects();
    const project = projectsData?.projects.find((p) => p.id === projectId);
    const rcEnabled = useRcEnabled(projectId);
    const role = useProjectRole(projectId);
    const canManage = role === 'admin' || role === 'owner';
    const { toast } = useToast();

    const offeringsQuery = useRcOfferings(projectId, { enabled: rcEnabled });
    const productsQuery = useRcProducts(projectId, { enabled: rcEnabled });

    const [selectedOfferingId, setSelectedOfferingId] = useState<string | null>(null);
    const [showNewOffering, setShowNewOffering] = useState(false);
    const [editingOffering, setEditingOffering] = useState<RcOffering | null>(null);
    const [deletingOffering, setDeletingOffering] = useState<RcOffering | null>(null);
    const [showAddPackage, setShowAddPackage] = useState(false);
    const [editingPackage, setEditingPackage] = useState<RcPackage | null>(null);
    const [deletingPackage, setDeletingPackage] = useState<RcPackage | null>(null);

    const deleteOffering = useDeleteRcOffering(projectId);
    const setCurrentOffering = useSetCurrentOffering(projectId);
    const removePackage = useRemovePackage(projectId);

    // Same discipline as RcChartsPage: don't decide "not connected" until `useProjects()` has
    // resolved, or a still-loading flag briefly flashes the connect upsell.
    if (!project) {
      return (
        <PageShell
          projectId={projectId}
          title="Offerings"
          description="The product bundles presented to users, and how each one converts."
          breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Offerings' }]}
        >
          {null}
        </PageShell>
      );
    }
    if (!rcEnabled) return <RcConnectPage projectId={projectId} />;

    const offerings = offeringsQuery.data ?? [];
    const products = productsQuery.data ?? [];
    const activeOffering =
      offerings.find((o) => o.id === selectedOfferingId) ?? offerings.find((o) => o.isCurrent) ?? offerings[0] ?? null;
    const activePackages = activeOffering
      ? [...activeOffering.packages].sort((a, b) => a.sortOrder - b.sortOrder || a.identifier.localeCompare(b.identifier))
      : [];

    const handleSetCurrent = (offering: RcOffering) => {
      setCurrentOffering.mutate(offering.id, {
        onSuccess: () => toast({ title: `${offering.identifier} is now the current offering` }),
        onError: (error) =>
          toast({ title: 'Could not set current offering', description: errorTitle(error, 'Something went wrong.'), variant: 'error' }),
      });
    };

    const handleDeleteOffering = (offering: RcOffering) => {
      deleteOffering.mutate(offering.id, {
        onSuccess: () => {
          setDeletingOffering(null);
          if (selectedOfferingId === offering.id) setSelectedOfferingId(null);
          toast({ title: `Deleted ${offering.identifier}` });
        },
        onError: (error) => {
          setDeletingOffering(null);
          toast({ title: 'Could not delete offering', description: errorTitle(error, 'Something went wrong.'), variant: 'error' });
        },
      });
    };

    const handleRemovePackage = (offeringId: string, pkg: RcPackage) => {
      removePackage.mutate(
        { offeringId, packageId: pkg.id },
        {
          onSuccess: () => {
            setDeletingPackage(null);
            toast({ title: `Removed ${pkg.identifier}` });
          },
          onError: (error) => {
            setDeletingPackage(null);
            toast({ title: 'Could not remove package', description: errorTitle(error, 'Something went wrong.'), variant: 'error' });
          },
        },
      );
    };

    const offeringColumns: Array<DataTableColumn<RcOffering>> = [
      { key: 'identifier', header: 'Identifier' },
      { key: 'displayName', header: 'Display name' },
      { key: 'current', header: 'Current', render: (o) => (o.isCurrent ? <Badge variant="accent">Current</Badge> : null) },
      { key: 'packages', header: 'Packages', align: 'right', sortValue: (o) => o.packages.length, render: (o) => o.packages.length },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (offering) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelectedOfferingId(offering.id)}>
              View packages
            </Button>
            {canManage && !offering.isCurrent && (
              <Button variant="secondary" size="sm" disabled={setCurrentOffering.isPending} onClick={() => handleSetCurrent(offering)}>
                Set current
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" size="sm" onClick={() => setEditingOffering(offering)}>
                Edit
              </Button>
            )}
            {canManage && (
              <Button variant="danger" size="sm" onClick={() => setDeletingOffering(offering)}>
                Delete
              </Button>
            )}
          </div>
        ),
      },
    ];

    const packageColumns: Array<DataTableColumn<RcPackage>> = [
      { key: 'identifier', header: 'Identifier' },
      { key: 'packageType', header: 'Type', render: (p) => <Badge variant="outline">{p.packageType}</Badge> },
      { key: 'product', header: 'Product', render: (p) => resolveProductLabel(products, p.productId) },
      { key: 'sortOrder', header: 'Sort order', align: 'right' },
      ...(canManage
        ? [
            {
              key: 'actions',
              header: 'Actions',
              align: 'right' as const,
              render: (pkg: RcPackage) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingPackage(pkg)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeletingPackage(pkg)}>
                    Remove
                  </Button>
                </div>
              ),
            },
          ]
        : []),
    ];

    const newOfferingButton = <Button onClick={() => setShowNewOffering(true)}>New offering</Button>;
    const addPackageButton = <Button size="sm" onClick={() => setShowAddPackage(true)}>Add package</Button>;

    return (
      <PageShell
        projectId={projectId}
        title="Offerings"
        description="The product bundles presented to users, and how each one converts."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Offerings' }]}
        actions={canManage ? newOfferingButton : null}
      >
        {offeringsQuery.isPending && <p role="status">Loading offerings…</p>}
        {offeringsQuery.isError && <p role="alert" className="text-danger">{errorTitle(offeringsQuery.error, 'Failed to load offerings.')}</p>}

        {!offeringsQuery.isPending && !offeringsQuery.isError && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Offerings</CardTitle>
                <CardDescription>Group packages into a paywall bundle; exactly one offering is current.</CardDescription>
              </CardHeader>
              <CardContent>
                {offerings.length > 0 ? (
                  <DataTable caption="RevenueCat offerings" columns={offeringColumns} rows={offerings} rowKey={(o) => o.id} />
                ) : (
                  <EmptyState
                    title="No offerings yet"
                    description="Create an offering to start bundling packages for your paywall."
                    action={canManage ? newOfferingButton : null}
                  />
                )}
              </CardContent>
            </Card>

            {activeOffering && (
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>Packages — {activeOffering.identifier}</CardTitle>
                    <CardDescription>{activeOffering.displayName}</CardDescription>
                  </div>
                  {canManage && addPackageButton}
                </CardHeader>
                <CardContent>
                  {activePackages.length > 0 ? (
                    <DataTable
                      caption={`Packages in ${activeOffering.identifier}`}
                      columns={packageColumns}
                      rows={activePackages}
                      rowKey={(p) => p.id}
                    />
                  ) : (
                    <EmptyState
                      title="No packages in this offering"
                      description="Add a package to attach a product to this offering's paywall."
                      action={canManage ? addPackageButton : null}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Dialog open={canManage && showNewOffering} onOpenChange={setShowNewOffering}>
          <DialogContent>
            {showNewOffering && <OfferingForm projectId={projectId} onDone={() => setShowNewOffering(false)} />}
          </DialogContent>
        </Dialog>

        <Dialog open={canManage && editingOffering !== null} onOpenChange={(open) => !open && setEditingOffering(null)}>
          <DialogContent>
            {editingOffering && (
              <OfferingForm projectId={projectId} offering={editingOffering} onDone={() => setEditingOffering(null)} />
            )}
          </DialogContent>
        </Dialog>

        <ConfirmAlert
          open={canManage && deletingOffering !== null}
          onOpenChange={(open) => !open && setDeletingOffering(null)}
          title="Delete offering"
          description={`Delete "${deletingOffering?.identifier}"? Its ${deletingOffering?.packages.length ?? 0} package(s) are removed with it. This can’t be undone.`}
          pending={deleteOffering.isPending}
          confirmLabel="Delete"
          onConfirm={() => deletingOffering && handleDeleteOffering(deletingOffering)}
        />

        <Dialog open={canManage && showAddPackage && activeOffering !== null} onOpenChange={setShowAddPackage}>
          <DialogContent>
            {showAddPackage && activeOffering && (
              <PackageForm projectId={projectId} offeringId={activeOffering.id} products={products} onDone={() => setShowAddPackage(false)} />
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={canManage && editingPackage !== null} onOpenChange={(open) => !open && setEditingPackage(null)}>
          <DialogContent>
            {editingPackage && activeOffering && (
              <PackageForm
                projectId={projectId}
                offeringId={activeOffering.id}
                pkg={editingPackage}
                products={products}
                onDone={() => setEditingPackage(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        <ConfirmAlert
          open={canManage && deletingPackage !== null}
          onOpenChange={(open) => !open && setDeletingPackage(null)}
          title="Remove package"
          description={`Remove "${deletingPackage?.identifier}" from ${activeOffering?.identifier}? This can’t be undone.`}
          pending={removePackage.isPending}
          confirmLabel="Remove"
          onConfirm={() => activeOffering && deletingPackage && handleRemovePackage(activeOffering.id, deletingPackage)}
        />
      </PageShell>
    );
  }

  /** Shared admin-mutation confirm — the offering-delete and package-remove alert-dialogs (spec
   *  §3.3 row actions) are identical apart from copy and which mutation fires. */
  function ConfirmAlert({
    open,
    onOpenChange,
    title,
    description,
    pending,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: ReactNode;
    pending: boolean;
    confirmLabel: string;
    onConfirm: () => void;
  }) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" disabled={pending} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  /** Create when `offering` is omitted, edit when given (identifier becomes read-only, and the
   *  submit button targets `useUpdateRcOffering` instead of `useCreateRcOffering`). */
  function OfferingForm({ projectId, offering, onDone }: { projectId: string; offering?: RcOffering; onDone: () => void }) {
    const createOffering = useCreateRcOffering(projectId);
    const updateOffering = useUpdateRcOffering(projectId);
    const isEdit = offering !== undefined;
    const pending = isEdit ? updateOffering.isPending : createOffering.isPending;
    const [identifier, setIdentifier] = useState(offering?.identifier ?? '');
    const [displayName, setDisplayName] = useState(offering?.displayName ?? '');
    const [metadataText, setMetadataText] = useState(
      offering?.metadata != null ? JSON.stringify(offering.metadata, null, 2) : '',
    );
    const [formError, setFormError] = useState<string | null>(null);

    const handleSubmit = (event: FormEvent) => {
      event.preventDefault();
      let metadata: unknown;
      if (metadataText.trim().length > 0) {
        try {
          metadata = JSON.parse(metadataText);
        } catch {
          setFormError('Metadata must be valid JSON.');
          return;
        }
      }
      const onError = (error: unknown) =>
        setFormError(mutationErrorMessage(error, `Could not ${isEdit ? 'update' : 'create'} offering.`));
      if (isEdit) {
        updateOffering.mutate(
          { offeringId: offering.id, displayName, ...(metadata !== undefined ? { metadata } : {}) },
          { onSuccess: onDone, onError },
        );
      } else {
        createOffering.mutate(
          { identifier, displayName, ...(metadata !== undefined ? { metadata } : {}) },
          { onSuccess: onDone, onError },
        );
      }
    };

    return (
      <>
        <DialogTitle>{isEdit ? 'Edit offering' : 'New offering'}</DialogTitle>
        <DialogDescription>
          {isEdit ? `${offering.identifier} — identifier can’t be changed.` : 'Offerings group packages for the paywall.'}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="offering-identifier" className="mb-1 block">Identifier</Label>
            <Input
              id="offering-identifier"
              value={isEdit ? offering.identifier : identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={isEdit}
              readOnly={isEdit}
              required
            />
          </div>
          <div>
            <Label htmlFor="offering-display-name" className="mb-1 block">Display name</Label>
            <Input id="offering-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="offering-metadata" className="mb-1 block">Metadata (JSON{isEdit ? '' : ', optional'})</Label>
            <Textarea
              id="offering-metadata"
              value={metadataText}
              onChange={(e) => setMetadataText(e.target.value)}
              placeholder='{"tier": "premium"}'
            />
          </div>
          {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create offering'}
            </Button>
          </div>
        </form>
      </>
    );
  }

  /** Add when `pkg` is omitted, edit when given (identifier/product become fixed — the backend PATCH
   *  only accepts `packageType`/`sortOrder`, spec §1). */
  function PackageForm({
    projectId,
    offeringId,
    pkg,
    products,
    onDone,
  }: {
    projectId: string;
    offeringId: string;
    pkg?: RcPackage;
    products: RcProduct[];
    onDone: () => void;
  }) {
    const addPackage = useAddPackage(projectId);
    const updatePackage = useUpdatePackage(projectId);
    const isEdit = pkg !== undefined;
    const pending = isEdit ? updatePackage.isPending : addPackage.isPending;
    const [identifier, setIdentifier] = useState(pkg?.identifier ?? '');
    const [packageType, setPackageType] = useState<RcPackageType>(pkg?.packageType ?? 'CUSTOM');
    const [productId, setProductId] = useState(pkg?.productId ?? products[0]?.id ?? '');
    const [sortOrder, setSortOrder] = useState(String(pkg?.sortOrder ?? 0));
    const [formError, setFormError] = useState<string | null>(null);

    if (!isEdit && products.length === 0) {
      return (
        <>
          <DialogTitle>Add package</DialogTitle>
          <DialogDescription>Create a product first (Products page) — every package must reference one.</DialogDescription>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="secondary" onClick={onDone}>Close</Button>
          </div>
        </>
      );
    }

    const handleSubmit = (event: FormEvent) => {
      event.preventDefault();
      const onError = (error: unknown) =>
        setFormError(mutationErrorMessage(error, `Could not ${isEdit ? 'update' : 'add'} package.`));
      if (isEdit) {
        updatePackage.mutate(
          { offeringId, packageId: pkg.id, packageType, sortOrder: Number(sortOrder) || 0 },
          { onSuccess: onDone, onError },
        );
        return;
      }
      if (!productId) {
        setFormError('Choose a product.');
        return;
      }
      addPackage.mutate(
        { offeringId, identifier, packageType, productId, sortOrder: Number(sortOrder) || 0 },
        { onSuccess: onDone, onError },
      );
    };

    return (
      <>
        <DialogTitle>{isEdit ? 'Edit package' : 'Add package'}</DialogTitle>
        <DialogDescription>
          {isEdit ? `${pkg.identifier} → ${resolveProductLabel(products, pkg.productId)}` : 'Attach a product to this offering’s paywall.'}
        </DialogDescription>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          {!isEdit && (
            <div>
              <Label htmlFor="package-identifier" className="mb-1 block">Identifier</Label>
              <Input id="package-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            </div>
          )}
          <div>
            <Label className="mb-1 block">Package type</Label>
            <Select value={packageType} onValueChange={(v) => setPackageType(v as RcPackageType)}>
              <SelectTrigger aria-label="Package type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PACKAGE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!isEdit && (
            <div>
              <Label className="mb-1 block">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger aria-label="Product"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {products.map((product) => <SelectItem key={product.id} value={product.id}>{productLabel(product)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="package-sort-order" className="mb-1 block">Sort order</Label>
            <Input id="package-sort-order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
          {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add package'}
            </Button>
          </div>
        </form>
      </>
    );
  }
  ```

- [ ] **Step 4: Swap the router line (one import + one `component:` line).** Edit
  `dashboard/src/router.tsx`.

  Add the import beside the other RC page imports (after the `RcChartsPage` import — and after
  `RcEntitlementsPage`/`RcProductsPage` too, if C3/C4 already landed them):

  ```tsx
  import { RcOfferingsPage } from './features/revenuecat/components/RcOfferingsPage';
  ```

  Replace the inline placeholder component of `rcOfferingsRoute` (currently):

  ```tsx
  const rcOfferingsRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/offerings',
    component: () => (
      <RcPlaceholderPage
        title="Offerings"
        description="The product bundles presented to users, and how each one converts."
      />
    ),
  });
  ```

  with:

  ```tsx
  const rcOfferingsRoute = createRoute({
    getParentRoute: () => privateRoute,
    path: '/projects/$projectId/rc/offerings',
    component: RcOfferingsPage,
  });
  ```

  `RcPlaceholderPage` stays imported — Customers and Paywalls still use it. No `nav-model`,
  `AppLayout`, or any other WIP file is touched.

- [ ] **Step 5: Run — expect pass.**

  ```bash
  cd dashboard && npx vitest run src/features/revenuecat/components/rc-offerings.test.tsx
  ```

  Expected: all 7 tests pass (render / create / set-current / add-package / edit-package /
  remove-package / viewer-read-only / not-connected).

- [ ] **Step 6: Commit.**

  ```bash
  cd dashboard && git add \
    src/features/revenuecat/components/RcOfferingsPage.tsx \
    src/features/revenuecat/components/rc-offerings.test.tsx \
    src/router.tsx \
    && git commit -m "feat(rc-catalog): RcOfferingsPage (offerings + packages) + wire /rc/offerings route"
  ```

- [ ] **Step 7: WIP-safety gate — assert no collapse-rail WIP file was touched by this commit.**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --porcelain -- \
    dashboard/src/components/layout/AppLayout.tsx \
    dashboard/src/components/layout/OrgSwitcher.tsx \
    dashboard/src/components/layout/ProjectSwitcher.tsx \
    dashboard/src/components/layout/ToolRail.tsx \
    dashboard/src/components/layout/nav-model.ts \
    dashboard/src/components/layout/RailInitial.tsx \
    dashboard/src/features/command-palette/CommandPalette.tsx \
    dashboard/src/test/render-app.tsx \
    'dashboard/src/components/layout/*.test.tsx'
  ```

  Expected: **empty output** (zero lines). Confirm the commit's file set matches exactly the three
  files staged in Step 6:

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git show --stat --oneline HEAD -- dashboard/
  ```

  Expected: only `RcOfferingsPage.tsx`, `rc-offerings.test.tsx`, and `router.tsx` appear;
  `nav-model.ts` and every other WIP file are absent.

---

### Task C6.1: Verify gate — Catalog Config UIs sub-project (no new files)

Final acceptance for the whole `myrevenuecat-catalog-config-uis` sub-project (spec §7 build-order
step 6): both backends typecheck clean and their catalog/e2e tests pass, the dashboard typechecks,
the full `revenuecat` test slice passes, the new files lint clean, and `git status` proves no
collapse-rail/nav-model file was touched anywhere across C1–C5.

**Files**
- None created or modified (verification only).

**Interfaces**
- Consumes: the entire sub-project surface — server PATCH endpoints + Testcontainers/e2e specs
  (C1), `catalog-api.ts` + its hook tests (C2), `RcEntitlementsPage` (C3), `RcProductsPage` (C4),
  `RcOfferingsPage` + the three router swaps (C3/C4/C5).
- Produces: nothing.

**Steps**

- [ ] **Step 1: `mobile_purchase` typecheck.**

  ```bash
  cd backend/mobile_purchase && npx tsc --noEmit
  ```

  Expected: exits 0 — the four new PATCH schemas/services/controllers (C1) and every consumer of
  `catalog.types.ts` are fully typed.

- [ ] **Step 2: `mobile_purchase` catalog + e2e tests.**

  ```bash
  cd backend/mobile_purchase && npx jest src/catalog test/e2e
  ```

  Expected: green — `products.service.spec.ts`, `entitlements.service.spec.ts`,
  `offerings.service.spec.ts` (each `update` method: happy path, ownership 404, empty-body 400,
  immutable-field-absent) plus `catalog.e2e-spec.ts` (each new `PATCH` route: 200 admin, 403 viewer,
  404 unknown id) all pass; no regression in the pre-existing catalog/e2e coverage
  (`cors.e2e-spec.ts`, `metrics.e2e-spec.ts`, `subscribers.e2e-spec.ts` are unaffected by this
  sub-project and must stay green too, since `npx jest test/e2e` runs the whole directory).

- [ ] **Step 3: `mobile_analytics` typecheck (per-service isolation, spec §0).**

  ```bash
  cd backend/mobile_analytics && npx tsc --noEmit
  ```

  Expected: exits 0 — this sub-project makes no `mobile_purchase` schema change (PATCH reuses
  existing columns), so there is nothing for a Prisma-client regen to break here, but the isolation
  check runs regardless (mirrors the RevenueCat-integration sub-project's own gate).

- [ ] **Step 4: Dashboard typecheck.**

  ```bash
  cd dashboard && npm run typecheck
  ```

  Expected: `tsc --noEmit` exits 0 — `catalog-api.ts`'s hooks/types (C2) and all three catalog pages
  (C3/C4/C5) are fully typed, including the `Array<DataTableColumn<T>>` conditional-spread actions
  columns and the `isEdit`-narrowed `OfferingForm`/`PackageForm` union props in `RcOfferingsPage`.

- [ ] **Step 5: Dashboard `revenuecat` test slice.**

  ```bash
  cd dashboard && npx vitest run src/features/revenuecat
  ```

  Expected: green — `api.test.ts`, `purchase-metrics-api.test.ts`, `rc-charts.test.tsx`,
  `rc-connect.test.tsx`, `rc-nav.test.tsx`, `rc-pages.test.tsx` (Customers/Paywalls still render
  `RcPlaceholderPage`), plus the new `rc-entitlements.test.tsx` (C3), `rc-products.test.tsx` (C4),
  and `rc-offerings.test.tsx` (C5) all pass — no regression from the three placeholder swaps.

- [ ] **Step 6: Scoped lint on the files this sub-project actually added/touched.**

  ```bash
  cd dashboard && npx eslint \
    src/features/revenuecat/catalog-api.ts \
    src/features/revenuecat/catalog-api.test.ts \
    src/features/revenuecat/components/RcEntitlementsPage.tsx \
    src/features/revenuecat/components/rc-entitlements.test.tsx \
    src/features/revenuecat/components/RcProductsPage.tsx \
    src/features/revenuecat/components/rc-products.test.tsx \
    src/features/revenuecat/components/RcOfferingsPage.tsx \
    src/features/revenuecat/components/rc-offerings.test.tsx \
    src/router.tsx
  ```

  Expected: exits 0 — no unused imports (`ReactNode`, `FormEvent`, every ui-kit import in
  `RcOfferingsPage.tsx` is referenced), no rules-of-hooks violations (`OfferingForm`/`PackageForm`
  call every hook before their early `products.length === 0` return), no `@typescript-eslint`
  errors on the conditional `DataTableColumn` actions-column spreads. Adjust the file list if C2's
  hook-test file is named differently than assumed above (`catalog-api.test.ts`) — confirm with
  `ls src/features/revenuecat/*.test.ts` first if unsure.

- [ ] **Step 7: WIP-safety gate — assert no collapse-rail/nav-model file changed across the whole
  sub-project (C1–C5).**

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git status --porcelain -- \
    dashboard/src/components/layout/AppLayout.tsx \
    dashboard/src/components/layout/OrgSwitcher.tsx \
    dashboard/src/components/layout/ProjectSwitcher.tsx \
    dashboard/src/components/layout/ToolRail.tsx \
    dashboard/src/components/layout/nav-model.ts \
    dashboard/src/components/layout/RailInitial.tsx \
    dashboard/src/features/command-palette/CommandPalette.tsx \
    dashboard/src/test/render-app.tsx \
    'dashboard/src/components/layout/*.test.tsx'
  ```

  Expected: **empty output** (zero lines) for every sub-project commit, not just C5's.

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git log --oneline -20 -- backend/mobile_purchase dashboard/src/features/revenuecat dashboard/src/router.tsx
  ```

  Read the listed commit range and, for each one, run:

  ```bash
  cd /Users/aimeric/Documents/personnal-project/MyAmpix && git show --stat --oneline <sha>
  ```

  Expected: every file touched across the whole C1–C5 range lives under
  `backend/mobile_purchase/{src,test,prisma}` , `dashboard/src/features/revenuecat/`, or is the
  single `dashboard/src/router.tsx` (import + `component:` line swaps only); `nav-model.ts` and
  every other collapse-rail WIP path from Step 7's list are absent from every commit in the range.


---

