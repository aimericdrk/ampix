# MyAmpMix

Self-hosted, Mixpanel-class product analytics platform: Flutter SDK →
NestJS ingestion/API → ClickHouse + Postgres + Redis → React dashboard.
100% OSS, zero paid SaaS. Design docs live in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Repository layout

| Path                     | What                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `sdk/flutter_analytics/` | Flutter SDK (Flutter 3.32+, Dart 3.8+) — _not yet scaffolded_ |
| `backend/`               | NestJS 11 ingestion + analytics API — _not yet scaffolded_    |
| `dashboard/`             | React 18 + Vite SPA — _not yet scaffolded_                    |
| `packages/contracts/`    | Shared TS types + Zod schemas — _not yet scaffolded_          |
| `infra/`                 | docker-compose (local dev), ClickHouse init SQL, GCP (later)  |
| `docs/superpowers/`      | Specs and implementation plans                                |
| `.github/workflows/`     | CI (path-filtered per package)                                |

## Prerequisites

- **Node 22** (`nvm use` reads `.nvmrc`)
- **pnpm 10** (`corepack enable` activates the pinned version)
- **Docker** with Compose v2

## Quick start

```bash
corepack enable
pnpm install
pnpm infra:up        # ClickHouse + Postgres + Redis, waits for healthchecks
cp .env.example .env # backend env (used once backend/ lands)
```

Verify: `curl http://localhost:8123/ping` → `Ok.`

## Local services (dev credentials — never used in production)

| Service    | Port(s)    | Credentials                                           |
| ---------- | ---------- | ----------------------------------------------------- |
| ClickHouse | 8123, 9000 | `default` / `myampmix_dev`, db `analytics`            |
| PostgreSQL | 5432       | `myampmix` / `myampmix_dev`, db `myampmix`            |
| Redis      | 6379       | none                                                  |
| Backend    | 8080       | `pnpm --filter ./backend start:dev` (once scaffolded) |
| Dashboard  | 5173       | Vite dev server, proxies `/api` + `/ingest` → 8080    |

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

## Conventions

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).
- All timestamps UTC; IDs are UUID v7 where generated.
- Coverage floors (CI-enforced): backend 85%, SDK 85%, dashboard 75%.
- Shared contracts: [`docs/superpowers/specs/2026-07-02-shared-contracts.md`](docs/superpowers/specs/2026-07-02-shared-contracts.md) — read before touching any interface.
