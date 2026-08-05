# MyRevenueCat Customers — Design

**Goal:** Replace the `/rc/customers` `RcPlaceholderPage` stub with a real Customers surface — a searchable subscriber **list** + a per-customer **detail** (entitlements, subscriptions, transaction history, attributes) — plus admin actions: **grant/revoke a promotional entitlement** and **delete a customer**. Backed by new dashboard-facing read/write endpoints on `mobile_purchase`.

**Design principle:** This is the from-scratch RevenueCat clone reading our own `mobile_purchase` service — it does NOT gate on any external "connect RevenueCat" step. Anchor behavior in RevenueCat's real Customers page.

---

## §0. Constraints & principles

- **Refund is OUT of scope** — a real refund needs the Apple/Google store refund API + `StoreClient` + credentials, which land in the deploy/creds track (sub-project D). This sub-project ships the read view + promotional-entitlement grant/revoke + delete-customer; the Refund action is added in D.
- **No connect gate:** the page renders its content directly (empty states when a project has no customers yet). NEVER use `useRcEnabled`/`RcConnectPage`. Wait only for `useProjects()` to resolve (gate-then-mount), then render.
- **Roles:** reads (`viewer`); the three mutations grant/revoke/delete (`admin`). Every write control on the dashboard is gated on `useProjectRole(projectId) ∈ {admin, owner}`; viewers see a fully read-only surface.
- **Reach seam reused:** dashboard → `purchaseApiFetch<T>(path, options?)` (`dashboard/src/lib/api/purchase-client.ts`); base `/api/v1/projects/${projectId}/customers`.
- **Per-service isolation:** after the new migration + regen, `backend/mobile_analytics` `tsc` stays 0.
- **UI conventions:** reuse the ui-kit (`DataTable`, `dialog`, `alert-dialog`, `badge`, `button`, `input`, `label`) and native `<select>` for any picker (Radix `Select` hangs jsdom — the offerings-dialog lesson). Mirror the catalog pages' gate-then-mount + role-gating + CRUD-dialog patterns.
- **HARD WIP rule:** never create/modify/stage any collapse-rail WIP — `dashboard/src/components/layout/{AppLayout,OrgSwitcher,ProjectSwitcher,ToolRail,nav-model,RailInitial}.{tsx,ts}`, layout `*.test.tsx`, `features/command-palette/CommandPalette.tsx`, `test/render-app.tsx`. **`nav-model.ts` is NOT edited** — the `/rc/customers` nav item already exists; the detail is a nested route added only in `router.tsx`. No co-author trailers.

## §1. Server (`mobile_purchase`, additive)

### §1.1 Promotional-entitlement domain (new)

**Migration** — a `PromotionalEntitlement` model:
```
id            uuid pk
projectId     uuid            -- scope
customerId    uuid -> Customer (onDelete: Cascade)
entitlementId uuid -> Entitlement (catalog; onDelete: Cascade)
grantedAt     timestamp (default now)
startsAt      timestamp (default now)   -- when the grant becomes active
expiresAt     timestamp?                -- null = lifetime
revokedAt     timestamp?                -- null = active; set on revoke
note          text?                     -- optional admin note
@@index([projectId, customerId])
@@index([customerId])
```

**Duration set** (grant request): `daily | three_day | weekly | monthly | two_month | three_month | six_month | yearly | lifetime`. The server computes `expiresAt` from `grantedAt` + the duration using UTC date math (day-based for daily/three_day/weekly; calendar-month/year addition for the month/year durations); `lifetime` → `expiresAt = null`.

### §1.2 Entitlement-engine extension (additive to the reviewed M4b `computeCustomerInfo`)

