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

## 15. Advanced analysis API — Phase 4 (added 2026-07-04)

Three read-only endpoints under `/api/v1/projects/:projectId/...`, JWT + project membership (viewer+), reusing the exact §14 machinery: `resolveProperty` for every property reference, the shared filter compiler, date-range handling, and **fully parameterized ClickHouse** (`{name:Type}` query_params — never string interpolation). Event names, property values, and numeric bounds are all bound as params. Structural keywords that cannot be parameters (interval unit `day`/`week`, funnel `strict_order` flag) are selected from **frozen constant maps** keyed by a validated enum — identical to the §14 interval pattern — never interpolated from raw input. Reject unknown ops/intervals/directions with `400`. All three take exact-count semantics: users are `uniqExact(distinct_id)`; event de-dup within a user uses raw events (an `insert_id` re-delivery does not create a phantom step).

### POST /query/funnels
Ordered conversion funnel via ClickHouse `windowFunnel`. Body:
```jsonc
{
  "steps": [
    { "event": "app_open", "filters": [] },          // each step: an event + optional §14 filters (AND-joined)
    { "event": "signup_started" },
    { "event": "checkout_completed" }
  ],                                                   // 2..8 ordered steps
  "date_range": { "from": "2026-06-01", "to": "2026-07-01" },
  "window_days": 7,                                    // conversion window (1..365); → windowFunnel(window_seconds)
  "order": "any",                                      // any | strict_order (strict = steps must be strictly consecutive in time)
  "breakdown": { "property": "utm_source" }            // optional; one funnel per breakdown value (top 10, rest folded to "$other")
}
```
Engine: per `distinct_id`, `windowFunnel(window_seconds[, 'strict_order'])(timestamp, cond0, cond1, …)` where `cond_k` = `event = {stepK:String}` AND that step's compiled filters; the combinator returns the max consecutive step reached (0..N). Then step *k*'s count = users whose level ≥ *k*+1.
→
```jsonc
{
  "steps": [
    { "event": "app_open",           "count": 1000, "conversion_from_prev": 1.0,   "conversion_from_top": 1.0 },
    { "event": "signup_started",     "count": 620,  "conversion_from_prev": 0.62,  "conversion_from_top": 0.62 },
    { "event": "checkout_completed", "count": 145,  "conversion_from_prev": 0.234, "conversion_from_top": 0.145 }
  ],
  "overall_conversion": 0.145,
  "breakdowns": [ { "value": "tiktok", "steps": [ … ], "overall_conversion": 0.21 } ]   // present only when breakdown set
}
```
`conversion_from_prev` of step 0 is always `1.0`; rates are `count / prev_count` (and `count / step0_count` for `from_top`), `0` when the denominator is `0`. `400` on <2 or >8 steps, bad window, unknown op.

### POST /query/retention
Cohort retention grid: users "born" (first did `born_event` in the window), returning if they did `return_event` a given number of intervals later. Body:
```jsonc
{
  "born_event":   { "name": "signup_completed", "filters": [] },   // cohort-defining event
  "return_event": { "name": "app_open", "filters": [] },           // returning event (defaults to born_event if omitted)
  "date_range": { "from": "2026-06-01", "to": "2026-07-01" },       // cohort BIRTH window (UTC dates, inclusive)
  "interval": "day",                                                // day | week — period granularity (constant-map keyword)
  "periods": 14                                                     // return periods computed: columns are period 0..periods (1..30)
}
```
Engine: `born_bucket(user) = min(toStartOf{Interval}(timestamp))` over born_event rows in-window; for return_event rows, `period = dateDiff('{interval}', born_bucket, toStartOf{Interval}(ts))`, kept when `0 ≤ period ≤ periods`. Cohort row = born_bucket; cell = `uniqExact(distinct_id)`.
→
```jsonc
{
  "cohorts": [
    { "cohort": "2026-06-01", "size": 320,
      "periods": [ { "period": 0, "count": 320, "rate": 1.0 }, { "period": 1, "count": 210, "rate": 0.656 }, … ] },
    { "cohort": "2026-06-02", "size": 290, "periods": [ … ] }
  ],
  "averages": [ { "period": 0, "rate": 1.0 }, { "period": 1, "rate": 0.61 }, … ]        // size-weighted mean per period
}
```
Period 0 is by definition the cohort itself (`count == size`, `rate == 1.0`). Cohorts are ordered by birth bucket ascending; a cohort exposes only the periods for which a full interval has elapsed within the query's "to" bound (later periods omitted, not zero-filled, so partial windows don't read as churn). `400` on unknown interval or `periods` out of `1..30`.

