#!/usr/bin/env bash
# Builds every MyAmpix image on this host and imports it into the k3s containerd image store.
# No registry involved — the cluster runs what this box builds.
#   Usage: scripts/k8s/build-local-images.sh [tag]     (default: sha-<short git sha>)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TAG="${1:-sha-$(git rev-parse --short=7 HEAD)}"
OWNER="${IMAGE_OWNER:-local}"
REG="${IMAGE_REGISTRY:-ghcr.io}"

# name|dockerfile|target
TARGETS=(
  "mobile-analytics|backend/mobile_analytics/Dockerfile|runtime"
  "mobile-purchase|backend/mobile_purchase/Dockerfile|runtime"
  "mobile-purchase-migrate|backend/mobile_purchase/Dockerfile|migrate"
  "dashboard|dashboard/Dockerfile|runtime"
  "admin|admin/Dockerfile|runtime"
  "admin-migrate|admin/Dockerfile|migrate"
)

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r name dockerfile target <<< "$entry"
  ref="$REG/$OWNER/myampix-$name:$TAG"
  echo "=== building $ref (target=$target) ==="
  sudo docker build -f "$dockerfile" --target "$target" -t "$ref" .
done

echo "=== importing into k3s containerd ==="
for entry in "${TARGETS[@]}"; do
  IFS='|' read -r name _ _ <<< "$entry"
  ref="$REG/$OWNER/myampix-$name:$TAG"
  sudo docker save "$ref" | sudo k3s ctr images import -
  echo "imported $ref"
done

echo
echo "TAG=$TAG"
sudo k3s ctr images ls -q | grep "myampix-" | sort
