# MyAmpMix — Infra & CI/CD Sub-Project Design

**Date:** 2026-07-02
**Status:** Approved design
**Parent:** `docs/superpowers/specs/2026-07-02-analytics-platform-design.md` (master design §2, §7)
**Conforms to:** `docs/superpowers/specs/2026-07-02-shared-contracts.md` (contracts §1, §2, §3, §5, §9) — any conflict is a bug in this document.

## 1. Scope & Responsibilities

This sub-project owns everything that is not product code:

1. **Monorepo root tooling** — pnpm 10 workspace, Node 22 pinning, ESLint 9 flat config + Prettier 3 root configs, root scripts.
2. **Local development infrastructure** — Docker Compose stack (ClickHouse 24.8, PostgreSQL 17, Redis 7) with healthchecks, persistent volumes, and ClickHouse init SQL, matching contracts §2/§5 exactly.
3. **Production GCP topology** — Cloud Run services, one GCE database VM, private networking, Cloud Scheduler, GCS backups.
4. **Secret management** — Google Secret Manager as the single source of production secrets.
5. **CI/CD** — GitHub Actions path-filtered pipelines, Workload Identity Federation, Artifact Registry, gradual-rollout deploys with health-check rollback.

Out of scope: application code (backend/dashboard/SDK sub-projects), Prisma schema content (backend owns Postgres migrations; infra only runs the Postgres container), analytics query design.

**Golden rule (master design §10): zero paid SaaS.** The only billable line items are raw GCP compute (Cloud Run free tier + one small GCE VM), GCS storage, and network egress. No managed databases, no paid CI, no paid monitoring, no email SaaS, no paid CDN subscription. Every tool below is OSS or a free tier of infrastructure we already pay compute for.

## 2. Monorepo Root Tooling

Per contracts §1:

| Concern | Choice | Enforcement |
|---|---|---|
| Package manager | **pnpm 10** | `packageManager: "pnpm@10.x"` in root `package.json` (Corepack), `engines.pnpm >= 10` |
| Workspace | `pnpm-workspace.yaml` listing `backend`, `dashboard`, `packages/*` | pnpm refuses cross-package phantom deps |
| Node | **22** | `.nvmrc` = `22`, `engines.node >=22 <23`, CI uses `node-version-file: .nvmrc` |
| Lint | **ESLint 9 flat config** (`eslint.config.mjs` at root; packages extend it) | root `pnpm lint`, CI job |
| Format | **Prettier 3** (root `.prettierrc.json` + `.prettierignore`) | root `pnpm format:check`, CI job |
| Dart lint | `flutter_lints` (owned by SDK sub-project) | SDK CI job |
| Commits | Conventional Commits (contracts §9) | review convention (no commit-hook tooling in v1 — YAGNI) |

Root `package.json` scripts (stable interface other sub-projects rely on):

- `lint` / `format` / `format:check` — root-wide ESLint/Prettier.
- `typecheck`, `test` — `pnpm -r --if-present <script>` fan-out; packages that don't define the script are skipped, so the root scripts work from day zero.
- `infra:up` / `infra:down` / `infra:reset` — wrappers around `docker compose -f infra/docker-compose.yml` (`up -d --wait` blocks until healthchecks pass; `reset` removes volumes).

