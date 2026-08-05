# Backend Dockerfile + local containerized run — Design

**Date:** 2026-07-16
**Status:** Approved (design), pending implementation plan
**Parent:** `2026-07-16-revenuecat-parity-program-roadmap.md` → sub-project **X1 (Deploy pipeline)**, first increment.
**Conforms to:** `2026-07-02-infra-cicd-design.md` (the approved GCP infra design — §6.2 "multi-stage, distroless runtime", "same image serves api and worker").

## Scope

The smallest real step of X1: containerize the NestJS backend and prove the image **runs** against the existing local Compose databases. No GCP, no CI, no deploy workflow, no `worker` image — those are later X1 increments.

**Deliverable:** a `docker compose … up --build` that starts the backend container, applies Postgres migrations, and answers `GET /health/ready` 200 with Postgres + ClickHouse + Redis all reachable **from inside the container**.

**Out of scope:** the `worker` entrypoint/image (X2), Artifact Registry / WIF / Cloud Run / Secret Manager, the deploy and dashboard workflows, the 8080/8088 reconciliation (noted below, deferred to the Cloud Run increment).

## Why this first

There is no deployment and no container image today; the backend runs on the host via `pnpm`. A working image is the atom every later X1/X2 step builds on (Cloud Run runs this image; the worker is this image with a different start command). Proving it locally de-risks the pnpm-workspace-in-Docker friction before any cloud spend.

## Files

- **Create `backend/Dockerfile`** — multi-stage.
- **Create `backend/.dockerignore`.**
- **Create `backend/docker-entrypoint.sh`** — migrate-then-start.
- **Create `infra/docker-compose.app.yml`** — overlay that runs the backend image wired to the DB services.
- **Modify** nothing in application source. (The 8080/8088 port question is deferred — see *Deferred*.)

## Dockerfile

