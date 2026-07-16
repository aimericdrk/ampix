# RevenueCat parity P0 — Domain model (catalog) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the static RevenueCat-style catalog (apps, products, entitlements, offerings, packages) as the project-scoped substrate P1 and P3 read from.

**Architecture:** Six additive `rc_*` Prisma models under `Project`, plus a `backend/src/catalog` NestJS module (admin-gated CRUD controllers, services, a pure App-User-ID validator + key generator + Zod schemas, and a `resolveCurrentOffering` service). Purely additive to the RevenueCat *mirror* — the mirror tables and module are never touched. No store calls, no entitlement computation, no deployment: 100% unit/Testcontainers-testable.

**Tech Stack:** NestJS 11, Prisma 6 + Postgres, Zod, Jest + `@testcontainers/postgresql`.

**Spec:** `docs/superpowers/specs/2026-07-16-rc-parity-p0-domain-model-design.md`

## Global Constraints

- **Backend only.** No `dashboard/`, no `sdk/`. Additive: **never modify** `src/revenuecat/**`, `RevenueCatIntegration`, `SubscriptionState`, or `RevenueCatWebhookEvent`.
- **Follow the restructured-backend layout:** capability folder `src/catalog/` with `controllers/`, `services/`, `support/`, a flat `catalog.module.ts` and `catalog.types.ts`. **No barrel `index.ts` files.** Imports are relative (only alias is `@myampix/contracts`).
- **Schema conventions (verbatim):** `@id @default(uuid(7)) @db.Uuid`, snake_case `@map`, `@@map` table names prefixed `rc_`, `onDelete: Cascade` from `Project`.
- **`PackageType` enum is RevenueCat's, verbatim:** `UNKNOWN, CUSTOM, LIFETIME, ANNUAL, SIX_MONTH, THREE_MONTH, TWO_MONTH, MONTHLY, WEEKLY`.
- **Auth:** controllers class-level `@UseGuards(JwtAuthGuard)`; writes method-level `@UseGuards(ProjectRolesGuard) @ProjectRoles('admin')`; reads use `@ProjectRoles('viewer')`. Validate bodies with `parseOrThrow(zodSchema, body)` from `src/auth/schemas/auth.schemas`.
- **Errors:** throw `ProblemException` (from `src/common/problem-details.filter` / wherever it lives — grep it) so failures exit as RFC 7807 via the global filter. 404 not-found, 409 unique-violation, 400 validation.
- **Credential encryption:** reuse `src/auth/crypto/aes-gcm.ts` (`encryptSecret`/`decryptSecret`/`decodeEncryptionKey`). P0 ships the column + a `STORE_CREDENTIALS_ENC_KEY` (optional in config); it does **not** populate credentials (that is P1).
- **Commits:** one per task; **no `Co-Authored-By` trailer** (session-authorized per-task commits). The controller confirms commit authorization at execution start.
- **Verify:** `cd backend && npm run build && npm test` green after each task.

---

### Task 1: Prisma models, migration, config key

Lands the whole schema so every later task has real types. One deliverable: the migration applies and `prisma generate` produces the new model types.

**Files:**
- Modify: `backend/prisma/schema.prisma` (add enums, 6 models, `Project` back-relations)
- Create: `backend/prisma/migrations/<timestamp>_rc_parity_catalog/migration.sql` (via `prisma migrate dev`)
- Modify: `backend/src/config/app-config.ts` (add optional `STORE_CREDENTIALS_ENC_KEY`)
- Test: `backend/src/catalog/catalog-schema.spec.ts` (new — a Testcontainers smoke test that the tables exist)

**Interfaces:**
- Produces: Prisma models `App`, `Product`, `Entitlement`, `ProductEntitlement`, `Offering`, `Package`; enums `AppPlatform`, `ProductType`, `PackageType`; config field `storeCredentialsEncKey?: string`.

- [ ] **Step 1: Write the failing smoke test**

