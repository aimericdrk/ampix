# mobile_purchase — MyRevenueCat backend (billing authority)

NestJS 11 backend for **MyRevenueCat**, the subscription/billing half of MyAmpix. It is a full
RevenueCat-class clone and the **billing authority**: it ingests App Store and Google Play purchase
notifications directly (no RevenueCat dependency), computes entitlements on read, manages the
product catalog, and serves subscription analytics.

- **Package:** `@myampix/mobile-purchase`
- **Port:** `8090`
- **Data store:** its **own** Postgres on `:5433` (never reads the analytics databases)
- **Auth model:** holds **no** JWT secret — it calls `mobile_analytics` for project role checks (`ANALYTICS_INTERNAL_URL`)
- **Repo-wide context:** see the root [`DOCUMENTATION.md`](../../DOCUMENTATION.md)

---

## How to run

From the **repo root** (pnpm workspace — always use `--filter`):

```bash
# 0. one time: install + local databases (starts the :5433 Postgres too)
corepack enable && pnpm install
pnpm infra:up

# 1. env (first time only)
cp backend/mobile_purchase/.env.example backend/mobile_purchase/.env

# 2. schema (its own Postgres on :5433)
pnpm --filter @myampix/mobile-purchase exec prisma migrate deploy

# 3. run (watch mode) → http://localhost:8090
pnpm --filter @myampix/mobile-purchase start:dev
```

Requires `mobile_analytics` (:8088) running for role checks, and — only for the connect-stores
flow — a `STORE_CREDENTIALS_ENC_KEY`. `pnpm dev` at the root does **not** start this service; run it
with the steps above.

Verify: `curl http://localhost:8090/health` → healthy.

### Package scripts

| Script      | What it does                                |
| ----------- | ------------------------------------------- |
| `start:dev` | `nest start --watch` on `:8090`             |
| `build`     | `nest build` → `dist/`                      |
| `start`     | `node dist/main.js` (production)            |
| `typecheck` | `tsc --noEmit`                              |
| `test`      | Jest (Testcontainers e2e — needs Docker)    |

---

## Configuration

`.env.example` is intentionally minimal; the full, authoritative surface is
`src/config/app-config.ts` (Zod-validated, **fails fast listing every problem at once**).

| Variable                     | Default                 | Purpose                                                       |
| ---------------------------- | ----------------------- | ------------------------------------------------------------- |
| `PORT`                       | `8090`                  | HTTP port                                                     |
| `DATABASE_URL`               | —                       | its own Postgres — `postgresql://mobile_purchase:…@localhost:5433/mobile_purchase` |
| `ANALYTICS_INTERNAL_URL`     | `http://localhost:8088` | where project roles are resolved                             |
| `DASHBOARD_ORIGINS`          | `http://localhost:5173` | CORS allowlist for dashboard→purchase requests               |
| `STORE_CREDENTIALS_ENC_KEY`  | (unset)                 | base64 32-byte AES-256 key (`openssl rand -base64 32`); absence only blocks the connect-store path, not boot. **Never commit.** |
| `APPLE_BUNDLE_IDS`           | `com.myampix.app`       | comma-separated bundle IDs accepted from Apple ASSN v2       |
| `APPLE_APP_APPLE_ID`         | (unset)                 | App Store Connect numeric app id (required for Production)    |
| `APPLE_ROOT_CERT_DIR`        | in-repo `certs/`        | trust anchors for verifying Apple notifications             |
| `GOOGLE_PUSH_AUTH_MODE`      | `shared_secret`         | `shared_secret` works today; `oidc` deferred to X1          |
| `GOOGLE_PUBSUB_SHARED_SECRET`| (unset)                 | Pub/Sub push token — **unset ⇒ every Google push is 401** (fail-closed by design) |
| `SCHEDULER_ENABLED`          | `true`                  | master switch for crons; **set `false` in tests**           |
| `EXPIRY_SWEEP_CRON`          | `*/5 * * * *`           | subscription-expiry sweep cadence                           |
| `LOG_LEVEL`                  | `info`                  | pino level                                                    |

