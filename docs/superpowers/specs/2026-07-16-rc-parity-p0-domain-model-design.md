# RevenueCat parity — P0: Domain model (catalog) — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Parent:** `2026-07-16-revenuecat-parity-program-roadmap.md` → sub-project **P0**.
**Scope decision honored:** S3 — the new catalog is **additive**; the existing RevenueCat *mirror* (`RevenueCatIntegration`, `SubscriptionState`, `RevenueCatWebhookEvent`) is left untouched and keeps working.

## Scope

P0 is the **static configuration substrate** of the RevenueCat clone: the catalog of what apps, products, entitlements, offerings, and packages exist for a project. It is the model that P1 (entitlement engine) and P3 (SDK) read from.

**In scope:** Prisma models + one additive migration; a NestJS `catalog` module with admin-gated CRUD; Zod validation at boundaries; a pure App-User-ID validator; and a `resolveCurrentOffering(projectId)` service. All **unit-testable with no external services and no deployment**.

**Explicitly out of scope (each is a later sub-project):**
- Any Apple/Google store call, product import from App Store Connect / Play Console → **P1**.
- Receipt validation, entitlement *computation*, CustomerInfo → **P1**.
- Populating/using the store-credential columns (the connect-store flow) → **P1**.
- The catalog management **UI** → **P4**.
- The public SDK-facing `getOfferings` endpoint → **P3** (P0 provides the internal `resolveCurrentOffering` service it will wrap).

## Why now / why this shape

The mirror consumes RevenueCat's already-computed truth; it has **no catalog** — no notion of a Product, an Entitlement, an Offering. Every later sub-project needs one. P0 builds it with zero external dependencies, so it can be fully built and unit-tested before the deploy pipeline or any store credentials exist.

## Data model (Prisma — additive to `backend/prisma/schema.prisma`)

Conventions match the existing schema: `@id @default(uuid(7)) @db.Uuid`, snake_case `@map`, `@@map`, `onDelete: Cascade` from `Project`. All new models are project-scoped and coexist with the mirror tables.

### Enums

```prisma
enum AppPlatform {
  IOS
  ANDROID
  // Reserved for later platform phases (S1) — modeled now so the enum is stable, unused today.
  MACOS
  AMAZON
  WEB
}

enum ProductType {
  AUTO_RENEWABLE_SUBSCRIPTION
  NON_RENEWING_SUBSCRIPTION
  CONSUMABLE
  NON_CONSUMABLE
}

// RevenueCat's PackageType, verbatim so the SDK contract matches.
enum PackageType {
  UNKNOWN
  CUSTOM
  LIFETIME
  ANNUAL
  SIX_MONTH
  THREE_MONTH
  TWO_MONTH
  MONTHLY
  WEEKLY
}
```

### Models

