# MyRevenueCat — Refund action (D1) — Design

**Goal:** Add an admin-initiated **Refund** action to the MyRevenueCat customer profile — RC-faithful: a **Google Play, active-subscription** refund that calls the Play Developer API to refund the last payment and revoke access, then reflects that in our own `mobile_purchase` state so compute-on-read drops the entitlement. This is the customer-refund action deferred out of sub-project B (Customers).

**Design principle:** Do EXACTLY what RevenueCat does. RC's refund capability is **asymmetric by store** (verified against RC's docs):
- **Apple App Store:** developers **cannot** issue refunds through any API — only Apple grants them. RC's Apple refund support is the inbound `CONSUMPTION_REQUEST` flow (respond within 12h with consumption data to influence Apple's decision) — a *webhook* feature that needs live ASSN delivery, **not** a dashboard button. So the clone offers **no** "issue refund" action for Apple. (That inbound flow is a separate, creds/deploy-gated sub-project — out of scope here.)
- **Google Play:** an **active** subscription can be refunded directly from the dashboard; RC calls the Play Developer API to **immediately revoke access + refund the last payment**. This is what D1 builds.

**This sub-project is one of three creds-free slices of sub-project D** (D1 Refund, D2 scheduler skeleton, D3 Cloud Run image slimming), each its own spec → plan → SDD. D1 is first because it directly continues sub-project B.

---

## §0. Constraints & principles

- **Store-gated only (RC-faithful).** The endpoint ALWAYS calls the Google `StoreClient`. Without live store credentials the client throws `GoogleCredentialsUnavailableError` → the endpoint returns **503** and writes **nothing** locally (identical posture to the existing receipts path, `src/receipts/support/google-receipt-validator.ts`). The local `refundedAt`/`revokedAt` writes happen ONLY after a successful store call. No "local-only refund" mode.
- **Google only.** `store === 'PLAY_STORE'`. Apple (`APP_STORE`) subscriptions get no refund action (UI hides it; the endpoint rejects them with 409).
- **Active only.** RC shows Refund only for currently-entitled subscriptions. Refundable status set = `{ ACTIVE, TRIAL, INTRO, GRACE_PERIOD, CANCELLED }` (the entitled states per the `SubscriptionStatus` enum comments; `CANCELLED` = auto-renew off but still entitled until `expiresAt`). Non-refundable = `{ BILLING_RETRY, PAUSED, EXPIRED, REVOKED }`.
- **Subscriptions only.** One-time-product refunds (Play `orders.refund`) are OUT of scope (deferred); RC's dashboard "Refund" lives on the subscription.
- **Admin-gated write.** `@RequireProjectRole('admin')`, like B's grant/revoke/delete-customer.
- **Reuse the existing store seam.** The `StoreClient` interface + `GOOGLE_STORE_CLIENT` DI token + `GoogleApiStoreClient` (creds-gated real impl) + `InMemoryStoreClient` (test double) already exist (`src/webhooks/google/*`). D1 extends the interface with one method; it does NOT invent a new store client.
- **Per-service isolation:** additive; no schema/migration change (`Subscription.refundedAt`, `Subscription.status`, `Transaction.revokedAt` all already exist). `mobile_analytics` untouched.
- **HARD WIP rule:** never touch the user's uncommitted collapse-rail WIP (`dashboard/src/components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`). Never commit `.env` / `google-service-account.json`. No co-author trailers. Reuse B's dashboard dialog/mutation patterns (native `<button>`/dialog — Radix Select hangs jsdom).

## §1. Server (`mobile_purchase`, additive)

### §1.1 Endpoint
`POST /api/v1/projects/:projectId/customers/:customerId/subscriptions/:subscriptionId/refund`
- `ProjectAccessGuard` + `@RequireProjectRole('admin')`. No request body.
- Success: **200** with `{ id, status, refundedAt }` (the updated subscription — the dashboard refetches detail anyway; the body confirms the new state).
- Lives in the customers write area (grouped with promotional grant/revoke/delete-customer). Path nests under `customers/:customerId` so the subscription is **double-scoped** to the customer, matching B's write endpoints.

