# MyRevenueCat — Cloud Run image slimming (D3) — Design

**Goal:** Slim the `backend/mobile_purchase` **serving** Docker image and extract database migrations out of the serving container. Two moves: (1) a **distroless** runtime image that carries only what serves traffic — no `prisma` CLI, no shell, one copy of the query engine; (2) a dedicated **one-shot `migrate` image/step** that runs `prisma migrate deploy` before the serving revision starts. Plus a runnable **local compose stack** (migrate → app) so the flow is exercised end-to-end without GCP.

**Design principle:** This is the documented Cloud Run follow-up. `backend/mobile_purchase/docker-entrypoint.sh:6-8` already flags it ("the Cloud Run increment MUST move this to a dedicated one-shot migration step — multiple instances must not race `migrate deploy`"), and the X1 Dockerfile design (`docs/superpowers/specs/2026-07-16-backend-dockerfile-design.md:124`) explicitly defers "distroless + a separate migration job removes the shell dependency" to this image. D3 is a **pure infra/Dockerfile slice** — no application code, schema, or migration content changes.

**This is D3 of sub-project D's three creds-free slices** (D1 Refund ✅, D2 scheduler+sweep ✅, D3 this). After D3, the remainder of D (X1 GCP deploy pipeline, real store credentials, live delivery) is blocked on user procurement.

---

## §0. Constraints & principles

- **Pure infra.** No change to `src/`, `prisma/schema.prisma`, `prisma/migrations/`, or any test. The only code-ish artifact touched is the Dockerfile, `.dockerignore`, `docker-entrypoint.sh` (deleted), and `infra/docker-compose.app.yml`.
- **The serving image serves only.** It must NOT contain the `prisma` CLI, a shell, or a second copy of the query engine. Migrations are never run from the serving container (removes the multi-instance `migrate deploy` race the entrypoint comment warns about).
- **Node 22 everywhere.** Builder + migrate stay `node:22-bookworm-slim`; runtime is `gcr.io/distroless/nodejs22-debian12` (matches `.nvmrc`/`engines`).
- **pnpm workspace.** Build context is the repo root (the pnpm workspace must be structurally valid). All dependency operations use pnpm with `--filter @myampix/mobile-purchase`; NEVER `npm install` for workspace deps. `pnpm deploy` produces the self-contained, symlink-free bundles the image stages copy.
- **Prisma version stays lockfile-pinned.** The current Dockerfile hand-pins a global `prisma@6.19.3` and warns it must track the lockfile; D3 eliminates that drift risk by sourcing the CLI from the workspace install (`pnpm deploy` bundle) instead of a global `npm install -g`.
- **Creds-free + verifiable locally.** Everything is proven by `docker build` + `docker compose up` against the existing throwaway `mobile-purchase-postgres`. No GCP, no real store credentials, no Cloud Run.
- **HARD WIP rule** (always in force): never touch/stage the user's uncommitted collapse-rail WIP (`dashboard/src/components/layout/*`, `nav-model.ts`, `CommandPalette.tsx`, `render-app.tsx`, `RailInitial.tsx`, `demo_config.dart`, the two `2026-07-16-dashboard-tool-rail*` docs). Never commit `.env`/secrets. No co-author trailers. The user merges.

## §1. The Dockerfile (`backend/mobile_purchase/Dockerfile`, rewritten to 3 targets)

### §1.1 `builder` (unchanged base, one line added)
`FROM node:22-bookworm-slim AS builder`, corepack pnpm@10.12.1, copy the workspace manifests + `backend/mobile_purchase`, then:
- `pnpm install --frozen-lockfile --filter @myampix/mobile-purchase...`
- `pnpm --filter @myampix/mobile-purchase exec prisma generate` (produces `backend/mobile_purchase/generated/client` incl. the query engine)
- `pnpm --filter @myampix/mobile-purchase build` (produces `dist/`)
- `pnpm --filter=@myampix/mobile-purchase deploy --prod --legacy /out` (serving bundle — prod deps only, no `prisma` CLI)
- **NEW:** `pnpm --filter=@myampix/mobile-purchase deploy --legacy /out-migrate` (migrate bundle — includes devDeps, so the `prisma` CLI + migration engine are present)