Two stages. Base image **`node:22-bookworm-slim`** (Debian slim; not Alpine — `argon2` and Prisma engines are glibc native modules and Alpine/musl needs extra handling we don't want here).

### Stage 1 — builder

1. `corepack enable && corepack prepare pnpm@10.12.1 --activate` (pin matches root `packageManager`).
2. Install the build toolchain the two native deps need: `apt-get install -y --no-install-recommends python3 make g++` (argon2 / node-gyp; Prisma downloads its own engine binaries).
3. Copy only the manifests first (layer-cache friendly): root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `backend/package.json`, `packages/contracts/package.json` (and any other `packages/*` the backend depends on — `@myampix/contracts` is the only workspace dep in `backend/package.json`).
4. `pnpm install --frozen-lockfile` for the whole workspace (respects root `onlyBuiltDependencies` = prisma/@prisma/client/@prisma/engines).
5. Copy the backend source + `packages/contracts` source.
6. Build contracts if it has a build step, then `pnpm --filter @myampix/backend run build` (`nest build` → `dist/`) and `pnpm --filter @myampix/backend exec prisma generate` (backend's `prepare` also runs it on install, but run it explicitly after copying the schema so the generated client is present).
7. **`pnpm --filter @myampix/backend deploy --prod /out`** — pnpm 10's `deploy` produces a self-contained, symlink-free `node_modules` with `@myampix/contracts` hard-copied in and dev deps dropped. This is the clean answer to workspace symlinks not surviving a naive copy into the runtime stage.

### Stage 2 — runtime

1. From `node:22-bookworm-slim`; create and switch to a non-root user (`useradd`).
2. Copy from `/out`: `node_modules`, `package.json`, the built `dist/`, the generated Prisma client, and `prisma/` (schema + `migrations/`) — the entrypoint needs the schema + migrations to run `prisma migrate deploy`.
   **Prisma CLI in runtime — decision:** `prisma` (the migration CLI) is a devDependency, so `pnpm deploy --prod` prunes it, but the entrypoint's `prisma migrate deploy` needs it offline. So the builder additionally copies the resolved `prisma` package **and** `@prisma/engines` into `/out/node_modules` after the deploy prune, so `node_modules/.bin/prisma` runs with no network at container start. (Alternative considered and rejected for this slice: move `prisma` to `dependencies` — that changes `backend/package.json`, which is out of scope here.)
3. `ENV NODE_ENV=production` is **not** set here — the compose overlay sets `NODE_ENV` (local run uses `development` so `COOKIE_SECURE` may stay false; see *Env*). The image itself is env-agnostic.
4. `EXPOSE 8088` (documentation only; the app binds `PORT`, default 8088).
5. `ENTRYPOINT ["./docker-entrypoint.sh"]`.

## Entrypoint (`docker-entrypoint.sh`)

```sh
#!/bin/sh
set -e
# Apply pending Postgres migrations before boot so the container is self-provisioning against a
# fresh DB. NOTE: fine for local + single-instance. The Cloud Run increment MUST move this to a
# dedicated one-shot migration step — multiple api/worker instances must not race migrate deploy.
node_modules/.bin/prisma migrate deploy
exec node dist/main.js
```

`main.ts` already calls `process.loadEnvFile()` inside a try/catch, so the absence of a `.env` file in the container is a no-op — env comes from the process environment (compose). ClickHouse schema is **not** created here: `infra/clickhouse/init.sql` already creates `analytics.*` on first Compose boot.

## `.dockerignore`

Ignore `node_modules`, `dist`, `coverage`, `.env*`, `test/`, `**/*.spec.ts`, `.git`, so the build context is small and no host `node_modules`/secrets leak in.

## Compose overlay (`infra/docker-compose.app.yml`)

Adds one service to the existing `myampix` project, on the same network as `clickhouse`/`postgres`/`redis`:

```yaml
services:
  backend:
    build:
      context: ..            # repo root, so the Dockerfile can see the workspace
      dockerfile: backend/Dockerfile
    depends_on:
      clickhouse: { condition: service_healthy }
      postgres:   { condition: service_healthy }
      redis:      { condition: service_healthy }
    env_file:
      - ../backend/.env       # dev secrets (JWT_*, TOTP_ENC_KEY) — gitignored, never committed
    environment:
      NODE_ENV: development
      PORT: 8088
      # DB hosts overridden to Compose service names (the localhost values in .env don't resolve
      # inside the container). Dev creds match infra/docker-compose.yml and are dev-only.
      DATABASE_URL: postgresql://myampix:myampix_dev@postgres:5432/myampix
      CLICKHOUSE_URL: http://clickhouse:8123
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: myampix_dev
      CLICKHOUSE_DB: analytics
      REDIS_URL: redis://redis:6379
    ports:
      - "8088:8088"
```

**Secrets discipline (CLAUDE.md):** no secret values are committed. `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOTP_ENC_KEY` come from the gitignored `backend/.env` (created from the committed `.env.example` by `scripts/dev.sh`). Only non-secret Compose service-name URLs and the already-committed dev DB creds appear in the overlay. Runbook step: ensure `backend/.env` exists (`cp backend/.env.example backend/.env`) and contains the three required secrets — `TOTP_ENC_KEY` must decode to exactly 32 bytes (64 hex chars); `JWT_*` ≥ 32 chars.

## Required env (from `backend/src/config/app-config.ts`)

`loadConfig()` aggregates every missing/invalid var into one thrown error at boot, so all of these must be present for the container to start (NODE_ENV=development):

- **DB:** `DATABASE_URL` (postgresql://), `CLICKHOUSE_URL` (http://), `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DB`, `REDIS_URL` (redis://).
- **Secrets (required outside NODE_ENV=test):** `JWT_ACCESS_SECRET` (≥32), `JWT_REFRESH_SECRET` (≥32), `TOTP_ENC_KEY` (decodes to 32 bytes).
- **Optional / defaulted:** `PORT` (8088), `COOKIE_SECURE` (false in dev), Firebase (`FIREBASE_STORAGE_BUCKET`/`GOOGLE_APPLICATION_CREDENTIALS` → in-memory screenshot fallback + warning when unset), Mistral (unconfigured → 503 on that one feature). All fine to omit locally.

## Verification (the proof — a green build is not proof)

1. `pnpm infra:up` (DB stack healthy).
2. `docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml up --build backend`.
3. Observe: image builds; entrypoint logs `prisma migrate deploy` applying migrations cleanly; app logs "listening on 0.0.0.0:8088".
4. `curl -fsS localhost:8088/health` → 200 (liveness, no I/O).
5. `curl -fsS localhost:8088/health/ready` → 200 with Postgres + ClickHouse + Redis all `ok` (this is the real proof — the container reached all three DBs by service name).
6. Bonus: `docker run` the image with no env → it fails fast with the aggregated config error (confirms the config gate works in-container).

## Deferred (explicitly not in this slice)

- **8080 vs 8088:** the infra design pins Cloud Run to `--port=8080`; the app defaults to 8088. Keep 8088 here; reconcile in the Cloud Run increment (Cloud Run injects `PORT`, so the image already honors it — the reconciliation is config, not code).
- **`worker` image/entrypoint** — X2.
- **Migrations as a dedicated step** (vs entrypoint) — required before multi-instance Cloud Run; called out in the entrypoint comment.
- **Distroless runtime** — the infra design says "distroless"; this slice uses `bookworm-slim` for a shell (the entrypoint + `prisma` CLI need one). Revisit for the Cloud Run image (distroless + a separate migration job removes the shell dependency).
- **Image size optimization, healthcheck in the image, multi-arch** — later.
