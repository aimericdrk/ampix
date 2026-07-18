# MyRevenueCat Catalog Config UIs — Design

**Goal:** Replace the `RcPlaceholderPage` stubs for **Products, Entitlements, and Offerings** with real dashboard configuration pages that drive the existing `mobile_purchase` catalog admin API (via the `purchaseApiFetch` seam from the Charts slice), and add the minimal additive server **PATCH** endpoints needed for RevenueCat-style in-place editing.

**Design principle:** Anchor behavior in RevenueCat's real catalog model — Entitlements are the access levels; Products are store SKUs (optionally granting entitlements); Offerings group Packages, and each Package wraps a Product for paywall display; exactly one Offering is "current".

---

## §0. Constraints & principles

- **RC catalog model (real):** App → Products (per app) → attach Entitlements; Offerings → Packages → reference a Product; one current Offering per project.
- **Server today is create+delete only** (a deliberate "no-update, cross-tenant-airtight" decision). This sub-project ADDS scoped `PATCH` endpoints for the safe editable fields only; identity fields stay immutable. New endpoints follow the exact existing pattern (`@UseGuards(ProjectAccessGuard)`, `@RequireProjectRole('admin')`, `parseOrThrow`, `projectId`-scoped ownership).
- **Per-service isolation:** `backend/mobile_analytics` `tsc` must stay 0 after any `mobile_purchase` schema/regen. (No schema change is expected in this sub-project — PATCH reuses existing columns.)
- **Reach seam reused:** the dashboard calls `mobile_purchase` through `purchaseApiFetch<T>(path, options?)` (`dashboard/src/lib/api/purchase-client.ts`) — bearer JWT + RFC-7807 → `ApiError`, `purchaseApiBaseUrl` prefix, CORS already enabled. No new transport is built.
- **Role gating:** list endpoints are `viewer`; all mutations are `admin`. The dashboard gates every write control on `useProjectRole(projectId)` resolving to `admin` or `owner`; viewers get a fully read-only surface (no create/edit/delete controls rendered).
- **HARD WIP rule:** never create, modify, stage, or format any uncommitted collapse-rail WIP file — `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, the layout `*.test.tsx`, `dashboard/src/features/command-palette/CommandPalette.tsx`, `dashboard/src/test/render-app.tsx`. **`nav-model.ts` is NOT edited at all** — every RC route already exists; only `router.tsx` `component:` lines are swapped. Every dashboard task ends with a `git status` WIP check.
- **No co-author trailers on any commit.**

## §1. Server — additive PATCH endpoints (`mobile_purchase`)

Four scoped update endpoints, each `@RequireProjectRole('admin')`, `projectId`-scoped, partial Zod body (all fields optional; identity fields absent from the schema so they cannot be changed). On unknown/foreign id → 404 (same ownership pattern as the existing `remove`).

| Endpoint | Editable fields | Immutable (rejected/ignored) |
|---|---|---|
| `PATCH /api/v1/projects/:projectId/catalog/products/:productId` | `displayName?`, `priceCents?`, `currency?`, `durationIso8601?`, `subscriptionGroupId?` | `appId`, `storeProductId`, `type` |
| `PATCH /api/v1/projects/:projectId/catalog/entitlements/:entitlementId` | `displayName?` | `identifier` |
| `PATCH /api/v1/projects/:projectId/catalog/offerings/:offeringId` | `displayName?`, `metadata?` | `identifier`, `isCurrent` (use existing `POST …/current`) |
| `PATCH /api/v1/projects/:projectId/catalog/offerings/:offeringId/packages/:packageId` | `packageType?`, `sortOrder?` | `identifier`, `productId` |

- **Schemas:** add `updateProductSchema`, `updateEntitlementSchema`, `updateOfferingSchema`, `updatePackageSchema` to `catalog/support/catalog.schemas.ts` — partial versions of the create schemas restricted to the editable fields, each `.refine(obj => Object.keys(obj).length > 0, 'at least one field required')` so an empty body is a 400.
- **Services:** add `update(projectId, id, patch)` methods that first assert ownership (`findFirst({ where: { id, projectId } })` → 404 if absent), then `prisma.<model>.update`. Package update also scopes by `offeringId` (and the offering by `projectId`). Reuse the existing `isUniqueViolation`/`isForeignKeyViolation` helpers where relevant.
- **Controllers:** add the `@Patch(':id')` handlers to the existing `products`/`entitlements`/`offerings` controllers, returning the updated row (same shape as `create`).
- **Tests:** Testcontainers service tests (each update: happy path, ownership 404, empty-body reject, immutable-field-absent) + e2e route tests (200 as admin, 403 as viewer, 404 unknown id) mirroring `catalog`/`metrics` e2e patterns.

## §2. Dashboard catalog API layer

`dashboard/src/features/revenuecat/catalog-api.ts` — TanStack Query hooks over `purchaseApiFetch`, keyed per resource, each mutation invalidating its resource's list query on success. Response types mirror the admin list/create shapes:

- **Apps:** `RcApp { id, name, platform, bundleId?, packageName?, publicSdkKey }` (storeCredentials never returned). `useRcApps(projectId)`, `useCreateRcApp`, `useDeleteRcApp`.
- **Entitlements:** `RcEntitlement { id, identifier, displayName }`. `useRcEntitlements`, `useCreateRcEntitlement`, `useUpdateRcEntitlement`, `useDeleteRcEntitlement`.
- **Products:** `RcProduct { id, appId, storeProductId, type, displayName, priceCents?, currency?, durationIso8601?, subscriptionGroupId?, entitlements: RcEntitlement[] }` (admin list `include: { entitlements: true }`). `useRcProducts`, `useCreateRcProduct`, `useUpdateRcProduct`, `useDeleteRcProduct`, `useAttachEntitlement`, `useDetachEntitlement`.
- **Offerings:** `RcOffering { id, identifier, displayName, isCurrent, metadata, packages: RcPackage[] }`; `RcPackage { id, identifier, packageType, productId, sortOrder }` (admin list `include: { packages: true }`). `useRcOfferings`, `useCreateRcOffering`, `useUpdateRcOffering`, `useDeleteRcOffering`, `useSetCurrentOffering`, `useAddPackage`, `useRemovePackage`, `useUpdatePackage`.
- **Query keys:** `['rc-catalog', projectId, <resource>]`. Base URL builder mirrors `purchaseMetricsBase`: `/api/v1/projects/${projectId}/catalog`.

## §3. Pages

All three pages: gate on `useRcEnabled(projectId)` + resolved `useProjects()` (render `RcConnectPage` when RC is not connected, exactly like `RcChartsPage`); wrap in `PageShell` with the RC breadcrumb; loading/empty/error states via the existing `DataTable`/`Skeleton`/`empty-state`/`alert` primitives; **all write controls gated on `useProjectRole` ∈ {admin, owner}** (viewers see the tables but no create/edit/delete/reorder controls). Mirror the existing project-settings members/tokens CRUD pattern (`DataTable` + `dialog` create/edit + `alert-dialog` delete confirm).

### §3.1 `RcEntitlementsPage` (`/rc/entitlements`)
- `DataTable`: `identifier`, `displayName`, (row count of products granting it — optional, from the products list if cheap). Row actions (admin): **Edit** (`dialog`: displayName; identifier shown read-only), **Delete** (`alert-dialog` confirm).
- Header action (admin): **New entitlement** (`dialog`: identifier + displayName).

### §3.2 `RcProductsPage` (`/rc/products`)
- **App context bar:** a `combobox`/`select` of the project's apps (from `useRcApps`); if none exist, an empty-state prompting **New app**. Admin actions: **New app** (`dialog`: name, platform `select`, bundleId/packageName conditional on platform), **Delete app** (`alert-dialog`; warns it removes the app's products).
- **Products `DataTable`** (for the selected app): `storeProductId`, `type` (badge), `displayName`, price (`priceCents`+`currency` formatted, or "—"), `durationIso8601`, **entitlements** (badges from `product.entitlements`). Row actions (admin): **Edit** (`dialog`: displayName + price/currency/duration/subscriptionGroupId; storeProductId/type read-only), **Manage entitlements** (`dialog`: checkbox list of all project entitlements, toggling calls attach/detach), **Delete** (`alert-dialog`).
- Header action (admin): **New product** (`dialog`: storeProductId, type `select`, displayName, optional price/currency/duration/group; `appId` = selected app).

### §3.3 `RcOfferingsPage` (`/rc/offerings`)
- **Offerings list** (`DataTable` or cards): `identifier`, `displayName`, **current** badge, package count. Row actions (admin): **Set current** (`POST …/current`; only one current — the UI reflects the flip after invalidation), **Edit** (`dialog`: displayName + metadata as JSON textarea; identifier read-only), **Delete** (`alert-dialog`).
- Header action (admin): **New offering** (`dialog`: identifier, displayName, optional metadata).
- **Per-offering packages** (expand/detail): `DataTable` of packages — `identifier`, `packageType` (badge), **product** (resolved from `useRcProducts` by `productId` → storeProductId/displayName), `sortOrder`. Row actions (admin): **Edit** (`dialog`: packageType `select` + sortOrder), **Remove** (`alert-dialog`). Header: **Add package** (`dialog`: identifier, packageType `select`, product `select` from the project's products, sortOrder). Packages render sorted by `sortOrder` then `identifier`.

## §4. Data flow & error handling

- Reads: `useQuery` → `purchaseApiFetch` GET. Writes: `useMutation` → `purchaseApiFetch` POST/PATCH/DELETE, `onSuccess` invalidates the resource list key (and cross-invalidates where a change is visible elsewhere — e.g. attaching an entitlement invalidates products; setCurrent invalidates offerings).
- Errors surface as `ApiError` (RFC-7807). Dialogs show the problem `detail`/`title` inline on failed submit and keep the dialog open; list-level fetch failure shows the `alert` slot. A `403` (viewer attempting a write) should not normally occur because controls are role-gated, but a surfaced 403 renders "You need admin access to change the catalog."
- Optimistic updates are NOT used in v1 (invalidate-and-refetch keeps it simple and correct); revisit if latency warrants.

## §5. Testing

- **Server:** Testcontainers service specs (each `update` method: happy path, ownership 404, empty-body 400) + e2e specs (each PATCH route: 200 admin, 403 viewer, 404 unknown) — same harness as `metrics`/`catalog` tests.
- **Dashboard:** MSW page tests per page (render list, create via dialog, edit via dialog, delete confirm, role-gated read-only for a viewer, RC-not-connected shows `RcConnectPage`) mirroring `rc-charts.test.tsx`; hook tests for `catalog-api.ts` mirroring `purchase-metrics-api.test.ts`.

## §6. Routing & WIP-safety

- `router.tsx`: three single-line `component:` swaps (`rcProductsRoute`, `rcEntitlementsRoute`, `rcOfferingsRoute`) from `RcPlaceholderPage` to the real pages, plus three imports. `RcPlaceholderPage` stays imported (Customers + Paywalls still use it). **No `nav-model.ts` change** — the routes and nav items already exist.
- Every dashboard task ends by asserting `git status` shows no collapse-rail WIP file touched.

## §7. Build order (decomposition for the plan)

1. **Server PATCH** — schemas + service `update` methods + `@Patch` handlers + Testcontainers + e2e (one increment per resource, or grouped; products/entitlements/offerings/package).
2. **`catalog-api.ts`** — all hooks + response types + hook tests.
3. **`RcEntitlementsPage`** — simplest, no cross-resource deps; router swap; page tests.
4. **`RcProductsPage`** — apps context + products + entitlement attach/detach; router swap; page tests.
5. **`RcOfferingsPage`** — offerings + packages (consumes products for the package→product picker); router swap; page tests.
6. **Verify gate** — both backends `tsc` 0; `mobile_purchase` catalog+e2e green; dashboard `tsc` 0 + `revenuecat` suite green; WIP-safety `git status`.

## §8. Out of scope (explicit)

- **Paywalls** (`/rc/paywalls`) — roadmap P6; needs the paywall-rendering SDK. Stays `RcPlaceholderPage`.
- **Customers** (`/rc/customers`) — sub-project B. Stays `RcPlaceholderPage`.
- **Store sync** (auto-importing products from App Store Connect / Play) — needs real store credentials (deploy-gated); products are entered manually in v1.
- **Optimistic UI, drag-and-drop package reordering** (sortOrder is edited numerically in v1), bulk operations, and any `nav-model`/navigation change.

## §9. Response shapes (reference)

- **Apps list** `GET …/catalog/apps` → `RcApp[]` (`id, name, platform, bundleId?, packageName?, publicSdkKey`).
- **Entitlements list** `GET …/catalog/entitlements` → `RcEntitlement[]` (`id, identifier, displayName`).
- **Products list** `GET …/catalog/products` → `RcProduct[]` (with `entitlements: RcEntitlement[]`).
- **Offerings list** `GET …/catalog/offerings` → `RcOffering[]` (with `packages: RcPackage[]`).
- Create/Update return the affected row in the same shape (single object). Delete/attach/detach/removePackage return `204`.