Create `backend/src/catalog/catalog-schema.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../test/integration/helpers/containers';

jest.setTimeout(180000);

describe('rc_* catalog schema', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container.stop();
  });

  it('creates an app, product, entitlement, mapping, offering, and package', async () => {
    // Project.createdById is optional — no need to create a User (avoids guessing User's required fields).
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });

    const app = await prisma.app.create({
      data: { projectId: project.id, name: 'iOS', platform: 'IOS', bundleId: 'com.x.y', publicSdkKey: 'mrc_pub_test1' },
    });
    const product = await prisma.product.create({
      data: { projectId: project.id, appId: app.id, storeProductId: 'com.x.y.monthly', type: 'AUTO_RENEWABLE_SUBSCRIPTION', displayName: 'Monthly' },
    });
    const ent = await prisma.entitlement.create({ data: { projectId: project.id, identifier: 'pro', displayName: 'Pro' } });
    await prisma.productEntitlement.create({ data: { productId: product.id, entitlementId: ent.id } });
    const offering = await prisma.offering.create({ data: { projectId: project.id, identifier: 'default', displayName: 'Default', isCurrent: true } });
    const pkg = await prisma.package.create({
      data: { offeringId: offering.id, identifier: '$rc_monthly', packageType: 'MONTHLY', productId: product.id },
    });

    expect(pkg.packageType).toBe('MONTHLY');
    const withEnt = await prisma.product.findUnique({ where: { id: product.id }, include: { entitlements: true } });
    expect(withEnt?.entitlements).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/catalog/catalog-schema.spec.ts`
