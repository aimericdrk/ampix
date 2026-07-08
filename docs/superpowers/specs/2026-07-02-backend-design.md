# MyAmpix Backend (NestJS) — Design Specification

**Date:** 2026-07-02
**Status:** Approved design
**Conforms to:** `docs/superpowers/specs/2026-07-02-analytics-platform-design.md` (master design) and `docs/superpowers/specs/2026-07-02-shared-contracts.md` (shared contracts). Where this document and the shared contracts disagree, the shared contracts win.

## 1. Scope

Design of the `backend/` NestJS application across all delivery phases (1–7), plus the shared `packages/contracts` workspace package. Phase 1 (foundation & ingestion) has an executable plan in `docs/superpowers/plans/2026-07-02-backend-ingestion-phase1.md`; later phases get their own plans when their phase starts.

Two API surfaces in one codebase, two Cloud Run services from the same image:

- **`api` service** — `/ingest/*` (SDK-token auth, hot path) and `/api/v1/*` (dashboard, JWT auth). Scales 0→N, concurrency ~80, port **8080**.
- **`worker` service** — BullMQ consumers + repeatable jobs, separate entrypoint (`src/worker.ts`), no public routes except `/health`. `min-instances=1`, CPU always allocated.

## 2. Stateless Cloud Run constraints (binding design rules)

Any instance can be killed at any time and any request can land on any instance. Therefore:

1. **No in-process buffering.** `/ingest` writes synchronously to ClickHouse with `async_insert=1, wait_for_async_insert=1`: ClickHouse buffers and batches server-side; the HTTP 202 is only returned after ClickHouse durably acked the rows. An instance dying loses nothing that was acknowledged.
2. **Idempotent ingestion.** Every event carries an SDK-generated UUID `insert_id` which is part of the `events` sorting key (ReplacingMergeTree). Retried batches collapse on background merges. Because dedup is eventual, all exactness-sensitive queries use `count(DISTINCT insert_id)`, never bare `count()`.
3. **All shared state in Redis or the databases**: SDK-token cache (Redis, TTL 60 s), rate-limit windows (Redis ZSETs), BullMQ queues (Redis), metadata (Postgres), events (ClickHouse). Nothing instance-local is load-bearing. No `@nestjs/schedule` in the api service.
4. **Graceful SIGTERM drain.** `app.enableShutdownHooks()`; on SIGTERM Nest stops accepting connections, drains in-flight requests, then `onApplicationShutdown` closes the ClickHouse client, Redis connection(s), and Prisma pool — all within Cloud Run's 10 s window. The worker additionally calls `worker.close()` on its BullMQ workers so in-progress jobs finish or are returned to the queue.
5. **Ingestion writer behind an interface** (`EventSink`) so Pub/Sub or a ClickHouse cluster can replace the direct writer later without touching business logic (master design §2, cost note 5).

## 3. Module map

All modules live under `backend/src/<module>/`. Global infrastructure modules (`config`, `prisma`, `redis`, `clickhouse`, `common`) are `@Global()`.

| Module | Phase | Responsibility |
|---|---|---|
| `config` | 1 | Zod-validated env loader (contracts §3); crashes boot on invalid config. |
| `common` | 1 | RFC 7807 problem details (exception + global filter), JSON/gzip body parsing, pino logger setup, shared decorators. |
| `prisma` | 1 | PrismaService (Postgres, contracts §6). |
| `redis` | 1 | Shared ioredis client provider (`REDIS` token). |
| `clickhouse` | 1 | `ClickHouseService` wrapper over `@clickhouse/client` with async-insert settings; row types. |
| `ingestion` | 1 | `/ingest/events`, `/ingest/profiles`; SDK-token guard, rate limiting, validation/normalization, ClickHouse writes. |
| `health` | 1 | `/health` (liveness), `/health/ready` (Postgres + ClickHouse + Redis probes). |
| `auth` | 2 | Signup/login/refresh/logout, JWT access (15 min, in memory) + refresh (30 d, httpOnly cookie, hashed in `refresh_tokens`), password hashing (argon2id). |
| `orgs` | 2 | Organizations, memberships, roles (admin/analyst/viewer), invitation links (signed token, `invitations` table). |
| `projects` | 2 | Projects CRUD, SDK token issue/revoke (`sdk_tokens`), project settings; revoke invalidates the Redis token cache immediately. |
| `identity` | 3 | identify/alias handling → `identity_mappings`; canonical-id resolution helpers for the query engine. |
| `analytics` | 3–4 | Query engine (JSON definition → parameterized ClickHouse SQL); insights, live feed, sessions (3); funnels, retention, flows (4). |
| `users` | 3 | Profile explorer (filter/search over `user_profiles`), per-user activity timeline. |
| `cohorts` | 5 | Cohort definition engine (behavioral + property conditions), materialization + scheduled refresh (worker). |
| `dashboards` | 5 | Saved reports (stores the same JSON query definition), dashboard layouts (Postgres). |
| `attribution` | 6 | Encrypted ad-account credentials, Meta Marketing API / TikTok Events API enrichment jobs, attribution reports. |
| `export` | 7 | CSV/JSON streaming exports of any report or raw event slice. |
| `gdpr` | 7 | Delete/export by `distinct_id` (ClickHouse lightweight mutations, Postgres scrub), executed as jobs. |
| `jobs` | 3+ | BullMQ queue registrations, producers, processors; worker entrypoint module. |

