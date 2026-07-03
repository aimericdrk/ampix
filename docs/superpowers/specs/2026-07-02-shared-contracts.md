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
      "properties": { "plan": "pro", "value": 9.99 },         // flat JSON, optional
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
`$first_open`, `$app_open`, `$app_background`, `$session_start`, `$session_end` (property `$duration_ms`), `$screen_view` (`$screen_name`, `$previous_screen`, `$time_on_previous_ms`), `$tap` (`$widget_type`, `$widget_label`, `$screen_name`, `$pos_x`, `$pos_y`), `$rage_tap`, `$identify`, `$campaign_touch`. Reserved property prefix: `$`.

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