Expected: FAIL — `prisma.app` is not a function (models don't exist yet).

- [ ] **Step 3: Add the enums + models to the schema**

Append to `backend/prisma/schema.prisma` the three enums and six models **exactly as written in the spec's "Data model" section** (`docs/superpowers/specs/2026-07-16-rc-parity-p0-domain-model-design.md`, the ```prisma blocks). Copy them verbatim.

Then add these back-relations inside the existing `model Project { ... }` block, next to the RC-mirror relations already there:

```prisma
  apps            App[]
  catalogProducts Product[]
  entitlements    Entitlement[]
  offerings       Offering[]
```

- [ ] **Step 4: Create the migration + generate the client**

Run: `cd backend && npx prisma migrate dev --name rc_parity_catalog --create-only`
Then open the generated `migration.sql` and **append** the partial unique index Prisma can't express (single current offering per project):

```sql
-- Single current offering per project (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "rc_offerings_one_current_per_project"
  ON "rc_offerings" ("project_id") WHERE "is_current" = true;
```

Then: `npx prisma migrate deploy` (applies to your dev DB) and `npx prisma generate`.

- [ ] **Step 5: Add the optional config key**

In `backend/src/config/app-config.ts`, add to `envSchema` (near `TOTP_ENC_KEY`):

```ts
  // P0 (RC parity) — encrypts App store credentials at rest (reuses the aes-gcm helper). Optional:
  // P0 never writes credentials; P1's connect-store flow requires it before it can.
  STORE_CREDENTIALS_ENC_KEY: z.string().optional(),
```

and surface it on `AppConfig` (optional, like the other optional fields) and populate it in `loadConfig()`.

- [ ] **Step 6: Run the smoke test**

Run: `cd backend && npx jest src/catalog/catalog-schema.spec.ts`
Expected: PASS.

- [ ] **Step 7: Build + commit**

```bash
cd backend && npm run build
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/config/app-config.ts backend/src/catalog/catalog-schema.spec.ts
git commit -m "feat(catalog): add rc_* domain model (apps/products/entitlements/offerings/packages)"
```

---

### Task 2: Pure support units (validator, key generator, Zod schemas, types)

All pure, no DB — fast unit tests. These are consumed by every controller/service, so they come before the CRUD.

**Files:**
- Create: `backend/src/catalog/support/app-user-id.validator.ts` + `.spec.ts`
- Create: `backend/src/catalog/support/key-generator.ts` + `.spec.ts`
- Create: `backend/src/catalog/support/catalog.schemas.ts`
- Create: `backend/src/catalog/catalog.types.ts`

**Interfaces:**
- Produces: `assertValidAppUserId(id: string, reservedStoreIds?: string[]): void`; `generatePublicSdkKey(): string`; Zod schemas `createAppSchema`, `createProductSchema`, `createEntitlementSchema`, `attachEntitlementSchema`, `createOfferingSchema`, `createPackageSchema`; types `ResolvedOffering`, `ResolvedPackage`.

- [ ] **Step 1: Write the failing validator test**

Create `backend/src/catalog/support/app-user-id.validator.spec.ts`:

```ts
import { assertValidAppUserId } from './app-user-id.validator';

describe('assertValidAppUserId', () => {
  it('accepts a normal id', () => {
    expect(() => assertValidAppUserId('user_12345')).not.toThrow();
  });

  it.each(['no_user', 'null', 'NULL', 'none', 'nil', '(null)', 'nan', 'unidentified', 'unknown', 'undefined', '', '   '])(
    'rejects reserved/blank id %p',
    (id) => {
      expect(() => assertValidAppUserId(id)).toThrow();
    },
  );

  it('rejects an email-shaped id (PII)', () => {
    expect(() => assertValidAppUserId('a@b.com')).toThrow();
  });

  it('rejects an id equal to a project store identifier', () => {
    expect(() => assertValidAppUserId('com.acme.app', ['com.acme.app'])).toThrow();
  });

  it('rejects an over-length id', () => {
    expect(() => assertValidAppUserId('x'.repeat(1501))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && npx jest src/catalog/support/app-user-id.validator.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `backend/src/catalog/support/app-user-id.validator.ts`:

```ts
import { ProblemException } from '../../common/problem-details.filter';

/** RevenueCat's reserved/invalid App User IDs — accepting these corrupts the identity graph. */
const RESERVED = new Set([
  'no_user', 'null', 'none', 'nil', '(null)', 'nan', 'unidentified', 'unknown', 'undefined',
]);
const MAX_LENGTH = 1500;

/**
 * Throws a 400 ProblemException if `id` is not a valid App User ID, replicating RevenueCat's rules:
 * non-empty, not a reserved sentinel, not PII-shaped (email), not a store bundle/package id, bounded
 * length, no control characters.
 */
export function assertValidAppUserId(id: string, reservedStoreIds: string[] = []): void {
  const trimmed = id?.trim() ?? '';
  const bad = (message: string): never => {
    throw new ProblemException({ status: 400, title: 'Invalid app user id', detail: message });
  };
  if (trimmed.length === 0) bad('app user id must not be empty');
  if (trimmed.length > MAX_LENGTH) bad(`app user id must be <= ${MAX_LENGTH} characters`);
  if (RESERVED.has(trimmed.toLowerCase())) bad(`"${id}" is a reserved app user id`);
  if (trimmed.includes('@')) bad('app user id must not be an email / PII');
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(trimmed)) bad('app user id must not contain control characters');
  if (reservedStoreIds.some((s) => s === trimmed)) bad('app user id must not equal a store identifier');
}
```

(Confirm `ProblemException`'s import path by grepping — adjust if it lives elsewhere. Match its existing constructor shape.)

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npx jest src/catalog/support/app-user-id.validator.spec.ts`
Expected: PASS.

- [ ] **Step 5: Key generator (test → impl)**

Create `backend/src/catalog/support/key-generator.spec.ts`:

```ts
import { generatePublicSdkKey } from './key-generator';

describe('generatePublicSdkKey', () => {
  it('starts with the public prefix and is unique', () => {
    const a = generatePublicSdkKey();
    const b = generatePublicSdkKey();
    expect(a).toMatch(/^mrc_pub_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
```

Create `backend/src/catalog/support/key-generator.ts`:

```ts
import { randomBytes } from 'node:crypto';

/** Public SDK key (safe to ship in a client): `mrc_pub_` + 16 random bytes hex. */
export function generatePublicSdkKey(): string {
  return `mrc_pub_${randomBytes(16).toString('hex')}`;
}
```

Run: `cd backend && npx jest src/catalog/support/key-generator.spec.ts` → PASS.

- [ ] **Step 6: Zod schemas + types (no test — exercised via controller tests in later tasks)**

Create `backend/src/catalog/catalog.types.ts`:

```ts
import type { PackageType, ProductType } from '@prisma/client';

export interface ResolvedPackage {
  identifier: string;
  packageType: PackageType;
  product: {
    storeProductId: string;
    type: ProductType;
    priceCents: number | null;
    currency: string | null;
    durationIso8601: string | null;
    entitlements: string[];
  };
}

export interface ResolvedOffering {
  identifier: string;
  metadata: unknown;
  packages: ResolvedPackage[];
}
```