### §1.2 `migrate` (new one-shot target)
```
FROM node:22-bookworm-slim AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out-migrate /app
# prisma/ (schema + migrations) — copied explicitly in case `pnpm deploy` prunes it.
COPY --from=builder /app/backend/mobile_purchase/prisma /app/prisma
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
```
- One-shot: runs `migrate deploy` and exits (0 on success, non-zero on failure — the compose/Job orchestrator gates the app start on this exit code). Keeps a shell (bookworm-slim) because the `prisma` CLI wants one; size is secondary (this image never serves traffic).
- Sources `prisma` from the workspace bundle, not a global install — no version drift.

### §1.3 `runtime` (new distroless serving target)
```
FROM gcr.io/distroless/nodejs22-debian12 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out /app
# The app imports ../../generated/client at runtime and the query engine lives there; copy it
# explicitly so the serving image needs neither the prisma CLI nor a second `prisma generate`.
COPY --from=builder /app/backend/mobile_purchase/generated /app/generated
EXPOSE 8090
CMD ["dist/main.js"]
```
- Distroless's entrypoint is `node`, so `CMD ["dist/main.js"]` runs `node dist/main.js`. No shell, no entrypoint script.
- Runs as distroless's built-in `nonroot` user (uid 65532) — no `groupadd`/`useradd` (which need a shell) required.
- **Dropped vs. today:** the `npm install -g prisma` layer (~112MB), the runtime `prisma generate` (the second engine copy, ~57MB), the `docker-entrypoint.sh` copy + shell, and the migrate-at-startup step.
- `main.ts`'s dev-only `dotenv` load no-ops with no `.env` present (config comes from the environment); NODE_ENV=production.

