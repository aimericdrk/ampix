# Cloud Run Image Slimming (D3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the `backend/mobile_purchase` serving image to a **distroless** runtime (no `prisma` CLI, no shell, one query engine) and move `prisma migrate deploy` into a dedicated **one-shot `migrate` image**, with a runnable local compose stack (migrate → app). Pure infra — no application/schema/migration change.

**Architecture:** One Dockerfile, three targets — `builder` (unchanged, adds a second `pnpm deploy` that keeps the `prisma` CLI), `migrate` (bookworm-slim one-shot that runs `migrate deploy` and exits), `runtime` (distroless `gcr.io/distroless/nodejs22-debian12`, serves only, carries the pre-generated `generated/` client so it needs neither the CLI nor a runtime `prisma generate`). `infra/docker-compose.app.yml` gains a one-shot `mobile-purchase-migrate` service and a `mobile-purchase` app service gated on it via `service_completed_successfully`.

**Tech Stack:** Docker multi-stage build (BuildKit), pnpm 10 workspace deploy, Prisma 6 CLI (`migrate deploy`), NestJS 11 runtime, Docker Compose. No Node/TS code changes.

**Design spec:** `docs/superpowers/specs/2026-07-24-cloud-run-image-slimming-design.md` (all § references point there).

## Global Constraints

Every task's requirements implicitly include all of these:

- **Pure infra.** No change to `backend/mobile_purchase/src/`, `prisma/schema.prisma`, `prisma/migrations/`, or any test file. Only the Dockerfile, `docker-entrypoint.sh` (deleted), and `infra/docker-compose.app.yml` change.
- **Serving image serves only.** The `runtime` target must contain NO `prisma` CLI, NO shell, and NO second `prisma generate`. Migrations never run from the serving container.
- **Node 22 + debian bookworm alignment.** `builder`/`migrate` = `node:22-bookworm-slim`; `runtime` = `gcr.io/distroless/nodejs22-debian12` (both debian-12/bookworm, so the Prisma query engine built in the builder is ABI-compatible with the runtime — do not switch either to alpine/musl).
- **pnpm workspace, repo-root build context.** Build context is the repo root. Dependency operations use pnpm `--filter @myampix/mobile-purchase`; NEVER `npm install` for workspace deps. `pnpm deploy --legacy` produces the self-contained bundles the stages copy.
- **HARD WIP rule:** NEVER touch or stage the user's uncommitted collapse-rail WIP (`dashboard/src/components/layout/*`, `dashboard/src/features/command-palette/CommandPalette.tsx`, `dashboard/src/test/render-app.tsx`, `dashboard/src/components/layout/RailInitial.tsx`, `sdk/flutter_purchases/example/lib/demo_config.dart`, the two `2026-07-16-dashboard-tool-rail*` docs). Always `git add` the specific task files — **never `git add -A`**.
- **Commits:** per-task commits authorized; the USER pushes/merges. Convention `feat(mobile_purchase): …` / `chore(mobile_purchase): …`. **No co-author trailer, ever.** Never commit `.env`/secrets.
- **Environment:** Docker must be RUNNING. Builds pull base images + run `pnpm install` (network needed). The `mobile-purchase-postgres` DB is defined in `infra/docker-compose.yml` (host `:5433`, internal `5432`, creds `mobile_purchase`/`mobile_purchase_dev`, db `mobile_purchase`).
- **Ledger note:** `.superpowers/` is git-ignored — the verify gate APPENDS its ledger entry but does NOT `git add`/commit it.

---

### Task 1 (D3.1): Rewrite the Dockerfile to 3 targets (distroless runtime + one-shot migrate)