The root ESLint config ignores `sdk/**` (Dart, not ESLint's job), `dist/`, `coverage/`. Prettier ignores `pnpm-lock.yaml`, generated output, and `docs/` (hand-authored specs are not reformatted). TypeScript 5.8+ is a root devDependency so `typescript-eslint` resolves one consistent compiler version workspace-wide.

## 3. Local Development Environment (`infra/docker-compose.yml`)

One Compose file, project name `myampmix`, used identically by developers and (with a prod overlay) by the production VM — dev/prod parity via identical images.

Services, ports, credentials — **exactly** contracts §2:

| Service | Image | Host ports | Credentials |
|---|---|---|---|
| `clickhouse` | `clickhouse/clickhouse-server:24.8` | 8123 (HTTP), 9000 (native) | `default` / `myampmix_dev`, db `analytics` |
| `postgres` | `postgres:17-alpine` | 5432 | `myampmix` / `myampmix_dev`, db `myampmix` |
| `redis` | `redis:7-alpine` | 6379 | no auth locally |

Design points:

- **Healthchecks on every service** (`clickhouse-client --query 'SELECT 1'`, `pg_isready`, `redis-cli ping`) so `docker compose up --wait` returns only when the stack is actually usable, and so backend Testcontainers-style waits are unnecessary for the shared dev stack.
- **Named volumes** (`clickhouse_data`, `postgres_data`, `redis_data`) — data survives `down`; `infra:reset` wipes them deliberately.
- **ClickHouse init**: `infra/clickhouse/init.sql` mounted read-only into `/docker-entrypoint-initdb.d/`; runs once on first boot. Its content is the authoritative DDL from contracts §5 verbatim (`analytics.events`, `analytics.user_profiles`, `analytics.identity_mappings`), prefixed with `CREATE DATABASE IF NOT EXISTS analytics` and `SET allow_experimental_json_type = 1` (the `JSON` column type is behind that flag in ClickHouse 24.8). `IF NOT EXISTS` on every statement keeps the script idempotent.
- **Postgres has no init SQL** — schema is owned by the backend via Prisma migrations (contracts §1, §6). Compose only guarantees the server, user, and empty `myampmix` database exist.
- **Redis persistence**: `--appendonly yes` locally so BullMQ dev queues survive restarts.
- **ulimits** for ClickHouse (`nofile` 262144) per upstream recommendation.
- Backend (`:8080`) and dashboard (`:5173`) run on the host via `pnpm`, not in Compose — fastest iteration loop; they connect over localhost using the env vars of contracts §3, which a committed root `.env.example` documents value-for-value.

## 4. Production Topology (GCP)

```
                        ┌────────────────────────── GCP project ──────────────────────────┐
 Flutter apps ──HTTPS──▶│ Cloud Run "api"     (scale 0→N, conc. 80)  ─┐                   │
 Dashboard SPA ◀─HTTPS──│ Firebase Hosting (free tier, static dist/)  │ VPC connector     │
 Cloud Scheduler ─OIDC─▶│ Cloud Run "worker"  (min=1, CPU always on) ─┤ (private egress)  │
                        │                                             ▼                   │
                        │            GCE VM (e2-small, private IP only, Container-Opt. OS)│
                        │            └─ docker compose: ClickHouse + Postgres + Redis     │
                        │                     │ nightly backups                           │
                        │                     ▼                                           │
                        │            GCS buckets: pg dumps · clickhouse-backup · (tiered  │
                        │            event storage later, master design §2)               │
                        └──────────────────────────────────────────────────────────────────┘
```

### 4.1 Cloud Run services

Two services built from the same backend image (master design §2):

| Service | Flags | Rationale |
|---|---|---|
| `api` | `--min-instances=0 --max-instances=10 --concurrency=80 --cpu=1 --memory=512Mi --port=8080 --timeout=60` | Scale-to-zero: pay only for traffic. Stateless by design (async_insert, Redis-held shared state). |
| `worker` | `--min-instances=1 --max-instances=1 --no-cpu-throttling --cpu=1 --memory=512Mi` | BullMQ consumers + schedulers need CPU **always allocated**, not just during requests; exactly one instance avoids duplicate scheduled work (BullMQ locks make >1 safe later if needed). |

Both: SIGTERM graceful shutdown within Cloud Run's 10 s window (backend contract), `--service-account` scoped per service, env from Secret Manager (§5), egress `--vpc-connector=myampmix-connector --vpc-egress=private-ranges-only`.

### 4.2 Database VM

- One **e2-small** GCE VM (upgradable in place), Container-Optimized OS or Debian + Docker, **no public IP** (`--no-address`); SSH via IAP tunnel only.
- Runs `infra/gcp/vm/docker-compose.prod.yml`: same three images as local dev, differences only in (a) passwords injected from Secret Manager at boot via `cloud-init`, (b) `restart: unless-stopped`, (c) ports bound to the VM's private interface, (d) a fourth container: `altinity/clickhouse-backup` (OSS) for scheduled ClickHouse backups.
- Firewall: ingress to 8123/9000/5432/6379 allowed **only** from the VPC connector CIDR; deny everything else.
- Persistent data on an attached **pd-balanced** data disk (separate from boot disk) so snapshots capture only data.

### 4.3 Networking

- Dedicated VPC `myampmix-vpc`, one region (matches Cloud Run region).
- **Serverless VPC Access connector** `myampmix-connector` (min 2 / max 3 `e2-micro` instances — smallest allowed) gives Cloud Run private-IP reach to the VM. (Direct VPC egress is the zero-cost alternative; the connector is chosen for GA maturity — revisit when Direct VPC egress fits all constraints.)
- The VM's private IP is stable (reserved internal address) and referenced by the Cloud Run env vars: `DATABASE_URL`, `CLICKHOUSE_URL`, `REDIS_URL` (names per contracts §3, hosts swapped from `localhost` to the VM IP).

### 4.4 Cloud Scheduler

Belt-and-braces triggers for periodic jobs (master design §2), all free-tier (≤3 jobs are free; additional jobs cost cents):

| Job | Schedule | Target |
|---|---|---|
| `session-finalize` | every 15 min | `POST https://worker…/internal/jobs/session-finalize` |
| `cohort-refresh` | hourly | `POST https://worker…/internal/jobs/cohort-refresh` |
| `attribution-sync` | every 6 h | `POST https://worker…/internal/jobs/attribution-sync` |

All calls authenticated with **OIDC** (scheduler service account → Cloud Run invoker role on `worker`); no shared secrets in URLs.

### 4.5 Backups (all to GCS, lifecycle-managed)

| What | How | Schedule | Retention |
|---|---|---|---|
| Postgres | `pg_dump -Fc` from a cron container/systemd timer on the VM → `gs://myampmix-backups/pg/` | nightly 03:00 UTC | 30 days (GCS lifecycle rule) |
| ClickHouse | **clickhouse-backup** (OSS, Altinity) full weekly + incremental nightly → `gs://myampmix-backups/clickhouse/` | nightly 03:30 UTC | 4 full generations |
| Whole data disk | GCE **snapshot schedule** on the data disk | daily | 7 days |

Restore procedures are documented in `infra/gcp/vm/README` (created with the provisioning milestone): disk snapshot for disaster recovery, `pg_restore` / `clickhouse-backup restore` for surgical recovery. The VM's service account has `objectAdmin` on the backup bucket only.

## 5. Secret Management

**Google Secret Manager** (free tier: 6 secret versions, 10k accesses/month — within budget) is the only store for production secrets. Nothing secret is ever committed, put in CI variables as plaintext, or baked into images.

| Secret | Consumers |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥32 chars, contracts §3) | Cloud Run `api` |
| `POSTGRES_PASSWORD` | VM compose, Cloud Run `api`/`worker` (inside `DATABASE_URL`) |
| `CLICKHOUSE_PASSWORD` | VM compose, Cloud Run `api`/`worker` |
| `AD_CREDENTIALS_ENC_KEY` (phase 6, encrypts ad-account credentials at rest in Postgres) | Cloud Run `api`/`worker` |