### POST /query/flows
Event-sequence flow (Sankey) anchored at one event. Body:
```jsonc
{
  "anchor": { "event": "app_open", "filters": [] },   // the fixed node
  "direction": "forward",                              // forward = events AFTER anchor | backward = events BEFORE anchor
  "date_range": { "from": "2026-06-01", "to": "2026-07-01" },
  "steps": 3,                                          // hops to expand away from the anchor (1..5)
  "max_nodes_per_step": 8,                             // top-N distinct events per step; the rest fold into "$other"
  "unit": "session"                                    // session (split by session_id) | user (whole user timeline)
}
```
Engine: per unit, order events by `timestamp`; for each occurrence of the anchor take the next (`forward`) / previous (`backward`) `steps` events as an ordered path; aggregate transitions `(step_index, from_event, to_event)` → `uniqExact(distinct_id)`; within each step keep the top `max_nodes_per_step` target events by volume and fold the remainder into a synthetic `"$other"` node; users who have no further event at a step flow into a synthetic `"$end"` node (drop-off).
→
```jsonc
{
  "nodes": [ { "id": "0:app_open", "step": 0, "event": "app_open", "value": 1000 },
             { "id": "1:browse",   "step": 1, "event": "browse",   "value": 540  }, … ],
  "links": [ { "source": "0:app_open", "target": "1:browse", "value": 540 },
             { "source": "0:app_open", "target": "1:$end",   "value": 300 }, … ]     // Sankey-ready; node ids are "step:event"
}
```
Node `id` is `"{step}:{event}"` (unique across steps even when the same event recurs). `400` on unknown direction/unit, `steps` out of `1..5`, or `max_nodes_per_step` out of `1..20`.

## 16. Cohorts, saved reports & custom dashboards — Phase 5 (added 2026-07-04)

Persistence layer + management API that make Phase 3–4 analytics reusable: a **cohort** is a saved
audience definition, a **saved report** is a saved query of any analysis type, a **dashboard** is a
grid of tiles each backed by a saved report. All rows are **project-scoped** and gated by project
membership; **reads require viewer+, writes require analyst+** (reuse `RolesGuard` + `@Roles('analyst')`
from `../authz/roles.guard`, resolving the org from the project like the tenancy controllers). Ownership
is recorded (`created_by`) but does not restrict access within the project. Definitions are stored as
validated JSON and **re-validated with the SAME zod schemas** (§14/§15) on write and before every run —
a stored definition is never trusted blindly, so the injection-safe query engine remains the only path
to ClickHouse.

### Postgres schema (Prisma — new migration `phase5_cohorts_dashboards`)
- `Cohort(id uuid pk, project_id fk→Project, name, definition Json, created_by fk→User, created_at, updated_at)`
- `SavedReport(id uuid pk, project_id fk, name, kind enum insights|funnel|retention|flows, definition Json, created_by fk, created_at, updated_at)`
- `Dashboard(id uuid pk, project_id fk, name, created_by fk, created_at, updated_at)`
- `DashboardTile(id uuid pk, dashboard_id fk→Dashboard on delete cascade, title, saved_report_id fk→SavedReport nullable, inline_definition Json nullable, kind enum, x int, y int, w int, h int, position int)` — a tile references a saved report OR carries an inline definition (exactly one; enforce in the service). Grid is a fixed **12-column** layout; `w`∈1..12, `h`≥1, `x`∈0..11, `x+w`≤12.
- Indexes on every `project_id`; `DashboardTile(dashboard_id, position)`. Cascade tile delete with dashboard.