### Inter-module interfaces (what other modules may import)

```ts
// config
export const APP_CONFIG: 'APP_CONFIG';
export interface AppConfig { nodeEnv; port; databaseUrl; clickhouse: {url; user; password; database}; redisUrl; jwtAccessSecret?; jwtRefreshSecret?; ingestMaxBatch; ingestMaxBodyKb; ingestRateLimitPerMin; }
export function loadConfig(env?: NodeJS.ProcessEnv): AppConfig;

// common
export class ProblemException extends HttpException { constructor(init: { status: number; title: string; detail?: string; type?: string; errors?: unknown; retryAfterSeconds?: number }) }
export class ProblemDetailsFilter implements ExceptionFilter {}

// clickhouse
export interface EventSink { insertEvents(rows: EventRow[]): Promise<void>; }   // ClickHouseService is the phase-1 impl
export class ClickHouseService implements EventSink {
  insertEvents(rows: EventRow[]): Promise<void>;
  insertProfiles(rows: ProfileRow[]): Promise<void>;
  query<T>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  ping(): Promise<boolean>;
}

// ingestion (consumed by projects for cache invalidation)
export function sdkTokenCacheKey(token: string): string;      // `sdk_token:${token}`

// identity (consumed by analytics)
export class IdentityService {
  recordMappings(projectId: string, rows: IdentityMappingRow[]): Promise<void>;
  canonicalIdJoin(eventsAlias: string): string;  // SQL fragment: LEFT JOIN identity_mappings → coalesce(canonical_id, distinct_id)
}

// analytics (consumed by dashboards, export)
export class QueryEngine { compile(projectId: string, def: AnalyticsQuery): CompiledQuery; }
export interface CompiledQuery { sql: string; params: Record<string, unknown>; }

// orgs / projects (consumed by every /api controller)
export class RolesGuard {}                 // @MinRole('analyst')
export class ProjectAccessGuard {}         // :projectId → org membership check
```

## 4. `packages/contracts` — shared workspace package

Single source of truth for every payload that crosses a service boundary. Consumed by `backend` (runtime validation) and `dashboard` (types + client). The Flutter SDK conforms by contract test (it cannot import TS).

- **Name:** `@myampix/contracts`, private, `main: dist/index.js`, built with `tsc`. Dependency: `zod` only (keep it lean — the dashboard bundles it).
- **Phase 1 exports (ingest):** `ingestEventSchema`, `eventContextSchema`, `ingestEventsRequestSchema`, `profileOperationSchema`, `ingestProfilesRequestSchema`, types `IngestEvent`, `EventContext`, `ProfileOperation`, `ProfileOp`, `IngestResponse { accepted: number; rejected: RejectedItem[] }`, `RejectedItem { index: number; reason: string }`, `SDK_TOKEN_REGEX = /^mam_[0-9a-f]{32}$/`, reserved-name constants (`RESERVED_EVENTS`, `RESERVED_PROPERTY_PREFIX = '$'`).
- **Phase 3+ exports (query definitions):** `insightsQuerySchema`, `funnelQuerySchema`, `retentionQuerySchema`, `flowsQuerySchema` + inferred types; `SeriesResponse` per contracts §7. The dashboard report builder produces these objects, saved reports store them verbatim (JSONB in Postgres), and the backend validates them with the same schema it compiles from — zero drift by construction.
- **OpenAPI:** the backend emits `packages/contracts/openapi/openapi.json` (see §10); the dashboard generates its typed client from that file. Ingest DTOs and query DTOs are declared once as Zod and surfaced to Swagger via `nestjs-zod` (`createZodDto`), so Zod remains the single source.

## 5. Ingestion pipeline (phase 1, authoritative behavior = contracts §4)