Create `backend/src/catalog/support/catalog.schemas.ts`:

```ts
import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.$-]+$/, 'invalid identifier');

export const createAppSchema = z
  .object({
    name: z.string().min(1).max(200),
    platform: z.enum(['IOS', 'ANDROID', 'MACOS', 'AMAZON', 'WEB']),
    bundleId: z.string().min(1).optional(),
    packageName: z.string().min(1).optional(),
  })
  .refine((v) => (v.platform === 'IOS' ? !!v.bundleId : true), { message: 'iOS apps require bundleId' })
  .refine((v) => (v.platform === 'ANDROID' ? !!v.packageName : true), { message: 'Android apps require packageName' });

export const createProductSchema = z.object({
  appId: z.string().uuid(),
  storeProductId: z.string().min(1).max(256),
  type: z.enum(['AUTO_RENEWABLE_SUBSCRIPTION', 'NON_RENEWING_SUBSCRIPTION', 'CONSUMABLE', 'NON_CONSUMABLE']),
  displayName: z.string().min(1).max(256),
  priceCents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  durationIso8601: z.string().min(2).max(16).optional(),
  subscriptionGroupId: z.string().min(1).optional(),
});

export const createEntitlementSchema = z.object({
  identifier,
  displayName: z.string().min(1).max(256),
});

export const attachEntitlementSchema = z.object({ entitlementId: z.string().uuid() });

export const createOfferingSchema = z.object({
  identifier,
  displayName: z.string().min(1).max(256),
  isCurrent: z.boolean().optional(),
  metadata: z.unknown().optional(),
});

export const createPackageSchema = z.object({
  identifier,
  packageType: z.enum(['UNKNOWN', 'CUSTOM', 'LIFETIME', 'ANNUAL', 'SIX_MONTH', 'THREE_MONTH', 'TWO_MONTH', 'MONTHLY', 'WEEKLY']),
  productId: z.string().uuid(),
  sortOrder: z.number().int().optional(),
});
```

- [ ] **Step 7: Build + commit**

```bash
cd backend && npm run build && npx jest src/catalog/support
git add backend/src/catalog
git commit -m "feat(catalog): app-user-id validator, key generator, zod schemas, types"
```

---

### Task 3: Apps + Entitlements services & controllers

The two simplest catalog resources (no cross-entity mapping yet). Establishes the CRUD + admin-guard pattern the rest reuse.

**Files:**
- Create: `backend/src/catalog/services/apps.service.ts` + `.spec.ts`
- Create: `backend/src/catalog/services/entitlements.service.ts` + `.spec.ts`
- Create: `backend/src/catalog/controllers/apps.controller.ts`
- Create: `backend/src/catalog/controllers/entitlements.controller.ts`

**Interfaces:**
- Consumes: `PrismaService`, `generatePublicSdkKey`, `createAppSchema`, `createEntitlementSchema`, `ProblemException`.
- Produces: `AppsService.{create,list,remove}`, `EntitlementsService.{create,list,remove}`. Routes `POST/GET/DELETE /api/v1/projects/:projectId/catalog/apps[/:appId]` and `.../catalog/entitlements[/:entId]`.

- [ ] **Step 1: Write `apps.service.spec.ts` (Testcontainers)**

```ts
import { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresContainer } from '../../../test/integration/helpers/containers';
import { AppsService } from './apps.service';

jest.setTimeout(180000);

describe('AppsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: AppsService;
  let projectId: string;

  beforeAll(async () => {
    const started = await startPostgresContainer();
    container = started.container;
    prisma = new PrismaClient({ datasources: { db: { url: started.url } } });
    service = new AppsService(prisma as never);
    const org = await prisma.organization.create({ data: { name: 'O' } });
    const project = await prisma.project.create({ data: { orgId: org.id, name: 'P' } });
    projectId = project.id;
  });
  afterAll(async () => { await prisma.$disconnect(); await container.stop(); });

  it('creates an app with a generated public key and lists it', async () => {
    const app = await service.create(projectId, { name: 'iOS', platform: 'IOS', bundleId: 'com.a.b' });
    expect(app.publicSdkKey).toMatch(/^mrc_pub_/);
    const list = await service.list(projectId);
    expect(list.map((a) => a.id)).toContain(app.id);
  });

  it('rejects a duplicate bundleId for the same platform', async () => {
    await service.create(projectId, { name: 'dup', platform: 'IOS', bundleId: 'com.dup.app' });
    await expect(service.create(projectId, { name: 'dup2', platform: 'IOS', bundleId: 'com.dup.app' })).rejects.toThrow();
  });
});
```

