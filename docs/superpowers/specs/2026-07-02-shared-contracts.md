# MyAmpMix — Shared Contracts (Source of Truth)

All sub-project specs and plans MUST conform to this document. Any change here requires updating every consumer.

## 1. Monorepo layout & toolchain

```
myampmix/
├── sdk/flutter_analytics/     # Dart/Flutter package  (Flutter 3.32+, Dart 3.8+)
├── backend/                   # NestJS 11, Node 22, TypeScript 5.8+, pnpm workspace member
├── dashboard/                 # React 18, Vite 6, TypeScript 5.8+, pnpm workspace member
├── packages/contracts/        # Shared TS types + Zod schemas + OpenAPI output (workspace member)
├── infra/                     # docker-compose.yml, clickhouse/init.sql, postgres via Prisma, deploy scripts
├── docs/superpowers/specs|plans/
└── .github/workflows/
```

- Package manager: **pnpm 10** with workspace at repo root (`pnpm-workspace.yaml` lists `backend`, `dashboard`, `packages/*`).
- Node version pinned in `.nvmrc` and `package.json engines`: `22`.
- Lint/format: ESLint 9 flat config + Prettier 3 (root config, per-package extends). Dart: `flutter_lints`.

## 2. Local infra (docker-compose) — ports & credentials

| Service | Image | Host port | Credentials (local dev only) |
|---|---|---|---|
| ClickHouse | `clickhouse/clickhouse-server:24.8` | 8123 (http), 9000 (native) | user `default`, password `myampmix_dev`, db `analytics` |
| PostgreSQL | `postgres:17-alpine` | 5432 | user `myampmix`, password `myampmix_dev`, db `myampmix` |
| Redis | `redis:7-alpine` | 6379 | no auth locally |
| Backend (dev) | local `pnpm start:dev` | **8080** | — |
| Dashboard (dev) | Vite dev server | 5173 | proxies `/api` + `/ingest` → 8080 |

## 3. Environment variables (backend)

```
NODE_ENV, PORT=8080
DATABASE_URL=postgresql://myampmix:myampmix_dev@localhost:5432/myampmix
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default  CLICKHOUSE_PASSWORD=myampmix_dev  CLICKHOUSE_DB=analytics
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (min 32 chars; app refuses to boot without them outside NODE_ENV=test)
INGEST_MAX_BATCH=100        # events per request
INGEST_MAX_BODY_KB=1024
INGEST_RATE_LIMIT_PER_MIN=1000   # optional; per-token sliding window (tests override)
```

Config is validated at startup with Zod; missing/invalid vars crash the boot with a clear message.

## 4. Ingest API contract (`/ingest`)

Auth: `Authorization: Bearer <sdk_token>` where `sdk_token` is the project's ingest token (format `mam_` + 32 hex chars). Invalid token → `401 {type,title,status}` (RFC 7807). Rate limit: 1000 req/min per token (Redis sliding window) → `429`.

### POST `/ingest/events`
- `Content-Type: application/json`, optional `Content-Encoding: gzip`.
- Body:

```jsonc
{
  "events": [
    {
      "insert_id": "018f6b2e-7c1a-7f3b-9c4d-1a2b3c4d5e6f",   // UUID v4/v7, REQUIRED, dedup key
      "event": "checkout_completed",                          // 1..255 chars, REQUIRED
      "distinct_id": "u_42 | anon UUID",                      // REQUIRED
      "anon_id": "device anon UUID",                          // REQUIRED (stable per install)
      "session_id": "018f6b2e-....",                          // REQUIRED (UUID)
      "timestamp": 1751462400123,                             // ms epoch, client clock, REQUIRED
      "properties": { "plan": "pro", "value": 9.99 },         // optional; values: scalar, null, or array of scalars — nested objects rejected at the schema layer. Envelope size (≤INGEST_MAX_BATCH) is enforced at the API layer, not in the static schema.
      "context": {                                            // all optional strings/ints
        "app_version": "1.4.2", "app_build": "142",
        "os": "ios|android", "os_version": "18.5",
        "device_model": "iPhone16,2", "device_manufacturer": "Apple",
        "locale": "fr_FR", "timezone": "Europe/Paris",
        "screen_width": 393, "screen_height": 852,
        "network": "wifi|cellular|offline", "sdk_version": "0.1.0",
        "utm_source": "tiktok", "utm_medium": "paid", "utm_campaign": "summer",
        "utm_content": null, "utm_term": null,
        "first_utm_source": "meta", "first_utm_campaign": "launch",
        "install_referrer": "utm_source=facebook&..."
      }
    }
  ]
}
```