### Cohort definition (JSON) & engine
```jsonc
{
  "match": "all",                                        // all | any (AND / OR across conditions)
  "conditions": [
    { "type": "behavior", "event": "checkout_completed", "op": "gte", "count": 1, "within_days": 30,
      "filters": [ { "property": "os", "op": "eq", "value": "ios" } ] },   // did/didn't do event N times in last D days
    { "type": "did_not", "event": "app_open", "within_days": 7 },          // performed the event 0 times in the window
    { "type": "property", "property": "plan", "op": "eq", "value": "pro" } // latest-known profile / event property
  ]                                                                         // 1..10 conditions
}
```
Engine: each condition compiles to a **parameterized** `distinct_id`-producing ClickHouse fragment
(behavior → `GROUP BY distinct_id HAVING count(...) {op} {n}` over the window; `did_not` → users absent
from that set; property → matches via `resolveProperty`). `all` intersects the id-sets, `any` unions
them. The resolved cohort is a `distinct_id IN (<subquery>)` predicate — never a materialized id list
spliced into SQL. **Cohort as a filter:** §14 insights, §15 funnels, and §15 retention bodies accept an
optional top-level `"cohort_id": "<uuid>"`; the engine loads that cohort's definition, compiles it, and
AND-joins the `distinct_id IN (…)` predicate into the query (still fully parameterized).

### Cohorts API (`/api/v1/projects/:projectId/cohorts`)
- `GET /cohorts` → `{ "cohorts": [ { "id","name","created_by","created_at","updated_at" } ] }` (viewer+).
- `POST /cohorts` (analyst+) body `{ "name", "definition" }` → `201` cohort object. `400` if the
  definition fails the cohort zod schema.
- `GET /cohorts/:id` → cohort incl. `definition`. `PATCH /cohorts/:id` (analyst+) name/definition.
  `DELETE /cohorts/:id` (analyst+) → `204`.
- `GET /cohorts/:id/preview` → `{ "count": N, "sample": ["distinct_id", …up to 20] }` — runs the cohort
  and returns its size + a sample (viewer+). `uniqExact` for the count.

### Saved reports API (`/api/v1/projects/:projectId/reports`)
- `GET /reports?kind=<kind?>` → `{ "reports": [ { "id","name","kind","created_by","updated_at" } ] }`.
- `POST /reports` (analyst+) `{ "name","kind","definition" }` → `201`. The `definition` is validated with
  the zod schema for its `kind` (§14 insights / §15 funnel|retention|flows) — `400` on mismatch.
- `GET /reports/:id` (incl. definition) · `PATCH /reports/:id` · `DELETE /reports/:id` (analyst+, `204`).
- `POST /reports/:id/run` (viewer+) → executes the stored definition through the existing engine and
  returns that analysis's normal response shape (re-validated first). Accepts an optional body
  `{ "date_range"?, "cohort_id"? }` override merged over the stored definition.

### Dashboards API (`/api/v1/projects/:projectId/dashboards`)
- `GET /dashboards` → `{ "dashboards": [ { "id","name","tile_count","updated_at" } ] }`.
- `POST /dashboards` (analyst+) `{ "name" }` → `201`. `GET /dashboards/:id` →
  `{ "id","name","tiles": [ { "id","title","kind","saved_report_id","inline_definition","x","y","w","h","position" } ] }`.
  `PATCH /dashboards/:id` (name) · `DELETE /dashboards/:id` (analyst+, `204`, cascades tiles).
- Tiles: `POST /dashboards/:id/tiles` (analyst+) `{ "title","saved_report_id"? | "inline_definition"?,"kind","x","y","w","h" }`
  → `201` tile; `PATCH /dashboards/:id/tiles/:tileId` (move/resize/retitle); `DELETE …/tiles/:tileId` (`204`).
  `PATCH /dashboards/:id/layout` (analyst+) `{ "tiles": [ { "id","x","y","w","h","position" } ] }` batch-saves
  the grid after a drag. Validate the 12-col bounds server-side.
- `GET /dashboards/:id/data` (viewer+) → runs every tile's definition and returns
  `{ "tiles": [ { "id", "result": <analysis response> | { "error": "<detail>" } } ] }` — one tile failing
  never fails the dashboard.