Run → FAIL (no `AppsService`).

- [ ] **Step 2: Implement `apps.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details.filter';
import { generatePublicSdkKey } from '../support/key-generator';
import type { z } from 'zod';
import type { createAppSchema } from '../support/catalog.schemas';

type CreateApp = z.infer<typeof createAppSchema>;

@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateApp) {
    try {
      return await this.prisma.app.create({
        data: {
          projectId,
          name: input.name,
          platform: input.platform,
          bundleId: input.bundleId ?? null,
          packageName: input.packageName ?? null,
          publicSdkKey: generatePublicSdkKey(),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'App already exists' });
      throw e;
    }
  }

  list(projectId: string) {
    return this.prisma.app.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, appId: string) {
    const app = await this.prisma.app.findFirst({ where: { id: appId, projectId } });
    if (!app) throw new ProblemException({ status: 404, title: 'App not found' });
    await this.prisma.app.delete({ where: { id: appId } });
  }
}

/** Prisma P2002 = unique constraint violation. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
```

Run the spec → PASS.

- [ ] **Step 3: `entitlements.service.ts` (test → impl)**

Mirror `apps.service.spec.ts` for entitlements (create with `{ identifier, displayName }`; assert `@@unique([projectId, identifier])` rejects a duplicate identifier). Then implement `EntitlementsService` with `create/list/remove` in the same shape as `AppsService` (create catches P2002 → 409; remove 404-guards on `findFirst({ id, projectId })`). Full code follows the AppsService pattern exactly, over `prisma.entitlement`.

- [ ] **Step 4: Controllers**

Create `backend/src/catalog/controllers/apps.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../../auth/schemas/auth.schemas';
import { JwtAuthGuard } from '../../auth/tokens/jwt-auth.guard';
import { ProjectRoles } from '../../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../../authz/project-roles.guard';
import { createAppSchema } from '../support/catalog.schemas';
import { AppsService } from '../services/apps.service';

@Controller('api/v1/projects/:projectId/catalog/apps')
@UseGuards(JwtAuthGuard)
export class AppsController {
  constructor(private readonly service: AppsService) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  create(@Param('projectId') projectId: string, @Body() body: unknown) {
    return this.service.create(projectId, parseOrThrow(createAppSchema, body));
  }

  @Delete(':appId')
  @HttpCode(204)
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  remove(@Param('projectId') projectId: string, @Param('appId') appId: string) {
    return this.service.remove(projectId, appId);
  }
}
```

Create `entitlements.controller.ts` in the same shape (`/catalog/entitlements`, `createEntitlementSchema`, `EntitlementsService`).

- [ ] **Step 5: Build + commit** (controllers are wired into the module in Task 6; they compile now as standalone classes)

```bash
cd backend && npm run build && npx jest src/catalog/services
git add backend/src/catalog
git commit -m "feat(catalog): apps + entitlements services and controllers"
```

---

### Task 4: Products service & controller + entitlement mapping

Adds products (owned by an app) and the many-to-many product↔entitlement mapping.

**Files:**
- Create: `backend/src/catalog/services/products.service.ts` + `.spec.ts`
- Create: `backend/src/catalog/controllers/products.controller.ts`

**Interfaces:**
- Consumes: `PrismaService`, `createProductSchema`, `attachEntitlementSchema`, `ProblemException`.
- Produces: `ProductsService.{create,list,remove,attachEntitlement,detachEntitlement}`. Routes under `.../catalog/products`, plus `POST/DELETE .../catalog/products/:productId/entitlements[/:entitlementId]`.