**Files:**
- Modify: `backend/mobile_purchase/Dockerfile` (rewrite to `builder` + `migrate` + `runtime`)
- Delete: `backend/mobile_purchase/docker-entrypoint.sh` (no longer referenced — migration moves to the `migrate` target's `CMD`, serving runs `node dist/main.js` directly)

**Interfaces:**
- Consumes (existing, unchanged): the pnpm workspace layout; `prisma/schema.prisma` generator `output = "../generated/client"`; `dist/main.js` from `nest build`; the health endpoints `/health` + `/health/ready`.
- Produces (D3.2 + D3.3 depend on these): two build targets addressable as `--target migrate` and `--target runtime`; the `migrate` image's default `CMD` runs `prisma migrate deploy`; the `runtime` image's `CMD ["dist/main.js"]` serves on `8090` and needs only `DATABASE_URL` (+ optional `PORT`/`DASHBOARD_ORIGINS`/`ANALYTICS_INTERNAL_URL`) in its environment.

- [ ] **Step 1: Capture the baseline image size (build the CURRENT Dockerfile first, before editing).**

From the repo root, with Docker running:
```bash
docker build -f backend/mobile_purchase/Dockerfile -t mp-baseline:pre-d3 .
docker image inspect -f '{{.Size}}' mp-baseline:pre-d3
```
Expected: the current single-runtime image builds; record its `.Size` in bytes (the ~1GB / ~231MB-deduped baseline). This is the before-number for the D3.2/D3.3 size gate. (If the current Dockerfile fails to build in this environment for an unrelated reason, note it and use the documented ~231515248 bytes as the baseline instead.)

- [ ] **Step 2: Rewrite `backend/mobile_purchase/Dockerfile` to three targets.**

Replace the ENTIRE file with:
```dockerfile
# syntax=docker/dockerfile:1
# MyAmpix mobile-purchase backend image — standalone RevenueCat-style purchase service, own Postgres.
# Build context is the REPO ROOT so the pnpm workspace is visible.
#
# Three targets:
#   builder  — installs the workspace, generates the Prisma client, builds dist/, and produces two
#              self-contained pnpm-deploy bundles: /out (prod-only, for serving) and /out-migrate
#              (with devDeps, so it carries the `prisma` CLI + migration engine).
#   migrate  — one-shot job image: runs `prisma migrate deploy` and exits. Keeps a shell (the CLI
#              wants one); never serves traffic, so size is secondary.
#   runtime  — distroless serving image: `node dist/main.js` only. No prisma CLI, no shell, no
#              second `prisma generate` — it carries the builder's already-generated client + engine.

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# Workspace root + the packages mobile-purchase needs. Other workspace manifests are copied so the
# workspace is structurally valid, but `--filter @myampix/mobile-purchase...` keeps their deps out.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY dashboard/package.json dashboard/package.json
COPY backend/mobile_analytics/package.json backend/mobile_analytics/package.json
COPY packages/contracts packages/contracts
COPY backend/mobile_purchase backend/mobile_purchase

# Full source is copied before install because mobile-purchase's `prepare` script (prisma generate)
# runs during install and needs the schema present.
RUN pnpm install --frozen-lockfile --filter @myampix/mobile-purchase...

RUN pnpm --filter @myampix/mobile-purchase exec prisma generate
RUN pnpm --filter @myampix/mobile-purchase build

# Serving bundle: prod-only, self-contained, symlink-free. `--legacy` is required because pnpm 10
# otherwise only deploys workspaces with `inject-workspace-packages=true`.
RUN pnpm --filter=@myampix/mobile-purchase deploy --prod --legacy /out

# Migrate bundle: same deploy WITHOUT --prod, so the devDependency `prisma` CLI + its migration
# engine are present. Sourced from the workspace install (lockfile-pinned) — no global npm install,
# no version drift against @prisma/client.
RUN pnpm --filter=@myampix/mobile-purchase deploy --legacy /out-migrate

# ---------- migrate (one-shot) ----------
FROM node:22-bookworm-slim AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out-migrate /app
# prisma/ (schema + migrations) copied explicitly in case `pnpm deploy` prunes it from the bundle.
COPY --from=builder /app/backend/mobile_purchase/prisma /app/prisma
# Runs the migrations to completion and exits (0 = applied/no-op, non-zero = failure → the
# orchestrator must not start the serving revision). Idempotent.
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

# ---------- runtime (distroless serving) ----------
FROM gcr.io/distroless/nodejs22-debian12 AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The pruned, prod-only service bundle: dist/, prod node_modules (incl. @prisma/client), prisma/
# schema, package.json.
COPY --from=builder /out /app

# The app imports ../../generated/client at runtime and the Prisma query engine lives inside that
# output dir; copy it explicitly from the builder so the serving image needs neither the prisma CLI
# nor a runtime `prisma generate`. (bookworm builder → bookworm-based distroless: engine is ABI-compatible.)
COPY --from=builder /app/backend/mobile_purchase/generated /app/generated

# distroless/nodejs* runs as the built-in nonroot user (uid 65532) and its ENTRYPOINT is `node`,
# so CMD is just the script path → `node dist/main.js`. No shell, no entrypoint script.
EXPOSE 8090
CMD ["dist/main.js"]
```

- [ ] **Step 3: Delete the now-dead entrypoint script.**
```bash
git rm backend/mobile_purchase/docker-entrypoint.sh
```
Expected: the file is staged for deletion. Nothing references it anymore (the old runtime `COPY`/`ENTRYPOINT` lines are gone; migration is the `migrate` target's `CMD`).

- [ ] **Step 4: Build the `migrate` target.**
```bash
docker build --target migrate -f backend/mobile_purchase/Dockerfile -t mp-migrate:d3 .
```
Expected: builds successfully. (BuildKit only builds the `builder` + `migrate` stages.)

- [ ] **Step 5: Build the `runtime` target + record its size.**
```bash
docker build --target runtime -f backend/mobile_purchase/Dockerfile -t mp-runtime:d3 .
docker image inspect -f '{{.Size}}' mp-runtime:d3
```
Expected: builds successfully; record `.Size`. It should be materially smaller than the Step 1 baseline (no `npm install -g prisma` layer, no second engine, distroless base). Record both numbers.

- [ ] **Step 6: Prove the serving image has no `prisma` CLI layer.**
```bash
docker history --no-trunc mp-runtime:d3 | grep -i "prisma" || echo "NO prisma-CLI layer (expected)"
```
Expected: no `npm install -g prisma` / `prisma generate` layer appears (the only prisma content is the copied `/out` node_modules `@prisma/client` + `/app/generated`, not a CLI install). Printing `NO prisma-CLI layer (expected)` is the pass.

- [ ] **Step 7: Runtime sanity — the distroless image runs node + resolves `generated/client` (no DB needed).**
```bash
docker run --rm mp-runtime:d3 2>&1 | head -20 ; echo "exit=${PIPESTATUS[0]}"
```
Expected: the container starts `node dist/main.js`, loads the app, and FAILS on config validation with a message containing `Invalid environment configuration` / `DATABASE_URL` (no `DATABASE_URL` was provided), exiting non-zero. This proves `main.js` loads and the `../../generated/client` import resolves inside distroless. It must **NOT** fail with `Cannot find module` or a module-resolution error — that would mean `generated/` didn't land correctly (fix the runtime `COPY` before proceeding). (The Prisma **engine** binary is only loaded at `$connect`, so full engine+DB validation happens in D3.2's compose smoke, not here.)

- [ ] **Step 8: Commit the Dockerfile rewrite + entrypoint deletion.**

Step 3's `git rm` already staged the deletion; stage the modified Dockerfile and confirm the staged set is exactly those two paths:
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
git add backend/mobile_purchase/Dockerfile
git status --short backend/mobile_purchase/
```
Expected: exactly `M  backend/mobile_purchase/Dockerfile` and `D  backend/mobile_purchase/docker-entrypoint.sh` staged, nothing else. Then:
```bash
git commit -m "feat(mobile_purchase): distroless serving image + one-shot migrate target (D3.1)"
```
(Never `git add -A` — the tree carries the user's uncommitted dashboard WIP.) No co-author trailer.

---

### Task 2 (D3.2): Local compose stack — migrate → app, and the functional smoke

**Files:**
- Modify: `infra/docker-compose.app.yml` (add `mobile-purchase-migrate` + `mobile-purchase` services)

**Interfaces:**
- Consumes (from D3.1): the `migrate` + `runtime` Dockerfile targets. Consumes (existing): the `mobile-purchase-postgres` service in `infra/docker-compose.yml` (internal host `mobile-purchase-postgres:5432`, creds `mobile_purchase`/`mobile_purchase_dev`, db `mobile_purchase`); the base compose `name: myampix` (services share the `myampix_default` network by DNS name).
- Produces (D3.3 depends on this): a `docker compose … up` path that applies migrations then serves, with `/health/ready` reachable on host `:8090`.

- [ ] **Step 1: Add the two services to `infra/docker-compose.app.yml`.**

Append under the existing `services:` map (after the `backend:` service), matching its `context: ..` + repo-root-relative `dockerfile:` convention:
```yaml
  # --- mobile-purchase (RevenueCat-style service) local run: migrate one-shot, then the distroless app.
  # Mirrors the intended Cloud Run flow (a migrate Job gates the serving revision). Brought up with the
  # base stack: docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml up --build mobile-purchase
  mobile-purchase-migrate:
    build:
      context: ..
      dockerfile: backend/mobile_purchase/Dockerfile
      target: migrate
    depends_on:
      mobile-purchase-postgres:
        condition: service_healthy
    environment:
      # Internal service DNS + internal port 5432 (the :5433 is only the host-published port). Dev-only creds.
      DATABASE_URL: postgresql://mobile_purchase:mobile_purchase_dev@mobile-purchase-postgres:5432/mobile_purchase
    restart: "no"

  mobile-purchase:
    build:
      context: ..
      dockerfile: backend/mobile_purchase/Dockerfile
      target: runtime
    depends_on:
      # Serve only AFTER the one-shot migrate exits 0 — the compose expression of "migrate Job → serving revision".
      mobile-purchase-migrate:
        condition: service_completed_successfully
      mobile-purchase-postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: "8090"
      DATABASE_URL: postgresql://mobile_purchase:mobile_purchase_dev@mobile-purchase-postgres:5432/mobile_purchase
      DASHBOARD_ORIGINS: http://localhost:5173
      # Cross-service authz target (analytics backend). Only used on-demand for guarded requests, not
      # by /health — the app boots fine even if the analytics service isn't up.
      ANALYTICS_INTERNAL_URL: http://backend:8088
    ports:
      - "8090:8090"
```
(No container `healthcheck` on `mobile-purchase`: the distroless image has no shell/curl to run one. Liveness/readiness is verified host-side via `curl localhost:8090/...` below, which is how Cloud Run's HTTP health probe will hit it too.)

- [ ] **Step 2: Bring up the stack (builds the images, applies migrations, starts the app).**
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml up -d --build mobile-purchase
```
Expected: Docker builds the `migrate` + `runtime` images, starts `mobile-purchase-postgres`, runs `mobile-purchase-migrate` to completion (exit 0), then starts `mobile-purchase`. `docker compose … up` for `mobile-purchase` pulls in its `depends_on` graph automatically.

- [ ] **Step 3: Confirm the migrate one-shot applied the migrations and exited 0.**
```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml logs mobile-purchase-migrate | tail -30
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml ps -a mobile-purchase-migrate
```
Expected: the logs show Prisma applying the 7 migrations (or "No pending migrations" on a re-run — idempotent); `ps -a` shows the service `Exited (0)`.

- [ ] **Step 4: The load-bearing smoke — the distroless app serves `/health/ready` (proves engine + DB connectivity without the CLI).**
```bash
sleep 5
curl -fsS localhost:8090/health/ready ; echo
curl -fsS -o /dev/null -w '%{http_code}\n' localhost:8090/health
```
Expected: `/health/ready` returns `200` with a body indicating `postgres: true` (the distroless `@prisma/client` + the copied `generated/` **query engine** connected to Postgres — no `prisma` CLI, no runtime `prisma generate`); `/health` returns `200`. If `/health/ready` reports the DB unreachable or the container crash-looped on an engine load error, the runtime `generated/` copy or the engine ABI is wrong — fix in D3.1 before proceeding. (Give it a few seconds; retry the curl once if the app is still booting.)

- [ ] **Step 5: Record the runtime image size for the gate, then tear down.**
```bash
docker image inspect -f '{{.Size}}' mp-runtime:d3 2>/dev/null || docker image inspect -f '{{.Size}}' "$(docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml images -q mobile-purchase)"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml down
```
Expected: the runtime image size is recorded (compare to the D3.1 Step 1 baseline — expect a material reduction); the stack tears down. (Leave `mobile-purchase-postgres`'s volume alone — `down` without `-v` keeps it.)

- [ ] **Step 6: Commit the compose stack.**
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix && git add infra/docker-compose.app.yml && git commit -m "feat(mobile_purchase): local compose stack — one-shot migrate then distroless app (D3.2)"
```
No co-author trailer. `git status` afterward shows only the dashboard WIP as remaining modifications.

---

### Task 3 (D3.3): Verify gate

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ledger entry only — appended, NOT committed; `.superpowers/` is git-ignored)
- No source changes — verification only. If any check fails, fix the owning task (D3.1/D3.2) and re-run this gate from Step 1.

**Interfaces:**
- Consumes: the D3.1 Dockerfile (3 targets) + D3.2 compose stack.
- Produces: a pass/fail record appended to `.superpowers/sdd/progress.md`.

**Environment notes:** Docker must be RUNNING. `<D3-base>` below = the commit BEFORE D3.1 (the D3 spec commit `7c8789e`; substitute the real SHA if it differs — `git log --oneline` shows D3.1's parent). D3 is pure infra — NO app test suite / tsc step is required (no `src/` changed); a `git diff --stat <D3-base>..HEAD -- backend/mobile_purchase/src` MUST be empty (proves it).

- [ ] **Step 1: Both targets build clean.**
```bash
cd /Users/aimeric/Documents/personnal-project/MyAmpix
docker build --target migrate -f backend/mobile_purchase/Dockerfile -t mp-migrate:gate .
docker build --target runtime -f backend/mobile_purchase/Dockerfile -t mp-runtime:gate .
```
Expected: both succeed, no errors.

- [ ] **Step 2: Size + no-CLI evidence.**
```bash
echo "runtime size (bytes):" ; docker image inspect -f '{{.Size}}' mp-runtime:gate
echo "baseline was (bytes):" ; docker image inspect -f '{{.Size}}' mp-baseline:pre-d3 2>/dev/null || echo "231515248 (documented)"
docker history --no-trunc mp-runtime:gate | grep -i "install -g prisma" && echo "FAIL: prisma CLI present" || echo "PASS: no prisma CLI layer"
```
Expected: runtime size materially below baseline; `PASS: no prisma CLI layer`. Record both numbers + the delta for the ledger.

- [ ] **Step 3: Full compose smoke (migrate → app → health).**
```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml up -d --build mobile-purchase
sleep 8
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml ps -a mobile-purchase-migrate
curl -fsS localhost:8090/health/ready ; echo
docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml down
```
Expected: `mobile-purchase-migrate` `Exited (0)`; `/health/ready` → `200` `{postgres:true}`. (Retry the curl once if the app is still booting.)

- [ ] **Step 4: WIP-safety + pure-infra proof.**
```bash
git status --short
git diff --stat <D3-base>..HEAD -- backend/mobile_purchase/src backend/mobile_purchase/prisma ; echo "src/prisma diff above must be EMPTY"
git log --name-only <D3-base>..HEAD | grep -E 'dashboard/src/components/layout/|command-palette/CommandPalette|src/test/render-app|RailInitial|demo_config' ; echo "wip-exit=$?"
git log <D3-base>..HEAD --format='%h %b' | grep -i 'co-authored' ; echo "coauthor-exit=$?"
```
Expected: `git status` shows ONLY the user's known WIP set, nothing staged; the `src`/`prisma` diff is EMPTY (pure infra — no app/schema change); `wip-exit=1` (no WIP file in any D3 commit); `coauthor-exit=1` (no trailer). If any WIP file appears in a D3 commit: STOP and surface it.

- [ ] **Step 5: Record the gate in the ledger (append only — do NOT git add/commit; `.superpowers/` is git-ignored).**

Append to `.superpowers/sdd/progress.md` (substitute the observed sizes):
```
Task D3.3 (verify gate): complete — ALL checks PASS. (1) both Dockerfile targets (migrate + distroless runtime) build clean; (2) runtime image <NEW> bytes vs <BASE> baseline (−<DELTA>, no `npm install -g prisma` layer, no second prisma generate, distroless base); (3) compose smoke: mobile-purchase-migrate Exited(0) applied the 7 migrations, distroless mobile-purchase served /health/ready 200 {postgres:true} — proving @prisma/client + the copied generated/ engine connect WITHOUT the prisma CLI; (4) WIP-safe: git status = user's collapse-rail WIP set ONLY, ZERO D3-range commits touch layout/nav-model/CommandPalette/render-app/RailInitial/demo_config, src/ + prisma/ diff EMPTY (pure infra), nothing staged, no co-author trailers.
=== SUB-PROJECT D3 (Cloud Run image slimming) COMPLETE. Dockerfile → 3 targets: builder / one-shot migrate (prisma migrate deploy, sourced from the workspace install, no global npm) / distroless gcr.io/distroless/nodejs22 runtime (node dist/main.js, no CLI/shell, carries the pre-generated client+engine). docker-entrypoint.sh deleted (migration no longer runs from the serving container — removes the multi-instance race). infra/docker-compose.app.yml runs migrate→app via service_completed_successfully. GCP/Cloud-Run-Job wiring stays X1. NOT pushed/merged. This was the LAST creds-free slice of sub-project D. ===
```
Do NOT run `git add .superpowers/...` — it is git-ignored. `git status --short` remains exactly the WIP set.
