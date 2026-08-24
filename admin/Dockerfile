# syntax=docker/dockerfile:1
# MyAmpix admin console image — Next.js standalone (runtime) + one-shot migrate/seed (migrate).
# Build context is the REPO ROOT (pnpm workspace).

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
# openssl so `prisma generate` targets the runtime's openssl-3.0.x engine (same rationale as the
# backend Dockerfiles).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY backend/mobile_analytics/package.json backend/mobile_analytics/package.json
COPY backend/mobile_purchase/package.json backend/mobile_purchase/package.json
COPY dashboard/package.json dashboard/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY admin admin
# prepare (prisma generate) runs during install and needs the schema present — admin/ is copied above.
RUN pnpm install --frozen-lockfile --filter @myampix/admin...
RUN pnpm --filter @myampix/admin build
# Migrate bundle: WITH devDeps so the prisma CLI + migration engine are present (lockfile-pinned).
RUN pnpm --filter=@myampix/admin deploy --legacy /out-migrate

# ---------- migrate (one-shot: create DB → migrate deploy → seed default admin) ----------
FROM node:22-bookworm-slim AS migrate
ENV NODE_ENV=production
# openssl: without it the Prisma CLI misdetects openssl-1.1.x and misses the bundled 3.0.x engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /out-migrate /app
# prisma/ and scripts/ copied explicitly in case `pnpm deploy` prunes them from the bundle.
COPY --from=builder /app/admin/prisma /app/prisma
COPY --from=builder /app/admin/scripts /app/scripts
CMD ["node", "scripts/migrate.mjs"]

# ---------- runtime (Next standalone) ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# openssl so Prisma's runtime platform detection matches the openssl-3.0.x engine generated in the
# builder (without it, detection falls back to openssl-1.1.x and the engine "does not exist").
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Standalone output: traced node_modules at the workspace root + the app under admin/.
COPY --from=builder --chown=node:node /app/admin/.next/standalone /app
COPY --from=builder --chown=node:node /app/admin/.next/static /app/admin/.next/static
COPY --from=builder --chown=node:node /app/admin/public /app/admin/public
# Next's output tracing misses Prisma's native query engine — copy the full generated client.
COPY --from=builder --chown=node:node /app/admin/generated /app/admin/generated
USER node
EXPOSE 3000
CMD ["node", "admin/server.js"]