- [ ] **Step 1: Write `products.service.spec.ts`**

Set up org/project/app/entitlement (as in Task 3's spec). Assert: `create` requires the `appId` to belong to the same project (creating with a foreign app's id → throws 400/404); a product can attach two entitlements and both come back via `findUnique({ include: { entitlements: true } })`; attaching the same entitlement twice is idempotent or 409 (pick 409 and assert it); `@@unique([appId, storeProductId])` rejects a duplicate store product id under one app.

- [ ] **Step 2: Run → FAIL, then implement `products.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details.filter';
import type { z } from 'zod';
import type { createProductSchema } from '../support/catalog.schemas';

type CreateProduct = z.infer<typeof createProductSchema>;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateProduct) {
    const app = await this.prisma.app.findFirst({ where: { id: input.appId, projectId } });
    if (!app) throw new ProblemException({ status: 400, title: 'App does not belong to this project' });
    try {
      return await this.prisma.product.create({
        data: {
          projectId,
          appId: input.appId,
          storeProductId: input.storeProductId,
          type: input.type,
          displayName: input.displayName,
          priceCents: input.priceCents ?? null,
          currency: input.currency ?? null,
          durationIso8601: input.durationIso8601 ?? null,
          subscriptionGroupId: input.subscriptionGroupId ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Product already exists for this app' });
      throw e;
    }
  }

  list(projectId: string) {
    return this.prisma.product.findMany({ where: { projectId }, include: { entitlements: true }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, productId: string) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!p) throw new ProblemException({ status: 404, title: 'Product not found' });
    await this.prisma.product.delete({ where: { id: productId } });
  }

  async attachEntitlement(projectId: string, productId: string, entitlementId: string) {
    const [product, ent] = await Promise.all([
      this.prisma.product.findFirst({ where: { id: productId, projectId } }),
      this.prisma.entitlement.findFirst({ where: { id: entitlementId, projectId } }),
    ]);
    if (!product) throw new ProblemException({ status: 404, title: 'Product not found' });
    if (!ent) throw new ProblemException({ status: 404, title: 'Entitlement not found' });
    try {
      await this.prisma.productEntitlement.create({ data: { productId, entitlementId } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Entitlement already attached' });
      throw e;
    }
  }

  async detachEntitlement(projectId: string, productId: string, entitlementId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, projectId } });
    if (!product) throw new ProblemException({ status: 404, title: 'Product not found' });
    await this.prisma.productEntitlement.deleteMany({ where: { productId, entitlementId } });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
```

Run → PASS.

- [ ] **Step 3: `products.controller.ts`**

Same guard pattern as `AppsController`. Routes: `GET /` (viewer), `POST /` (admin, `createProductSchema`), `DELETE /:productId` (admin), `POST /:productId/entitlements` (admin, `attachEntitlementSchema` → `attachEntitlement`), `DELETE /:productId/entitlements/:entitlementId` (admin → `detachEntitlement`, `@HttpCode(204)`).

- [ ] **Step 4: Build + commit**

```bash
cd backend && npm run build && npx jest src/catalog/services/products.service.spec.ts
git add backend/src/catalog
git commit -m "feat(catalog): products service/controller + product-entitlement mapping"
```

---

### Task 5: Offerings + Packages + offering resolver

The merchandising layer, the single-current-offering invariant, and the resolver P3 will wrap.

**Files:**
- Create: `backend/src/catalog/services/offerings.service.ts` + `.spec.ts`
- Create: `backend/src/catalog/services/offering-resolver.service.ts` + `.spec.ts`
- Create: `backend/src/catalog/controllers/offerings.controller.ts`

**Interfaces:**
- Consumes: `PrismaService`, `createOfferingSchema`, `createPackageSchema`, `ProblemException`, `ResolvedOffering`.
- Produces: `OfferingsService.{create,list,remove,setCurrent,addPackage,removePackage}`; `OfferingResolverService.resolveCurrentOffering(projectId): Promise<ResolvedOffering | null>`.

- [ ] **Step 1: `offerings.service.spec.ts`** — assert: creating with `isCurrent:true` then creating a second with `isCurrent:true` leaves exactly one current (the DB partial index + service `setCurrent` unset the prior in one transaction); `addPackage` rejects a `productId` from another project (400); duplicate package `identifier` within an offering → 409.