### Dashboard frontend (React)
New routes `/projects/$projectId/{cohorts,reports,dashboards,dashboards/$dashboardId}` + nav tabs.
- **Cohorts**: list + a builder (condition rows: behavior/did_not/property) with a live `preview` count.
- **Reports**: list; "Save current view as report" wired from the Insights/Funnels/Retention/Flows
  builders (their existing query-definition state IS the saved `definition`); a report page renders via
  `/run` using the Phase 3–4 chart components keyed by `kind`.
- **Dashboards**: list; a dashboard view renders a **CSS-Grid 12-column** board of tiles, each tile
  rendering the matching chart from `/dashboards/:id/data`. Drag-to-reorder and **discrete resize**
  (per-tile column-span / height steppers — NOT free-form drag-resize) persisted via
  `/layout` — implemented with native pointer events + CSS Grid, **no new drag-drop dependency** (honors
  the "minimize packages" constraint; discrete resize is also far less bug-prone). "Add tile from report"
  picker. Cohort filter selectable on Insights/Funnels/Retention builders (sets `cohort_id`).

Verification: unit tests (cohort/report/dashboard zod schemas incl. the exactly-one-of tile rule and
12-col bounds; cohort compiler SQL shape + injection regression like §14/§15), a real-stack e2e proving
a known cohort resolves to the exact expected users AND that a cohort-filtered insight returns the
narrowed counts, dashboard tile CRUD + `/data` batch-run, and a dashboard-frontend functional test.

## 17. Identity resolution — anonymous → identified merge (added 2026-07-05)

Fixes: a user tracked anonymously and THEN logged in shows up as **two different users**. The SDK
already emits the link — on `identify(userId)` it sends a reserved `$identify` event whose
`distinct_id` is the new `userId` and which carries property `$anon_id` = the pre-login id (§4). Events
before login have `distinct_id = anon_id`; after login `distinct_id = userId`. Nothing on the backend
consumed `$identify`, so the two id-spaces were never merged. This section makes the analytics read side
resolve `anon_id → userId`.

### ClickHouse alias map (reuse the EXISTING `analytics.identity_mappings` table; add only the MV to `infra/clickhouse/init.sql`, idempotent)
- Table `analytics.identity_mappings (project_id UUID, anon_id String, canonical_id String, created_at DateTime64(3))` `ENGINE = ReplacingMergeTree(created_at) ORDER BY (project_id, anon_id)` **already exists** (§5 DDL / init.sql) but was never populated or read — do NOT create a new table, wire this one up.
- MV `identity_mappings_mv` on `events`: `WHERE event = '$identify' AND JSONExtractString(toJSONString(properties), '$anon_id') != ''`
  → `SELECT project_id, JSONExtractString(toJSONString(properties),'$anon_id') AS anon_id, distinct_id AS canonical_id, timestamp AS created_at`.
  (`$identify`/`$anon_id`/`$alias` are OUR fixed reserved constants — embedded as SQL literals, never bound from user input, matching how `$session_end`/`$duration_ms` are handled in §14.)

### Canonicalization (read side, injection-safe)
Provide a single reusable helper (a `WITH aliases AS (SELECT project_id, anon_id, argMax(canonical_id, created_at) AS canonical_id FROM identity_mappings WHERE project_id = {projectId:UUID} GROUP BY project_id, anon_id)` CTE + a `LEFT JOIN … ON e.distinct_id = aliases.anon_id` yielding `coalesce(aliases.canonical_id, e.distinct_id) AS uid`). Single-level resolution (anon→user) is sufficient; do not chain. Apply `uid` (the canonical id) instead of raw `distinct_id` in:
- **Users explorer** — `GET /users` (group/count by `uid`; `distinct_id` shown is the canonical `uid`; search matches the canonical id prefix) and `GET /users/:distinctId` (a profile for id `X` includes events from `X` **and** from every `anon_id` whose canonical is `X` — i.e. filter on `uid = {id}` after resolution; also resolve when the caller passes an `anon_id` that aliases to a user, redirect/return the canonical profile). This is the primary visible fix.
- **Insights `unique_users`** — `uniqExact(uid)` instead of `uniqExact(distinct_id)`.
- **Funnels / retention / flows** unique-user counts SHOULD use `uid` too (same helper); if any is deferred, say so in the report.

