# MyAmpMix — Self-Hosted Product Analytics Platform (Mixpanel-class)

**Date:** 2026-07-02
**Status:** Approved design, pending implementation planning

## 1. Goal

A self-hosted product-analytics platform with full Mixpanel-class features:

- **Flutter SDK** that tracks events (manual + autocaptured taps/screens), exact session durations, user identity, and acquisition source (Meta/TikTok/Google campaigns).
- **NestJS backend** that ingests events at scale, aggregates them, and serves analytics queries.
- **React + TypeScript dashboard** (single-page static build, hostable anywhere).
- Full CI/CD and automated tests at every layer.

**Scale target:** apps with ~100k monthly active users → 20–60M events/month with autocapture. **Production runs on Google Cloud Run** (multiple concurrent autoscaled instances — the whole backend is designed stateless), with databases on cost-efficient GCP infrastructure and Docker Compose for local development. Cost efficiency is prioritized wherever it does not remove features.

## 2. Architecture Overview

Monorepo:

```
myampmix/
├── sdk/flutter_analytics/     # Flutter SDK (pub-publishable package)
├── backend/                   # NestJS — ingestion, analytics queries, auth
├── dashboard/                 # React 18 + TypeScript + Vite SPA
├── infra/                     # docker-compose (local dev), DB init/migrations, Cloud Run + GCE provisioning
├── docs/                      # specs and implementation plans
└── .github/workflows/         # CI/CD
```

Data flow:

```
Flutter SDK ──gzip batched HTTPS──▶ NestJS /ingest (Cloud Run, N instances) ──validate──▶ ClickHouse async_insert
Dashboard (React SPA) ◀──REST/JSON──▶ NestJS /api ──▶ ClickHouse (events) + Postgres (metadata)
BullMQ worker service (Cloud Run, min-instances=1) ──▶ Meta/TikTok enrichment, cohort refresh, session finalization, GDPR deletes
```

### Deployment topology & Cloud Run concurrency

Production runs on **Google Cloud Run**, which autoscales multiple concurrent instances and can stop any of them at any time. Design rules that follow from this:

- **No in-process event buffering.** Batching happens *inside ClickHouse* via `async_insert=1` — ClickHouse collects rows server-side and flushes optimally sized parts. API instances stay fully stateless; an instance dying loses nothing that was acknowledged.
- **Idempotent ingestion.** The SDK stamps every event with a UUID `insert_id`. SDK retries after network timeouts can therefore never double-count: duplicates collapse in ClickHouse (dedup by `insert_id`, see schema). Safe with any number of concurrent instances receiving the same retried batch.
- **All shared state lives in Redis or the databases** — distributed rate limiting, token cache, BullMQ queues. Nothing instance-local is load-bearing.
- **Two Cloud Run services:** `api` (ingest + dashboard API, scales 0→N, concurrency ~80) and `worker` (BullMQ consumers + schedulers, `min-instances=1`, CPU always allocated so background jobs actually run). Cloud Scheduler triggers periodic jobs (cohort refresh, session finalization, attribution sync) via authenticated HTTP as a belt-and-braces alternative to in-process cron.
- **Graceful shutdown:** SIGTERM handler drains in-flight requests and closes DB pools within Cloud Run's 10 s window.
- **Databases:** ClickHouse + PostgreSQL + Redis all self-hosted on **one small GCE VM** (Compose-managed with automated disk snapshots + nightly `pg_dump`/ClickHouse backups to GCS). No managed database services — cheapest option that keeps every feature. Reachable from Cloud Run via VPC connector or private IP.
- **Local development** uses the same containers via Docker Compose — dev/prod parity through identical images.

### Storage

| Store | Role |
|---|---|
| **ClickHouse** | All event data and profile snapshots. Native `windowFunnel()`, `retention()`, and array functions power funnels/retention/flows without precomputation. |
| **PostgreSQL** | Metadata: orgs, users, memberships/roles, invitations, projects, API tokens, saved reports, dashboards, cohort definitions, encrypted ad-account credentials. Prisma migrations. |
| **Redis** | Token→project cache on the hot ingest path, rate limiting, BullMQ queues. |

### ClickHouse schema (core)

- `events` — ReplacingMergeTree, `PARTITION BY toYYYYMM(timestamp)`, `ORDER BY (project_id, event_name, timestamp, insert_id)`. The SDK-generated `insert_id` in the sorting key makes retried/duplicate deliveries collapse on background merges; because that dedup is eventual, queries where exactness matters use `count(DISTINCT insert_id)` instead of `count()`. Typed context columns (device, os, app_version, geo, utm_*, session_id, distinct_id) + `properties JSON`.
- `user_profiles` — ReplacingMergeTree keyed by `(project_id, distinct_id)`; latest profile state wins.
- `identity_mappings` — anonymous_id → canonical user id links (identify/alias).
- Materialized-view rollups: daily active users, daily event counts per event_name, daily session stats. Dashboards hit rollups first; raw events only for drill-downs and complex reports.

### Cost optimizations (no feature loss)