Delivery paths:

- **Cloud Run**: `--set-secrets=JWT_ACCESS_SECRET=jwt-access-secret:latest,…` — mounted as env vars by the platform; rotation = add secret version + redeploy revision.
- **GCE VM**: `cloud-init` fetches secrets via `gcloud secrets versions access` using the VM service account and writes a root-only `/opt/myampmix/.env` consumed by `docker-compose.prod.yml`. Rotation = re-run the fetch unit + `docker compose up -d`.
- **CI**: no long-lived secrets at all — Workload Identity Federation (§6.3) issues short-lived tokens; GitHub repo secrets hold only non-sensitive identifiers (project id, WIF provider name).

Local dev uses the fixed contracts §2 credentials (`myampmix_dev`) committed in `.env.example` — explicitly dev-only.

## 6. CI/CD Design (GitHub Actions)

### 6.1 Pipeline layout — path-filtered per package

One **`ci.yml`** workflow (PRs + pushes to `main`) with a `changes` job (`dorny/paths-filter`, OSS) fanning out to per-package jobs, plus an always-on root lint job:

| Job | Trigger paths | Steps |
|---|---|---|
| `root` | always | `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm format:check` |
| `backend` | `backend/**`, `packages/**`, lockfile, workflow | lint → typecheck → unit tests → *(when backend lands)* integration tests with **service containers** (ClickHouse/Postgres/Redis, same images as §3) → build |
| `dashboard` | `dashboard/**`, `packages/**`, lockfile, workflow | lint → typecheck → Vitest → *(when dashboard lands)* Playwright smoke → build |
| `sdk` | `sdk/flutter_analytics/**`, workflow | `dart format --set-exit-code` → `flutter analyze` → `flutter test` (subosito/flutter-action, Flutter 3.32.x) |

