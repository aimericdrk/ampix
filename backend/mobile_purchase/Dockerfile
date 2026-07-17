# syntax=docker/dockerfile:1
# MyAmpix mobile-purchase backend image — standalone RevenueCat-style purchase service, own Postgres.
# Build context is the REPO ROOT (mirrors backend/Dockerfile) so the pnpm workspace is visible.

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app

# Workspace root + the packages mobile-purchase needs. Other workspace manifests are copied so the
# workspace is structurally valid, but `--filter @myampix/mobile-purchase...` keeps their deps out
# of the install.
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

# Self-contained, symlink-free, prod-only deploy into /out — the clean answer to pnpm workspace
# symlinks not surviving a naive copy into the runtime stage. `--legacy` is required because pnpm 10
# otherwise only deploys workspaces with `inject-workspace-packages=true`.
RUN pnpm --filter=@myampix/mobile-purchase deploy --prod --legacy /out

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app
WORKDIR /app

# The pruned, flattened service: dist/, prod-only node_modules, prisma/ (schema), package.json.
COPY --from=builder --chown=app:app /out /app

# The Prisma migration CLI for the entrypoint's `migrate deploy`. `pnpm deploy --prod` prunes the
# devDependency `prisma`, so install it globally at build time (network available then; none needed
# at container start). Pinned to the service's prisma dependency (see pnpm-lock.yaml — keep in sync,
# a mismatch against the installed @prisma/client version breaks `prisma generate` below).
RUN npm install -g prisma@6.19.3 && npm cache clean --force

# Regenerate the Prisma client into its package-local output (backend/mobile_purchase/generated/client,
# per prisma/schema.prisma's generator `output`) as a defensive rebuild: `pnpm deploy` already
# reruns the `prepare` script (prisma generate) against /out, but this guarantees a client matching
# the exact engine/runtime bundled with the globally-installed prisma CLI above is present
# regardless of how the deploy step's own generation behaves.
RUN prisma generate --schema prisma/schema.prisma

COPY --chown=app:app backend/mobile_purchase/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER app
EXPOSE 8090
ENTRYPOINT ["/app/docker-entrypoint.sh"]
