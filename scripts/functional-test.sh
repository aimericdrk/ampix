#!/usr/bin/env bash
# Runs the functional (no-mock) dashboard e2e suite end-to-end, headlessly:
# infra → migrate → build backend → boot backend for real → run Playwright
# against it → always tear the backend down.
#
# Usage: pnpm test:functional   (or: bash scripts/functional-test.sh)
set -euo pipefail
# Job control on: backgrounding the backend below then gets it its own process
# group, so the trap can kill "$BACKEND_PID and everything under it" via a
# negative pid without touching this script's own process group.
set -m

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_LOG=/tmp/mam-func-backend.log
BACKEND_PID=""

info() { printf '\033[1;36m▶ %s\033[0m\n' "$1"; }
die() {
  printf '\033[1;31mERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    info "stopping backend (pid $BACKEND_PID) and its process group…"
    kill -TERM -- "-$BACKEND_PID" 2>/dev/null || kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# 1. backend env
[ -f backend/.env ] || {
  cp backend/.env.example backend/.env
  info "created backend/.env from backend/.env.example"
}

# 2. infra (ClickHouse, Postgres, Redis) — waits for healthchecks
info "starting infra (ClickHouse :8123, Postgres :5432, Redis :6379)…"
docker compose -f infra/docker-compose.yml up -d --wait

# 3. schema
info "applying database migrations…"
pnpm --filter @myampix/backend exec prisma migrate deploy

# 4. build + boot the real backend
info "building backend…"
pnpm --filter @myampix/backend build

info "starting backend (http://localhost:8080)…"
: >"$BACKEND_LOG"
(cd backend && exec node dist/main.js) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

info "waiting for backend health…"
ready=""
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8080/health 2>/dev/null | grep -q '"status":"ok"'; then
    ready=1
    break
  fi
  kill -0 "$BACKEND_PID" 2>/dev/null || die "backend process exited early — see $BACKEND_LOG"
  sleep 1
done

if [ -z "$ready" ]; then
  echo "---- $BACKEND_LOG ----" >&2
  cat "$BACKEND_LOG" >&2 || true
  die "backend did not become healthy within 60s"
fi
info "backend healthy"

# 5. Playwright browser + functional suite
info "ensuring Playwright chromium is installed…"
pnpm --filter dashboard exec playwright install chromium

info "running functional e2e tests (real backend, no mocks)…"
pnpm --filter dashboard exec playwright test --config playwright.func.config.ts