Two-layer skipping keeps the pipeline green from the very first commit:

1. **Path filters** — untouched packages don't even start a job (also means their required checks pass instantly via the filter job pattern).
2. **Existence guards** — each package job first checks its manifest exists (`backend/package.json`, `dashboard/package.json`, `sdk/flutter_analytics/pubspec.yaml`) and no-ops with a `::notice::` if the package isn't scaffolded yet. This lets infra CI merge **before** any product package exists.

Coverage floors (backend 85%, SDK 85%, dashboard 75% — contracts §9) are enforced inside each package's test command, so CI inherits them without extra plumbing. Dependabot (`.github/dependabot.yml`) covers `npm` (root workspace), `github-actions`, `docker` (infra images), and later `pub`; weekly, grouped.

### 6.2 Build & publish (on `main` only)

`deploy-backend.yml` (later milestone): after CI passes on `main`,

1. Build backend Docker image once (multi-stage, distroless runtime), tag `europe-west1-docker.pkg.dev/<project>/myampmix/backend:{sha,semver}`.
2. Push to **Artifact Registry** (auth via WIF, §6.3).

The same image serves `api` and `worker` (different start commands) — one build, two deploys.

### 6.3 Workload Identity Federation — no long-lived keys

- One workload identity pool + GitHub OIDC provider, attribute-mapped to `repository` and `ref`.
- Deploy service account (`roles/run.developer`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser` on the runtime SAs) impersonable **only** from `repo:<owner>/myampmix` on `refs/heads/main`.
- CI uses `google-github-actions/auth@v2` with `workload_identity_provider` + `service_account`; zero JSON keys anywhere.

### 6.4 Deploy with gradual rollout + health-check rollback

For each of `api` and `worker`:

```
gcloud run deploy <svc> --image …:$SHA --no-traffic --tag candidate …flags(§4.1)
curl -fsS https://candidate---<svc>-<hash>.run.app/health   # readiness gate
gcloud run services update-traffic <svc> --to-tags candidate=10   # canary
sleep 120; curl health again + check error-rate via Cloud Monitoring API (free)
gcloud run services update-traffic <svc> --to-latest                # 100%
# any failed gate → gcloud run services update-traffic <svc> --to-revisions <previous>=100 && exit 1
```

Rollback is instant because the previous revision stays warm-capable; the job fails loudly on rollback so `main` is known-bad.

### 6.5 Dashboard static deploy

`deploy-dashboard.yml` (later milestone): `pnpm --filter ./dashboard build` → write runtime `dist/config.js` with the production API base URL (one build works everywhere — master design §5) → deploy `dist/` to **Firebase Hosting free tier** (free HTTPS + CDN, no load-balancer cost; auth via the same WIF credentials, `firebase deploy --only hosting`). Fallback documented: plain GCS static bucket if Firebase is ever unwanted.

## 7. Zero Paid SaaS — audit of this design

Billed: Cloud Run compute beyond free tier, one e2-small VM + disks/snapshots, VPC connector instances, GCS storage/egress. **Free/OSS:** GitHub Actions (public/free minutes), dorny/paths-filter, subosito/flutter-action, Docker images (ClickHouse/Postgres/Redis/clickhouse-backup), Secret Manager free tier, Cloud Scheduler free tier, Firebase Hosting free tier, Cloud Logging free tier (pino JSON → stdout), Dependabot. **Nothing else.**

## 8. File Inventory (exact)

### `infra/`

| Path | Purpose | Milestone |
|---|---|---|
| `infra/docker-compose.yml` | Local dev stack: ClickHouse 24.8, Postgres 17, Redis 7, healthchecks, volumes, init mount | **Phase 1** |
| `infra/clickhouse/init.sql` | Authoritative DDL (contracts §5) + database create + JSON-type flag | **Phase 1** |
| `infra/gcp/provision.sh` | Idempotent gcloud provisioning: APIs, VPC, connector, firewall, VM, buckets + lifecycle, Artifact Registry, service accounts, WIF pool/provider, Scheduler jobs | GCP milestone |
| `infra/gcp/secrets.sh` | Creates/rotates Secret Manager secrets (prompts, never echoes) | GCP milestone |
| `infra/gcp/vm/cloud-init.yaml` | VM bootstrap: Docker, secret fetch → `/opt/myampmix/.env`, compose up, backup timers | GCP milestone |
| `infra/gcp/vm/docker-compose.prod.yml` | Prod overlay: Secret-Manager passwords, restart policies, private binding, clickhouse-backup sidecar | GCP milestone |
| `infra/gcp/vm/clickhouse-backup.yaml` | clickhouse-backup config (GCS remote, schedules, retention) | GCP milestone |
| `infra/gcp/vm/backup.sh` | Nightly `pg_dump -Fc` → GCS (systemd timer unit installed by cloud-init) | GCP milestone |
| `infra/gcp/vm/README.md` | Restore runbook (snapshots, pg_restore, clickhouse-backup restore) | GCP milestone |

### `.github/`

| Path | Purpose | Milestone |
|---|---|---|
| `.github/workflows/ci.yml` | Path-filtered lint/typecheck/test for root, backend, dashboard, sdk with existence guards | **Phase 1** |
| `.github/dependabot.yml` | Weekly npm + github-actions + docker update PRs | **Phase 1** |
| `.github/workflows/deploy-backend.yml` | main-only: build image → Artifact Registry (WIF) → gradual rollout `api`+`worker` with health-gate rollback | Deploy milestone |
| `.github/workflows/deploy-dashboard.yml` | main-only: static build → runtime `config.js` → Firebase Hosting | Deploy milestone |

### Repo root (owned by this sub-project)

`package.json` · `pnpm-workspace.yaml` · `pnpm-lock.yaml` · `.nvmrc` · `.gitignore` · `eslint.config.mjs` · `.prettierrc.json` · `.prettierignore` · `.env.example` · `README.md` — all **Phase 1**.

## 9. Milestones

1. **Phase 1 — Infra Foundation** (planned in `docs/superpowers/plans/2026-07-02-infra-foundation-phase1.md`): monorepo root scaffold, local Docker Compose stack, ClickHouse init SQL, CI skeleton (lint/typecheck/test with path filters + existence guards). **No deploy jobs, no GCP resources.**
2. **Deploy pipeline milestone**: `deploy-backend.yml`, `deploy-dashboard.yml`, WIF setup, Artifact Registry — planned once the backend produces a runnable image (master design phase 1 backend work).
3. **GCP provisioning milestone**: `infra/gcp/**` scripts, VM, networking, Scheduler, backups, Secret Manager population — planned alongside first production deployment.
