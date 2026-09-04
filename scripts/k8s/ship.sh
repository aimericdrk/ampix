#!/usr/bin/env bash
# ship.sh — put the latest code on this cluster with one command.
#
#   scripts/k8s/ship.sh
#
# This box IS the deploy target: it builds the images itself and imports them straight into the k3s
# containerd store (image.owner "local" in infra/values.prod.yaml — nothing is ever pulled from a
# registry). ship.sh chains the steps that were previously run by hand:
#
#   1. git pull --ff-only        bring this checkout up to date with origin
#   2. build-local-images.sh     build the 6 images at TAG, import them into k3s
#   3. deploy.sh                 helm upgrade — migrate Jobs first, auto-rollback on any failure
#   4. smoke tests               the four public hosts must answer
#
# TAG is always sha-<7-char HEAD>, so what runs on the cluster is exactly what git says it is. If
# tracked files are modified, TAG gets a -dirty suffix and the images are always rebuilt.
#
# Options:
#   --no-pull        deploy this checkout as-is (skip git pull)
#   --tag <name>     deploy <name> instead of sha-<HEAD>; reuses existing images when present
#   --rebuild        rebuild even if that tag is already in containerd
#   --prune [N]      after a successful deploy, delete all but the newest N tags (default 5)
#   --skip-tests     don't run the post-deploy smoke tests
#   -h, --help       this text
#
# Rollback is unchanged and does not go through this script:
#   helm -n myampix history myampix
#   helm -n myampix rollback myampix <REVISION>     # does NOT undo DB migrations
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
NS="${NAMESPACE:-myampix}"
VALUES="${VALUES:-$ROOT/infra/values.prod.yaml}"

PULL=1 REBUILD=0 PRUNE=0 PRUNE_KEEP=5 TESTS=1 TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-pull)    PULL=0; shift ;;
    --rebuild)    REBUILD=1; shift ;;
    --skip-tests) TESTS=0; shift ;;
    --tag)        TAG="${2:?--tag needs a value}"; shift 2 ;;
    --prune)      PRUNE=1; shift
                  case "${1:-}" in [0-9]*) PRUNE_KEEP="$1"; shift ;; esac ;;
    -h|--help)    awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,"");print}' "$0"; exit 0 ;;
    *)            echo "ship.sh: unknown option $1 (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mship.sh: %s\033[0m\n' "$*" >&2; exit 1; }

for t in git docker helm kubectl; do command -v "$t" >/dev/null || die "missing $t"; done
[ -f "$VALUES" ] || die "values file $VALUES not found"
sudo -n true 2>/dev/null || echo "ship.sh: sudo may prompt for a password (docker + k3s ctr need it)"

# ── 1. pull ──────────────────────────────────────────────────────────────────────────────────────
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse --short=7 HEAD)"
if [ "$PULL" = 1 ]; then
  step "git pull --ff-only (branch $BRANCH)"
  git pull --ff-only || die "pull is not a fast-forward — reconcile this checkout with origin first"
else
  step "skipping git pull (--no-pull), branch $BRANCH"
fi

HEAD_SHA="$(git rev-parse --short=7 HEAD)"
DIRTY=0
git diff --quiet HEAD -- || DIRTY=1        # tracked-file changes only; untracked files are ignored
[ -z "$TAG" ] && { TAG="sha-$HEAD_SHA"; [ "$DIRTY" = 1 ] && TAG="$TAG-dirty"; }
[ "$DIRTY" = 1 ] && { REBUILD=1; echo "ship.sh: tracked files are modified — tagging $TAG and forcing a rebuild"; }

CURRENT="$(kubectl -n "$NS" get deploy mobile-analytics \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | sed 's/.*://')"
echo "  running on cluster : ${CURRENT:-<nothing deployed>}"
echo "  shipping           : $TAG"
[ "$BEFORE" != "$HEAD_SHA" ] && echo "  pulled             : $BEFORE → $HEAD_SHA"
if [ -n "$CURRENT" ] && [ "$CURRENT" = "$TAG" ] && [ "$DIRTY" = 0 ] && [ "$REBUILD" = 0 ]; then
  echo
  echo "ship.sh: the cluster already runs $TAG — nothing to ship."
  echo "         (re-run with --rebuild to force a rebuild and redeploy anyway)"
  exit 0
fi