1. **ZSTD compression codecs** on all event columns (~10–20× on analytics data).
2. **Tiered storage:** partitions older than 90 days move automatically (ClickHouse storage policy TTL) to object storage (GCS, S3-compatible via HMAC) and stay fully queryable. Hot disk stays small. Enabled once the VM disk actually fills — pennies per GB when needed, nothing before.
3. **Materialized-view rollups** (above) so routine dashboard queries scan KBs, keeping CPU needs — and the server size — low.
4. **Gzip batched ingestion** from the SDK: fewer requests, ~90% less bandwidth.
5. Cloud Run scale-to-zero for the API (pay only for traffic) + one small always-on worker instance; databases on a single low-cost GCE VM. The ingestion writer is isolated behind an interface so Pub/Sub or a ClickHouse cluster can be introduced later without touching business logic.

### Identity & sessions (Mixpanel model)

- SDK generates an anonymous `distinct_id` (UUID) on first launch, persisted locally.
- `identify(userId)` links anonymous history via `identity_mappings`; `alias()` supported; `reset()` on logout.
- Sessions are computed **SDK-side**: a `session_id` rotates after 30 minutes in background; session start/end events carry exact durations. A BullMQ job finalizes sessions server-side for apps killed mid-session (fallback: last event timestamp).

## 3. Flutter SDK (`sdk/flutter_analytics`)

**Public API** (Mixpanel-compatible surface):
`init(token, config)`, `track(event, {properties})`, `identify(id)`, `alias(id)`, `reset()`, `timeEvent(name)` / duration auto-attach on next `track(name)`, `registerSuperProperties()`, `people.set/setOnce/increment/append/deleteUser()`, `optOutTracking()` / `optInTracking()`, `flush()`.

**Autocapture** (each toggleable in config):
- Screen views via `NavigatorObserver` (route name, previous route, time-on-screen).
- Taps via a root `AnalyticsWrapper` widget + hit-test inspection: widget runtime type, `Key`/semantics label, screen, position. Rage-tap detection.
- App lifecycle: first open, open, backgrounded, session start/end (+ duration).

**Attribution:**
- Android: Install Referrer API — captures Meta/TikTok/Google campaign parameters reliably at install.
- Deep links (app_links): UTM parameters captured on any open.
- iOS: UTM via deep/universal links; Apple Search Ads attribution token where available.
- First-touch attribution persisted forever; last-touch updated per campaign visit; both auto-attached to every event and to the user profile.

**Reliability:** every event is written to a local queue (drift/isar) before any network call; flush in gzip batches (20 events or 10 s, configurable); exponential backoff with jitter; survives offline periods and app kills; queue capped with oldest-first eviction. Automatic context: app version/build, OS + version, device model, locale, timezone, screen size, network type, SDK version.

**Quality bar:** null-safe, zero codegen for consumers, no static global mutable state beyond the singleton facade, unit + widget tests including offline/retry simulations.

## 4. Backend (NestJS)

Two API surfaces, one app:

- **`/ingest/*`** — public, authenticated by project SDK token (Redis-cached lookup), distributed rate limits (Redis), minimal processing: validate (Zod), normalize, write to ClickHouse with `async_insert` (server-side batching; stateless instances, see §2). Endpoints: `POST /ingest/events` (batch), `POST /ingest/profiles`.
- **`/api/*`** — dashboard API. JWT access + refresh tokens, org/project role guards.

**Modules:** `auth`, `orgs` (organizations, members, roles: admin/analyst/viewer, invitations via shareable signed links — no paid email provider; SMTP delivery pluggable later), `projects` (tokens, settings), `ingestion`, `identity`, `analytics` (insights, funnels, retention, flows, sessions, live feed), `users` (profile explorer + activity timeline), `cohorts` (definition engine + scheduled refresh), `dashboards` (saved reports, layout), `attribution` (Meta Marketing API + TikTok Events API enrichment via BullMQ using stored ad-account credentials), `export` (CSV/JSON), `gdpr` (delete/export by distinct_id).

**Query engine:** every report endpoint accepts a typed JSON query definition (events, date range, property filters with and/or groups, breakdowns, interval, formulas). A query-builder layer compiles it to **parameterized** ClickHouse SQL — user input never interpolated. Responses are chart-ready series. Same definition shape is what the frontend report builder produces and what saved reports store.

**Cross-cutting:** global exception filter (RFC 7807 problem-details), class-validator/Zod on all DTOs, pino structured logging with request ids, health/readiness endpoints, graceful SIGTERM shutdown (drain in-flight requests, close DB pools), Prometheus-style metrics endpoint.

## 5. Dashboard (React SPA)

Vite + React 18 + TypeScript strict. TanStack Query + TanStack Router. Radix primitives + Tailwind, light/dark themes. Recharts. Builds to a static `dist/` (single-page, hash-free routing behind any static host/CDN); API base URL injected via runtime `config.js` so one build works everywhere.