`total` (event counts via `count(DISTINCT insert_id)`) is unaffected. Raw-event queries stay authoritative/exact.

### Verification
Real-stack e2e (`backend/test/e2e/identity-resolution.e2e-spec.ts`, following `analytics.e2e-spec.ts`):
ingest a KNOWN sequence for one physical user — N anonymous events with `distinct_id = <anon>`, then an
`$identify` event (`distinct_id = <user>`, `$anon_id = <anon>`), then M identified events with
`distinct_id = <user>` — plus a separate unrelated user. Assert: `GET /users` returns **one** merged user
for that person (not two), the merged profile's `event_count` = N + M (+ the identify event), and an
insights `unique_users` over the whole set counts that person **once**. Unit tests for the canonicalization
SQL builder (shape + that it never interpolates user input).

## 18. Screenshot capture pipeline — DEV/REFERENCE captures (added 2026-07-05, v2; model revised 2026-07-06)

Page images for the path map + click heatmap are **reference** screenshots captured by the DEVELOPER in a debug build (SDK → backend → dashboard), **not** collected from every user. Revised model (2026-07-06) — the earlier per-user "once per version" auto-upload was replaced because per-user uploads don't scale (storage cost) and carry PII risk. Now: capture is **off by default** and runs **only in `kDebugMode`** (release/production builds never capture or upload); the developer enables it in a debug build, walks each screen once to populate the ADMIN's single reference image per screen, and can RETAKE. The backend still keeps exactly one image per `(project, screen, app_version)`.

