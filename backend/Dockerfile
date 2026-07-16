# syntax=docker/dockerfile:1
# MyAmpix backend image — X1 (deploy pipeline), first increment.
# Design: docs/superpowers/specs/2026-07-16-backend-dockerfile-design.md
# Build context is the REPO ROOT (see infra/docker-compose.app.yml) so the pnpm workspace is visible.

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
# argon2 + node-gyp need a C/C++ toolchain to compile during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Workspace root + the packages the backend needs. dashboard's manifest is copied so the workspace
# is structurally valid, but `--filter @myampix/backend...` keeps dashboard's deps out of the install.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY dashboard/package.json dashboard/package.json
COPY packages/contracts packages/contracts
COPY backend backend

# Full source is copied before install because both backend (`prepare`: prisma generate) and
# contracts (`prepare`: tsc) run their prepare scripts during install and need their sources present.
RUN pnpm install --frozen-lockfile --filter @myampix/backend...

# Build order: contracts (dist consumed by backend) → prisma client (needed to typecheck) → Nest build.
RUN pnpm --filter @myampix/contracts build
RUN pnpm --filter @myampix/backend exec prisma generate
RUN pnpm --filter @myampix/backend build

# Self-contained, symlink-free, prod-only deploy of the backend into /out — the clean answer to
# pnpm workspace symlinks not surviving a naive copy into the runtime stage. `--legacy` is required
# because pnpm 10 otherwise only deploys workspaces with `inject-workspace-packages=true`; the legacy
# path copies the resolved deps (incl. the built @myampix/contracts) from the store into /out.
RUN pnpm --filter=@myampix/backend deploy --prod --legacy /out

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app

# The pruned, flattened backend: dist/, prod-only node_modules, prisma/ (schema + migrations), package.json.
COPY --from=builder --chown=app:app /out /app

# The Prisma migration CLI for the entrypoint's `migrate deploy`. `pnpm deploy --prod` prunes the
# devDependency `prisma`, so install it globally at build time (network available then; none needed
# at container start). Pinned to the backend's prisma dependency.
RUN npm install -g prisma@6.8.0 && npm cache clean --force

# Regenerate the Prisma client into the deployed node_modules so it is guaranteed present in the
# final image regardless of whether `pnpm deploy` carried the generated output.
RUN prisma generate --schema prisma/schema.prisma

COPY --chown=app:app backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER app
EXPOSE 8088
ENTRYPOINT ["/app/docker-entrypoint.sh"]
