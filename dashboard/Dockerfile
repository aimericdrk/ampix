# syntax=docker/dockerfile:1
# MyAmpix dashboard image — static Vite build served by nginx (unprivileged, :8080).
# Build context is the REPO ROOT (pnpm workspace). Runtime config (backend origins) is NOT baked in:
# the nginx entrypoint renders /config.js from API_BASE_URL / PURCHASE_API_BASE_URL at container start
# (dashboard/src/lib/config.ts reads window.___MYAMPIX_CONFIG__ from /config.js).

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app
# Workspace manifests so the lockfile importers resolve; only the dashboard's deps are installed.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY backend/mobile_analytics/package.json backend/mobile_analytics/package.json
COPY backend/mobile_purchase/package.json backend/mobile_purchase/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY dashboard dashboard
RUN pnpm install --frozen-lockfile --filter @myampix/dashboard...
RUN pnpm --filter @myampix/dashboard build

# ---------- runtime ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Templates are rendered by the image's entrypoint (envsubst) into /etc/nginx/conf.d/ at start.
COPY dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY dashboard/nginx/config.js.template /etc/nginx/templates/config.js.template
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html
# Only these two variables are substituted — nginx's own $uri/$host etc. are left alone.
ENV NGINX_ENVSUBST_FILTER='^(API_BASE_URL|PURCHASE_API_BASE_URL)$' \
    API_BASE_URL="" \
    PURCHASE_API_BASE_URL=""
EXPOSE 8080