- `ComputeCustomerInfoInput` gains `promotionalEntitlements: { entitlementIdentifier: string; expiresAtMs: number | null }[]` — the customer's non-revoked grants (compute-on-read expiry is applied by the engine against `nowMs`, same as subscriptions).
- The engine **unions** each active promotional grant (`expiresAtMs === null || expiresAtMs > nowMs`) into the computed `entitlements`: it produces/merges an `EntitlementInfo` for that entitlement identifier marked as promotionally-sourced (e.g. `productIdentifier: 'promotional'`, `store: 'promotional'`), `isActive: true`, `willRenew: false`, `expirationDate` = the grant's expiry (null for lifetime). **Merge rule** when the same entitlement is granted by BOTH a store subscription and a promotional grant: the entitlement is active, and the **later expiration wins** (lifetime/null beats any date); document this in the engine.
- `CustomerInfoAssemblerService.assemble` additionally loads `promotionalEntitlement.findMany({ where: { projectId, customerId, revokedAt: null }, include: { entitlement: { select: { identifier: true } } } })`, projects to `{ entitlementIdentifier, expiresAtMs }`, and passes it to `computeCustomerInfo`. This makes the extension automatically apply to the SDK-facing `GET /v1/subscribers/:appUserId` too (promotional entitlements correctly show up for the SDK — the RC-faithful behavior).

### §1.3 Read endpoints (`ProjectAccessGuard` + `@RequireProjectRole('viewer')`)

- `GET /api/v1/projects/:projectId/customers?search=&limit=&cursor=`
  - Paginated + searchable list. `search` matches `appUserId` (case-insensitive contains). `limit` default 25 (max 100). **Keyset pagination** on `(createdAt DESC, id DESC)`; `cursor` encodes the last row's `(createdAt, id)`.
  - Row: `{ id, appUserId, createdAt, lastSeenAt, activeSubscriptionCount, totalSpentCents, currency }`. `activeSubscriptionCount` = count of the customer's subscriptions in active statuses (`TRIAL,INTRO,ACTIVE,CANCELLED,GRACE_PERIOD`). `totalSpentCents` = SUM of the customer's non-revoked `Transaction.priceCents`; `currency` = the dominant currency of those transactions (null if none). Computed with grouped aggregation queries (not per-row `computeCustomerInfo`, keeping the list cheap).
  - Response: `{ items: Row[], nextCursor: string | null }`.
- `GET /api/v1/projects/:projectId/customers/:customerId`
  - `{ customer: { id, appUserId, appleAppAccountToken, googleObfuscatedId, attributes, createdAt, lastSeenAt }, customerInfo: CustomerInfo (from the extended assembler — entitlements incl. promotional), subscriptions: Subscription[], transactions: Transaction[] (most-recent first), promotionalEntitlements: { id, entitlementIdentifier, grantedAt, startsAt, expiresAt, revokedAt, note }[] }`.
  - 404 (RFC-7807) when `{ id: customerId, projectId }` matches no customer.

### §1.4 Write endpoints (`ProjectAccessGuard` + `@RequireProjectRole('admin')`)

- `POST /api/v1/projects/:projectId/customers/:customerId/promotional-entitlements` `{ entitlementId, duration, note? }` → grant. Validates the customer + the entitlement belong to `projectId` (404 otherwise); computes `expiresAt`; creates the grant; returns it. Returns `200/201` the created grant `{ id, entitlementIdentifier, grantedAt, startsAt, expiresAt, revokedAt: null, note }`.
- `DELETE /api/v1/projects/:projectId/customers/:customerId/promotional-entitlements/:grantId` → revoke. Double-scoped (grant belongs to customer belongs to project → 404 otherwise); sets `revokedAt = now` (idempotent — re-revoking a revoked grant is a no-op 204). Returns `204`.
- `DELETE /api/v1/projects/:projectId/customers/:customerId` → delete customer. 404 if not in project. `prisma.customer.delete` — **cascades** subscriptions + promotional entitlements; **`Transaction.customerId` is `SetNull`** (the immutable revenue ledger survives, anonymized). Returns `204`. This removes the customer's PII (appUserId, tokens, attributes) while preserving revenue history for the metrics endpoints.

## §2. Dashboard

- `features/revenuecat/customers-api.ts` — hooks over `purchaseApiFetch`, keyed `['rc-customers', projectId, …]`:
  - `useRcCustomers(projectId, { search })` — list; keyset pagination (`useInfiniteQuery` on `nextCursor`, or a "load more" cursor). Debounced `search`.
  - `useRcCustomer(projectId, customerId)` — detail.
  - `useGrantPromotionalEntitlement(projectId, customerId)` / `useRevokePromotionalEntitlement(projectId, customerId)` / `useDeleteCustomer(projectId)` — mutations; invalidate the customer detail (and the list on delete).