- Responses: `202 {"accepted": 98, "rejected": [{"index": 3, "reason": "missing insert_id"}]}` (batch never all-or-nothing); `400` malformed JSON; `401`; `413` body too large; `429`.
- Server sets authoritative `server_timestamp`; client `timestamp` is clamped to `[now-7d, now+5min]`.

### POST `/ingest/profiles`
Body: `{"operations": [{"distinct_id": "u_42", "op": "set|set_once|increment|append|unset|delete", "properties": {...}, "timestamp": 1751462400123}]}` → `202` same shape as events.

### Reserved event names (SDK autocapture)
`$first_open`, `$app_open`, `$app_background`, `$session_start`, `$session_end` (property `$duration_ms`), `$screen_view` (`$screen_name`, `$previous_screen`, `$time_on_previous_ms`), `$tap` (`$widget_type`, `$widget_label`, `$screen_name`, `$pos_x`, `$pos_y`), `$rage_tap`, `$identify`, `$campaign_touch`, `$in_app_purchase` (native store-transaction autocapture — properties `$product_id`, `$price` (number), `$currency`, `$quantity`, `$transaction_id`, `$store` (`app_store`|`play_store`), `$purchase_source` = `"native"`). Reserved property prefix: `$`.

**Manual vs automatic events (distinction):** every SDK-autocaptured/native event is `$`-prefixed and reserved (e.g. `$screen_view`, `$tap`, `$in_app_purchase`); developer-tracked manual events are never `$`-prefixed. So a manually-tracked purchase (whatever the developer names it, e.g. `purchase`/`checkout_completed`) and the automatically-detected native store transaction (`$in_app_purchase`, `$purchase_source:"native"`) are always distinguishable by name prefix — analytics/queries can filter one from the other.

Alias transport: there is no `$alias` event — `alias(newId)` sends a `$identify` event with property `{"$alias": "<newId>"}`. Profile op encodings: `unset` sends `properties: {"<name>": null, ...}`; `delete` sends `properties: {}`.

## 5. ClickHouse DDL (authoritative)

```sql
CREATE TABLE analytics.events (
  project_id    UUID,
  insert_id     UUID,
  event         LowCardinality(String) CODEC(ZSTD(3)),
  distinct_id   String CODEC(ZSTD(3)),
  anon_id       String CODEC(ZSTD(3)),
  session_id    UUID,
  timestamp     DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
  server_timestamp DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
  properties    JSON,
  app_version   LowCardinality(String), app_build LowCardinality(String),
  os            LowCardinality(String), os_version LowCardinality(String),
  device_model  LowCardinality(String), device_manufacturer LowCardinality(String),
  locale        LowCardinality(String), timezone LowCardinality(String),
  screen_width  UInt16, screen_height UInt16,
  network       LowCardinality(String), sdk_version LowCardinality(String),
  utm_source    LowCardinality(String), utm_medium LowCardinality(String),
  utm_campaign  String, utm_content String, utm_term String,
  first_utm_source LowCardinality(String), first_utm_campaign String,
  install_referrer String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, event, timestamp, insert_id);

CREATE TABLE analytics.user_profiles (
  project_id UUID, distinct_id String,
  properties JSON, updated_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (project_id, distinct_id);

CREATE TABLE analytics.identity_mappings (
  project_id UUID, anon_id String, canonical_id String,
  created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (project_id, anon_id);
```

