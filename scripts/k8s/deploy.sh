#!/usr/bin/env bash
# Deploy/upgrade MyAmpix on the cluster your kubeconfig points at.
# Usage: scripts/k8s/deploy.sh <image-tag> [values-file]
#   e.g. scripts/k8s/deploy.sh sha-1a2b3c4          (values: infra/values.prod.yaml)
# Runs the migrate hook Jobs first, then rolls the Deployments; on ANY failure the release is rolled
# back to the previous revision (--atomic on Helm 3, --rollback-on-failure on Helm 4).
set -euo pipefail
TAG="${1:?usage: deploy.sh <image-tag> [values-file]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALUES="${2:-$ROOT/infra/values.prod.yaml}"
NS="${NAMESPACE:-myampix}"
RELEASE="${RELEASE:-myampix}"

for t in helm kubectl; do command -v "$t" >/dev/null || { echo "deploy.sh: missing $t" >&2; exit 1; }; done
[ -f "$VALUES" ] || { echo "deploy.sh: values file $VALUES not found (copy infra/helm/myampix/values.prod.example.yaml)" >&2; exit 1; }

major="$(helm version --template '{{.Version}}' | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$major" -ge 4 ]; then ROLLBACK_FLAG=--rollback-on-failure; else ROLLBACK_FLAG=--atomic; fi

echo "deploy.sh: release=$RELEASE ns=$NS tag=$TAG values=$VALUES"
helm upgrade --install "$RELEASE" "$ROOT/infra/helm/myampix" \
  -n "$NS" --create-namespace -f "$VALUES" --set image.tag="$TAG" \
  "$ROLLBACK_FLAG" --wait --timeout 10m
echo
kubectl -n "$NS" get deploy,hpa,ingress