```prisma
model App {
  id           String      @id @default(uuid(7)) @db.Uuid
  projectId    String      @map("project_id") @db.Uuid
  name         String
  platform     AppPlatform
  // Store identity: one is set depending on platform (validated at the boundary, not the DB).
  bundleId     String?     @map("bundle_id")      // iOS
  packageName  String?     @map("package_name")   // Android
  // Public SDK key — safe to ship in a client; generated on create. Looked up by the SDK's
  // purchase-intake calls in P1/P3. Format: `mrc_pub_<random>`.
  publicSdkKey String      @unique @map("public_sdk_key")
  // Store credentials, encrypted at rest. Columns modeled now; POPULATED in P1's connect-store
  // flow (nullable until then). Encryption uses a dedicated key (see "Store credentials" below).
  storeCredentials String? @map("store_credentials") // encrypted JSON blob, null until connected
  createdAt    DateTime    @default(now()) @map("created_at")
  project      Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  products     Product[]

  @@unique([projectId, platform, bundleId])
  @@unique([projectId, platform, packageName])
  @@index([projectId])
  @@map("rc_apps")
}

model Product {
  id                  String      @id @default(uuid(7)) @db.Uuid
  projectId           String      @map("project_id") @db.Uuid
  appId               String      @map("app_id") @db.Uuid
  storeProductId      String      @map("store_product_id") // App Store / Play product identifier
  type                ProductType
  displayName         String      @map("display_name")
  // Imported price/duration SNAPSHOT (real pricing is store-authoritative; this is a cached config
  // value, refreshed by P1's import). Nullable until imported.
  priceCents          Int?        @map("price_cents")
  currency            String?
  durationIso8601     String?     @map("duration_iso8601") // e.g. P1M, P1Y; null for non-subs
  subscriptionGroupId String?     @map("subscription_group_id") // iOS upgrade/downgrade scope
  createdAt           DateTime    @default(now()) @map("created_at")
  project             Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  app                 App         @relation(fields: [appId], references: [id], onDelete: Cascade)
  entitlements        ProductEntitlement[]
  packages            Package[]

  @@unique([appId, storeProductId])
  @@index([projectId])
  @@map("rc_products")
}

model Entitlement {
  id          String   @id @default(uuid(7)) @db.Uuid
  projectId   String   @map("project_id") @db.Uuid
  identifier  String   // e.g. "pro" — unique per project, stable, used by the SDK
  displayName String   @map("display_name")
  createdAt   DateTime @default(now()) @map("created_at")
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  products    ProductEntitlement[]

  @@unique([projectId, identifier])
  @@index([projectId])
  @@map("rc_entitlements")
}

model ProductEntitlement {
  productId     String      @map("product_id") @db.Uuid
  entitlementId String      @map("entitlement_id") @db.Uuid
  product       Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  entitlement   Entitlement @relation(fields: [entitlementId], references: [id], onDelete: Cascade)

  @@id([productId, entitlementId])
  @@index([entitlementId])
  @@map("rc_product_entitlements")
}

model Offering {
  id          String    @id @default(uuid(7)) @db.Uuid
  projectId   String    @map("project_id") @db.Uuid
  identifier  String    // e.g. "default"
  displayName String    @map("display_name")
  isCurrent   Boolean   @default(false) @map("is_current")
  metadata    Json?     // arbitrary client-readable JSON (RC Offering.metadata)
  createdAt   DateTime  @default(now()) @map("created_at")
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  packages    Package[]

  @@unique([projectId, identifier])
  // At most one current offering per project — enforced in the service (a partial unique index on
  // (projectId) WHERE is_current is added via raw SQL in the migration; Prisma can't express it).
  @@index([projectId])
  @@map("rc_offerings")
}

model Package {
  id          String      @id @default(uuid(7)) @db.Uuid
  offeringId  String      @map("offering_id") @db.Uuid
  identifier  String      // e.g. "$rc_monthly"
  packageType PackageType @map("package_type")
  productId   String      @map("product_id") @db.Uuid
  sortOrder   Int         @default(0) @map("sort_order")
  offering    Offering    @relation(fields: [offeringId], references: [id], onDelete: Cascade)
  product     Product     @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@unique([offeringId, identifier])
  @@index([productId])
  @@map("rc_packages")
}
```

Also add the back-relations to the existing `Project` model (`apps App[]`, `entitlements Entitlement[]`, `offerings Offering[]`, `catalogProducts Product[]`), mirroring how the RC-mirror relations are already listed there.

### Store credentials