Inserts use `async_insert=1, wait_for_async_insert=1` (client waits for durable ack; batching is server-side).

## 6. PostgreSQL core schema (Prisma, phase 1–2)

`organizations(id uuid pk, name, created_at)` · `users(id uuid pk, email unique, password_hash, name, created_at)` · `memberships(user_id, org_id, role enum admin|analyst|viewer, pk(user_id,org_id))` · `invitations(id uuid pk, org_id, role, token unique, expires_at, accepted_by nullable)` · `projects(id uuid pk, org_id fk, name, timezone default 'UTC', created_at)` · `sdk_tokens(id uuid pk, project_id fk, token unique 'mam_'+hex32, label, revoked_at nullable, created_at)` · `refresh_tokens(id uuid pk, user_id fk, token_hash, expires_at, revoked_at nullable)`.

## 7. Dashboard API conventions (`/api/v1`)

- Auth: `POST /api/v1/auth/signup|login|refresh|logout`; access JWT 15 min in memory, refresh JWT 30 d httpOnly cookie.
  - `signup` body `{email, password, name}`; `login` body `{email, password}`. Both (and `refresh`, which takes no body) respond `200 {"access_token": "<jwt>", "user": {"id", "email", "name"}}` and set/rotate the refresh cookie. `logout` → `204`, clears the cookie.
- `GET /api/v1/projects` → `{"projects": [{"id", "org_id", "name", "timezone"}]}`.
- `POST /api/v1/projects` (admin) body `{"org_id", "name", "timezone"?}` → `201` project object (same shape as list items).
- Autocomplete metadata (phase 3): `GET /api/v1/projects/:projectId/meta/events` → `{"events": ["checkout_completed", ...]}`; `GET .../meta/properties?event=<name>` → `{"properties": [{"name", "type": "string|number|bool"}]}`. Sourced from ClickHouse `DISTINCT` over the last 30 days, cached 5 min in Redis.
- `GET /api/v1/invitations/:token` (public, milestone 2) → `{"org_name", "role", "expires_at"}`; `410` if expired/used.
- JSON error shape everywhere: RFC 7807 `{type, title, status, detail?, errors?}`.
- Analytics queries: `POST /api/v1/projects/:projectId/query/insights` (phase 3+ adds `/funnels`, `/retention`, `/flows`) with body `{ "events": [{"name": "...", "aggregation": "total|unique_users"}], "date_range": {"from": "2026-06-01", "to": "2026-07-01"}, "interval": "hour|day|week|month", "filters": [{"property": "...", "op": "eq|neq|contains|set|not_set|gt|lt", "value": ...}], "breakdown": {"property": "..."} }` → `{ "series": [{"name": "...", "data": [{"t": "2026-06-01", "value": 123}]}] }`.
- Live feed: `GET /api/v1/projects/:projectId/events/live?limit=50&before=<cursor>`.

## 8. SDK public API (Dart) — frozen surface for v0.1

```dart
await MyAmpMix.init(token, config: MyAmpMixConfig(...));
MyAmpMix.instance.track('event', properties: {...});
MyAmpMix.instance.identify('user_id');  MyAmpMix.instance.alias('new_id');
MyAmpMix.instance.reset();              MyAmpMix.instance.flush();
MyAmpMix.instance.timeEvent('event');
MyAmpMix.instance.registerSuperProperties({...});
MyAmpMix.instance.people.set({...}); // set/setOnce/increment/append/unset/deleteUser
MyAmpMix.instance.optOutTracking(); MyAmpMix.instance.optInTracking();
// Widgets: MyAmpMixObserver() for Navigator, MyAmpMixTracker(child: app) for taps
```

## 9. Cross-cutting rules

- All timestamps stored/compared in UTC; project timezone applied only at query time.
- IDs are UUID v7 where generated server-side or SDK-side (time-ordered).
- Commit style: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).
- Coverage floors (CI-enforced): backend 85% lines, SDK 85%, dashboard 75%.
- No paid services anywhere (design spec §10).

---

## 11. Auth & TOTP 2FA API (added 2026-07-04)