### SDK (Flutter, debug-only, off by default)
- Config `autocaptureScreenshots` (**default FALSE**) + `SdkOverrides.screenshotCapturer`/`screenshotSettleDelay` test seams. Wiring is gated on `config.autocaptureScreenshots && (kDebugMode || injected-capturer)` — a release build NEVER captures/uploads. Meaningful screen names require NAMED routes (`RouteSettings(name:)`); `MyAmpMixObserver` also accepts an optional `screenNameExtractor`.
- Capture waits for the navigation transition to actually FINISH before rendering — the production capturer polls `WidgetsBinding.hasScheduledFrame` between frames until the UI stops animating (capped ~2.5s), so the frame is settled, not grabbed mid-animation (a fixed delay isn't robust across transition durations/devices). `MyAmpMix.instance.retakeScreenshots()` clears the local once-per-version markers so screens re-capture (pair with deleting the stored image via the DELETE endpoint below).
- On `$screen_view`, capture the current frame via a root `RepaintBoundary` (`RenderRepaintBoundary.toImage`) → downscale to ≤ 640px longest side → JPEG q≈70. **Throttle — capture each screen ONCE PER APP VERSION:** the SDK persists the set of already-captured `(screen_name, app_version)` pairs in the `keyValueStore`, so a given screen is captured+uploaded only the first time it is viewed under the current `app_version`, and NEVER again for that version — across sessions and app relaunches (a screen's layout only changes between releases). A new `app_version` re-captures each screen exactly once. (Persisted marker keyed by `app_version` so upgrading invalidates old markers.) Never-throw (design §13): any capture/encode/upload failure is dropped silently and does NOT mark the pair captured (so it retries next launch).
- **Privacy**: a `MyAmpMixPrivacy(child: …)` widget masks its subtree (solid block) in captures; document that developers should wrap PII/input fields. MVP does not auto-mask all text — call this out in HOW-TO-USE.md.
- Upload: `POST /ingest/screenshots` (multipart/form-data) `Authorization: Bearer <sdk_token>`, fields: `screen_name`, `app_version`, `width`, `height`, `image_hash`, `image` (JPEG bytes). → `202 {"stored": bool}` (backend may reject a dup/over-cap without error). Rate-limited per token.

### Backend (storage strategy: image bytes in **Firebase Storage**, metadata in Postgres)
The image BYTES live in **Firebase Storage** (a Google Cloud Storage bucket, via `firebase-admin`); Postgres holds only metadata + the object path. This matches the GCP/Cloud-Run deployment and keeps the DB small.
- Abstract storage behind a `ScreenshotStorage` PORT (interface: `put(objectPath, bytes, contentType)`, `getStream(objectPath)` / `signedUrl(objectPath)`, `delete(objectPath)`). Two adapters: a **Firebase** adapter (prod, `firebase-admin` `getStorage().bucket()`) and an **in-memory fake** adapter used by tests AND as the automatic fallback in local dev when Firebase is not configured (so the app still boots + works without credentials). Select by config.
- Config (validated app-config): `FIREBASE_STORAGE_BUCKET` (bucket name) + credentials via `GOOGLE_APPLICATION_CREDENTIALS` (service-account JSON path) or Application Default Credentials; when unset → use the in-memory fake adapter and log a clear warning (dev/test). Also `SCREENSHOT_MAX_KB` (default 512). Add to `.env.example`. Never commit a service-account key.
- Postgres table `screen_captures(id uuid, project_id fk, screen_name, storage_path text, content_type, width int, height int, app_version, image_hash, captured_at, updated_at)` — **no bytea**; `storage_path` is the object path in the bucket: `screens/{screen_name}/{app_version}.jpg` (URI-encoded segments; NO `project_id` segment — cleaner paths for a single-project bucket; per-project isolation lives in the row's `project_id` + the unique key. If one bucket ever serves multiple projects, re-add a `{project_id}` segment to avoid cross-project object collisions). Unique **`(project_id, screen_name, app_version)`** — exactly ONE image per screen per app version. `POST /ingest/screenshots` UPSERTs: put the bytes to Firebase at the deterministic path (overwrites), upsert the metadata row. Storage bounded (#screens × #versions). Prisma migration `v2_screen_captures`.
- `POST /ingest/screenshots` (ingest module, SDK-token auth): validate size (≤ `SCREENSHOT_MAX_KB`) + content-type (image/jpeg); put to Firebase Storage; upsert metadata. `202 {"stored": true}`; `413` too large; `401`.
- Read (membership-gated, viewer+): `GET /api/v1/projects/:projectId/screens` → `{screens:[{screen_name, capture_count, latest_captured_at, width, height}]}`. `GET /api/v1/projects/:projectId/screens/:screenName/image?app_version=<optional>` → **the JPEG image** (Content-Type image/jpeg, Cache-Control), newest version if unspecified — the endpoint either streams the bytes proxied from Firebase Storage OR `302`-redirects to a short-lived signed URL (implementation choice; the RESPONSE the client/browser sees is the image, so the dashboard's `ScreenImage` needs no change). `404` if none.
- **Retake/delete** (analyst+): `DELETE /api/v1/projects/:projectId/screens/:screenName?app_version=<optional>` → deletes the Firebase object(s) + metadata row(s) for that screen (all versions, or one when `app_version` given) → `204`. Used by the dashboard's "Retake" (delete then the developer re-captures via `retakeScreenshots()` + re-navigating in a debug build) and "Delete" actions. Never fails on a missing object (`ignoreNotFound`).

Verification: SDK unit test of the capture→hash→throttle→upload mapping via an injected fake capturer (no real rendering). Backend e2e uses the **in-memory fake `ScreenshotStorage`** (no real Firebase): POST /ingest/screenshots stores + upserts (re-send same triple replaces; new version adds a row); GET /screens lists; GET image returns the bytes; membership + token auth enforced; oversize → 413. The Firebase adapter itself is thin and integration-only (not unit-tested), same policy as native/external code.

## 19. v2 analytics — click heatmap, screen paths, engagement metrics, templates (added 2026-07-05, v2)

All read endpoints under `/api/v1/projects/:projectId/...`, viewer+ membership, FULLY parameterized ClickHouse (reuse §14 `resolveProperty`/filter-compiler/date handling), and — where users are counted — the §17 canonical `uid`.

### POST /query/click-heatmap
Body: `{ "screen_name": "checkout", "date_range": {from,to}, "grid": { "cols": 20, "rows": 40 }, "filters": [] }` (cols/rows 1..100). Engine: over `$tap` events with `$screen_name = {screen:String}`, normalize each tap to `[0,1]²` via `$pos_x / screen_width`, `$pos_y / screen_height` (context columns; skip rows with 0 width/height), bucket into the `cols×rows` grid, `count()` per cell. → `{ "screen_name", "total": N, "cells": [ { "cx", "cy", "count" } ] }` (cx∈0..cols-1, cy∈0..rows-1; empty cells omitted). Powers the heatmap overlay on the screen's screenshot.

### POST /query/screen-paths
Like §15 flows BUT nodes are **screens** (the `$screen_name` property of `$screen_view` events), not event names — the existing flows engine keys nodes on event name, which can't distinguish screens. Body: `{ "anchor_screen"?: "home", "direction": "forward"|"backward", "date_range", "steps": 1..5, "max_nodes_per_step": 1..20, "unit": "session"|"user" }` (omit `anchor_screen` → start from the top entry screens). Per unit, order `$screen_view` by timestamp, take the `$screen_name` sequence, aggregate transitions `uniqExact(uid)`, top-N per step + `$other`/`$end`. → same Sankey shape as §15 flows (`{nodes:[{id,step,event:screen_name,value}], links:[{source,target,value}]}`). This is the user-path-map data source.

### GET /metrics/engagement?from=&to=&interval=day|week|month
Active-user + stickiness metrics using canonical `uid` (§17). → `{ "active": [ {"t","dau"|"wau"|"mau" as chosen by interval, "value"} ], "stickiness": [ {"t","value"} ] (DAU/MAU ratio), "new_vs_returning": [ {"t","new","returning"} ] }`. "New" = uid whose first-ever event is in the bucket; "returning" = active uid seen before the bucket. Reuses the rollup MVs where exact-safe; raw events otherwise.

### Templates (Amplitude-parity, seeded server-side)
- `GET /api/v1/templates` (auth) → `{ "templates":[ {"id","name","description","kind_counts"} ] }`. Fixed catalog: `acquisition`, `activation-funnel`, `engagement`, `retention`, `revenue`, `product-usage`, `user-paths`. Each is a code-defined bundle of saved-report definitions (§14/§15) + a dashboard layout (§16).
- `POST /api/v1/projects/:projectId/templates/:templateId/apply` (analyst+) → materializes the bundle as real Cohorts/SavedReports/Dashboard rows (§16) in the project and returns `{ "dashboard_id" }`. Idempotency: name-suffix or skip-if-exists; state it.

Verification: click-heatmap e2e (known taps at known normalized positions → exact cell counts); screen-paths e2e (known screen sequence → exact nodes/links incl `$end`); engagement e2e (known active users across days → exact DAU/MAU/stickiness); template-apply e2e (creates the expected reports+dashboard). Unit tests for each compiler (shape + injection-safety).

## 20. Configurable logging (added 2026-07-06)

Both the backend and the SDK expose a log-LEVEL setting so operators/developers control verbosity.

### Backend — `LOG_LEVEL` env (validated app-config §3)
`LOG_LEVEL` ∈ `fatal|error|warn|info|debug|trace|silent`, **default `info`**. Wires the pino logger's base `level`. **HTTP request auto-logging (pino-http) is emitted per-response at: `debug` for 2xx/3xx, `warn` for 4xx, `error` for 5xx** — so at the default `info`, successful-request logs are SUPPRESSED (only shown when `LOG_LEVEL=debug`/`trace`), while application logs (info) and client/server error requests still surface. Implement via `LoggerModule.forRootAsync` injecting the config: set `pinoHttp.level = config.logLevel` and a `customLogLevel(req,res,err)` returning the mapping above. Add `LOG_LEVEL` to `.env.example`.

### SDK — `MyAmpMixConfig.logLevel` (Dart)
Public enum `MyAmpMixLogLevel { none, error, warn, info, debug }` (ascending verbosity). `MyAmpMixConfig.logLevel` **default `none`** (silent — preserves today's default-quiet behavior). Back-compat: when `logLevel` is left at its default and the existing `debug: true` flag is set, the effective level is `debug`. `MamLogger` filters by the effective level: internal diagnostics log at `debug`, error-carrying diagnostics at `error`; still gated to `kDebugMode` as today (the SDK never prints in release builds). Existing `debug` flag stays for back-compat.
