#!/usr/bin/env bash
# Builds every MyAmpix image on this host and imports it into the k3s containerd image store.
# No registry involved — the cluster runs what this box builds.
# Most images build from this repo; notification-sender builds from its own checkout ($NOTIFICATION_SRC).
#   Usage: scripts/k8s/build-local-images.sh [tag]     (default: sha-<short git sha>)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
TAG="${1:-sha-$(git rev-parse --short=7 HEAD)}"
OWNER="${IMAGE_OWNER:-local}"
REG="${IMAGE_REGISTRY:-ghcr.io}"

# notification-sender lives in its own repo, checked out next to this one. Override if it is
# elsewhere:  NOTIFICATION_SRC=/path/to/notification-sender scripts/k8s/build-local-images.sh
NOTIFICATION_SRC="${NOTIFICATION_SRC:-$ROOT/../notification-sender}"

# name|dockerfile|target|context   (context is relative to $ROOT, or absolute)
TARGETS=(
  "mobile-analytics|backend/mobile_analytics/Dockerfile|runtime|."
  "mobile-purchase|backend/mobile_purchase/Dockerfile|runtime|."
  "mobile-purchase-migrate|backend/mobile_purchase/Dockerfile|migrate|."
  "dashboard|dashboard/Dockerfile|runtime|."
  "admin|admin/Dockerfile|runtime|."
  "admin-migrate|admin/Dockerfile|migrate|."
  "notification-sender|Dockerfile|runtime|$NOTIFICATION_SRC"
)

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r name dockerfile target context <<< "$entry"
  # Dockerfile paths are relative to their own build context, which is this repo for everything
  # except notification-sender.
  [ -f "$context/$dockerfile" ] || {
    echo "build-local-images.sh: $context/$dockerfile not found" >&2
    [ "$name" = notification-sender ] && echo "  clone it:  git clone git@github.com:ATCLUB-INC/notification-sender.git $NOTIFICATION_SRC" >&2
    exit 1
  }
  ref="$REG/$OWNER/myampix-$name:$TAG"
  echo "=== building $ref (target=$target, context=$context) ==="
  sudo docker build -f "$context/$dockerfile" --target "$target" -t "$ref" "$context"
done

echo "=== importing into k3s containerd ==="
for entry in "${TARGETS[@]}"; do
  IFS='|' read -r name _ _ _ <<< "$entry"
  ref="$REG/$OWNER/myampix-$name:$TAG"
  sudo docker save "$ref" | sudo k3s ctr images import -
  echo "imported $ref"
done

echo
echo "TAG=$TAG"
sudo k3s ctr images ls -q | grep "myampix-" | sort