**Never commit** `.env`, `.p8`/`.p12`, service-account JSON, or any encryption key/shared secret.

---

## Module map (`src/`)

| Module            | Responsibility                                                                 |
| ----------------- | ------------------------------------------------------------------------------ |
| `webhooks/apple/` | `POST /webhooks/apple` — verifies Apple App Store Server Notifications v2 (signed JWS) |
| `webhooks/google/`| `POST /webhooks/google` — Google RTDN via Pub/Sub, shared-secret auth          |
| `subscriptions/`, `subscribers/`, `customers/` | subscription state, subscriber lookups, customer list + detail (refunds, deletion, promo entitlements) |
| `entitlements/`   | entitlement definitions + **compute-on-read** resolution                       |
| `catalog/`        | apps, products, offerings, packages, and the per-app store-credentials connect flow |
| `metrics/`        | `summary`, `mrr`, `revenue`, `active-subscriptions` — powers MyRevenueCat pages |
| `receipts/`       | `POST /v1/receipts` — receipt validation entry                                 |
| `scheduler/`      | the expiry-sweep cron (`@nestjs/schedule`)                                      |
| `authz/`, `prisma/`, `config/`, `health/`, `common/` | infrastructure                                         |

---

## Selected endpoints

Inbound store notifications:

```
POST /webhooks/apple                    # App Store Server Notifications v2
POST /webhooks/google?token=<secret>    # Google RTDN (Pub/Sub push)
```

Public SDK surface (used by `myampix_purchases`, under `/v1`):

```
GET  /v1/offerings
GET  /v1/subscribers/:appUserId
POST /v1/receipts
```

Dashboard/admin surface (`/api/v1/projects/:projectId/…`, role-checked via analytics):

```
GET    catalog/apps            POST catalog/apps            DELETE catalog/apps/:appId
PUT    catalog/apps/:appId/store-credentials
GET    catalog/apps/:appId/store-credentials/status
DELETE catalog/apps/:appId/store-credentials
…/catalog/products      …/catalog/offerings      …/catalog/entitlements   (full CRUD)
GET    customers        GET customers/:customerId
DELETE customers/:customerId
POST   customers/:customerId/subscriptions/:subscriptionId/refund
POST   customers/:customerId/promotional-entitlements   DELETE …/:grantId
GET    metrics/summary · metrics/mrr · metrics/revenue · metrics/active-subscriptions
```

Health: `GET /health`, `GET /health/ready`.

---

## How purchases arrive

Real purchases reach this service **automatically via webhooks**, independent of whether the buyer
reopens the app:

- **iOS:** Apple posts ASSN v2 → `POST /webhooks/apple` → JWS verified against trust anchors + bundle ID → transaction recorded → entitlements recomputed.
- **Android:** Google publishes an RTDN → Pub/Sub push → `POST /webhooks/google?token=…` → shared-secret checked → subscription state + entitlements updated.

Entitlements are computed on read, so a customer's active access always reflects the latest
notification.

**Gated on the GCP deploy (sub-project X1):** outbound server-to-server calls to the Google Play
Developer API and App Store Server API, plus OIDC Pub/Sub auth. Until then the store clients are
scaffolded but raise a typed "credentials unavailable" error instead of making a live call. Inbound
webhook verification works pre-deploy.

---

## Testing & Prisma

- **Tests:** Jest, with e2e suites on **Testcontainers** (Docker required). Keep `SCHEDULER_ENABLED=false` in tests so the expiry cron doesn't fire during teardown.
- **Prisma:** own schema/client; `prisma generate` runs on install. Evolve with
  `pnpm --filter @myampix/mobile-purchase exec prisma migrate dev --name <change>`.
