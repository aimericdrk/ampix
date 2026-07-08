#!/usr/bin/env bash
# One command to run the whole MyAmpix stack locally:
#   databases (ClickHouse + Postgres + Redis) → migrate → seed → backend + dashboard.
# Ctrl-C stops the backend and dashboard; the databases keep running
# (stop them with `pnpm infra:down`).
set -euo pipefail
cd "$(dirname "$0")/.."

info() { printf '\033[1;36m▶ %s\033[0m\n' "$1"; }
die() {
  printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

# 0. prerequisites
command -v docker >/dev/null || die "docker is required (install Docker Desktop)"
docker info >/dev/null 2>&1 || die "the Docker daemon is not running — start Docker Desktop first"
command -v pnpm >/dev/null || die "pnpm is required — run 'corepack enable'"

# 1. dependencies + backend env
[ -d node_modules ] || {
  info "installing dependencies…"
  pnpm install
}
[ -f backend/.env ] || {
  cp backend/.env.example backend/.env
  info "created backend/.env from backend/.env.example"
}

# 2. databases (waits for healthchecks)
info "starting databases (ClickHouse :8123, Postgres :5432, Redis :6379)…"
docker compose -f infra/docker-compose.yml up -d --wait

# 3. schema + demo data
info "applying database migrations…"
pnpm --filter @myampix/backend exec prisma migrate deploy
info "seeding demo project + ingest token…"
pnpm --filter @myampix/backend exec prisma db seed

# 4. app processes — Ctrl-C stops both
info "starting backend (http://localhost:8080) + dashboard (http://localhost:5173)…"
trap 'echo; info "shutting down backend + dashboard…"; kill 0' EXIT INT TERM
pnpm --filter @myampix/backend start:dev &
pnpm --filter dashboard dev &
wait