Real account auth (previously mocked). All under `/api/v1/auth`. JSON in/out; errors are RFC 7807. Access token = JWT 15 min returned in body (held in memory client-side); refresh = opaque/JWT in an httpOnly `mam_refresh` cookie (30 d, rotated on use). Passwords hashed with **argon2id**. TOTP per RFC 6238 (30 s step, 6 digits, SHA-1 — Google Authenticator compatible).

### Endpoints
- `POST /signup` `{email, password (min 8), name}` → `200 {access_token, user:{id,email,name}}` + refresh cookie. Creates the user (409 if email taken).
- `POST /login` `{email, password}`:
  - 2FA **off** → `200 {access_token, user}` + refresh cookie.
  - 2FA **on** → `200 {mfa_required: true, mfa_token}` (NO access token, NO refresh cookie). `mfa_token` is a short-lived (5 min) JWT with `purpose:"mfa"` — never accepted as an access token.
  - bad creds → `401`.
- `POST /2fa/verify` `{mfa_token, code}` (`code` = 6-digit TOTP **or** a recovery code) → `200 {access_token, user}` + refresh cookie; `401` on bad/expired.
- `POST /refresh` (refresh cookie) → `200 {access_token, user}` + rotated cookie; `401` if missing/invalid.
- `POST /logout` → `204`, clears cookie + revokes the refresh token.
- `GET /me` (access token) → `200 {user, two_factor_enabled}`.
- `POST /2fa/setup` (access token) → `200 {otpauth_url, secret, qr_data_url}` — generates a **pending** (not-yet-active) TOTP secret; `qr_data_url` is a PNG data URI of the otpauth URL.
- `POST /2fa/activate` `{code}` (access token) → verifies code vs pending secret → enables 2FA, persists secret (AES-256-GCM encrypted at rest) → `200 {recovery_codes: string[10]}` (shown once).
- `POST /2fa/disable` `{code}` (access token) → `204`; clears secret + recovery codes.

Recovery codes: 10, single-use, stored hashed. 2FA verify/activate attempts are rate-limited per user (reuse Redis). `mfa_token`/access/refresh use distinct signing purposes so none is interchangeable.

### New env vars (extends §3)
```
ACCESS_TOKEN_TTL=900            # seconds (15m)
REFRESH_TOKEN_TTL=2592000       # seconds (30d)
MFA_TOKEN_TTL=300               # seconds (5m)
TOTP_ISSUER=MyAmpMix            # label shown in the authenticator app
TOTP_ENC_KEY                    # 32-byte key (base64 or 64-hex) for AES-256-GCM of TOTP secrets; required outside NODE_ENV=test
COOKIE_SECURE=false             # true in production (HTTPS)
COOKIE_DOMAIN                   # optional
```

---

## 12. Projects & minimal analytics read (added 2026-07-04)

Makes the dashboard's project navigation and a first real data view work end-to-end against the backend (previously mocked). All under `/api/v1`, JWT access-token auth (the §11 access token). A user may only see orgs/projects/data for organizations they are a member of (membership join enforced; 403 for a project in a non-member org, 404 for an unknown project id).

### Signup now provisions a default workspace
`POST /api/v1/auth/signup` additionally creates, in one transaction with the user: an `Organization` named `"<name>'s Workspace"`, a `Membership(role=admin)` linking the user to it, a `Project` named `"Default"` (timezone `UTC`), and an `SdkToken` (`mam_` + 32 random hex). So a brand-new account immediately has one org, one project, and one ingest token. (Existing signup response shape is unchanged.)

### GET /api/v1/projects
Returns the authenticated user's projects across their memberships:
```json
{ "projects": [ { "id": "uuid", "org_id": "uuid", "org_name": "Ada's Workspace",
                  "name": "Default", "timezone": "UTC", "ingest_token": "mam_…" } ] }
```
`ingest_token` is included because the requester owns the project (used to instrument their app / ingest). `org_name` is added to the existing Project shape; the dashboard `Project` type gains `org_name` and `ingest_token`.