- [ ] **Step 2: Run → FAIL, then implement `offerings.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details.filter';
import type { z } from 'zod';
import type { createOfferingSchema, createPackageSchema } from '../support/catalog.schemas';

type CreateOffering = z.infer<typeof createOfferingSchema>;
type CreatePackage = z.infer<typeof createPackageSchema>;

@Injectable()
export class OfferingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(projectId: string, input: CreateOffering) {
    return this.prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.offering.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } });
      }
      try {
        return await tx.offering.create({
          data: {
            projectId,
            identifier: input.identifier,
            displayName: input.displayName,
            isCurrent: input.isCurrent ?? false,
            metadata: (input.metadata ?? undefined) as never,
          },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Offering identifier already exists' });
        throw e;
      }
    });
  }

  async setCurrent(projectId: string, offeringId: string) {
    const offering = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.$transaction([
      this.prisma.offering.updateMany({ where: { projectId, isCurrent: true }, data: { isCurrent: false } }),
      this.prisma.offering.update({ where: { id: offeringId }, data: { isCurrent: true } }),
    ]);
  }

  list(projectId: string) {
    return this.prisma.offering.findMany({ where: { projectId }, include: { packages: true }, orderBy: { createdAt: 'asc' } });
  }

  async remove(projectId: string, offeringId: string) {
    const o = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!o) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.offering.delete({ where: { id: offeringId } });
  }

  async addPackage(projectId: string, offeringId: string, input: CreatePackage) {
    const [offering, product] = await Promise.all([
      this.prisma.offering.findFirst({ where: { id: offeringId, projectId } }),
      this.prisma.product.findFirst({ where: { id: input.productId, projectId } }),
    ]);
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    if (!product) throw new ProblemException({ status: 400, title: 'Product does not belong to this project' });
    try {
      return await this.prisma.package.create({
        data: {
          offeringId,
          identifier: input.identifier,
          packageType: input.packageType,
          productId: input.productId,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ProblemException({ status: 409, title: 'Package identifier already exists in this offering' });
      throw e;
    }
  }

  async removePackage(projectId: string, offeringId: string, packageId: string) {
    const offering = await this.prisma.offering.findFirst({ where: { id: offeringId, projectId } });
    if (!offering) throw new ProblemException({ status: 404, title: 'Offering not found' });
    await this.prisma.package.deleteMany({ where: { id: packageId, offeringId } });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
```

- [ ] **Step 3: `offering-resolver.service.spec.ts`** — build app→product(+2 entitlements)→offering(current)→2 packages; assert `resolveCurrentOffering` returns the packages in `sortOrder`, each product's `entitlements` flattened to identifier strings, and `null` when no offering is current.

- [ ] **Step 4: Implement `offering-resolver.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ResolvedOffering } from '../catalog.types';

@Injectable()
export class OfferingResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCurrentOffering(projectId: string): Promise<ResolvedOffering | null> {
    const offering = await this.prisma.offering.findFirst({
      where: { projectId, isCurrent: true },
      include: {
        packages: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { include: { entitlements: { include: { entitlement: true } } } } },
        },
      },
    });
    if (!offering) return null;
    return {
      identifier: offering.identifier,
      metadata: offering.metadata,
      packages: offering.packages.map((pkg) => ({
        identifier: pkg.identifier,
        packageType: pkg.packageType,
        product: {
          storeProductId: pkg.product.storeProductId,
          type: pkg.product.type,
          priceCents: pkg.product.priceCents,
          currency: pkg.product.currency,
          durationIso8601: pkg.product.durationIso8601,
          entitlements: pkg.product.entitlements.map((pe) => pe.entitlement.identifier),
        },
      })),
    };
  }
}
```

Run both specs → PASS.

- [ ] **Step 5: `offerings.controller.ts`** — routes: `GET /` (viewer), `POST /` (admin, `createOfferingSchema`), `POST /:offeringId/current` (admin → `setCurrent`, 204), `DELETE /:offeringId` (admin), `POST /:offeringId/packages` (admin, `createPackageSchema` → `addPackage`), `DELETE /:offeringId/packages/:packageId` (admin → `removePackage`, 204).

