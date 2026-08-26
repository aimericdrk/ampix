# mobile_analytics — MyAmplitude backend

NestJS 11 backend for **MyAmplitude**, the product-analytics half of MyAmpix. It handles SDK
ingestion, analytics queries, authentication (JWT + TOTP 2FA), organizations/projects/roles, and
reference screenshots. It also serves an internal role-resolution endpoint that the
`mobile_purchase` service calls.

- **Package:** `@myampix/mobile-analytics`
- **Port:** `8088`
- **Data stores:** Postgres (accounts/orgs/projects/tokens), ClickHouse (events/profiles/identity), Redis (sessions + rate limiting — **mandatory**)
- **Repo-wide context:** see the root [`DOCUMENTATION.md`](../../DOCUMENTATION.md)

---

## How to run

From the **repo root** (this is a pnpm workspace — always run package scripts with `--filter`):

```bash
# 0. one time: install + local databases
corepack enable && pnpm install
pnpm infra:up                                                     # ClickHouse + Postgres + Redis

# 1. env (first time only)
cp backend/mobile_analytics/.env.example backend/mobile_analytics/.env

# 2. schema + demo data
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy
pnpm --filter @myampix/mobile-analytics exec prisma db seed       # demo project + ingest token

# 3. run (watch mode) → http://localhost:8088
pnpm --filter @myampix/mobile-analytics start:dev
```

The seed creates the fixed demo ingest token `mam_00000000000000000000000000000000`.

> The whole stack (this backend + dashboard, migrated and seeded) also comes up with a single
> `pnpm dev` from the repo root. Use the steps above when you want to run just this service.

### Package scripts

| Script       | What it does                                            |
| ------------ | ------------------------------------------------------- |
| `start:dev`  | `nest start --watch` on `:8088`                         |
| `build`      | `nest build` → `dist/`                                  |
| `start`      | `node dist/main.js` (production)                        |
| `typecheck`  | `tsc --noEmit`                                          |
| `test`       | Jest unit tests                                         |
| `test:int`   | integration tests (Testcontainers — needs Docker)      |
| `test:e2e`   | end-to-end tests (Testcontainers — needs Docker)       |
| `test:cov`   | coverage run (floor **85%**)                            |
| `seed`       | `prisma db seed`                                        |

---

## Configuration

Copy `.env.example` → `.env`. The environment is validated at boot. Key variables:

| Variable                                   | Purpose                                                             |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `PORT`                                     | HTTP port (default `8088`)                                          |
| `DATABASE_URL`                             | Postgres — `postgresql://myampix:myampix_dev@localhost:5432/myampix`|
| `CLICKHOUSE_URL/_USER/_PASSWORD/_DB`       | event store connection                                             |
| `REDIS_URL`                                | **mandatory, no fallback** — sessions + rate limiting              |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | token signing — change for any real environment                    |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` / `MFA_TOKEN_TTL` | token lifetimes (seconds)                           |
| `TOTP_ISSUER` / `TOTP_ENC_KEY`             | 2FA; `TOTP_ENC_KEY` = 32-byte hex (`openssl rand -hex 32`)         |
| `COOKIE_SECURE` / `COOKIE_DOMAIN`          | refresh-cookie flags — **prod refuses to boot with `COOKIE_SECURE=false`** |
| `INGEST_MAX_BATCH` / `INGEST_MAX_BODY_KB`  | ingestion limits                                                   |
| `SCREENSHOT_MAX_KB`                        | max autocapture screenshot upload size                             |
| `FIREBASE_STORAGE_BUCKET`                  | GCS bucket for screenshot bytes; unset → in-memory fake (dev/test) |
| `GOOGLE_APPLICATION_CREDENTIALS`           | service-account JSON path — **never commit it**                    |
| `LOG_LEVEL`                                | pino level; at `info`, 2xx/3xx request logs are suppressed         |

**Never commit** `.env`, secrets, encryption keys, or service-account JSON.

---

## Module map (`src/`)

| Module                                    | Responsibility                                                   |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `ingestion/`                              | `/ingest/events`, `/ingest/profiles` — token-auth'd gzip batches |
| `analytics/`, `cohorts/`, `dashboards/`, `reports/` | query APIs (insights/funnels/retention/cohorts) over ClickHouse |
| `auth/`                                    | signup/login, JWT access+refresh, TOTP 2FA                       |
| `orgs/`, `projects/`, `invitations/`, `authz/` | orgs, projects, membership, per-project roles              |
| `screenshots/`                             | reference-screenshot upload/serve (Firebase Storage + Postgres)  |
| `internal/`                                | role-resolution endpoint `mobile_purchase` calls                 |
| `revenuecat/`                              | **legacy** RevenueCat integration mirror (superseded by the MyRevenueCat clone in `mobile_purchase`) |
| `clickhouse/`, `redis/`, `prisma/`, `health/`, `config/`, `common/`, `templates/` | infrastructure |

---

## Selected endpoints

Ingestion (SDK, `Authorization: Bearer mam_…`):

```
POST /ingest/events
POST /ingest/profiles
POST /ingest/screenshots
```

Each `sdk_tokens` row is either a `client` or a `server` token, and `SdkTokenGuard` puts that on the
request so `EventNormalizer` can stamp it into the `source` column of every row it writes. It comes
from the token row alone — a `source` in the payload is ignored — which is what makes the dimension
trustworthy. New tokens default to `client`; `source` is immutable once the token exists.

Auth (`/api/v1/auth`): `POST signup · login · 2fa/verify · refresh · logout · password`,
`GET/PATCH me`, `POST 2fa/setup · 2fa/activate · 2fa/disable`.

Orgs / projects / members: `/api/v1/orgs`, `/api/v1/orgs/:orgId/projects`,
`/api/v1/projects` (+ `:projectId/tokens`, `:projectId/data/purge`, members, project-access).

Analytics / cohorts / dashboards / reports: `POST /api/v1/projects/:projectId/query/insights`,
`GET meta/events`, `GET meta/properties`, `…/cohorts`, `…/dashboards`, `…/reports`.

Internal (called by `mobile_purchase`): `GET /api/v1/internal/projects/:projectId/role`.

Health: `GET /health`, `GET /health/ready`.

> There is a legacy `revenuecat/` surface (`/webhooks/revenuecat/:projectId`,
> `/api/v1/projects/:projectId/integrations/revenuecat/*`, `metrics/subscriptions`). New billing
> work lives in `mobile_purchase`, not here.

---

## Testing

Jest. Integration/e2e suites spin up a real Postgres via **Testcontainers**, so **Docker must be
running**. Coverage floor is **85%** (CI-enforced). Run a single suite while iterating:

```bash
pnpm --filter @myampix/mobile-analytics test -- <path/to/file.spec.ts>
```

## Prisma

This service has its own schema and generated client. `prisma generate` runs on install
(`prepare`). To evolve the schema:

```bash
pnpm --filter @myampix/mobile-analytics exec prisma migrate dev --name <change>
pnpm --filter @myampix/mobile-analytics exec prisma studio        # browse/edit rows
```