### §1.4 `.dockerignore` + entrypoint
- Keep `backend/mobile_purchase/Dockerfile.dockerignore` as-is (it already excludes `**/node_modules`, `**/dist`, `.env*`, tests, `.git`). Do **not** add `**/generated` to it: the builder produces `generated/` itself via `prisma generate` inside the image and never copies the host's, so the ignore is irrelevant either way — leave it untouched. No change needed unless a build-context leak surfaces during the build.
- **Delete** `backend/mobile_purchase/docker-entrypoint.sh` — no target references it after this change (the runtime no longer copies it; migration lives in the `migrate` target's CMD).

## §2. Local compose stack (`infra/docker-compose.app.yml`)

Extend the existing app-compose (which already has a `backend` service for `mobile_analytics`) with two services, mirroring its build/network/env conventions. Both build from the repo-root context with `dockerfile: backend/mobile_purchase/Dockerfile` and a `target:`.

- **`mobile-purchase-migrate`** — `build: { target: migrate }`, `restart: "no"` (one-shot), `depends_on: { mobile-purchase-postgres: { condition: service_healthy } }`, `environment: { DATABASE_URL: postgresql://…@mobile-purchase-postgres:5432/… }`. Runs `migrate deploy` and exits 0.
- **`mobile-purchase`** — `build: { target: runtime }`, `depends_on: { mobile-purchase-migrate: { condition: service_completed_successfully }, mobile-purchase-postgres: { condition: service_healthy } }`, `environment: { DATABASE_URL, PORT: 8090, DASHBOARD_ORIGINS, ANALYTICS_INTERNAL_URL }`, `ports: ["8090:8090"]`. The `service_completed_successfully` condition is the compose expression of "migrate job finishes, THEN the serving revision starts" — the same ordering Cloud Run will enforce with a migrate Job gating the serving revision.

The `mobile-purchase-postgres` service lives in the base `infra/docker-compose.yml`; the stack is brought up with both files (`docker compose -f infra/docker-compose.yml -f infra/docker-compose.app.yml up`), same as the existing `backend` service already relies on. Use the internal service DNS name + internal port `5432` for `DATABASE_URL` (the `:5433` is only the host-published port).

## §3. Data flow

Cloud Run target shape (documented, not wired here — X1 owns the GCP side): a **migrate Cloud Run Job** (the `migrate` image) runs `prisma migrate deploy` to completion, then the **serving revision** (the distroless `runtime` image) is rolled out; the serving container only ever `$connect`s (via `PrismaService.onModuleInit`), never migrates. The local compose stack (§2) is the faithful, runnable rehearsal of that ordering.

## §4. Testing / verification (all local, creds-free)

- **Builds:** `docker build --target runtime -f backend/mobile_purchase/Dockerfile -t mp-runtime .` and `--target migrate -t mp-migrate .` both succeed from the repo root.
- **Size gate:** record `docker image inspect -f '{{.Size}}'` for the new `runtime` vs. the current single-stage image (baseline ~1GB disk / ~231MB deduped). Expect the runtime image materially smaller (no prisma CLI layer, no second engine, distroless base). Record the actual before/after numbers in the verify report (no hard threshold — the goal is "materially smaller + CLI/shell gone").
- **Migrate step:** against a fresh `mobile-purchase-postgres`, the `migrate` image applies all 7 migrations and exits 0; a second run is a no-op (idempotent `migrate deploy`).
- **Serving smoke (the load-bearing test):** `docker compose … up` runs migrate→app; `curl :8090/health/ready` returns `200 {"postgres":true}`. This proves the distroless serving image boots and that `@prisma/client` + the copied `generated/` query engine connect to Postgres **without** the `prisma` CLI or a runtime `prisma generate`. `curl :8090/health` returns `200` (liveness).
- **No-CLI assertion:** confirm the runtime image carries no `prisma` CLI — e.g. `docker history` shows no `npm install -g prisma` layer, and the `/out` bundle is `--prod` (prisma is a devDep). (Distroless has no shell to `exec` into, so assert via build provenance + image contents, not a shell probe.)
- **App unaffected:** no `src/` change, so the existing test suite is untouched; a quick `npx tsc --noEmit` sanity is optional (nothing app-side changed).

## §5. Build order (for the plan)

1. **D3.1** — rewrite the Dockerfile to the 3 targets (builder + `migrate` + distroless `runtime`), delete `docker-entrypoint.sh`. Verify: both targets build; the `runtime` image, run by hand against a throwaway Postgres (migrate applied first via the `migrate` image), answers `/health/ready` 200.
2. **D3.2** — add the `mobile-purchase-migrate` + `mobile-purchase` services to `infra/docker-compose.app.yml`. Verify: `docker compose … up` runs migrate→app in order, `/health/ready` 200; record the runtime image size vs. baseline.
3. **D3.3** — verify gate: both builds clean, the compose smoke green, the size delta + no-CLI evidence recorded, WIP-safety `git status`, ledger.

## §6. Out of scope (explicit)

- **The GCP / Cloud Run wiring** — the migrate Cloud Run Job, the serving service, Workload Identity Federation, Secret Manager, the CI/CD build+deploy pipeline. That is **X1**, blocked on the user's GCP account. D3 delivers the images + local compose + this §3 note on how X1 invokes them.
- **Any app/schema/migration change** — D3 changes packaging only.
- **mobile_analytics** — its image/`backend` service is a separate, already-designed slice (`2026-07-02-infra-cicd-design.md`); D3 does not touch it.
- **Multi-arch / registry push / image signing** — deploy concerns, X1.

## §7. Reference — key existing facts

- Current Dockerfile `backend/mobile_purchase/Dockerfile` (single-stage-ish runtime): base `node:22-bookworm-slim` both stages; runtime does `npm install -g prisma@6.19.3` + a second `prisma generate` + copies `docker-entrypoint.sh`. Build context = repo root.
- `docker-entrypoint.sh`: runs `prisma migrate deploy` then `exec node dist/main.js` — its own comment (lines 6-8) mandates the D3 split.
- `prisma/schema.prisma:5-8` generator → `output = "../generated/client"`; imported at `src/prisma/prisma.service.ts:2`. `prisma` is a devDep, `@prisma/client` a prod dep. `"prepare": "prisma generate"` runs on install.
- `PrismaService` only `$connect`/`$disconnect`s — no migration logic in app code.
- 7 migrations in `prisma/migrations/`. Node 22 (`.nvmrc`, `engines`).
- `main.ts` loads dev-only `.env`, builds the app, `app.listen(port, '0.0.0.0')`. Health endpoints: `/health` (liveness), `/health/ready` (Postgres probe).
- `infra/docker-compose.yml` defines `mobile-purchase-postgres` (host :5433, internal 5432); `infra/docker-compose.app.yml` has the `backend` (mobile_analytics) service to mirror.