- [ ] **Step 6: Build + commit**

```bash
cd backend && npm run build && npx jest src/catalog/services/offerings.service.spec.ts src/catalog/services/offering-resolver.service.spec.ts
git add backend/src/catalog
git commit -m "feat(catalog): offerings + packages + current-offering resolver"
```

---

### Task 6: Module wiring + registration + end-to-end integration test

Wires everything into Nest and proves the whole catalog composes.

**Files:**
- Create: `backend/src/catalog/catalog.module.ts`
- Modify: `backend/src/app.module.ts` (register `CatalogModule`)
- Create: `backend/test/integration/catalog.int-spec.ts` (end-to-end over the real app)

**Interfaces:**
- Consumes: all services + controllers from Tasks 3–5.
- Produces: `CatalogModule` (exports `OfferingResolverService` so P1/P3 can consume it).

- [ ] **Step 1: `catalog.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { AuthzModule } from '../authz/authz.module';
import { AppsController } from './controllers/apps.controller';
import { EntitlementsController } from './controllers/entitlements.controller';
import { ProductsController } from './controllers/products.controller';
import { OfferingsController } from './controllers/offerings.controller';
import { AppsService } from './services/apps.service';
import { EntitlementsService } from './services/entitlements.service';
import { ProductsService } from './services/products.service';
import { OfferingsService } from './services/offerings.service';
import { OfferingResolverService } from './services/offering-resolver.service';

@Module({
  imports: [AuthzModule], // provides ProjectRolesGuard (Prisma/Config are @Global)
  controllers: [AppsController, EntitlementsController, ProductsController, OfferingsController],
  providers: [AppsService, EntitlementsService, ProductsService, OfferingsService, OfferingResolverService],
  exports: [OfferingResolverService],
})
export class CatalogModule {}
```

(Confirm `AuthzModule`'s import path + that it exports `ProjectRolesGuard`, per the earlier map — adjust if the guard is provided differently.)

- [ ] **Step 2: Register in `app.module.ts`**

Add `CatalogModule` to the `imports` array of `AppModule` (alongside `RevenueCatModule`). Import it at the top.

- [ ] **Step 3: End-to-end integration test**

Create `backend/test/integration/catalog.int-spec.ts` using the same `createApp()` bootstrap the other `*.int-spec.ts` files use (grep `test/integration` for the pattern — it builds the real Nest app + a Testcontainers Postgres and authenticates a user). Drive the real HTTP surface with supertest: create an app, a product, an entitlement, attach the entitlement, create a current offering, add a package → then `GET` a viewer-visible resource and assert the shape; assert a non-admin (viewer) gets 403 on `POST /catalog/apps`; assert the whole chain persists. This proves guard wiring + module composition, which the service unit tests can't.

- [ ] **Step 4: Full verify**

Run: `cd backend && npm run build && npm test`
Expected: PASS — the new catalog suites plus the untouched existing 1044 backend tests (the mirror suites must be unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/catalog/catalog.module.ts backend/src/app.module.ts backend/test/integration/catalog.int-spec.ts
git commit -m "feat(catalog): wire CatalogModule into the app + end-to-end integration test"
```

---

## Notes for the executor

- **Confirm two import paths before Task 2** by grepping: `ProblemException` (used everywhere here) and `AuthzModule`/`ProjectRolesGuard`. The plan's paths are best-effort from the codebase map; the guard idiom (class `JwtAuthGuard` + method `ProjectRolesGuard`+`@ProjectRoles`) and `parseOrThrow` are verified against `src/revenuecat/admin/rc-admin.controller.ts`.
- **Never touch the mirror.** If a change seems to require editing `src/revenuecat/**` or the RC-mirror models, stop — it doesn't; the catalog is additive.
- The DB-touching service specs are **co-located `.spec.ts`** using `startPostgresContainer()` with `jest.setTimeout(180000)` — the same pattern as `src/projects/members/project-membership-backfill.spec.ts`, run by `npm test`. The single end-to-end test is a `test/integration/*.int-spec.ts` (run by `npm test` too via the default matcher, or `npm run test:int`).