# ── 2. build ─────────────────────────────────────────────────────────────────────────────────────
# build-local-images.sh builds every target and imports each into k3s containerd. The count is read
# out of that script's TARGETS array rather than hardcoded here — hardcoding it meant that adding a
# target left this check satisfied by the old number and skipped the build.
WANT=$(awk '/^TARGETS=\(/{i=1;next} i&&/^\)/{exit} i&&/\|/{n++} END{print n+0}' \
  "$ROOT/scripts/k8s/build-local-images.sh")
[ "$WANT" -gt 0 ] || die "could not read the TARGETS list from build-local-images.sh"
HAVE=$(sudo k3s ctr images ls -q 2>/dev/null | grep -c "myampix-.*:$TAG\$" || true)
if [ "$HAVE" -ge "$WANT" ] && [ "$REBUILD" = 0 ]; then
  step "images for $TAG already in containerd ($HAVE/$WANT) — skipping build (--rebuild to force)"
else
  step "building $WANT images at $TAG and importing them into k3s"
  "$ROOT/scripts/k8s/build-local-images.sh" "$TAG"
fi

# ── 3. deploy ────────────────────────────────────────────────────────────────────────────────────
step "helm upgrade to $TAG (migrations first, rollback on failure)"
NAMESPACE="$NS" "$ROOT/scripts/k8s/deploy.sh" "$TAG" "$VALUES"

# ── 4. smoke tests ───────────────────────────────────────────────────────────────────────────────
if [ "$TESTS" = 1 ]; then
  step "smoke tests"
  # Read hosts.<name> out of the values file without needing yq: only lines inside the hosts: block.
  host() { awk -v k="$1" '/^hosts:/{i=1;next} i&&/^[^ ]/{i=0} i&&$1==k":"{print $2;exit}' "$VALUES"; }
  fail=0
  check() { # check <label> <url> <acceptable codes…>
    local label="$1" url="$2"; shift 2
    local code; code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null || echo 000)"
    if printf '%s\n' "$@" | grep -qx "$code"; then printf '  \033[32mok\033[0m   %-9s %s (%s)\n' "$label" "$url" "$code"
    else printf '  \033[31mFAIL\033[0m %-9s %s (%s, wanted %s)\n' "$label" "$url" "$code" "$*"; fail=1; fi
  }
  check api      "https://$(host api)/health/ready"      200
  check purchase "https://$(host purchase)/health/ready" 200
  check app      "https://$(host app)/"                  200
  check admin    "https://$(host admin)/"                200 302 307   # 307 → the login page
  # Only when it is switched on — notification.enabled is false until its secrets exist, and a
  # smoke test for a host with no backing Deployment would fail every deploy.
  if kubectl -n "$NS" get deploy notification-sender >/dev/null 2>&1; then
    check notif  "https://$(host notification)/health/ready" 200
  fi
  if [ "$fail" = 1 ]; then
    echo
    echo "ship.sh: $TAG is deployed but a smoke test failed. Inspect, then roll back if needed:"
    echo "  kubectl -n $NS get pods"
    echo "  kubectl -n $NS logs -l app.kubernetes.io/name=mobile-analytics --tail=100"
    echo "  helm -n $NS history ${RELEASE:-myampix}"
    exit 1
  fi
fi

# ── 5. prune ─────────────────────────────────────────────────────────────────────────────────────
# Old tags accumulate in both stores (~6 images per deploy). Never touches the tag just deployed.
if [ "$PRUNE" = 1 ]; then
  step "pruning old image tags (keeping the newest $PRUNE_KEEP, plus $TAG)"
  mapfile -t OLD < <(
    sudo docker images --filter=reference='ghcr.io/local/myampix-*' --format '{{.CreatedAt}}|{{.Tag}}' \
      | sort -r | awk -F'|' '!seen[$2]++ {print $2}' | grep -vx "$TAG" | tail -n +"$PRUNE_KEEP"
  )
  if [ "${#OLD[@]}" -eq 0 ]; then echo "  nothing to prune"; fi
  for t in "${OLD[@]:-}"; do
    [ -z "$t" ] && continue
    echo "  dropping $t"
    for ref in $(sudo docker images --filter=reference="ghcr.io/local/myampix-*:$t" --format '{{.Repository}}:{{.Tag}}'); do
      sudo docker rmi "$ref" >/dev/null 2>&1 || true
      sudo k3s ctr images rm "$ref" >/dev/null 2>&1 || true
    done
  done
fi

step "done — $TAG is live"
kubectl -n "$NS" get deploy -o custom-columns='DEPLOYMENT:.metadata.name,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[0].image' 2>/dev/null