### §1.2 `RefundService.refund(projectId, customerId, subscriptionId)`
1. **Load + scope.** Load the subscription by `id = subscriptionId`; assert `customerId` matches AND the customer belongs to `projectId` (double-scoped, no bare `findFirst` on id alone). Not found / cross-customer / cross-project → **404** (`ProblemException` 404, opaque — don't leak which scope failed).
2. **Preconditions (no store call if any fail):**
   - `store !== 'PLAY_STORE'` → **409** "Refunds are only available for Google Play subscriptions."
   - `refundedAt !== null` → **409** "This subscription has already been refunded."
   - `status ∉ { ACTIVE, TRIAL, INTRO, GRACE_PERIOD, CANCELLED }` → **409** "Only active subscriptions can be refunded."
   - `purchaseToken` null → **409** "Subscription is missing its Google purchase token." (defensive; a PLAY_STORE sub always has one)
3. **Resolve store identity.** `packageName` = the sub's `App.packageName` (via `appId`). If the app has no `packageName` → **409** "App is not configured for Google Play." (defensive invariant)
4. **Call the store (creds-gated).** `await storeClient.revokeAndRefundSubscription(packageName, purchaseToken)`. On `GoogleCredentialsUnavailableError` → **503** `ProblemException({ status: 503, title: 'Store credentials unavailable' })` (verbatim the receipts-path mapping) — **abort, write nothing.** Any other store error → **502** "Store rejected the refund" (`ProblemException`, detail = the error message).
5. **Reflect locally (only on store success), in one `prisma.$transaction`:**
   - `subscription`: `status = REVOKED`, `refundedAt = now`.
   - the **latest** `Transaction` for the sub (`where { subscriptionId, projectId }`, `orderBy purchasedAt desc`, take 1) — set `revokedAt = now` if it isn't already. (RC refunds "the last purchase"; only the last payment is revoked. If the sub has zero transactions, skip — the subscription-level refund still stands.)
   - `now` is injected (`nowMs`/clock param) for deterministic tests, consistent with the metrics/entitlements services.
6. **Return** `{ id, status: 'REVOKED', refundedAt }`. Compute-on-read (`computeCustomerInfo`) now drops the entitlement automatically (a `REVOKED` sub with `refundedAt` set is not entitled) — no scheduler needed.

### §1.3 `StoreClient` extension
Add to the `StoreClient` interface (`src/webhooks/google/store-client.ts`):
```
revokeAndRefundSubscription(packageName: string, purchaseToken: string): Promise<void>
```
- **Real** `GoogleApiStoreClient` (`store-client.google-api.ts`): implement to call the Play Developer API `purchases.subscriptions.revoke` (refund last payment + immediately revoke) — but, like its sibling methods, it is **creds-gated**: with `App.storeCredentials` NULL it throws `GoogleCredentialsUnavailableError(packageName)` before any network call. (The real `googleapis` wiring is a later creds-gated drop-in; D1 ships the throw + the method contract, matching how `getSubscriptionV2`/`getProduct` are shaped today.)
- **Test double** `InMemoryStoreClient`: implement `revokeAndRefundSubscription` to record `(packageName, purchaseToken)` and be configurable to resolve (success) or reject (e.g. throw `GoogleCredentialsUnavailableError`, or a generic store error) so specs can drive every branch.

### §1.4 Module wiring
The refund service needs `GOOGLE_STORE_CLIENT`. Provide it to the customers-write module the same way the receipts module does — via the shared Google store-client provider (import/re-provide `GOOGLE_STORE_CLIENT` so `RefundService` can `@Inject(GOOGLE_STORE_CLIENT)`). No new store client is constructed; the existing factory is reused. Wire `RefundController` + `RefundService` into the module that already hosts the customer write endpoints.

### §1.5 Tests (Testcontainers + e2e)
`RefundService` spec (mock `StoreClient`):
- **Happy path** — active PLAY_STORE sub + store success → sub `status = REVOKED` + `refundedAt` set; the latest transaction `revokedAt` set (an older transaction stays non-revoked); the store double received `(packageName, purchaseToken)`; **and** `computeCustomerInfo` for that customer no longer reports the entitlement as active (proves the end-to-end drop).
- **Already refunded** (`refundedAt` set) → 409, store double **not** called, no writes.
- **Non-Google** (`APP_STORE` sub) → 409, store not called.
- **Inactive** (e.g. `EXPIRED` / `BILLING_RETRY`) → 409, store not called.
- **Creds unavailable** (double throws `GoogleCredentialsUnavailableError`) → 503, and the sub/transaction are **unchanged** (transaction rolled back / never written).
- **Generic store error** (double throws Error) → 502, no local writes.
- **Cross-customer** & **cross-project** id → 404, store not called.

E2e (`test/e2e`, mirror the customers write e2e, bind `InMemoryStoreClient` configured to succeed): 200 admin happy → response body shows `REVOKED`+`refundedAt`; 403 viewer; 401 no token; 404 unknown subscription; 409 non-Google (seed an APP_STORE sub). One 503 case if feasible by binding a throwing double.

## §2. Dashboard

**No change needed to sub-project B's customer-detail endpoint** — it already returns each subscription as a full row (`RcSubscriptionRow`), so the dashboard already has `id`, `store` (`RcRawStore = 'APP_STORE' | 'PLAY_STORE'`, matching the server enum), `status` (`RcSubscriptionStatus`), and `refundedAt` to decide button visibility and target the refund. D1's dashboard work is purely the mutation hook + the action UI.

- `features/revenuecat/customers-api.ts` — add `useRefundSubscription(projectId, customerId)` mutation: `POST` via `purchaseApiFetch` to `/api/v1/projects/${projectId}/customers/${customerId}/subscriptions/${subscriptionId}/refund`; on success invalidate the customer-detail query key (the sub re-renders as refunded/revoked). `TError = ApiError`.
- `RcCustomerDetailPage` subscriptions section — for each subscription, show a **Refund** action **only when**: the viewer is admin (`useProjectRole ∈ {admin, owner}`) AND `store === 'PLAY_STORE'` AND `status ∈` the refundable set AND `refundedAt` is null. Clicking opens a confirm dialog (native, B's dialog pattern): title "Refund subscription", body "Refund the last payment and revoke this subscription immediately? This can't be undone.", confirm/cancel. Confirm → `useRefundSubscription` mutation.
  - On **success**: close dialog, success toast ("Refund issued"), detail refetch shows the sub as Refunded/Revoked (and the entitlement gone).
  - On **503**: error toast "Connect a Google Play service account first." (surfaced from the `ApiError`).
  - On other errors (409/404/502): error toast with the problem `detail`.
- Non-Google / inactive / already-refunded / viewer → the Refund action is **not rendered** (faithful; hide, don't disable).

## §3. Data flow & error handling

Admin clicks Refund → confirm → `useRefundSubscription` → `purchaseApiFetch` POST → `RefundController` (admin guard) → `RefundService`: scope + preconditions → `StoreClient.revokeAndRefundSubscription` (creds-gated) → on success, DB transaction marks the sub REVOKED + refundedAt + latest txn revokedAt → 200. Compute-on-read drops the entitlement on the next read. Errors map to RFC-7807: 404 (scope), 409 (three precondition cases), 502 (store error), 503 (no creds), 403 (non-admin), 401 (no token) — all via `ProblemException`, surfaced by `purchaseApiFetch` as `ApiError` and shown as toasts.

## §4. Testing summary

- **Server:** Testcontainers `RefundService` (every branch in §1.5) + e2e (200/403/401/404/409[, 503]).
- **Dashboard:** MSW — admin sees Refund on an active Google sub → confirm → success → sub renders refunded; MSW 503 → error toast; viewer sees no button; an `APP_STORE` sub shows no button; an already-refunded sub shows no button.

## §5. Build order (for the plan)

1. **D1.1** — `StoreClient` interface extension (`revokeAndRefundSubscription`) + real creds-gated throw + `InMemoryStoreClient` double; unit-level assertion the real impl throws `GoogleCredentialsUnavailableError` with NULL creds.
2. **D1.2** — `RefundService` (scope + preconditions + store call + local reflect) + Testcontainers spec (all §1.5 branches).
3. **D1.3** — `RefundController` + module wiring (inject `GOOGLE_STORE_CLIENT`) + e2e.
4. **D1.4** — dashboard `useRefundSubscription` hook + MSW hook test.
5. **D1.5** — `RcCustomerDetailPage` Refund action + confirm dialog + toasts; MSW page tests (visibility matrix + success + 503).
6. **D1.6** — verify gate (mobile_purchase tsc 0 + refund spec + e2e green; dashboard tsc 0 + revenuecat suite green; WIP-safety `git status`).

## §6. Out of scope (explicit)

- **Apple refunds** — impossible via API; the RC-parity Apple path is the inbound `CONSUMPTION_REQUEST` auto-response, a separate webhook sub-project (needs live ASSN delivery + creds).
- **One-time-product refunds** (Play `orders.refund`) — RC's dashboard refund is on the subscription; defer.
- **Real Play Developer API wiring** — `revokeAndRefundSubscription`'s real network call is creds-gated (needs `App.storeCredentials`, the Play service account); D1 ships the seam + the creds-gated throw. Populating credentials + the live call is part of the connect-store / deploy work.
- **Externally-initiated refund detection** (a user refunds via Google, RC picks it up in ≤24h via RTDN) — that's the Google `voidedPurchases`/RTDN webhook path, already handled by the M3 ingest; D1 is only the dashboard-initiated action.
- **Refund metrics/charts** (a dedicated refunds chart) — the summary already maps `refundedAt` → churn reason `refund`; a dedicated chart is separate.

## §7. Reference — key existing symbols

- `Subscription` (`refundedAt`, `status: SubscriptionStatus`, `store: Store`, `purchaseToken`, `appId`, `customerId`, `projectId`); `Transaction` (`subscriptionId`, `revokedAt`, `purchasedAt`, `projectId`; `@@index([subscriptionId])`); `App` (`packageName`, `storeCredentials`).
- `Store` enum = `{ APP_STORE, PLAY_STORE }`. `SubscriptionStatus` = `{ TRIAL, INTRO, ACTIVE, CANCELLED, GRACE_PERIOD, BILLING_RETRY, PAUSED, EXPIRED, REVOKED }`.
- `StoreClient` interface + `GOOGLE_STORE_CLIENT` token + `GoogleApiStoreClient` + `InMemoryStoreClient` + `GoogleCredentialsUnavailableError` (`src/webhooks/google/*`).
- `ProblemException` (`src/common/problem-details`), `ProjectAccessGuard` + `@RequireProjectRole` (`src/authz/*`), `computeCustomerInfo` (`src/entitlements/compute-customer-info.ts`).
- Dashboard: `purchaseApiFetch` (`dashboard/src/lib/api/purchase-client.ts`), `useProjectRole`, `customers-api.ts`, `RcCustomerDetailPage` + its dialogs file.