### GET /api/v1/projects/:projectId/events/summary
Real ClickHouse read over `analytics.events` for that `project_id`:
```json
{ "project_id": "uuid", "total": 128,
  "by_event": [ { "event": "checkout_completed", "count": 12 }, { "event": "product_viewed", "count": 40 } ] }
```
`total` and per-event `count` use `count(DISTINCT insert_id)` (exact under retries). `by_event` ordered by count desc. All-time (no date filter in this MVP). Empty project → `{ total: 0, by_event: [] }`. Auth + membership enforced as above.

---

## 13. Tenancy management API (added 2026-07-04)

Org / member / invitation / project / account management. All under `/api/v1`, JWT access-token auth (§11). **Role matrix** (admin > analyst > viewer), enforced by a `RolesGuard` that resolves the org from the route's `:orgId` (or the `:projectId`'s org) and checks the caller's membership role:
- **Reads** (list orgs/members/projects/tokens/summary, get invitation): any member (viewer+).
- **Mutations** (rename org, member role change/remove, invitations, project create/rename/delete, token create/revoke): **admin**.
- **Create org** and **self account** actions: any authenticated user.
A non-member gets **403** for a scoped route; unknown ids **404**; unauthenticated **401**. RFC 7807 throughout.

### Account (self)
- `PATCH /api/v1/auth/me { name }` → `200` updated `{id,email,name}`.
- `POST /api/v1/auth/password { current_password, new_password (min 8) }` → `204` (verifies current via argon2, re-hashes). Wrong current → `401`.