```
request → gzip-aware JSON body parser (limit INGEST_MAX_BODY_KB) → SdkTokenGuard → IngestRateLimitGuard
        → envelope check (events/operations array, ≤ INGEST_MAX_BATCH)
        → per-item Zod validation (accept/reject, never all-or-nothing)
        → normalization (timestamp clamp to [now−7d, now+5min], server_timestamp, context → typed columns, null → '')
        → ClickHouseService.insertEvents (async_insert=1, wait_for_async_insert=1)
        → 202 { accepted, rejected: [{index, reason}] }
```

- **Auth:** `Authorization: Bearer mam_<32hex>`. Lookup order: Redis `sdk_token:<token>` (JSON `{projectId|null}`, TTL 60 s) → Postgres `sdk_tokens` (must exist and `revoked_at IS NULL`) → cache result (negative results cached too, protecting Postgres from invalid-token floods). Token revocation (phase 2 `projects` module) deletes the cache key, so revocation is immediate on the revoking path and ≤60 s stale otherwise.
- **Rate limiting:** Redis sliding window, 1000 req/min per token (contracts §4), implemented with a ZSET (`zremrangebyscore` + `zadd` + `zcard` + `pexpire` in one MULTI). 429 responses carry `Retry-After`. Limit value is configurable only for tests (`INGEST_RATE_LIMIT_PER_MIN`, default 1000).
- **Errors:** RFC 7807 everywhere — 400 malformed JSON / bad envelope / oversize batch, 401 bad token, 413 body over limit, 429 rate limit.
- **Profiles:** operations validated per-item, grouped by `distinct_id`, current state read with `SELECT ... FINAL`, ops applied in timestamp order (`set`, `set_once`, `increment`, `append`, `unset`, `delete`), one new `user_profiles` row per user (ReplacingMergeTree(updated_at) — latest wins). Read-modify-write is acceptable because profile ops are orders of magnitude rarer than events; contention across instances resolves via last-write-wins on `updated_at`, which matches Mixpanel semantics closely enough for v1.

## 6. Identity merge semantics

- Events are stored with the `distinct_id` the SDK knew at send time; **no retroactive rewriting of event rows**. Merging happens at query time.
- `identify(userId)`: SDK sends `$identify` with `distinct_id = userId`, `anon_id = device anon id`. The ingestion path (phase 3 hook in `identity`) writes `identity_mappings(project_id, anon_id → canonical_id = userId)`. First mapping wins: the `identity` module refuses to overwrite an existing `anon_id` row with a different canonical id (ReplacingMergeTree would keep the latest, so the module checks before insert; conflicting identifies are dropped and logged).
- `alias(newId)`: writes `identity_mappings(newId → existing canonical id)` — the alias occupies the `anon_id` key slot, pointing at the canonical id.
- `reset()`: SDK rotates its anon `distinct_id`; no server-side unlink.
- **Query-time resolution:** every user-scoped aggregation resolves `coalesce(m.canonical_id, e.distinct_id)` via `LEFT JOIN identity_mappings m ON m.project_id = e.project_id AND m.anon_id = e.distinct_id` (helper fragment from `IdentityService.canonicalIdJoin`). If join cost becomes measurable, the upgrade path is a ClickHouse dictionary over `identity_mappings` (`dictGetOrDefault`) — same semantics, no API change.

## 7. Query engine (`analytics`)

Master design §4: every report endpoint accepts a typed JSON query definition; a compiler produces **parameterized** ClickHouse SQL. User input is never interpolated into SQL text.

**Definition shape** (contracts §7 for insights; funnels/retention/flows extend the same vocabulary):

```ts
interface InsightsQuery {
  events: { name: string; aggregation: 'total' | 'unique_users' }[];
  date_range: { from: string; to: string };            // ISO dates, project timezone applied at query time
  interval: 'hour' | 'day' | 'week' | 'month';
  filters?: FilterLeaf[];                               // flat array = AND; phase 4 adds nested {and:[...]}/{or:[...]} groups, backward compatible
  breakdown?: { property: string };
  formulas?: { expression: string; label: string }[];   // e.g. "A / B" over event series
}
type FilterLeaf = { property: string; op: 'eq'|'neq'|'contains'|'set'|'not_set'|'gt'|'lt'; value?: string | number | boolean };
```

**Compiler pipeline:** Zod-validate definition → resolve each `property` to either a typed column (whitelist map: `os`, `app_version`, `utm_source`, …) or a `properties` JSON path → build SQL AST → render with `{name:Type}` query params. Rules:

