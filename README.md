# MyAmpix

Self-hosted, Mixpanel-class product analytics platform: Flutter SDK →
NestJS ingestion/API → ClickHouse + Postgres + Redis → React dashboard.
100% OSS, zero paid SaaS. Design docs live in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Repository layout

| Path                     | What                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `sdk/flutter_analytics/` | Flutter SDK (Flutter 3.32+, Dart 3.8+) — offline-first queue + uploader (phase 1) |
| `backend/`               | NestJS 11 ingestion + analytics API — `/ingest/*` + health (phase 1)              |
| `dashboard/`             | React 18 + Vite SPA — auth + projects shell (phase 1)                             |
| `packages/contracts/`    | Shared TS types + Zod schemas (ingest/auth contracts)                             |
| `admin/`                 | Ops/admin console (Next.js) — auth+2FA, k8s/Docker/datastore monitoring, alerts   |
| `infra/`                 | docker-compose (local dev + prod DB overlay), ClickHouse init SQL, Helm chart     |
| `scripts/k8s/`           | Deploy tooling: `deploy.sh`, `secrets.sh`, chart lint, kind smoke test            |
| `docs/superpowers/`      | Specs and implementation plans                                                    |
| `docs/runbooks/`         | Operator runbook: k3s VPS deployment (`vps-k3s.md`)                               |
| `.github/workflows/`     | CI (path-filtered per package) + `images.yml` (GHCR image builds)                 |

## Prerequisites

- **Node 22** (`nvm use` reads `.nvmrc`)
- **pnpm 10** (`corepack enable` activates the pinned version)
- **Docker** with Compose v2

## Quick start

```bash
corepack enable
pnpm install
pnpm infra:up        # ClickHouse + Postgres + Redis, waits for healthchecks
cp .env.example backend/.env # backend env, loaded at boot in dev
```

Verify: `curl http://localhost:8123/ping` → `Ok.`

## Local services (dev credentials — never used in production)

| Service    | Port(s)    | Credentials                                        |
| ---------- | ---------- | -------------------------------------------------- |
| ClickHouse | 8123, 9000 | `default` / `myampix_dev`, db `analytics`          |
| PostgreSQL | 5432       | `myampix` / `myampix_dev`, db `myampix`            |
| Redis      | 6379       | none                                               |
| Backend    | 8080       | `pnpm --filter ./backend start:dev`                |
| Dashboard  | 5173       | Vite dev server, proxies `/api` + `/ingest` → 8080 |

## Root commands

| Command             | Effect                                       |
| ------------------- | -------------------------------------------- |
| `pnpm lint`         | ESLint 9 (flat config) across the workspace  |
| `pnpm format:check` | Prettier 3 check (`pnpm format` to write)    |
| `pnpm typecheck`    | `typecheck` in every package that defines it |
| `pnpm test`         | `test` in every package that defines it      |
| `pnpm infra:up`     | Start local databases (healthcheck-gated)    |
| `pnpm infra:down`   | Stop them (data kept in named volumes)       |
| `pnpm infra:reset`  | Stop **and wipe** all local data             |
| `pnpm k8s:lint`     | Helm chart lint + kubeconform + invariants   |
| `pnpm k8s:local`    | Full-stack test mode in a local kind cluster |

## Conventions

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).
- All timestamps UTC; IDs are UUID v7 where generated.
- Coverage floors (CI-enforced): backend 85%, SDK 85%, dashboard 75%.
- Shared contracts: [`docs/superpowers/specs/2026-07-02-shared-contracts.md`](docs/superpowers/specs/2026-07-02-shared-contracts.md) — read before touching any interface.

## Deployment & test mode

Production runs on a single VPS: **k3s** (all services, HPA, hook-gated DB migrations, Let's
Encrypt) with the datastores in Docker Compose on the host. Follow
[`docs/runbooks/vps-k3s.md`](docs/runbooks/vps-k3s.md) end to end. Images are built by
`.github/workflows/images.yml` → GHCR; deploys are `scripts/k8s/deploy.sh <tag>`.

`pnpm k8s:local` boots the same topology locally in kind and smoke-tests it (migrations, health,
dashboard, admin console incl. 2FA + ops actions), then prints browsable `*.localhost` URLs and the
seeded admin credentials.

The **admin console** (`admin.<domain>`) is the operations UI: server/k8s/Docker/datastore
monitoring, alerting with 7-day history, restart/scale actions, and its own Postgres-backed
auth (argon2 + sessions + TOTP 2FA, no self-registration). Design docs:
`docs/superpowers/specs/2026-08-2*-admin-console*.md`.
