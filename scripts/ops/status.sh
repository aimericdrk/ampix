#!/usr/bin/env bash
# One-shot health snapshot of the whole deployment. Safe to run any time.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS="${NAMESPACE:-myampix}"
HOSTS=(app api purchase admin)
BASE="${BASE_DOMAIN:-37.187.71.20.nip.io}"

# The docker socket and /var/backups are root-owned. Prefer a direct call (works once your shell has
# picked up the `docker` group — re-login after install), fall back to passwordless sudo.
DOCKER="docker"; docker ps >/dev/null 2>&1 || DOCKER="sudo -n docker"
SUDO="";        [ -r /var/backups/myampix/postgres ] || SUDO="sudo -n"

echo "### systemd"
for u in docker k3s myampix-datastores myampix-backup.timer; do
  printf '  %-24s enabled=%-10s active=%s\n' "$u" "$(systemctl is-enabled "$u" 2>&1)" "$(systemctl is-active "$u" 2>&1)"
done

echo; echo "### datastores (docker)"
$DOCKER ps --filter name=myampix --format '  {{.Names}}  {{.Status}}'

echo; echo "### workloads (k8s)"
kubectl -n "$NS" get deploy,hpa --no-headers 2>/dev/null | sed 's/^/  /'

echo; echo "### pods not fully ready"
kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -v 'Completed' | grep -v '1/1 *Running' | sed 's/^/  /' || true
echo "  (empty above = everything ready)"

echo; echo "### TLS certificates"
kubectl -n "$NS" get certificate --no-headers 2>/dev/null | sed 's/^/  /'

echo; echo "### public endpoints"
declare -A PATHS=([app]=/healthz [api]=/health/ready [purchase]=/health/ready [admin]=/api/healthz)
for h in "${HOSTS[@]}"; do
  printf '  %-9s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$h.$BASE${PATHS[$h]}")"
done

echo; echo "### backups"
$SUDO ls -1t /var/backups/myampix/postgres/ 2>/dev/null | head -3 | sed 's/^/  postgres\//'
$SUDO ls -1t /var/backups/myampix/clickhouse/ 2>/dev/null | head -1 | sed 's/^/  clickhouse\//'
echo "  total: $($SUDO du -sh /var/backups/myampix 2>/dev/null | cut -f1)"

echo; echo "### disk"
df -h / | tail -1 | sed 's/^/  /'
