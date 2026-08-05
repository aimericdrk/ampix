# MyAmpix — Setup Guide

Everything you need to stand up MyAmpix locally and to enable each feature end to end. This is the
**operational** companion to [`DOCUMENTATION.md`](DOCUMENTATION.md) (which explains *what* each part
is) — here we cover *how to get it running and how to turn features on*, grounded in the actual
code. For per-project detail see each package's own `README.md`; for the analytics SDK in depth see
[`HOW-TO-USE.md`](HOW-TO-USE.md).

Every value below is traceable to a real file — file paths are cited for the non-obvious ones.

## Contents

1. [Prerequisites & first-run setup](#1-prerequisites--first-run-setup)
2. [mobile_analytics setup](#2-mobile_analytics-setup)
3. [Screenshots setup (end to end)](#3-screenshots-setup-end-to-end)
4. [mobile_purchase setup](#4-mobile_purchase-setup)
5. [Dashboard setup](#5-dashboard-setup)
6. [Mobile SDK setup](#6-mobile-sdk-setup)

> **Secrets rule (applies everywhere):** never commit `.env`, encryption keys, shared secrets,
> `.p8`/`.p12`, or service-account JSON. Where a real secret is needed, this guide shows how to
> *generate* one. The checked-in `.env.example` values are dev-only.

---

## 1. Prerequisites & first-run setup

### 0. Toolchain prerequisites

| Tool | Required version | Source |
|------|------------------|--------|
| Node.js | `>=22 <23` (repo pins **22** via `.nvmrc`) | root `package.json` `engines`, `.nvmrc` |
| pnpm | `>=10` (repo pins **10.12.1**) | root `package.json` `engines` + `packageManager` |
| Docker | daemon must be running | `scripts/dev.sh` checks `docker info` |
| tmux | optional (gives the split-pane dev view) | `scripts/dev.sh` (falls back to labeled interleaved logs) |
| Flutter | 3.32+ / Dart 3.8+ | only for building/running the SDKs |

```bash
# Node 22 (nvm respects the repo's .nvmrc)
nvm install && nvm use          # reads .nvmrc → 22

# pnpm 10 comes from Corepack (bundled with Node) — do NOT `npm i -g pnpm`
corepack enable                 # scripts/dev.sh errors "run 'corepack enable'" if pnpm is missing

# Docker Desktop must be installed AND running:
docker info                     # must succeed; dev.sh aborts otherwise
```

### 1. Install workspace dependencies (once)

From the repo root — this is a pnpm workspace, install hoists all packages:

```bash
pnpm install
```

Prisma client/engines are the only packages allowed to run install scripts (root `package.json` →
`pnpm.onlyBuiltDependencies`). `pnpm dev` auto-runs `pnpm install` if `node_modules` is absent
(`scripts/dev.sh` step 1).

### 2. Backend env file

`scripts/dev.sh` auto-creates it on first run:

```bash
cp backend/mobile_analytics/.env.example backend/mobile_analytics/.env
```

The defaults already match the Docker infra below, so no edits are needed for local dev. Key values:

```ini
PORT=8088
DATABASE_URL=postgresql://myampix:myampix_dev@localhost:5432/myampix
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=myampix_dev
CLICKHOUSE_DB=analytics
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev_only_change_me_dev_only_change_me
JWT_REFRESH_SECRET=dev_only_change_me_dev_only_change_yes
TOTP_ENC_KEY=<64 hex chars>     # AES-256-GCM key for TOTP secrets
COOKIE_SECURE=false             # NODE_ENV=production REFUSES to boot unless this is true
FIREBASE_STORAGE_BUCKET=        # empty → in-memory fake store, screenshots NOT persisted
```

For any non-local environment, generate fresh secrets (never commit them):

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / TOTP_ENC_KEY (64 hex chars each)
```

### 3. Start infrastructure (Docker)

`infra/docker-compose.yml` (compose project name `myampix`) brings up 6 services with healthchecks:

| Service | Host port | Credentials / notes |
|---------|-----------|---------------------|
| clickhouse | `8123` (HTTP), `9000` (native) | user `default` / pass `myampix_dev`, db `analytics`. Mounts `infra/clickhouse/init.sql` → `/docker-entrypoint-initdb.d/init.sql` (creates the analytics tables on first boot) |
| postgres | `5432` | user `myampix` / pass `myampix_dev`, db `myampix` (analytics service) |
| redis | `6379` | append-only enabled (rate limiting) |
| mobile-purchase-postgres | `5433`→5432 | **separate** DB for the purchase service: user `mobile_purchase` / pass `mobile_purchase_dev`, db `mobile_purchase` |
| adminer | `8082`→8080 | Postgres web UI, dracula theme |
| ch-ui | `5521` | ClickHouse web UI (pre-filled connection to `:8123`) |

Named volumes persist data: `clickhouse_data`, `postgres_data`, `redis_data`, `mobile_purchase_postgres_data`.

```bash
pnpm infra:up      # docker compose ... up -d --wait  (blocks until healthchecks pass)
pnpm infra:down    # stop containers, KEEP volumes/data
pnpm infra:reset   # down -v — DESTROYS all volumes (fresh ClickHouse re-runs init.sql)
```

### 4. Apply migrations + seed (analytics)

`pnpm dev` runs these automatically; to run manually:

```bash
# Postgres schema (Prisma migrate deploy)
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy

# Demo org + project + ingest token (idempotent)
pnpm seed          # === prisma db seed, wired via "prisma": { "seed": "node prisma/seed.mjs" }
```

`backend/mobile_analytics/prisma/seed.mjs` creates **Demo Org → project "Demo App" (UTC) → one SDK
token**. The exact seeded token (`seed.mjs:11`) is:

```
mam_a5857ba6d091bf8f6c96d7f84f0b35db
```

This is a LOCAL DEV credential only — never ship it. Token format is `mam_` + 32 lowercase hex
(`src/common/sdk-token.ts` → `generateSdkToken()`).

> **Example-token mismatch (heads up):** the Flutter examples are pinned to *different* tokens than
> the seed — `sdk/flutter_analytics/example` uses `mam_d9593ad7de03856e2fab8c97d1a9d7fd` and
> `sdk/flutter_purchases/example` uses `mam_7ac0cf0b5c861de45b250f777206a041`, both with
> `serverUrl` defaulting to `http://localhost:8088`. If an example's uploads/calls return **401**,
> reconcile: either mint the example's token (see §7) or point the example at the seeded
> `mam_a5857…` value. On the Android emulator, change the host from `localhost` to `10.0.2.2`.

The mobile-purchase service has its own Prisma schema/DB (port 5433); migrate it separately:

```bash
pnpm --filter @myampix/mobile-purchase exec prisma migrate deploy   # DATABASE_URL → :5433
```

### 5. One-command run vs manual

```bash
pnpm dev
```

`scripts/dev.sh` does, in order: verify docker+pnpm → `pnpm install` (if needed) → create `.env` →
`infra:up --wait` → `prisma migrate deploy` → `prisma db seed` → launch **backend on :8088** and
**dashboard on :5173**. With tmux it opens a split session `myampix-dev`; without tmux it
interleaves `[backend]`/`[web]` labeled logs. Ctrl-C stops the app processes only — **databases keep
running** (stop with `pnpm infra:down`).

`pnpm dev` does **not** start the mobile-purchase service. Run it standalone when needed:

```bash
pnpm --filter @myampix/mobile-purchase start:dev    # http://localhost:8090
```

Manual equivalent of `pnpm dev`:

```bash
pnpm infra:up
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy
pnpm seed
pnpm --filter @myampix/mobile-analytics start:dev   # backend :8088
pnpm --filter dashboard dev                         # dashboard :5173 (Vite proxies /api + /ingest → :8088)
```

### 6. Verify the stack

```bash
curl http://localhost:8123/ping                       # → "Ok."  (ClickHouse)
curl -u default:myampix_dev 'http://localhost:8123/?query=SELECT%201'   # → 1
curl http://localhost:8088/api/v1/health              # backend health

# Ingest smoke test with the seeded token (expect 202 Accepted)
curl -i -X POST http://localhost:8088/ingest/events \
  -H "Authorization: Bearer mam_a5857ba6d091bf8f6c96d7f84f0b35db" \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"name":"test"}]}'
```

Web explorers: **Adminer** http://localhost:8082 (System `PostgreSQL`, Server `postgres`, user
`myampix`, pass `myampix_dev`, db `myampix`); **ch-ui** http://localhost:5521.

### 7. Create your own account / org / project (dashboard path)

The seed exists only so the SDK example works out of the box. To use the product as a real user,
sign up through the dashboard (http://localhost:5173) or the auth API (`src/auth/controllers/auth.controller.ts`, base `api/v1/auth`):

```bash
# Sign up (email + password ≥8 chars + name) — returns access_token + sets mam_refresh cookie
curl -s -X POST http://localhost:8088/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"supersecret","name":"You"}'
```

Signup provisions the user's org. Create projects and mint ingest tokens through the authenticated
API (attach `Authorization: Bearer <access_token>`):

```bash
# Create a project in an org  (POST /api/v1/orgs/:orgId/projects — role: admin)
curl -X POST http://localhost:8088/api/v1/orgs/<orgId>/projects \
  -H "Authorization: Bearer <access_token>" -H 'Content-Type: application/json' \
  -d '{"name":"My App","timezone":"UTC"}'

# Mint a new ingest token  (POST /api/v1/projects/:projectId/tokens — project role: admin)
curl -X POST http://localhost:8088/api/v1/projects/<projectId>/tokens \
  -H "Authorization: Bearer <access_token>" -H 'Content-Type: application/json' \
  -d '{"label":"production"}'
# → { token: "mam_<32hex>", ... }  — copy it into your SDK config
```

Token endpoints (`src/projects/core/projects.controller.ts`):
`GET/POST /api/v1/projects/:projectId/tokens`, `DELETE .../tokens/:tokenId` to revoke. You can also
inspect/insert tokens via Prisma Studio (`pnpm --filter @myampix/mobile-analytics exec prisma studio`)
or Adminer against the `SdkToken` table.

---

## 2. mobile_analytics setup

NestJS 11 backend for **MyAmplitude** — SDK ingestion, analytics queries, auth (JWT + TOTP 2FA),
orgs/projects/roles, and the internal role-resolver `mobile_purchase` calls. Package
`@myampix/mobile-analytics`, port **8088**. Data stores: Postgres (accounts/orgs/projects/tokens),
ClickHouse (events/profiles/identity), Redis (sessions + rate limiting — **mandatory, no fallback**).

### 0. Prerequisites

- Node **22**, `corepack`/pnpm, Docker running (infra + Testcontainers).
- `pnpm infra:up` from the repo root starts ClickHouse (8123/9000), Postgres (5432), Redis (6379), Adminer (8082), ch-ui.
- **ClickHouse schema is created by infra, not by this service.** On first `infra:up`,
  `infra/clickhouse/init.sql` runs once, creating db `analytics` plus `events`, `user_profiles`,
  `identity_mappings`, and the rollup MVs. There is no ClickHouse migration step in the backend — it
  only reads/writes these tables. (If the CH data volume already exists, `init.sql` will NOT re-run;
  `pnpm infra:reset` wipes volumes to re-init.)

### 1. Environment file

```bash
cp backend/mobile_analytics/.env.example backend/mobile_analytics/.env   # first time only
```

`src/main.ts` calls `process.loadEnvFile()` at the top (before any import reads `process.env`). It
loads `.env` for local dev; **real environment variables always win** (`loadEnvFile` never overrides
an already-set var), and prod/CI with no `.env` falls through to the real environment silently.

The env is validated at boot by `loadConfig()` (`src/config/app-config.ts`). Validation
**aggregates every problem** into one thrown `Error` — a bad config shows all broken vars at once and
the process refuses to start. Unknown env keys are ignored.

### 2. Every meaningful env var

Traceable to the Zod schema + `collectCrossFieldProblems()` in `src/config/app-config.ts`.

**Core / infra**

| Var | Rule (schema) | Default | Breaks if wrong/missing |
|---|---|---|---|
| `NODE_ENV` | `development` \| `test` \| `production` | `development` | Selects prod hard-checks, dev TTL boost, pino transport |
| `PORT` | int 1–65535 | `8088` | App binds elsewhere; SDK/dashboard can't reach it |
| `DATABASE_URL` | matches `^postgresql://` | — (required) | Boot fails; Prisma can't connect. Dev: `postgresql://myampix:myampix_dev@localhost:5432/myampix` |
| `CLICKHOUSE_URL` | valid `http(s)://` | — (required) | Boot fails; analytics queries + ingest writes fail. Dev: `http://localhost:8123` |
| `CLICKHOUSE_USER` | min 1 | — (required) | Boot fails. Dev: `default` |
| `CLICKHOUSE_PASSWORD` | string (may be empty) | — (required key) | Auth failures to CH. Dev: `myampix_dev` |
| `CLICKHOUSE_DB` | min 1 | — (required) | Wrong DB → queries hit missing tables. Dev: `analytics` |
| `REDIS_URL` | valid `redis://`/`rediss://` | — (required) | **Boot fails.** No in-memory fallback. Powers sessions, ingest rate-limiter, 2FA pending secret + attempt limiter, refresh-token store. Dev: `redis://localhost:6379` |

**JWT + token TTLs** (`src/auth/services/auth-config.util.ts`)

| Var | Rule | Default | Notes |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | min 32 chars | — | **Required unless `NODE_ENV=test`.** Signs/verifies access tokens |
| `JWT_REFRESH_SECRET` | min 32 chars | — | **Required unless `NODE_ENV=test`.** Also signs the interim `mfa_token` — different secret from access so a purpose-check bug can't make them interchangeable |
| `ACCESS_TOKEN_TTL` | int seconds | `900` | See dev boost below |
| `REFRESH_TOKEN_TTL` | int seconds | `2592000` (30d) | Also sets the refresh cookie `maxAge` |
| `MFA_TOKEN_TTL` | int seconds | `300` | Lifetime of the interim `mfa_token` between `login` and `2fa/verify` |

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET  (>=32 chars)
openssl rand -base64 48   # JWT_REFRESH_SECRET (must differ)
```

**Dev-only TTL boost:** when `NODE_ENV=development` *and* `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL` are
unset, `loadConfig()` swaps in 30-day access / 1-year refresh TTLs so a coding session doesn't keep
bouncing to login. Setting either var explicitly, or any non-dev `NODE_ENV`, disables the boost.

**TOTP 2FA** (`src/auth/two-factor/`, `src/auth/crypto/aes-gcm.ts`)

| Var | Rule | Default | Notes |
|---|---|---|---|
| `TOTP_ISSUER` | min 1 | `MyAmpix` | Label in the authenticator app (`otpauth://` issuer) |
| `TOTP_ENC_KEY` | must decode to **exactly 32 bytes** (64 hex or base64) | — | **Required unless `NODE_ENV=test`.** AES-256-GCM key for TOTP secrets at rest + the encrypted pending secret in Redis. Wrong length → boot fails |

```bash
openssl rand -hex 32      # 64 hex chars = 32 bytes → TOTP_ENC_KEY
```

**Cookie flags** (`src/auth/tokens/cookies.ts`)

| Var | Rule | Default | Notes |
|---|---|---|---|
| `COOKIE_SECURE` | truthy = `true`/`1` | `false` | The `mam_refresh` cookie is `httpOnly`, `sameSite=lax`, `path=/api/v1/auth`. **Hard boot check:** `NODE_ENV=production` with `COOKIE_SECURE` not truthy → app refuses to boot. Keep `false` only for localhost HTTP dev |
| `COOKIE_DOMAIN` | optional | unset | Cookie `Domain`; leave empty for localhost |

**Ingestion limits**

| Var | Rule | Default | Notes |
|---|---|---|---|
| `INGEST_MAX_BATCH` | positive int | `100` | Max events/profiles per batch |
| `INGEST_MAX_BODY_KB` | positive int | `1024` | Wired into the JSON body parser in `main.ts` |
| `INGEST_RATE_LIMIT_PER_MIN` | positive int | `1000` | Not in `.env.example`; override exists mainly for tests. Ingest limiter fails **open** on a Redis error (availability > throttling for analytics) |

**Screenshots** (see §3): `SCREENSHOT_MAX_KB` (default 512), `FIREBASE_STORAGE_BUCKET` (unset → in-memory fake + warning; bytes not persisted), `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON path — never commit).

**Logging** (`LOG_LEVEL`, `src/app.module.ts`) — enum `fatal|error|warn|info|debug|trace|silent`,
default `info`. At `info`, successful **2xx/3xx** request logs are demoted to `debug` (filtered);
app logs and **4xx/5xx** request logs still surface. pino redacts `req.headers.authorization`;
`pino-pretty` is used **only** when `NODE_ENV=development` (other envs emit JSON).

**Ask-your-data (Mistral)** — read by config, not in `.env.example`, both optional: `MISTRAL_API_KEY`
(unset → feature returns 503, not a boot error), `MISTRAL_MODEL` (default `mistral-small-latest`).

### 3. Production-vs-dev enforcement (at boot)

- **`NODE_ENV=test`** relaxes the three "required" secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOTP_ENC_KEY`). In dev/production all three are required.
- **`NODE_ENV=production`** additionally requires `COOKIE_SECURE` truthy — otherwise the process throws and exits.
- Boot logs a **redacted** effective config (`describeConfig` — secrets shown only as `set`/`MISSING`, DB URL host/name only, never the password).

### 4. Migrations + demo seed

Prisma owns Postgres only (`prisma generate` runs on install via `prepare`):

```bash
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy   # apply migrations
pnpm --filter @myampix/mobile-analytics exec prisma db seed          # demo org/project + token
```

The seed creates the fixed demo ingest token `mam_a5857ba6d091bf8f6c96d7f84f0b35db` (see §1.4).
Evolve the schema in dev with `prisma migrate dev --name <change>`; browse rows with `prisma studio`.

### 5. Run

```bash
pnpm --filter @myampix/mobile-analytics start:dev     # watch → http://localhost:8088
# production:
pnpm --filter @myampix/mobile-analytics build && pnpm --filter @myampix/mobile-analytics start
```

Health probes: `GET /health` (liveness, no I/O) and `GET /health/ready` (probes Postgres +
ClickHouse + Redis, each bounded at 2500ms, 503 if any is down).

### 6. TOTP 2FA setup flow (`/api/v1/auth`, JWT-guarded)

`src/auth/controllers/auth.controller.ts`. Enrolling a user:

1. **`POST /2fa/setup`** → generates a TOTP secret, stores it **encrypted** in Redis as `2fa:pending:<userId>` (10-min TTL), returns `{ otpauth_url, secret, qr_data_url }`. The URI uses `TOTP_ISSUER` + the user's email.
2. User scans the QR (RFC 6238 defaults: 30s step, 6 digits, SHA-1; verify tolerates ±1 step).
3. **`POST /2fa/activate`** `{ code }` → verifies against the pending secret, persists it (AES-256-GCM, `TOTP_ENC_KEY`) to `users.totp_secret`, clears the pending key, returns one-time `recovery_codes`.
4. **`POST /2fa/disable`** `{ code }` → requires a valid active TOTP/recovery code, then disables.

Login with 2FA on: **`POST /login`** returns `{ mfa_required: true, mfa_token }` (signed with
`JWT_REFRESH_SECRET`, `MFA_TOKEN_TTL`); client then calls **`POST /2fa/verify`** `{ mfa_token, code }`
for the access token + refresh cookie.

**Brute-force throttle** (`two-factor-attempt-limiter.ts`): `verify`/`activate`/`disable` limited to
**10 attempts / 5 min per user** in Redis. Unlike the ingest limiter this **fails CLOSED** — any
Redis error denies with 503; over-limit returns 429 with `Retry-After`.

---

## 3. Screenshots setup (end to end)

Reference screenshots are a **developer debug tool**, not a per-user feature: the SDK only ever
captures in **debug builds** (`kDebugMode`) and only when you opt in. Each screen is captured **once
per `(screen_name, app_version)`**, uploaded to become the project's *admin reference image* that
powers the dashboard's user-path map + click heatmaps. A release build never captures or uploads.

Full path: **SDK flag + `MyAmpixTracker` + named routes → `POST /ingest/screenshots` → Postgres
metadata + Firebase bytes → dashboard Screens view / retake.**

### 1. SDK side (`sdk/flutter_analytics`)

**Enable the flag.** `autocaptureScreenshots` defaults to `false` (`lib/src/config.dart`). Turn it
on in a debug build:

```dart
await MyAmpix.init(
  '<SDK_INGEST_TOKEN>',                     // same mam_ token used for POST /ingest/events
  config: const MyAmpixConfig(
    serverUrl: 'http://localhost:8088',      // mobile_analytics :8088
    autocaptureScreenshots: true,            // off by default
    screenshotSettleDelay: Duration(seconds: 2), // default 1s; raise for slow transitions
    debug: true,                             // optional: see skip/upload logs
  ),
);
```

Even with the flag `true`, wiring only happens when `kDebugMode` is true (`lib/src/myampix.dart`):
`wantScreenshots = config.autocaptureScreenshots && (kDebugMode || <test seam>)`. A release build
silently skips capture — the intended safety property (bounded storage, no PII from the wild).

**Wrap the app in `MyAmpixTracker`.** Capture renders a root `RepaintBoundary`; `MyAmpixTracker`
installs a keyed full-screen boundary (`myampixScreenshotBoundaryKey`) around your subtree
(`lib/src/autocapture/myampix_tracker.dart`). Without it, the capturer falls back to the *largest*
`RenderRepaintBoundary` on screen (less reliable), so mount the tracker:

```dart
runApp(MyAmpixTracker(child: MyApp()));
```

**Attach the observer and NAME every route.** Capture is triggered from `$screen_view`
(`myampix.dart` → `_maybeCaptureScreenshot`). `$screen_view` comes from `MyAmpixObserver` (a
`NavigatorObserver`) which derives the screen name from `route.settings.name`, falling back to the
route's runtime type. Unnamed routes produce useless names like `MaterialPageRoute<...>`, and — since
the capture throttle key is `(screen_name, app_version)` — **stable, unique names are the rule**:

```dart
MaterialApp(
  navigatorObservers: [MyAmpixObserver()],
  onGenerateRoute: (s) => MaterialPageRoute(
    settings: RouteSettings(name: s.name), // <-- required for a real screen name
    builder: ...,
  ),
);
```

**Non-route navigation (bottom-nav tabs, `IndexedStack`, `PageView`)** — no `$screen_view` fires, so
every tab collapses into one screen. Call `trackScreen` on each switch:

```dart
MyAmpix.instance.trackScreen('home_tab'); // emits $screen_view + triggers capture
```

Use **stable names per layout**: one name per real screen/tab; group dynamic detail screens under one
name (e.g. `product_detail`) and put per-item ids in event properties.

**Mask PII with `MyAmpixPrivacy`.** Wrap sensitive widgets; the region renders normally on screen but
is painted solid black in the *uploaded* image only (`lib/src/autocapture/myampix_privacy.dart`):

```dart
MyAmpixPrivacy(child: TextField(controller: emailController));
```

**What the capturer does** (`screenshot_capturer.dart`): waits for the UI to stop animating (polls
`hasScheduledFrame`, capped at 2.5s) *on top of* `screenshotSettleDelay`; renders the boundary;
downscales to **≤ 640 px longest side**; blacks out privacy regions; encodes **JPEG q≈70**. Never
throws — any failure yields no screenshot.

**Upload** (`screenshot_autocapture.dart`): `POST {serverUrl}/ingest/screenshots`,
`multipart/form-data`, `Authorization: Bearer <token>`, fields `screen_name`, `app_version`,
`width`, `height`, `image_hash` (sha256), file part `image` (`image/jpeg`). A `202` marks the pair
captured (persisted locally) so it never re-uploads that version; a new `app_version` re-captures
every screen once.

**Retake:** `await MyAmpix.instance.retakeScreenshots()` clears the persisted markers for the current
app version so each screen re-captures on its next `$screen_view` (backend upserts, replacing the
image). No-op in release builds / when the flag is off.

### 2. Backend side (`backend/mobile_analytics`, :8088)

**Ingest endpoint** `POST /ingest/screenshots` (`src/screenshots/screenshots-ingest.controller.ts`):
guarded by `SdkTokenGuard` + `IngestRateLimitGuard` (same auth/rate-limit as `/ingest/events`).
Parses the multipart file (multer memory storage, hard cap 8 MiB) + fields, then
`ScreenshotsService.store(...)` → `202 {"stored": true}`.

**Validation** (`screenshots.service.ts`): content-type must be `image/jpeg` (else 415); size ≤
`SCREENSHOT_MAX_KB * 1024` (else 413); `screen_name` + `app_version` required (else 400).

| Env var | Default | Effect |
|---|---|---|
| `SCREENSHOT_MAX_KB` | `512` | Per-image size cap (KB) → 413 when exceeded |
| `FIREBASE_STORAGE_BUCKET` | *(unset)* | **Unset ⇒ in-memory fake store** — bytes NOT persisted across restarts, logs a warning. Set ⇒ persist to Firebase/GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | *(unset)* | Path to service-account JSON; read by `firebase-admin` via ADC |

**Metadata vs bytes split** (`screenshots.service.ts`): the image **bytes** go to object storage;
**Postgres holds only metadata** + the object path. Storage adapter chosen at boot
(`storage/screenshot-storage.provider.ts`):

- `FIREBASE_STORAGE_BUCKET` unset → `InMemoryScreenshotStorage` + warning: *"…using the in-memory screenshot store (dev/test). Screenshot bytes are NOT persisted across restarts."* (Metadata rows survive, but `GET .../image` 404s after restart because the object is gone.)
- Set → `FirebaseScreenshotStorage`, credentials from `applicationDefault()` (`GOOGLE_APPLICATION_CREDENTIALS` or ADC). A Firebase init failure degrades back to in-memory rather than crashing boot.

Bytes are written to a tenant-isolated path `{orgId}/{projectId}/screen/{screen_name}/{app_version}.jpg`,
then the metadata row is UPSERTed on the unique triple `(projectId, screenName, appVersion)` — exactly
one image per version. A put failure returns **502** (never persists a dangling metadata row).

**Boot self-check** (`onModuleInit`): when a bucket is configured, `storage.probe()` round-trips to
GCS; success logs `✓ Firebase Storage reachable: gs://<bucket>`, failure logs a loud `✗ ... NOT
reachable ...` so bad creds/wrong bucket surface at startup, not on first upload.

**Dashboard read endpoints** (`src/screenshots/screens.controller.ts`, JWT-guarded, membership viewer+):

- `GET /api/v1/projects/:projectId/screens` → screen catalog (`capture_count`, `latest_image_hash`, `latest_app_version`, dims).
- `GET /api/v1/projects/:projectId/screens/:screenName/image?app_version=&hash=` → streams the JPEG (`Cache-Control: private, max-age=300`).
- `DELETE /api/v1/projects/:projectId/screens/:screenName?app_version=` → **analyst+**; deletes object(s) + metadata (`204` even if nothing matched).

### 3. Dashboard side (`dashboard`, :5173)

React Query hooks (`src/features/analytics/api.ts`): `useScreens` (catalog), `useScreenImageBlob`
(fetches the membership-gated image via authed transport → object URL, content-addressed by
`image_hash` so a retake busts the cache), `useDeleteScreen`.

- `ScreenImage.tsx` renders the fetched blob with a "No screenshot yet" fallback (also the base layer for the click-heatmap overlay).
- `RetakeScreenButton.tsx` is the retake/delete control: there is **no re-capture button in the dashboard** — the dashboard only DELETEs an outdated reference image (two-step inline confirm, analyst+). To get the image back you re-capture from the SDK.

### End-to-end "enable screenshots" runbook

1. **Bring up infra + the analytics backend** (`pnpm dev` starts analytics + dashboard).
2. **Decide persistence.**
   - *Quick local check (bytes ephemeral):* leave `FIREBASE_STORAGE_BUCKET` unset. Uploads 202 and metadata rows appear, but images vanish on backend restart (the warning tells you so).
   - *Persist images:* set in the backend env:
     ```bash
     export FIREBASE_STORAGE_BUCKET="my-project.appspot.com"
     export GOOGLE_APPLICATION_CREDENTIALS="/abs/path/service-account.json"  # never commit
     export SCREENSHOT_MAX_KB=512   # optional
     ```
     Confirm the boot log line `✓ Firebase Storage reachable: gs://<bucket>`.
3. **Build the Flutter app in DEBUG** with `autocaptureScreenshots: true`, `serverUrl` at the backend, and the SDK ingest token (release builds never capture — intentional).
4. **Wire the SDK:** `runApp(MyAmpixTracker(child: MyApp()))`, add `MyAmpixObserver()` to `navigatorObservers`, give every route `RouteSettings(name: ...)`, call `trackScreen('<stable_name>')` for tabs/`IndexedStack`/`PageView`, wrap PII in `MyAmpixPrivacy`.
5. **Walk the app once.** Each `(screen_name, app_version)` uploads exactly once (`202`). Enable `debug` to see `screenshot uploaded: <name> (status 202)` / skip logs.
6. **View in the dashboard.** Open the project's analytics Screens surface (:5173).
7. **Update an image.** Delete the stale reference in the dashboard (analyst+ `DELETE`), then in the debug app call `await MyAmpix.instance.retakeScreenshots()` and re-navigate; the backend upserts and the dashboard image (content-addressed by hash) refreshes. Bumping the app's `app_version` also re-captures every screen once.

---

## 4. mobile_purchase setup

The billing-authority service (`@myampix/mobile-purchase`, NestJS 11, port `8090`). It ingests App
Store / Google Play notifications directly (no RevenueCat), holds **no JWT secret** (delegates role
checks to `mobile_analytics`), and runs against its **own** Postgres on `:5433`. Authoritative env
surface: `backend/mobile_purchase/src/config/app-config.ts` (Zod, **fail-fast** — one thrown error
lists every broken var at once).

### 1. Boot the service

From the repo root (`pnpm dev` at root does **not** start this service):

```bash
corepack enable && pnpm install
pnpm infra:up                                          # brings up the :5433 Postgres
cp backend/mobile_purchase/.env.example backend/mobile_purchase/.env
pnpm --filter @myampix/mobile-purchase exec prisma migrate deploy   # schema on its own :5433 DB
pnpm --filter @myampix/mobile-purchase start:dev       # → http://localhost:8090
curl http://localhost:8090/health                      # verify
```

`src/main.ts` calls `process.loadEnvFile()` — real env vars always win over `.env`. Also run
`mobile_analytics` (:8088) — every dashboard/admin route is role-checked against it.

### 2. Every environment variable (`app-config.ts`)

| Var | Default | Fail behavior / notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`\|`test`\|`production` |
| `PORT` | `8090` | int 1–65535 |
| `DATABASE_URL` | — (**required**) | must match `^postgresql://`; dev `postgresql://…@localhost:5433/mobile_purchase`. Only var with no default → boot fails if unset |
| `LOG_LEVEL` | `info` | pino levels |
| `ANALYTICS_INTERNAL_URL` | `http://localhost:8088` | base URL of analytics' internal role endpoint; must be a valid URL |
| `STORE_CREDENTIALS_ENC_KEY` | (unset) | if set, must base64-decode to **exactly 32 bytes** (AES-256) or boot fails; **absence does NOT fail boot** — it only fails the connect-store path (503) and blocks decryption of stored blobs |
| `APPLE_BUNDLE_IDS` | `com.myampix.app` | comma-separated; split/trimmed into `appleBundleIds[]` |
| `APPLE_APP_APPLE_ID` | (unset) | numeric App Store Connect app id; **required to build a Production Apple verifier**, optional for Sandbox-only |
| `APPLE_ROOT_CERT_DIR` | in-repo `certs/` next to the verifier | trust-anchor dir; resolved via `__dirname` (works from `src` or `dist`) |
| `GOOGLE_PUSH_AUTH_MODE` | `shared_secret` | `shared_secret` (works now) \| `oidc` (deferred to X1, always fails closed) |
| `GOOGLE_PUBSUB_SHARED_SECRET` | (unset) | **no dev default on purpose** — unset ⇒ every Google push is **401** (fail-closed) |
| `DASHBOARD_ORIGINS` | `http://localhost:5173` | comma-separated CORS allowlist; empty ⇒ CORS closed |
| `SCHEDULER_ENABLED` | `true` | `'false'` registers no crons (set in tests) |
| `EXPIRY_SWEEP_CRON` | `*/5 * * * *` | cron for the expiry sweep; validated by the `cron` lib |

Boot logs a **redacted** view (`describeConfig`) — secrets show as `set`/`MISSING`, `DATABASE_URL`
collapses to `set`.

### 3. What works pre-deploy vs. gated on GCP deploy (X1)

**Works today (inbound webhook verification, no GCP):**

- `POST /webhooks/apple` — verifies ASSN v2 JWS against trust anchors + bundleId, then ingests. Verification failure → 401; payload-shape failure → 400.
- `POST /webhooks/google?token=<secret>` — shared-secret push auth. Bad/missing auth → 401; unparseable envelope → 400; decoded → 200.

**Gated on the X1 GCP deploy (outbound + OIDC):**

- Outbound Google Play Developer API / App Store Server API calls. `GoogleApiStoreClient` decrypts a stored credential but its `getSubscriptionV2`/`getProduct`/`revokeAndRefundSubscription` still throw `GoogleCredentialsUnavailableError` at the network seam.
- Live credential validation: `StoreApiCredentialValidator.validate` always throws `StoreValidationUnavailableError` → connect flow records `liveVerified:false` / `pending`.
- OIDC push auth: `OidcPushAuthenticator` fails closed unconditionally; `GOOGLE_PUSH_AUTH_MODE=oidc` locks the endpoint rather than enabling a half-built verifier.

### 4. Enable Apple ASSN v2 verification (trust anchor)

`src/webhooks/apple/certs/` **ships empty on purpose**. Until a cert is present,
`loadAppleRootCertificates` returns `[]`, zero verifiers are built, and every Apple notification is
rejected **401** (fail-closed). To enable:

1. Download the public **Apple Root CA – G3** cert from https://www.apple.com/certificateauthority/ (PEM or DER — auto-detected).
2. Drop it into `src/webhooks/apple/certs/` (any filename), or point `APPLE_ROOT_CERT_DIR` at a dir containing it.
3. Set `APPLE_BUNDLE_IDS` to the real bundle id(s) and `APPLE_APP_APPLE_ID` to the numeric app id (**required** for Production; Sandbox-only works without it). One verifier is built per bundleId × environment; environment is hardcoded SANDBOX/PRODUCTION and never comes from the notification (bypass risk).

### 5. Enable Google RTDN push auth (shared-secret mode)

```bash
openssl rand -hex 32   # high-entropy token; never commit
```

Set `GOOGLE_PUBSUB_SHARED_SECRET=<that value>`, keep `GOOGLE_PUSH_AUTH_MODE=shared_secret`, and
configure the Pub/Sub push subscription endpoint as
`https://<host>/webhooks/google?token=<that value>`. The `?token=` is compared constant-time; unset
secret ⇒ 401 on every push.

### 6. CORS + cross-service role check

`src/main.ts` enables CORS with `origin: config.dashboardOrigins`, `credentials:true`, allowed
headers `Authorization, Content-Type, X-Request-Id`. The dashboard reaches this service
**cross-origin**, so the prod dashboard origin(s) must be in `DASHBOARD_ORIGINS`. Every admin route
runs `ProjectAccessGuard` → `ProjectAccessService` (`authz/project-access.service.ts`), which
forwards the caller's `Authorization` header to
`GET {ANALYTICS_INTERNAL_URL}/api/v1/internal/projects/:projectId/role`. Analytics unreachable/5xx →
503; bad creds → 401; 403/404/unknown role → deny (fail-closed). So `mobile_analytics` must be
running and reachable at `ANALYTICS_INTERNAL_URL`.

### 7. Scheduler

`SchedulerModule` wires `ScheduleModule.forRoot()` + `ExpirySweepJob`, which registers a
config-driven `CronJob` on `EXPIRY_SWEEP_CRON`. `SCHEDULER_ENABLED=false` registers nothing (use in
tests so the cron doesn't fire during teardown). The handler catches all errors — a tick never throws.

### 8. Connect-a-store runbook (per-app, dashboard Settings)

**Prerequisite:** `STORE_CREDENTIALS_ENC_KEY` must be set on the backend, or every `PUT` returns
**503**:

```bash
openssl rand -base64 32   # → STORE_CREDENTIALS_ENC_KEY (decodes to 32 bytes; never commit)
```

Flow: create the App, then PUT its store credential (admin role); status read is viewer role. All
routes are on `AppsController` (`catalog/controllers/apps.controller.ts`), scoped to `projectId` +
`appId`; the encrypted blob is **never** returned by any endpoint.

**Android app** (`PUT /api/v1/projects/:projectId/catalog/apps/:appId/store-credentials`) — body is
the Google Play service-account JSON, pasted whole as a string:

```json
{ "kind": "google_play",
  "serviceAccountJson": "{\"type\":\"service_account\",\"project_id\":\"…\",\"client_email\":\"…\",\"private_key\":\"…\"}" }
```

Structural check: valid JSON with `type:"service_account"` + `client_email` + `private_key` + `project_id`.

**iOS app** — App Store Connect API key blob:

```json
{ "kind": "app_store",
  "ascIssuerId": "<UUID>",
  "ascKeyId": "<10-char key id>",
  "ascPrivateKeyP8": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----",
  "appAppleId": "<numeric app id>" }
```

Validation: `ascIssuerId` UUID, `ascKeyId` exactly 10 chars, `ascPrivateKeyP8` contains the PEM
header, `appAppleId` all digits.

**Response contract (`StoreCredentialStatus`):** `{ connected, platform, liveVerified, verifiedAt }`.
Structural failure → 422; `kind`↔platform mismatch → 409; wrong scope/unknown app → opaque 404.
Because live validation is X1-gated, a successful connect today stores the encrypted blob
(AES-256-GCM, `store-credentials-cipher.ts`) and returns `liveVerified:false` / `verifiedAt:null`
(**pending**) — expected pre-deploy, not an error.

Other ops:

- `GET …/store-credentials/status` (viewer) — derives `connected`/`liveVerified` from non-secret columns; never decrypts.
- `DELETE …/store-credentials` (admin, 204) — idempotent, scoped clear.

Once X1 lands (GCP deploy + `googleapis`/ASC SDK wiring + real store accounts), the same stored blob
is what `GoogleApiStoreClient.requireCredentials` decrypts to make live Play/ASC calls — no call-site
changes, just the network seams and the validator body.

---

## 5. Dashboard setup

The dashboard is a static Vite/React SPA (`@myampix/dashboard`) that reads its backend origins **at
runtime** from a config file, so one build works against any environment.

### Which backends must be up

The dashboard talks to **two distinct backends** (both expose `/api/v1/projects/:projectId/…`, so
they can't be same-origin):

| Config key | Backend | Port | Used by |
|---|---|---|---|
| `apiBaseUrl` | `mobile_analytics` (MyAmplitude) | `:8088` | main app / analytics pages |
| `purchaseApiBaseUrl` | `mobile_purchase` (MyRevenueCat) | `:8090` | MyRevenueCat pages |

`pnpm dev` starts **only** `mobile_analytics` (`:8088`) + the dashboard (`:5173`). To exercise the
MyRevenueCat pages you must start `mobile_purchase` (`:8090`) separately.

### Running dev

```bash
pnpm dev                                            # DBs + analytics (:8088) + dashboard (:5173)
pnpm --filter @myampix/mobile-purchase start:dev    # :8090, for MyRevenueCat pages
# dashboard alone:
pnpm --filter dashboard dev                         # http://localhost:5173
```

The Vite dev proxy (`dashboard/vite.config.ts`) forwards same-origin paths to analytics, which is why
`apiBaseUrl` can be `''` in dev:

```ts
server: { port: 5173, proxy: { '/api': 'http://localhost:8088', '/ingest': 'http://localhost:8088' } }
```

The proxy only covers `/api` and `/ingest` → `:8088`. There is **no** proxy for `mobile_purchase`, so
`purchaseApiBaseUrl` must be an **absolute** origin in dev.

### The `window.___MYAMPIX_CONFIG__` mechanism

`dashboard/public/config.js` is loaded before the app bundle and assigns `window.___MYAMPIX_CONFIG__`.
`getRuntimeConfig()` merges it over dev-safe defaults (`apiBaseUrl: ''`, `purchaseApiBaseUrl: ''`):

```js
// dashboard/public/config.js  (checked-in dev values)
window.___MYAMPIX_CONFIG__ = {
  apiBaseUrl: '',                              // '' = same origin → Vite proxy in dev / reverse proxy in prod
  purchaseApiBaseUrl: 'http://localhost:8090', // mobile_purchase — MUST be absolute (no dev proxy for it)
};
```

### Build & deploy

```bash
pnpm --filter dashboard build     # emits static dist/ (config.js copied verbatim from public/)
pnpm --filter dashboard preview   # optional local preview of the build
```

`config.js` is a **static, deploy-time-replaced** file: ship the same immutable bundle everywhere and,
at deploy, swap `config.js` to point at that environment's origins:

```js
window.___MYAMPIX_CONFIG__ = {
  apiBaseUrl: '',                                  // '' if a reverse proxy fronts mobile_analytics same-origin
  purchaseApiBaseUrl: 'https://rc.myampix.example', // mobile_purchase absolute origin (set by the X1 pipeline)
};
```

No rebuild is needed to retarget backends — only `config.js` changes.

---

## 6. Mobile SDK setup

Two independent Flutter packages (both consumed via `path:`/`git:`, neither on pub.dev).

### `myampix_purchases` (MyRevenueCat SDK)

Configure via `PurchasesConfiguration` (`sdk/flutter_purchases/lib/src/configuration.dart`) and the
static `MyAmpixPurchases.configure()`:

```dart
import 'package:myampix_purchases/myampix_purchases.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();          // required before configure
  await MyAmpixPurchases.configure(
    PurchasesConfiguration(
      apiKey: 'mp_pub_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // PUBLIC SDK key, must start mp_pub_ (required)
      serverUrl: 'http://localhost:8090',               // mobile_purchase base URL; trailing slash normalized
      appUserID: null,                                  // null → anonymous id (or pass your own)
      logLevel: MyAmpixLogLevel.warn,                   // verbose|debug|info|warn|error (default warn)
    ),
  );
  runApp(const MyApp());
}
```

`apiKey`/`serverUrl` are asserted non-empty; `appUserID == null` yields an anonymous id.
`configure()` **never throws** — on failure the SDK stays unconfigured and later throwing calls raise
`PurchasesErrorCode.configurationError`.

**Running the example** (`sdk/flutter_purchases/example/lib/demo_config.dart` reads `--dart-define`s,
with fake fallbacks so `flutter run`/`flutter test` work with zero setup):

```bash
cd sdk/flutter_purchases/example
flutter run \
  --dart-define=MP_API_KEY=mp_pub_<your-public-key> \
  --dart-define=MP_SERVER_URL=http://localhost:8090
```

- `MP_API_KEY` default is a placeholder a real backend rejects with **401** — override with the real `mp_pub_` key.
- `MP_SERVER_URL` **default in the file is `http://localhost:8088`**, but `mobile_purchase` listens on **`:8090`** — always override with `:8090` (or your deployment).
- **Android emulator:** use `--dart-define=MP_SERVER_URL=http://10.0.2.2:8090`.
- Caveat (`example/lib/main.dart`): there is currently no production path to wire a native `StoreChannel`, so real `getOfferings`/`purchasePackage`/`restorePurchases` surface `storeProblemError`; identity/customer-info calls work against a live backend.

### `myampix_analytics` (MyAmplitude SDK) — wire-up basics

Full guide is [`HOW-TO-USE.md`](HOW-TO-USE.md); the essentials not covered by the screenshot flow (§3):

```dart
import 'package:myampix_analytics/myampix_analytics.dart';

await MyAmpix.init(
  'mam_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',                    // project INGEST token (positional), mam_ + 32 hex
  config: const MyAmpixConfig(serverUrl: 'http://localhost:8088'), // mobile_analytics origin
);
```

- **Token:** `pnpm dev` seeds `mam_a5857ba6d091bf8f6c96d7f84f0b35db`; mint more via the API (§1.7) or Prisma Studio (`Organization → Project → SdkToken`). `MyAmpix.init` is idempotent and never throws (failed init = silent no-op).
- **Android emulator:** use `http://10.0.2.2:8088`, not `localhost`.
- **Autocapture toggles** (`MyAmpixConfig`, independently toggleable): `autocaptureScreens` (default `true`), `autocaptureTaps` (`true`), `autocapturePurchases` (`true`), `autocaptureAttribution` (`true`), `autocaptureScreenshots` (`false`, **debug-build only** — see §3). Screens/taps also require wiring the observers once:

```dart
MaterialApp(
  navigatorObservers: [MyAmpixObserver()],                    // $screen_view
  builder: (context, child) => MyAmpixTracker(child: child!), // $tap / $rage_tap
);
```

See [`HOW-TO-USE.md`](HOW-TO-USE.md) for privacy masking, stable screen naming, and the screenshot retake flow.
