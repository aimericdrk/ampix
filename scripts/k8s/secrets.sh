#!/usr/bin/env bash
# Creates/updates the MyAmpix Kubernetes Secrets from the gitignored env files (idempotent):
#   infra/k8s/secrets/analytics.env → Secret myampix-analytics
#   infra/k8s/secrets/purchase.env  → Secret myampix-purchase
#   infra/k8s/secrets/admin.env     → Secret myampix-admin
#   $GHCR_USER + $GHCR_TOKEN         → docker-registry Secret ghcr-pull (skipped when unset)
# Usage: [NAMESPACE=myampix] [GHCR_USER=… GHCR_TOKEN=…] scripts/k8s/secrets.sh
# After rotating a value: re-run, then `kubectl -n myampix rollout restart deploy -l app.kubernetes.io/part-of=myampix`.
set -euo pipefail
NS="${NAMESPACE:-myampix}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/infra/k8s/secrets"

command -v kubectl >/dev/null || { echo "secrets.sh: kubectl not found" >&2; exit 1; }
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"

for svc in analytics purchase admin; do
  f="$DIR/$svc.env"
  [ -f "$f" ] || { echo "secrets.sh: missing $f — copy $svc.env.example and fill it" >&2; exit 1; }
  if grep -q 'CHANGE_ME' "$f"; then echo "secrets.sh: $f still contains CHANGE_ME" >&2; exit 1; fi
  kubectl -n "$NS" create secret generic "myampix-$svc" --from-env-file="$f" \
    --dry-run=client -o yaml | kubectl apply -f -
done

if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  kubectl -n "$NS" create secret docker-registry ghcr-pull \
    --docker-server=ghcr.io --docker-username="$GHCR_USER" --docker-password="$GHCR_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
else
  echo "secrets.sh: GHCR_USER/GHCR_TOKEN not set — skipping ghcr-pull (fine if the GHCR packages are public; then set image.pullSecret: \"\")"
fi
echo "secrets.sh: done (namespace $NS)"
