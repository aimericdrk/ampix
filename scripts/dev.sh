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
[ -f backend/mobile_analytics/.env ] || {
  cp backend/mobile_analytics/.env.example backend/mobile_analytics/.env
  info "created backend/mobile_analytics/.env from backend/mobile_analytics/.env.example"
}

# 2. databases (waits for healthchecks)
info "starting databases (ClickHouse :8123, Postgres :5432, Redis :6379)…"
docker compose -f infra/docker-compose.yml up -d --wait

# 3. schema + demo data
info "applying database migrations…"
pnpm --filter @myampix/mobile-analytics exec prisma migrate deploy
info "seeding demo project + ingest token…"
pnpm --filter @myampix/mobile-analytics exec prisma db seed

# 4. app processes — backend logs on the left, dashboard logs on the right
BACKEND_CMD='pnpm --filter @myampix/mobile-analytics start:dev'
DASHBOARD_CMD='pnpm --filter dashboard dev'
info "starting backend (http://localhost:8088) + dashboard (http://localhost:5173)…"

if command -v tmux >/dev/null; then
  if [ -n "${TMUX:-}" ]; then
    # already inside tmux: split the current window instead of nesting sessions
    tmux split-window -h "$DASHBOARD_CMD"
    tmux select-pane -L
    exec $BACKEND_CMD
  fi
  SESSION=myampix-dev
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  info "opening tmux session '$SESSION' — Ctrl-C in a pane stops that process, 'tmux kill-session -t $SESSION' stops both"
  exec tmux new-session -s "$SESSION" -n dev "$BACKEND_CMD" \; \
    split-window -h "$DASHBOARD_CMD" \; \
    set-option -g mouse on \; \
    set-option -w pane-border-status top \; \
    select-pane -t 0 -T 'backend :8088' \; \
    select-pane -t 1 -T 'dashboard :5173' \; \
    select-pane -t 0
fi

# fallback: no tmux — interleaved logs with colored prefixes
info "tmux not found — showing labeled logs instead (run 'brew install tmux' to get the split view)"
trap 'echo; info "shutting down backend + dashboard…"; kill 0' EXIT INT TERM
$BACKEND_CMD 2>&1 | sed -e $'s/^/\033[1;34m[backend]\033[0m /' &
$DASHBOARD_CMD 2>&1 | sed -e $'s/^/\033[1;35m[web]    \033[0m /' &
wait