`App.storeCredentials` is a single encrypted JSON blob (Apple: issuerId/keyId/p8; Google: service-account JSON). **Encryption at rest is required** (unlike the mirror's plaintext `apiKey`, a known debt). Reuse the codebase's existing symmetric-encryption utility if one exists (`src/auth/crypto/` houses TOTP secret encryption via `TOTP_ENC_KEY`); otherwise add a `STORE_CREDENTIALS_ENC_KEY` (32-byte, same shape as `TOTP_ENC_KEY`) and a small `encrypt/decrypt` helper. **P0 ships the column + the helper; P1's connect-store flow does the writing.** No plaintext credentials ever touch the DB.

## Module structure (`backend/src/catalog/`)

Follows the restructured backend convention (capability folders, controllers/services split, no barrels):

```
catalog/
  catalog.module.ts
  catalog.types.ts                 -- DTO/shape types (incl. ResolvedOffering)
  controllers/                     -- admin CRUD, JwtAuthGuard + @ProjectRoles('admin')
    apps.controller.ts
    products.controller.ts
    entitlements.controller.ts
    offerings.controller.ts
  services/
    apps.service.ts
    products.service.ts
    entitlements.service.ts        -- incl. product↔entitlement mapping
    offerings.service.ts           -- incl. packages; enforces single current offering
    offering-resolver.service.ts   -- resolveCurrentOffering(projectId): ResolvedOffering | null
  support/
    app-user-id.validator.ts       -- pure; RC reserved-ID blocklist
    catalog.schemas.ts             -- Zod request schemas + enum guards
    key-generator.ts               -- public SDK key generation
```

Controllers mount under `api/v1/projects/:projectId/catalog/...`, class-level `JwtAuthGuard`, method-level `ProjectRolesGuard` with `@ProjectRoles('admin')` for writes / `assertMembership` viewer+ for reads — the exact pattern the RC-admin and other controllers already use.

### `resolveCurrentOffering(projectId)`

Returns the project's `isCurrent` offering with packages sorted by `sortOrder`, each package resolved to its product and that product's entitlement identifiers — the exact nested shape P3's `getOfferings` will serialize:

```ts
interface ResolvedOffering {
  identifier: string;
  metadata: unknown;
  packages: Array<{
    identifier: string;
    packageType: PackageType;
    product: { storeProductId: string; type: ProductType; priceCents: number | null;
               currency: string | null; durationIso8601: string | null;
               entitlements: string[] };  // entitlement identifiers this product unlocks
  }>;
}
```

Returns `null` when no current offering is set. Pure DB read; no external calls.

### App-User-ID validator (`app-user-id.validator.ts`)

Pure function `assertValidAppUserId(id: string): void` (throws a `ProblemException` on invalid), replicating RevenueCat's rules so the identity graph can't be corrupted:
- Reject the reserved blocklist (case-insensitive): `no_user`, `null`, `none`, `nil`, `(null)`, `nan`, `unidentified`, `unknown`, `undefined`, empty/whitespace-only.
- Reject values equal to a project App's `bundleId`/`packageName`.
- Reject obvious PII shape (contains `@` → looks like an email) and control chars.
- Enforce a max length (1500, RC's documented ceiling) and non-empty.
Unit-tested against each rule. Used by P1/P3 at the customer boundary; lives here because it is foundational and pure.

## Validation rules (Zod, at the controller boundary)

- Identifiers (`entitlement.identifier`, `offering.identifier`, `package.identifier`) match `^[a-zA-Z0-9_.$-]+$` and are unique within their scope (enforced by DB `@@unique` + a friendly pre-check).
- `platform`/`type`/`packageType` are enum-guarded.
- An App must set exactly the store id for its platform (iOS→`bundleId`, Android→`packageName`).
- A Package's `productId` must belong to the same project as its Offering (cross-project reference rejected).
- Setting an offering `isCurrent: true` unsets any previous current offering in the same transaction.

## Error handling

All failures exit as RFC 7807 `application/problem+json` via the existing global `ProblemDetailsFilter` (unique-constraint violations → 409, not-found → 404, validation → 400). No new error infrastructure.

## Testing (all unit / service-level, no external services)

- **CRUD**: each service's create/read/update/delete + the uniqueness and cross-project guards.
- **Mapping**: product↔entitlement attach/detach; a product unlocking multiple entitlements and an entitlement unlocked by multiple products.
- **Single-current-offering** invariant: setting a new current unsets the old, transactionally.
- **`resolveCurrentOffering`**: nested resolution shape, sort order, `null` when unset, entitlement-identifier flattening.
- **App-User-ID validator**: one case per rule (blocklist member, bundle-id collision, email-shaped, over-length, empty, valid).
- Prisma-touching tests use the same Testcontainers-Postgres setup the backend already uses for integration tests; pure functions (validator, key-generator, resolver-shape) are plain unit tests.

## Coexistence with the mirror (S3)

Purely additive: new `rc_*` tables, new module, new optional `STORE_CREDENTIALS_ENC_KEY`. `RevenueCatIntegration`/`SubscriptionState`/`RevenueCatWebhookEvent` and the whole mirror pipeline are untouched. A project may run the mirror and the (still-empty) clone catalog simultaneously; nothing reads the catalog yet until P1/P3.

## Deferred (recorded)

- Store product import + Apple/Google calls, and populating `storeCredentials` → **P1**.
- Entitlement *computation* / CustomerInfo / receipt validation → **P1**.
- Catalog UI → **P4**; public `getOfferings` endpoint → **P3**.
- Subscription Groups as a first-class imported object (P0 only stores `subscriptionGroupId` on Product) → later.
- The partial unique index for single-current-offering is enforced in-service + a raw-SQL migration; revisit if Prisma gains native partial-unique support.