- `RcCustomersPage` (`/rc/customers`) — a search `<input>` + `DataTable` (appUserId, first seen, last seen, active subs, spend formatted via `formatCurrency`); a "Load more" control when `nextCursor` is set; empty state ("No customers yet — they appear here after their first purchase/SDK call"); row click navigates to the detail route. Gate-then-mount, no connect gate.
- `RcCustomerDetailPage` (**new nested route** `/rc/customers/$customerId`) — sections: **Entitlements** (active/expired, each showing identifier + expiry + a **Promotional** badge when promotionally-sourced), **Subscriptions** (store, product, status, willRenew, purchased/expires), **Transactions** (history table), **Attributes** (key/value), and **admin actions**: *Grant promotional entitlement* (dialog: native `<select>` entitlement + native `<select>` duration + optional note), *Revoke* (on each active promotional entitlement, `alert-dialog`), *Delete customer* (`alert-dialog` with a clear warning that it removes PII but keeps the revenue ledger). Viewer sees everything read-only (no action controls). Back-link to the list.
- `router.tsx` — swap the `/rc/customers` `component:` from `RcPlaceholderPage` to `RcCustomersPage`, and add a nested `createRoute` for `/projects/$projectId/rc/customers/$customerId` → `RcCustomerDetailPage`. `RcPlaceholderPage` stays imported (Paywalls still uses it). No `nav-model` change.

## §3. Data flow & error handling

- Reads: `useQuery`/`useInfiniteQuery` → `purchaseApiFetch` GET. Writes: `useMutation` → POST/DELETE, `onSuccess` invalidates the detail query (delete also invalidates the list and navigates back). Errors surface as `ApiError` (RFC-7807); dialogs show the problem detail inline and stay open on failure; list/detail fetch failure shows the `alert` slot. No optimistic updates in v1 (invalidate-and-refetch).

## §4. Testing

- **Server:** Testcontainers service specs — list (search, keyset pagination, active-sub count + spend aggregation), detail (assembled CustomerInfo incl. promotional union), grant (expiresAt from duration; lifetime null), revoke (revokedAt set; idempotent), delete (cascades subs + promo, transactions SetNull/ledger preserved), and the **engine-union** unit test (a promotional grant produces an active entitlement; expired/revoked grants don't; merge-with-store later-expiration-wins). e2e — every route's 200/viewer-403/admin/404, mirroring the catalog/metrics e2e harness.
- **Dashboard:** MSW page tests — list renders + search + load-more; detail renders entitlements/subs/transactions incl. a promotional badge; admin can grant (dialog)/revoke/delete; viewer read-only; empty states. Mirror `rc-charts`/`rc-offerings` test patterns (native selects → `userEvent.selectOptions`).

## §5. Build order (for the plan)

1. **B1** — migration (`PromotionalEntitlement`) + engine extension (`computeCustomerInfo` promotional union + assembler load) + Testcontainers/unit tests.
2. **B2** — read endpoints: customers list (search/keyset/aggregates) + customer detail; Testcontainers + e2e.
3. **B3** — write endpoints: grant + revoke promotional entitlement + delete customer; Testcontainers + e2e.
4. **B4** — dashboard `customers-api.ts` hooks + MSW hook tests.
5. **B5** — `RcCustomersPage` (list) + router swap + MSW page tests.
6. **B6** — `RcCustomerDetailPage` (detail + actions) + nested route + MSW page tests.
7. **B7** — verify gate (both backends tsc 0; mobile_purchase customers + e2e green; dashboard tsc 0 + revenuecat suite green; WIP-safety `git status`).

## §6. Out of scope (explicit)

- **Refund** (→ sub-project D, with the store credentials + `StoreClient`).
- **Subscriber attributes WRITE API** (setting custom attributes) — roadmap P5; detail shows attributes read-only.
- Optimistic UI, bulk actions, CSV export, per-list-row full entitlement computation, and any `nav-model`/navigation change.

## §7. Response shapes (reference)

- List `GET …/customers` → `{ items: { id, appUserId, createdAt, lastSeenAt, activeSubscriptionCount, totalSpentCents, currency }[], nextCursor: string | null }`.
- Detail `GET …/customers/:id` → `{ customer, customerInfo, subscriptions[], transactions[], promotionalEntitlements[] }` (§1.3).
- Grant `POST …/promotional-entitlements` → the created grant object. Revoke / Delete → `204`.