- Values always bind via `query_params` (`{f0:String}`, `{from:DateTime64(3)}`, …).
- Property identifiers cannot be bound as params, so they are validated against `^[A-Za-z0-9_$.]{1,255}$`, resolved through the column map, and JSON paths are emitted as backtick-quoted subcolumn access on `properties` only after validation. The unit suite includes an exhaustive injection corpus (quotes, backticks, `;`, `--`, unicode homoglyphs) that must all be rejected or neutralized.
- Timezone: `date_range`/`interval` bucketing uses `toStartOfInterval(timestamp, INTERVAL 1 day, {tz:String})` with the project timezone (Postgres `projects.timezone`); storage stays UTC (contracts §9).
- Exact counts use `count(DISTINCT insert_id)`; unique users use `uniqExact(canonical_id)` (see §6). Phase-3 rollup MVs (daily actives, daily event counts, daily session stats) are consulted first by a planner step when the definition is rollup-compatible (no property filters/breakdowns beyond rollup dimensions); raw `events` otherwise.

**Report type → ClickHouse functions:**

| Report | Core functions |
|---|---|
| Insights | `count(DISTINCT insert_id)`, `uniqExact()`, `toStartOfInterval`, conditional `countIf`/`uniqExactIf` for multi-event series; formulas computed in TS over aligned series. |
| Funnels | `windowFunnel(window_sec)(timestamp, event = {s0:String}, event = {s1:String}, …)` per canonical user, then `GROUP BY level`; strict-order variant `windowFunnel(window, 'strict_order')`; breakdowns wrap the inner query. |
| Retention | `retention(cond_0, cond_1, …, cond_n)` per canonical user with day-bucket conditions (`toDate(timestamp, tz) = {d0:Date}` …), summed into the cohort triangle; custom return events parameterize the conditions. |
| Flows | per-session ordered event arrays via `groupArray((timestamp, event))` + `arraySort`; transitions from `arrayZip(arrayPopBack(names), arrayPopFront(names))` then `ARRAY JOIN` + `GROUP BY (prev, next)`; path filtering via `sequenceMatch('(?1).*(?2)')`. Depth-limited (default 5 steps) around an anchor event. |
| Sessions | `$session_start`/`$session_end` events (SDK-computed, `$duration_ms`); rollup MV for daily session stats; worker finalizes orphan sessions. |
| Live feed | simple `ORDER BY timestamp DESC LIMIT {n}` with cursor `before` on `(timestamp, insert_id)`. |

Every compiled query is capped: `max_execution_time`, `max_rows_to_read`, `max_result_rows` set per request via `clickhouse_settings` so one bad report cannot starve the VM.

## 8. Worker service & BullMQ job catalog

Same NestJS codebase, second entrypoint `src/worker.ts` bootstrapping `WorkerModule` (infra modules + `jobs` + `/health` only; no ingest/api controllers). Deployed as Cloud Run service `worker`, `min-instances=1`. Queues live in Redis; every processor is idempotent (jobs carry deterministic job ids) because Cloud Scheduler triggers and BullMQ repeatables can overlap.

| Queue | Job | Trigger | Phase | Behavior |
|---|---|---|---|---|
| `sessions` | `finalize-stale-sessions` | Cloud Scheduler → authenticated HTTP on worker (belt-and-braces: BullMQ repeatable every 10 min) | 3 | Synthesize `$session_end` for sessions with no end event and last activity > 30 min old (duration = last event − start). |
| `cohorts` | `refresh-cohort:<cohortId>` | repeatable per cohort (default 15 min) | 5 | Re-evaluate definition, rewrite membership snapshot. |
| `attribution` | `sync-meta-campaigns`, `sync-tiktok-campaigns` | hourly repeatable | 6 | Pull campaign/adset metadata with stored encrypted credentials; enrich attribution reports. |
| `gdpr` | `delete-distinct-id`, `export-distinct-id` | on demand (API enqueue) | 7 | ClickHouse `ALTER TABLE ... DELETE` lightweight mutations + Postgres scrub; export streams to GCS-signed URL. |
| `maintenance` | `clickhouse-parts-report`, `backup-verify` | daily | 7 | Operational hygiene, alerts via log-based metrics. |

Concurrency defaults: 1 per queue except `attribution` (2). Failed jobs: exponential backoff, `attempts: 5`, dead-letter via BullMQ `failed` set surfaced on a worker health endpoint.

## 9. Cross-cutting design

