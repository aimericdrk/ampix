# MyAmpix — Full Documentation

MyAmpix is a self-hosted, 100%-OSS mobile growth platform. It bundles two products that
share one monorepo, one dashboard, and one login:

- **MyAmplitude** — a Mixpanel/Amplitude-class product-analytics stack: a Flutter SDK feeds an
  ingestion API that lands events in ClickHouse; the dashboard renders insights, funnels,
  retention, user-path maps, heatmaps, and cohorts.
- **MyRevenueCat** — a RevenueCat-class subscription/billing stack: a second backend
  (`mobile_purchase`) is the **billing authority**. It ingests App Store and Google Play
  purchase notifications, computes entitlements, and serves subscription analytics. It does **not**
  depend on RevenueCat — it talks to Apple and Google directly.

This document is the single entry point for both **operators** (people who want to run/use the
tool) and **contributors** (people who want to work on it). Two shorter docs already exist and
stay authoritative for their narrow scope: [`README.md`](README.md) (repo layout + quick start)
and [`HOW-TO-USE.md`](HOW-TO-USE.md) (the analytics Flutter SDK, in depth).

---

## Table of contents

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Prerequisites](#2-prerequisites)
3. [Quick start (one command)](#3-quick-start-one-command)
4. [Manual setup, service by service](#4-manual-setup-service-by-service)
5. [Environment configuration](#5-environment-configuration)
6. [The backends](#6-the-backends)
7. [The dashboard (frontend)](#7-the-dashboard-frontend)
8. [The mobile SDKs](#8-the-mobile-sdks)
9. [How a purchase flows in (end to end)](#9-how-a-purchase-flows-in-end-to-end)
10. [Contributor guide](#10-contributor-guide)
11. [Troubleshooting](#11-troubleshooting)
12. [Production deployment (k3s on a VPS)](#12-production-deployment-k3s-on-a-vps)
13. [Admin/ops console](#13-adminops-console)

---

## 1. Architecture at a glance

```
                    ┌─────────────────────── Flutter apps ───────────────────────┐
                    │  myampix_analytics  (track/identify/autocapture)            │
                    │  myampix_purchases  (offerings, purchase, entitlements)     │
                    └───────┬───────────────────────────────────┬────────────────┘
                            │ HTTP /ingest/*                     │ HTTP /api/v1/…
                            ▼                                    ▼
        ┌───────────────────────────────┐      ┌───────────────────────────────────┐
        │  mobile_analytics  (:8088)    │      │  mobile_purchase  (:8090)          │
        │  NestJS 11                    │      │  NestJS 11 — the billing authority │
        │  • ingestion + analytics API  │◄─────┤  • asks analytics for user roles   │
        │  • auth (JWT + TOTP 2FA)      │ role │    (ANALYTICS_INTERNAL_URL)         │
        │  • screenshots (Firebase)     │ check│  • Apple ASSN v2 + Google RTDN     │
        └──────┬───────────┬────────────┘      │    webhooks → entitlements         │
               │           │                   └──────────────┬────────────────────┘
        ClickHouse      Postgres  Redis                   Postgres (:5433)
         (events)      (accounts) (sessions,               (subscriptions,
                                   rate-limit)              customers, catalog)
                            ▲
        ┌───────────────────┴───────────────────────────────────────────────────┐
        │  dashboard  (:5173 dev / static build in prod)  React + TanStack       │
        │  reads apiBaseUrl → mobile_analytics, purchaseApiBaseUrl → mobile_purchase │
        └───────────────────────────────────────────────────────────────────────┘
```

**Monorepo layout** (pnpm workspaces — see `pnpm-workspace.yaml`):

| Path                        | What it is                                                         |
| --------------------------- | ------------------------------------------------------------------ |
| `backend/mobile_analytics/` | NestJS analytics + auth backend (port **8088**)                    |
| `backend/mobile_purchase/`  | NestJS billing-authority backend (port **8090**, its own Postgres) |
| `dashboard/`                | React 18 + Vite SPA (port **5173** in dev)                         |
| `sdk/flutter_analytics/`    | `myampix_analytics` Flutter SDK                                    |
| `sdk/flutter_purchases/`    | `myampix_purchases` Flutter SDK                                    |
| `packages/contracts/`       | Shared TypeScript types + Zod schemas used across services         |
| `infra/`                    | `docker-compose.yml` (local databases) + ClickHouse init SQL       |
| `docs/superpowers/`         | Design specs and implementation plans                              |
| `scripts/`                  | `dev.sh` (one-command stack), seed + functional-test helpers       |

**Why two backends and two databases?** MyRevenueCat is a full clone, not a mirror:
`mobile_purchase` owns its own Postgres (subscriptions, customers, catalog) and is the source of
truth for billing. It holds **no** JWT secret — when it needs to know whether a caller may access a
project, it calls back to `mobile_analytics`'s internal role-resolution endpoint
(`ANALYTICS_INTERNAL_URL`). The two services are deployed separately but share the same login and
the same dashboard.

---

## 2. Prerequisites

| Tool        | Version           | Notes                                                      |
| ----------- | ----------------- | ---------------------------------------------------------- |
| **Node.js** | 22.x (`>=22 <23`) | `nvm use` reads `.nvmrc`                                   |
| **pnpm**    | 10.x              | `corepack enable` activates the pinned `pnpm@10.12.1`      |
| **Docker**  | with Compose v2   | runs ClickHouse, Postgres ×2, Redis locally                |
| **Flutter** | 3.32+ / Dart 3.8+ | only needed to build/run the mobile SDKs or their examples |
| **tmux**    | optional          | `pnpm dev` uses it for a split backend/dashboard log view  |

Everything except Flutter is needed to run the web stack. Flutter is only for the SDKs.

---

## 3. Quick start (one command)

From the repo root:

```bash
corepack enable        # activate pinned pnpm
pnpm install           # install all workspace dependencies
pnpm dev               # the whole stack — see below
```

`pnpm dev` (which runs [`scripts/dev.sh`](scripts/dev.sh)) does all of this for you:

1. checks Docker is running and pnpm is available;
2. creates `backend/mobile_analytics/.env` from the example if it's missing;
3. starts the databases (`docker compose … up -d --wait`, healthcheck-gated);
4. applies analytics migrations (`prisma migrate deploy`);
5. seeds a demo project + ingest token;
6. launches **mobile_analytics on http://localhost:8088** and the **dashboard on
   http://localhost:5173** side by side (tmux split if available, labeled logs otherwise).

Ctrl-C stops the backend and dashboard; the databases keep running (`pnpm infra:down` stops them).

> **Note:** `pnpm dev` starts the analytics backend + dashboard. The **mobile_purchase** backend
> (MyRevenueCat) is a separate process — start it as shown in §4.3 when you're working on the
> billing side. The dashboard's `public/config.js` already points `purchaseApiBaseUrl` at
> `http://localhost:8090`, so once `mobile_purchase` is up the MyRevenueCat pages work with no
> further config.

Verify the databases are reachable: `curl http://localhost:8123/ping` → `Ok.`

---

## 4. Manual setup, service by service

If you'd rather run pieces individually (the usual contributor setup):

### 4.1 Databases

```bash
pnpm infra:up      # ClickHouse + Postgres + Redis + mobile-purchase-postgres, waits for health
pnpm infra:down    # stop (data kept in named volumes)
pnpm infra:reset   # stop AND wipe all local data
```

Local services and dev credentials (from `infra/docker-compose.yml`; the compose project is named
`myampix`). **These credentials are for local dev only — never reuse them in production.**

| Service                    | Port(s)       | Credentials / notes                                             |
| -------------------------- | ------------- | --------------------------------------------------------------- |
| ClickHouse                 | 8123, 9000    | `default` / `myampix_dev`, db `analytics`                       |
| Postgres (analytics)       | 5432          | `myampix` / `myampix_dev`, db `myampix`                         |
| Redis                      | 6379          | no password                                                     |
| Postgres (mobile_purchase) | **5433**→5432 | `mobile_purchase` / `mobile_purchase_dev`, db `mobile_purchase` |
| Adminer (DB web UI)        | 8082          | inspect any Postgres above                                      |
| ch-ui (ClickHouse web UI)  | —             | browse ClickHouse                                               |

### 4.2 mobile_analytics backend (:8088)

```bash
cp backend/mobile_analytics/.env.example backend/mobile_analytics/.env    # first time only
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy        # schema
pnpm --filter @myampix/mobile-analytics exec prisma db seed               # demo project + token
pnpm --filter @myampix/mobile-analytics start:dev                         # watch mode on :8088
```

### 4.3 mobile_purchase backend (:8090)

```bash
cp backend/mobile_purchase/.env.example backend/mobile_purchase/.env      # first time only
pnpm --filter @myampix/mobile-purchase exec prisma migrate deploy         # its OWN Postgres (:5433)
pnpm --filter @myampix/mobile-purchase start:dev                          # watch mode on :8090
```

`mobile_purchase` needs `mobile_analytics` running (it calls it for role checks) and a
`STORE_CREDENTIALS_ENC_KEY` if you exercise the connect-stores flow — see §5.

### 4.4 Dashboard (:5173)

```bash
pnpm --filter @myampix/dashboard dev       # Vite dev server on :5173
```

The Vite dev server proxies `/api` and `/ingest` to `:8088`. MyRevenueCat pages read
`purchaseApiBaseUrl` from `dashboard/public/config.js` (defaults to `http://localhost:8090`).

---

## 5. Environment configuration

Each backend loads a `.env` at boot. Both validate their environment with Zod and **fail fast with
every problem listed at once** if something is wrong.

### 5.1 mobile_analytics (`backend/mobile_analytics/.env`)

Copy from `.env.example`. Key variables:

| Variable                                                   | Purpose                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PORT`                                                     | HTTP port (default `8088`)                                                       |
| `DATABASE_URL`                                             | analytics Postgres (`postgresql://myampix:…@localhost:5432/myampix`)             |
| `CLICKHOUSE_URL/_USER/_PASSWORD/_DB`                       | event store connection                                                           |
| `REDIS_URL`                                                | **mandatory, no fallback** — auth sessions + rate limiting need it               |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`                 | sign/verify auth tokens — change for any real env                                |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` / `MFA_TOKEN_TTL` | token lifetimes (seconds)                                                        |
| `TOTP_ISSUER` / `TOTP_ENC_KEY`                             | 2FA; `TOTP_ENC_KEY` is a 32-byte hex key (`openssl rand -hex 32`)                |
| `COOKIE_SECURE` / `COOKIE_DOMAIN`                          | refresh-cookie flags — **production refuses to boot with `COOKIE_SECURE=false`** |
| `INGEST_MAX_BATCH` / `INGEST_MAX_BODY_KB`                  | ingestion limits                                                                 |
| `SCREENSHOT_MAX_KB`                                        | max size of an autocapture screenshot upload                                     |
| `FIREBASE_STORAGE_BUCKET`                                  | GCS bucket for screenshot bytes; unset → in-memory fake (dev/test)               |
| `GOOGLE_APPLICATION_CREDENTIALS`                           | service-account JSON path for Firebase Storage — **never commit it**             |
| `LOG_LEVEL`                                                | pino level; at `info`, 2xx/3xx request logs are suppressed                       |

### 5.2 mobile_purchase (`backend/mobile_purchase/.env`)

The `.env.example` is minimal; the full surface is defined in
`backend/mobile_purchase/src/config/app-config.ts`. Notable variables:

| Variable                      | Default                 | Purpose                                                                                                                                                           |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                        | `8090`                  | HTTP port                                                                                                                                                         |
| `DATABASE_URL`                | —                       | its **own** Postgres on `:5433`                                                                                                                                   |
| `ANALYTICS_INTERNAL_URL`      | `http://localhost:8088` | where it resolves project roles (it holds no JWT secret)                                                                                                          |
| `DASHBOARD_ORIGINS`           | `http://localhost:5173` | CORS allowlist for dashboard→purchase requests                                                                                                                    |
| `STORE_CREDENTIALS_ENC_KEY`   | (unset)                 | base64 32-byte key (`openssl rand -base64 32`) — AES-256 for stored store credentials. Absence only blocks the connect-store path, not boot. **Never commit it.** |
| `APPLE_BUNDLE_IDS`            | `com.myampix.app`       | comma-separated bundle IDs accepted from Apple ASSN v2                                                                                                            |
| `APPLE_APP_APPLE_ID`          | (unset)                 | App Store Connect numeric app id (required for Production)                                                                                                        |
| `APPLE_ROOT_CERT_DIR`         | in-repo `certs/`        | trust anchors for verifying Apple notifications                                                                                                                   |
| `GOOGLE_PUSH_AUTH_MODE`       | `shared_secret`         | `shared_secret` works today; `oidc` is deferred (X1)                                                                                                              |
| `GOOGLE_PUBSUB_SHARED_SECRET` | (unset)                 | token for Google Pub/Sub push auth — **unset ⇒ every push is rejected (401)**, never fail-open                                                                    |
| `SCHEDULER_ENABLED`           | `true`                  | master switch for cron jobs; set `false` in tests/workers                                                                                                         |
| `EXPIRY_SWEEP_CRON`           | `*/5 * * * *`           | how often expired subscriptions are swept                                                                                                                         |

> **Secrets rule:** never commit `.env`, `.p8`/`.p12`, service-account JSON, or any encryption key.
> Generate keys per-environment. The store-credentials key and Google shared secret are passed in
> via the environment only.

---

## 6. The backends

Both are NestJS 11 apps using Prisma 6. Each has its **own** Prisma schema and generated client, so
migrations and `prisma generate` are always run per-service with `--filter`.

### 6.1 mobile_analytics (the MyAmplitude backend)

Source modules (`backend/mobile_analytics/src/`):

- `ingestion/` — `POST /ingest/events`, `POST /ingest/profiles` (gzip batches from the SDK), token-authenticated. The token also decides the event's `source` (`client` or `server`) — see §6.1.1.
- `analytics/`, `cohorts/`, `dashboards/`, `reports/` — query APIs that power the dashboard's insights, funnels, retention, cohorts, and saved dashboards (backed by ClickHouse).
- `auth/` — email/password login, JWT access/refresh tokens, TOTP 2FA. Sessions + rate limiting use Redis.
- `orgs/`, `projects/`, `invitations/`, `authz/` — organizations, projects, membership, and per-project roles (owner/admin/member).
- `screenshots/` — reference-screenshot upload/serve for the user-path map + heatmaps (bytes to Firebase Storage, metadata in Postgres).
- `internal/` — the internal role-resolution endpoint `mobile_purchase` calls (`ANALYTICS_INTERNAL_URL`).
- `revenuecat/` — the **legacy** RevenueCat integration mirror. The active MyRevenueCat clone reads `mobile_purchase` instead; this remains for the old integration path.
- `clickhouse/`, `prisma/`, `redis/`, `health/`, `common/`, `config/`, `templates/` — infrastructure.

Data stores: **Postgres** (accounts, orgs, projects, tokens), **ClickHouse** (events, profiles,
identity mappings), **Redis** (sessions, rate limiting — mandatory).

#### 6.1.1 Client vs server attribution

A project can hold as many ingest tokens as it likes, and each one is minted as either a **client**
token (ships inside an app or web page — treat it as public) or a **server** token (lives on a
backend you control). Every event ingested with a token is stamped with that token's kind in the
`source` column of `analytics.events`.

The classification is taken from the authenticated token row, never from the request body: a payload
that sets `source` itself is ignored, so a leaked client token cannot pass its traffic off as
server-side. `source` is fixed when the token is created — rotating a token in the dashboard mints
the replacement with the same source, and changing it on a live token would silently re-label
everything sent after the change.

- **Creating one:** project → *SDK tokens* → pick Source, or `POST
  /api/v1/projects/:projectId/tokens` with `{"label": "...", "source": "client" | "server"}`.
  Omitting `source` yields `client`, which is also what every token minted before this feature is.
- **Using it:** `source` is a first-class query dimension — filter or break down any insight,
  funnel, retention or flow by it, and it appears in `GET /meta/properties` as a column.
- **RevenueCat webhooks** are recorded as `server`: they arrive machine-to-machine, with no device
  and no ingest token involved.

### 6.2 mobile_purchase (the MyRevenueCat backend / billing authority)

Source modules (`backend/mobile_purchase/src/`):

- `webhooks/apple/` — `POST /webhooks/apple`: verifies Apple **App Store Server Notifications v2** (signed JWS, using `@apple/app-store-server-library` and the trust-anchor certs).
- `webhooks/google/` — `POST /webhooks/google`: accepts Google **Real-Time Developer Notifications** (RTDN) pushed via Pub/Sub, authenticated by shared secret (`?token=…`, constant-time compared).
- `subscriptions/`, `subscribers/`, `customers/` — subscription state, the subscriber/customer records, and the searchable customer list the dashboard shows.
- `entitlements/` — entitlement definitions and **compute-on-read** entitlement resolution (a customer's active access is computed from their subscription state, not stored denormalized).
- `catalog/` — products, offerings, packages, and the per-app **store-credentials** connect flow (encrypted at rest with `STORE_CREDENTIALS_ENC_KEY`).
- `metrics/` — `GET …/metrics/summary`: MRR, active/trial counts, churn, by-product/by-store breakdowns, recent events — the MyRevenueCat Overview page.
- `receipts/`, `scheduler/` (the expiry sweep cron), `authz/`, `prisma/`, `config/`, `health/`, `common/`.

Data store: its **own Postgres** on `:5433`. It never reads the analytics databases.

**Store connection today vs. later:** the connect-stores UI stores Google Play / App Store
credentials per app, encrypted. Verifying purchases from **inbound webhooks** (Apple ASSN, Google
RTDN) works without those credentials. The **outbound** server-to-server calls to Apple/Google
(and OIDC Pub/Sub auth) are gated behind real credentials + the GCP deploy pipeline (tracked as
sub-project **X1**) — see §10.

---

## 7. The dashboard (frontend)

React 18 + TypeScript, TanStack Router + Query, Radix UI, Tailwind, Vite. Tests use Vitest + MSW.

**Run:** `pnpm --filter @myampix/dashboard dev` (→ http://localhost:5173).
**Build:** `pnpm --filter @myampix/dashboard build` (typecheck + Vite build).

**Runtime config** — the app reads `window.___MYAMPIX_CONFIG__` from
`dashboard/public/config.js`, which is loaded _before_ the bundle and **replaced at deploy time**,
so one static build runs against any backend:

```js
window.___MYAMPIX_CONFIG__ = {
  apiBaseUrl: '', // '' = same origin (Vite proxy in dev)
  purchaseApiBaseUrl: 'http://localhost:8090', // mobile_purchase origin (distinct backend)
};
```

`getRuntimeConfig()` merges these over defaults. `apiBaseUrl` targets `mobile_analytics`;
`purchaseApiBaseUrl` targets `mobile_purchase` (it must be an absolute origin in dev because both
backends expose `/api/v1/projects/:id/…` and can't share an origin).

**Navigation** is split into two tool groups: **MyAmplitude** (analytics — Home, insights,
funnels, retention, user paths, heatmaps, cohorts, dashboards) and **MyRevenueCat** (billing —
Overview, Conversion, Customers, Products, Offerings, Entitlements, Settings). The MyRevenueCat
pages read `mobile_purchase` directly and are always visible (no "connect RevenueCat" gate); the
only load gate is the project list resolving.

---

## 8. The mobile SDKs

Neither SDK is published to pub.dev; consume via `path:` (inside this monorepo) or `git:` (from
another repo). Both are safe-by-design: a failed `configure`/`init` disables the SDK rather than
crashing the host app.

### 8.1 myampix_analytics (`sdk/flutter_analytics`)

The full guide is [`HOW-TO-USE.md`](HOW-TO-USE.md). In short:

```dart
await MyAmpix.init(
  'mam_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',                 // project ingest token
  config: const MyAmpixConfig(serverUrl: 'http://localhost:8088'),
);
MyAmpix.instance.track('checkout_completed', properties: {'plan': 'pro', 'value': 9.99});
MyAmpix.instance.identify('user_42');
MyAmpix.instance.people.set({'plan': 'pro'});
```

- **Offline-first:** every call is written to a local queue before any network I/O, then batched and gzip-uploaded to `/ingest/events` + `/ingest/profiles` with exponential backoff.
- **Autocapture** (all `$`-prefixed, individually toggleable): screen views, taps/rage-taps, native in-app purchases, marketing attribution, and (debug-only, off by default) reference screenshots for the user-path map + heatmaps.
- **Token:** `pnpm dev` seeds the fixed demo token `mam_00000000000000000000000000000000`. Mint more via Prisma Studio (`Organization` → `Project` → `SdkToken`), token = `mam_` + 32 hex.
- **Android emulator:** use `http://10.0.2.2:8088` instead of `localhost`.

### 8.2 myampix_purchases (`sdk/flutter_purchases`)

A RevenueCat-style client for the `mobile_purchase` backend. Public surface (from
`lib/myampix_purchases.dart`): a static `MyAmpixPurchases` facade plus RevenueCat-shaped models
(`CustomerInfo`, `EntitlementInfo`, `Offering`/`Offerings`, `Package`, `StoreProduct`,
`PurchaseResult`, `PurchasesError`, `Store`, etc.).

```dart
import 'package:myampix_purchases/myampix_purchases.dart';

await MyAmpixPurchases.configure(
  const PurchasesConfiguration(
    apiKey: 'mp_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // public SDK key
    serverUrl: 'http://localhost:8090',               // mobile_purchase origin
    // appUserID: 'user_42',                           // optional; anonymous otherwise
    logLevel: MyAmpixLogLevel.warn,
  ),
);

final offerings = await MyAmpixPurchases.getOfferings();
final result    = await MyAmpixPurchases.purchasePackage(offerings.current!.availablePackages.first);
final info      = await MyAmpixPurchases.getCustomerInfo();   // entitlements
await MyAmpixPurchases.logIn('user_42');
await MyAmpixPurchases.restorePurchases();
MyAmpixPurchases.addCustomerInfoUpdateListener((info) { /* react to entitlement changes */ });
```

- Calls are **serialized** internally; the throwing read/purchase methods surface a typed `PurchasesError`, while internal machinery never throws into the host.
- **Example app:** `sdk/flutter_purchases/example` reads its config from `--dart-define`:
  `flutter run --dart-define=MP_API_KEY=mp_pub_… --dart-define=MP_SERVER_URL=http://localhost:8090`
  (use `http://10.0.2.2:8090` on the Android emulator). It runs with placeholder values too — the
  backend just returns `401`, which the demo catches and shows on screen.

> **Screen naming (both SDKs):** a screen name identifies a _layout_, not an _instance_. Give each
> route/tab a stable `RouteSettings(name: …)` (or call `trackScreen`/`retakeScreenshots` for
> non-route tabs) so detail pages share one reference screenshot. Put per-item IDs in event
> properties, not screen names.

---

## 9. How a purchase flows in (end to end)

For a project whose app has stores connected, a real purchase reaches MyRevenueCat automatically
via **webhooks** — no polling, and independent of whether the buyer ever opens the app again:

- **iOS / App Store:** Apple sends an **App Store Server Notification v2** to `POST /webhooks/apple`. `mobile_purchase` verifies the signed JWS against the trust-anchor certs and the configured bundle ID(s), records the transaction, and recomputes the customer's entitlements.
- **Android / Google Play:** Google publishes a **Real-Time Developer Notification** to a Pub/Sub topic that pushes to `POST /webhooks/google?token=…`. The shared-secret token is checked (constant-time); the notification updates subscription state and entitlements.

Entitlements are **computed on read**, so the customer's active access always reflects the latest
notification. The dashboard's MyRevenueCat pages (Overview/Customers/Conversion) read this state
from `mobile_purchase`.

**What still requires real credentials + the GCP deploy (X1):** outbound server-to-server calls to
the Google Play Developer API and App Store Server API, and OIDC-authenticated Pub/Sub. Until then
the store clients are scaffolded but gated (they raise a typed "credentials unavailable" error
rather than making a live call). Inbound webhook verification is the part that works pre-deploy.

---

## 10. Contributor guide

### 10.1 Root commands

| Command                        | Effect                                              |
| ------------------------------ | --------------------------------------------------- |
| `pnpm install`                 | install all workspaces                              |
| `pnpm dev`                     | run analytics backend + dashboard (see §3)          |
| `pnpm infra:up/down/reset`     | manage local databases                              |
| `pnpm seed`                    | seed the analytics demo project + token             |
| `pnpm typecheck`               | `typecheck` in every package that defines it        |
| `pnpm test`                    | `test` in every package that defines it             |
| `pnpm test:functional`         | `scripts/functional-test.sh` (black-box stack test) |
| `pnpm lint`                    | ESLint 9 (flat config) across the workspace         |
| `pnpm format` / `format:check` | Prettier 3 write / check                            |

### 10.2 Testing conventions

- **Backends:** Jest. Integration/e2e suites use **Testcontainers** (real Postgres in Docker), so Docker must be running. `mobile_analytics` splits `test` / `test:int` / `test:e2e`; run coverage with `test:cov`. In `mobile_purchase`, keep `SCHEDULER_ENABLED=false` in tests so cron jobs don't fire during Testcontainers teardown.
- **Dashboard:** **Vitest + MSW**. Run one file at a time when iterating (`pnpm --filter @myampix/dashboard test <path>`); Radix `Select` interactions can hang under jsdom, so prefer testing via role/text and avoid driving native-select-like popovers.
- **Coverage floors (CI-enforced):** backend 85%, SDK 85%, dashboard 75%.
- **CI** is path-filtered per package — a change under `dashboard/` doesn't run backend suites.

### 10.3 Working with Prisma (per service)

Each backend has its own schema/client. Always scope commands with `--filter`:

```bash
# analytics
pnpm --filter @myampix/mobile-analytics exec prisma migrate dev --name <change>
pnpm --filter @myampix/mobile-analytics exec prisma studio        # browse/edit rows

# purchase (its own Postgres on :5433)
pnpm --filter @myampix/mobile-purchase exec prisma migrate dev --name <change>
```

`prisma generate` runs automatically on install (`prepare` script). This monorepo uses pnpm — never
`npm install` in a package; add deps with `pnpm add <pkg> --filter <workspace>`.

### 10.4 Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`). Commit only when asked; never self-assign co-authorship.
- Timestamps are UTC; generated IDs are UUID v7.
- Shared contracts live in `packages/contracts` and `docs/superpowers/specs/2026-07-02-shared-contracts.md` — read before touching any cross-service interface.
- Design specs + implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

### 10.5 Development workflow (SDD)

Feature work follows subagent-driven development: brainstorm → spec → plan → implement→review→fix
per task, tracked in a progress ledger. Specs and plans are checked into `docs/superpowers/`. The
in-progress program of record for MyRevenueCat is the RevenueCat **parity** track — a full clone
that makes `mobile_purchase` the billing authority — broken into sub-projects with a defined build
order (starting with **X1**, the GCP deploy pipeline, which unblocks live store credentials and
outbound Apple/Google calls).

### 10.6 Knowledge graph

The repo ships a code knowledge graph in `graphify-out/`. For codebase questions prefer
`graphify query "<question>"` (a scoped subgraph) over raw grep; `graphify update .` after code
changes keeps it current (AST-only, no API cost).

---

## 11. Troubleshooting

| Symptom                                            | Cause / fix                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Login returns **500**                              | Redis is down. `REDIS_URL` is mandatory with no fallback → `pnpm infra:up`.                                                          |
| MyRevenueCat pages **404** / fail to load          | `mobile_purchase` isn't running, or `purchaseApiBaseUrl` doesn't point at it. Start it (§4.3); confirm `dashboard/public/config.js`. |
| `mobile_purchase` **won't boot**, lists env errors | Zod validation failed — the log lists every bad/missing var at once. Fix them (§5.2).                                                |
| Every Google webhook is **rejected (401)**         | `GOOGLE_PUBSUB_SHARED_SECRET` is unset — that's fail-closed by design. Set it and match the Pub/Sub push `?token=`.                  |
| Connect-stores flow errors on save                 | `STORE_CREDENTIALS_ENC_KEY` missing/invalid — must be base64 that decodes to 32 bytes (`openssl rand -base64 32`).                   |
| SDK ingest returns **401**                         | Wrong/missing token, or it isn't `mam_` + 32 hex. Use the seeded demo token or mint one via Prisma Studio.                           |
| Events never reach ClickHouse                      | Check the token, that the stack is up, and that `serverUrl` is reachable from the device (`10.0.2.2` on Android emulator).           |
| Integration/e2e tests fail at teardown             | Docker not running (Testcontainers), or `mobile_purchase` cron firing in tests — set `SCHEDULER_ENABLED=false`.                      |
| Prisma engine ABI / OpenSSL error in a built image | The build image needs system `openssl`; run as non-root. (Relevant to the `mobile_purchase` container build.)                        |

Verify the data stores directly:

```bash
curl http://localhost:8123/ping    # → Ok.  (ClickHouse)
docker compose -f infra/docker-compose.yml exec clickhouse \
  clickhouse-client --user default --password myampix_dev --database analytics \
  --query "SELECT event, count() FROM events GROUP BY event"
# Postgres: browse via Adminer at http://localhost:8082
```

---

## 12. Production deployment (k3s on a VPS)

Everything deploys to a single self-managed VPS — no cloud services, no paid SaaS:

- **k3s** runs the app workloads: `mobile-analytics` (HPA 2–6), `mobile-purchase-api` (HPA 2–4),
  `mobile-purchase-scheduler` (exactly 1, `Recreate`), `dashboard` (nginx), `admin` (ops console) —
  behind the bundled Traefik with cert-manager/Let's Encrypt TLS for
  `api.` / `purchase.` / `app.` / `admin.<domain>`.
- **Datastores stay in Docker Compose on the host** (`infra/docker-compose.prod.yml` overlay binds
  them to the VPS private IP only); pods reach them through selector-less Services + EndpointSlices
  under the same hostnames as local Compose.
- **Migrations gate every rollout**: Helm `pre-install/pre-upgrade` hook Jobs run
  `prisma migrate deploy` per service; a failed migration aborts and rolls back the release.
- **Images**: `.github/workflows/images.yml` builds 6 images to GHCR on push to `main`
  (`myampix-{mobile-analytics,mobile-purchase,mobile-purchase-migrate,dashboard,admin,admin-migrate}`).
  Deploys are manual: `scripts/k8s/deploy.sh sha-<7>`.
- **Chart**: `infra/helm/myampix` (values → `infra/values.prod.yaml`, gitignored). Secrets are
  created out-of-band by `scripts/k8s/secrets.sh` from gitignored env files under
  `infra/k8s/secrets/` — the chart never renders a Secret.
- **Verification**: `pnpm k8s:lint` (helm lint + kubeconform + design invariants) and
  `pnpm k8s:local` (full-stack smoke test in kind, browsable at `http://*.localhost:8089`).

Step-by-step operator guide: [`docs/runbooks/vps-k3s.md`](docs/runbooks/vps-k3s.md). Design:
`docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md`.

## 13. Admin/ops console

`admin/` (`@myampix/admin`) is a separate Next.js App Router app at `admin.<domain>` — the
operations counterpart to the product dashboard:

- **Monitoring**: node CPU/RAM/disk + uptime (metrics-server / kubelet), Kubernetes workloads
  (deployments, HPAs, pods, jobs, warning events, certificate expiries), host Docker containers
  (read-only `docker.sock`, values-gated), and direct Postgres/ClickHouse/Redis probes.
- **Metrics page**: time-series charts (axes, gridlines, hover tooltips; 1h/6h/24h/7d ranges) for
  node CPU/RAM/disk (percent and absolute), pod counts, restarts, per-deployment/HPA replicas,
  service health latency, Postgres sizes/connections, Redis memory/keys, ClickHouse disk, and the
  host Docker container count.
- **Logs page**: browse the live logs of every service — Kubernetes pods in the release namespace
  (per container, with a "previous container" option for crash loops) and, when the socket is
  mounted, the host Docker containers. Tail size, time window, text filter, 5 s follow mode.
- **Alerting & history**: an in-process sampler snapshots metrics every 5 min (7-day retention);
  fixed rules (CPU>90 %, mem>90 %, disk>85 %, store/service down, degraded deployment,
  cert <14 days) open/close alerts with a 2-tick flap guard, optional Slack/Discord-style
  `ALERT_WEBHOOK_URL`, 24 h sparklines on the overview.
- **Ops actions**: restart / scale deployments (type-the-name confirmation, namespaced write Role
  only — the cluster-wide role stays read-only; HPA-managed deployments refuse manual scale).
- **Auth**: own `admin_console` Postgres database; argon2id passwords, server-side sessions
  (`__Host-` cookie, idle+absolute expiry), per-account+per-IP lockout, TOTP 2FA with recovery
  codes (secrets AES-256-GCM-encrypted via `TOTP_ENC_KEY`), forced first-login password change,
  in-app user management (no self-registration), full audit log.
- **Dev**: `pnpm --filter @myampix/admin dev` (port 3100; needs `DATABASE_URL` for the
  `admin_console` DB on local Compose Postgres), `test`, `typecheck`, `build`.

Design: `docs/superpowers/specs/2026-08-24-admin-console-design.md` (v1) and
`…-admin-console-v2-design.md` (2FA, ops actions, alerting).
