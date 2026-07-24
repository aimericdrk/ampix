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