**Pages:** Live event feed (polling) · Insights builder (line/bar/pie/table, multi-event, breakdowns, filters, formulas like A/B) · Funnels builder (step editor, conversion windows, breakdowns) · Retention grid (cohort triangle, custom return events) · User Flows (sankey from/to any event) · Users explorer (filter/search, profile page with activity timeline) · Cohort builder (behavioral + property conditions) · Dashboards (drag-and-drop grid of saved reports, auto-refresh) · Attribution report (installs/events by source/campaign, first vs last touch) · Project settings (tokens, data management) · Org admin (members, roles, invitations) · Auth (login, signup, invite acceptance).

**API contract:** OpenAPI spec generated from NestJS decorators; typed client generated for the frontend — no drift between layers.

## 6. Testing

| Layer | Tests |
|---|---|
| Backend | Jest unit tests (query builder gets exhaustive cases incl. injection attempts); integration tests against **real** ClickHouse/Postgres/Redis via Testcontainers; supertest e2e for API contracts and auth/role matrices. |
| SDK | Dart unit tests (queueing, batching, backoff, identity, sessions) with fake HTTP + clock; widget tests for autocapture; golden scenario: offline → kill → relaunch → flush. |
| Dashboard | Vitest + Testing Library for components and report-builder logic; MSW-mocked API; Playwright smoke e2e (login → create report → see chart). |

CI fails on lint, typecheck, test, or coverage regression in any package.

## 7. CI/CD (GitHub Actions)

- Path-filtered per-package pipelines: **lint → typecheck → unit → integration → build**.
- Service containers (ClickHouse/Postgres/Redis) for backend integration jobs; Flutter action for SDK; Playwright job for dashboard.
- On `main`: build & push Docker images (backend api/worker, dashboard) to Google Artifact Registry with SHA + semver tags (Workload Identity Federation — no long-lived keys).
- Deploy job: `gcloud run deploy` for `api` and `worker` with the new image, gradual traffic rollout (e.g. 10% → 100%), automatic rollback to the previous revision on failed health check. Dashboard static build deployed to the static host/CDN.
- Dependabot + lockfile maintenance.

## 8. Delivery Phases

Each phase is independently planned, implemented, tested, and shippable:

1. **Foundation & ingestion** — monorepo scaffold, local Docker Compose infra, ClickHouse/Postgres schemas, `/ingest` pipeline (async_insert + insert_id dedup), SDK core (track/identify/sessions/offline queue), CI skeleton + Cloud Run deploy pipeline.
2. **Auth & tenancy** — orgs, users, roles, invitations, projects, tokens, dashboard shell with login.
3. **Core analytics** — live feed, Insights builder, users explorer + profiles, session reports, rollup materialized views.
4. **Advanced analysis** — funnels, retention, user flows.
5. **Cohorts & dashboards** — cohort builder/engine, saved reports, custom dashboards.
6. **Attribution** — SDK install referrer + UTM capture, attribution reports, Meta/TikTok API enrichment workers.
7. **Hardening & parity polish** — exports, GDPR tooling, tiered-storage automation, alerting, docs.

## 9. Explicit Non-Goals (v1)

- No SKAdNetwork/MMP-grade paid-install attribution on iOS (requires ad-network partnerships).
- No messaging/push campaigns (Mixpanel "Engage" messaging) — analytics only.
- No multi-region / clustered deployment in v1 (upgrade path preserved).
- No web/JS tracking SDK (Flutter only; the ingest API is generic so one can be added later).

## 10. Key Decisions Log

| Decision | Choice | Why |
|---|---|---|
| Events DB | ClickHouse | Column store with native funnel/retention functions; the standard for this product class; huge compression = low cost. |
| Metadata DB | PostgreSQL + Prisma | Relational integrity for auth/tenancy; migrations. |
| Ingestion batching | ClickHouse `async_insert` + SDK `insert_id` dedup (no Kafka, no in-process buffer) | Cloud Run instances are stateless/ephemeral; server-side batching loses nothing on scale-down and stays idempotent under concurrent retries. Writer isolated behind an interface for a later Pub/Sub upgrade. |
| Hosting | Cloud Run (api scale-to-zero, worker min-instances=1) + one GCE VM self-hosting ClickHouse/Postgres/Redis | User requirement (Cloud Run); lowest cost that keeps every feature. |
| Paid services | **None.** 100% OSS self-hosted; only raw compute (Cloud Run free tier + 1 small VM) and GCS storage are billed. No managed DBs, no email SaaS, no paid monitoring — invitations are shareable links, logging via pino → free Cloud Logging. | User requirement: minimize paid packages/technologies. |
| Frontend | Vite SPA, static build | User requirement: single-page compilation, easy hosting. |
| Sessions | SDK-computed with server fallback | Exact durations like Mixpanel; robust to app kills. |
| Cost tier | ZSTD + GCS tiered storage + rollups + gzip ingest | User requirement: lower cost, complexity acceptable, zero feature loss. |
| Attribution enrichment | Meta Marketing API + TikTok Events API workers | User-selected; requires user's ad-account credentials (stored encrypted). |