- **Errors — RFC 7807:** single global `ProblemDetailsFilter` (`@Catch()`): `ProblemException` passes through; other `HttpException`s are converted (status → canonical title, response message → `detail`); body-parser errors map to 400/413/415; everything else becomes a logged 500 with no internals leaked. `Content-Type: application/problem+json`, `instance` = request URL, optional `errors` member for field-level issues, `Retry-After` header for 429.
- **Logging — pino** via `nestjs-pino`: request-scoped logger, `genReqId` = incoming `x-request-id` or UUID, `authorization` header redacted, JSON to stdout (free Cloud Logging), `pino-pretty` only in dev. Request id is echoed in the `x-request-id` response header.
- **Health:** `GET /health` liveness (always 200, no I/O — Cloud Run probe). `GET /health/ready` checks Postgres (`SELECT 1`), ClickHouse (`ping`), Redis (`PING`); 503 + per-check booleans when any fails.
- **Metrics:** Prometheus-style `/metrics` (prom-client, default registry + counters: ingested events, rejected items, rate-limit hits, ClickHouse insert latency histogram). Phase 3.
- **OpenAPI:** `@nestjs/swagger` decorators on all `/api/v1` controllers + `nestjs-zod` DTOs from contracts schemas; a build script (`pnpm openapi:emit`) instantiates the app without listening and writes `packages/contracts/openapi/openapi.json`; the dashboard generates its typed client (openapi-typescript + openapi-fetch) from that artifact in its build. CI diffs the emitted spec to force regeneration on drift. `/ingest` is documented in the same spec (tagged `ingest`) for SDK implementers.
- **Security:** SDK tokens `mam_` + 32 hex (crypto random); JWT per contracts §7; roles enforced by `RolesGuard` matrix (admin > analyst > viewer); ad-account credentials encrypted at rest with AES-256-GCM under a key from Secret Manager-injected env (phase 6); no PII in logs.

## 10. Testing strategy

| Level | Tooling | Scope & conventions |
|---|---|---|
| Unit (`src/**/*.spec.ts`) | Jest + ts-jest | Pure logic with fakes: config loader, problem filter, normalizer (clamping, reject reasons), profile op application, guards with fake Redis/Prisma, query compiler (exhaustive cases incl. injection corpus). Coverage floor **85% lines** (CI-enforced, contracts §9). |
| Integration (`test/integration/**/*.int-spec.ts`) | Jest + Testcontainers | Real `postgres:17-alpine`, `clickhouse/clickhouse-server:24.8`, `redis:7-alpine` (same images as infra §2). Prisma migrations applied with `migrate deploy`; ClickHouse DDL applied verbatim from contracts §5. Verifies async-insert ack, insert_id dedup, rate-limiter windows, token cache. |
| E2E (`test/e2e/**/*.e2e-spec.ts`) | supertest against the real bootstrapped app (`createApp()` — same wiring as prod `main.ts`) + Testcontainers | Full ingest path: auth matrix (missing/malformed/unknown/revoked token), gzip bodies, per-item accept/reject, batch/body limits, rate-limit 429 + Retry-After, dedup across retried batches, timestamp clamping visible in ClickHouse, health endpoints. Later phases add auth/role matrices and query-API contract tests. |

CI (path-filtered per contracts): lint → typecheck → unit (with coverage gate) → integration → build. Integration/e2e run with `--runInBand`.

## 11. Phase mapping

| Phase | Backend deliverables |
|---|---|
| 1 | contracts package (ingest), scaffold, config, RFC 7807 + pino, Prisma schema + migration, Redis/ClickHouse clients, SDK-token guard, rate limiter, `/ingest/events` + `/ingest/profiles`, health, graceful shutdown, full test pyramid. → executable plan exists. |
| 2 | `auth`, `orgs`, `projects` (+ token revocation cache invalidation), JWT guards, invitation links, OpenAPI emission pipeline. |
| 3 | `identity`, query engine core, insights, live feed, sessions, `users`, rollup MVs, `/metrics`, worker service + `sessions` queue. |
| 4 | funnels (`windowFunnel`), retention (`retention()`), flows (array/sequence functions), nested filter groups. |
| 5 | `cohorts` (+ refresh jobs), `dashboards` (saved reports = stored query definitions). |
| 6 | `attribution` (encrypted credentials, Meta/TikTok sync jobs, reports). |
| 7 | `export`, `gdpr`, maintenance jobs, hardening. |

## 12. Additive-change notes

- New ClickHouse tables/MVs in phases 3+ (rollups, cohort memberships) and new Postgres tables (saved reports, cohort definitions, credentials) are **additive** and must be added to shared contracts §5/§6 before their phase's plan is written.
- `INGEST_RATE_LIMIT_PER_MIN` (default 1000 = contracts §4 value; overridden only in tests) is a backend-local env var; propose adding it to contracts §3 as optional.