### Organizations
- `POST /api/v1/orgs { name }` → `201 { id, name, role:"admin" }` (creator becomes admin member).
- `GET /api/v1/orgs` → `{ orgs:[{ id, name, role }] }` (caller's orgs + their role).
- `PATCH /api/v1/orgs/:orgId { name }` (admin) → `200 { id, name }`.

### Members & permissions
- `GET /api/v1/orgs/:orgId/members` (member) → `{ members:[{ user:{id,email,name}, role }] }`.
- `PATCH /api/v1/orgs/:orgId/members/:userId { role }` (admin) → `200`. **Cannot demote the last admin** → `409`.
- `DELETE /api/v1/orgs/:orgId/members/:userId` (admin) → `204`. **Cannot remove the last admin** → `409`.

### Invitations (shareable link, no email provider)
- `POST /api/v1/orgs/:orgId/invitations { role }` (admin) → `201 { id, role, token, invite_path:"/invite/<token>", expires_at }` (expires in 7 days). Admin copies the link and shares it.
- `GET /api/v1/orgs/:orgId/invitations` (admin) → `{ invitations:[{ id, role, expires_at }] }` (pending = not accepted, not expired).
- `DELETE /api/v1/orgs/:orgId/invitations/:invitationId` (admin) → `204`.
- `GET /api/v1/invitations/:token` (public) → `{ org_name, role, expires_at }`; `404` unknown, `410` expired/already accepted.
- `POST /api/v1/invitations/:token/accept` (auth) → creates `Membership(caller, org, role)`, sets `accepted_by` → `200 { org_id, role }`. Already a member → `200` (idempotent, keeps existing role). `410` if expired/accepted.

### Projects & tokens management
- `POST /api/v1/orgs/:orgId/projects { name, timezone? }` (admin) → `201 { id, org_id, name, timezone, ingest_token }` (creates the project + an initial SdkToken).
- `PATCH /api/v1/projects/:projectId { name?, timezone? }` (admin) → `200 { id, name, timezone }`.
- `DELETE /api/v1/projects/:projectId` (admin) → `204` (cascades tokens; ClickHouse event data is left as-is).
- `GET /api/v1/projects/:projectId/tokens` (admin) → `{ tokens:[{ id, token, label, created_at }] }` (non-revoked).
- `POST /api/v1/projects/:projectId/tokens { label? }` (admin) → `201 { id, token, label }` (new `mam_`+32hex).
- `DELETE /api/v1/projects/:projectId/tokens/:tokenId` (admin) → `204` (sets `revoked_at`; the ingest guard already rejects revoked tokens).

---

## 14. Core analytics API — Phase 3 (added 2026-07-04)

Read-only analytics over `analytics.events`, all under `/api/v1/projects/:projectId/...`, JWT auth + project membership (viewer+, reuse the projects membership check). **Every ClickHouse query MUST be parameterized** (`query_params` / `{name:Type}`), never string-interpolated — user-supplied property names/values are injection vectors. Property references resolve as: a **known event column** (whitelist: `event, distinct_id, anon_id, session_id, os, os_version, app_version, app_build, device_model, device_manufacturer, locale, timezone, network, sdk_version, utm_source, utm_medium, utm_campaign, utm_content, utm_term, first_utm_source, first_utm_campaign`) → that column; otherwise a **custom property** → `JSONExtractString(properties, {key:String})` with the key bound as a param. Reject unknown ops.

### POST /query/insights  (the query engine)
Body (typed query definition; also the saved-report shape in Phase 5):
```jsonc
{
  "events": [ { "name": "checkout_completed", "aggregation": "total" } ],  // total=count(DISTINCT insert_id); unique_users=uniqExact(distinct_id); 1..5 events
  "date_range": { "from": "2026-06-01", "to": "2026-07-01" },              // inclusive dates (UTC)
  "interval": "day",                                                        // hour|day|week|month → toStartOf*(timestamp)
  "filters": [ { "property": "os", "op": "eq", "value": "ios" } ],          // AND-joined; op: eq|neq|contains|gt|lt|is_set|is_not_set
  "breakdown": { "property": "utm_source" }                                 // optional single breakdown; top 20 values
}
```
→ `{ "series": [ { "name": "checkout_completed", "breakdown_value": "tiktok"|null, "data": [ { "t": "2026-06-01", "value": 12 } ] } ] }`. One series per (event × breakdown value); buckets zero-filled across the range. `400` on invalid definition (unknown op/interval, >5 events, bad date).

### GET /events/live?limit=50&before=<iso>
Recent events newest-first: `{ "events": [ { "insert_id", "event", "distinct_id", "timestamp", "os", "app_version" } ], "next_before": "<iso>|null" }`. `limit` ≤ 100.

### Users explorer
- `GET /users?search=<q>&limit=50&cursor=<distinct_id>` → `{ "users": [ { "distinct_id", "last_seen", "event_count" } ], "next_cursor": "<id>|null" }` (search matches distinct_id prefix; derived from events).
- `GET /users/:distinctId` → `{ "distinct_id", "profile": {…}, "first_seen", "last_seen", "event_count", "recent_events": [ { "insert_id","event","timestamp" } ] }` (profile from `user_profiles` FINAL, recent_events last 50).

### GET /sessions/summary?from=<date>&to=<date>
From `$session_end` events (`$duration_ms` property): `{ "sessions": N, "avg_duration_ms": M, "by_day": [ { "t","sessions","avg_duration_ms" } ] }`.

### Metadata (autocomplete for the builder)
- `GET /meta/events` → `{ "events": ["checkout_completed", …] }` (distinct event names, last 30 days).
- `GET /meta/properties?event=<name?>` → `{ "properties": [ { "name", "type": "string|number|column" } ] }` (known columns + distinct top-level `properties` keys seen, last 30 days).

### Rollup materialized views (ClickHouse)
Add to `infra/clickhouse/init.sql` (idempotent) three Aggregating/SummingMergeTree rollups fed by MVs on `events`: **daily active users** (`project_id, day, uniqState(distinct_id)`), **daily event counts** (`project_id, day, event, count`), **daily sessions** (`project_id, day, sessions, sum($duration_ms)`). Correctness note: the insights/summary endpoints query **raw events** for exact results (dedup via `DISTINCT insert_id`); the rollups exist for future dashboard-speed optimization and the DAU/session cards may read them. Keep raw-event queries authoritative in Phase 3.
