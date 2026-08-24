#!/usr/bin/env bash
# End-to-end smoke test of the Helm chart on a local kind cluster, against the dev Compose DB stack.
# Proves: hook Jobs migrate first, every Deployment becomes Available, readiness is green through the
# ingress, the dashboard serves its runtime config. Design §9.2.
#
# Prereqs: docker, kind, kubectl, helm; `pnpm infra:up` (Compose DBs on the host).
# Usage: pnpm k8s:local            # create/update cluster, build+load images, deploy, assert
#        SKIP_BUILD=1 pnpm k8s:local   # reuse already-built local images
#        pnpm k8s:local down       # delete the cluster
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLUSTER="${CLUSTER:-myampix-smoke}"
NS=myampix
HTTP_PORT="${HTTP_PORT:-8089}"   # host port mapped to the kind ingress :80
IMG_PREFIX=ghcr.io/local/myampix
TAG=dev

for t in docker kind kubectl helm curl openssl; do
  command -v "$t" >/dev/null || { echo "local.sh: missing tool '$t'" >&2; exit 1; }
done

if [ "${1:-}" = "down" ]; then kind delete cluster --name "$CLUSTER"; exit 0; fi

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

step "kind cluster ($CLUSTER), ingress :80 → localhost:$HTTP_PORT"
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER" --config=- <<EOC
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: ${HTTP_PORT}
        protocol: TCP
EOC
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

step "ingress-nginx (kind flavour)"
kubectl apply -f https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml >/dev/null
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=240s

step "metrics-server (HPA needs it; insecure kubelet TLS is fine for kind)"
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml >/dev/null
kubectl -n kube-system patch deploy metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null 2>&1 || true

if [ "${SKIP_BUILD:-}" != "1" ]; then
  step "build images"
  docker build -f "$ROOT/backend/mobile_analytics/Dockerfile" --target runtime -t "$IMG_PREFIX-mobile-analytics:$TAG" "$ROOT"
  docker build -f "$ROOT/backend/mobile_purchase/Dockerfile" --target runtime -t "$IMG_PREFIX-mobile-purchase:$TAG" "$ROOT"
  docker build -f "$ROOT/backend/mobile_purchase/Dockerfile" --target migrate -t "$IMG_PREFIX-mobile-purchase-migrate:$TAG" "$ROOT"
  docker build -f "$ROOT/dashboard/Dockerfile" -t "$IMG_PREFIX-dashboard:$TAG" "$ROOT"
  docker build -f "$ROOT/admin/Dockerfile" --target runtime -t "$IMG_PREFIX-admin:$TAG" "$ROOT"
  docker build -f "$ROOT/admin/Dockerfile" --target migrate -t "$IMG_PREFIX-admin-migrate:$TAG" "$ROOT"
fi

step "verify the analytics image's app uid matches values.yaml (runAsUser: 999)"
uid="$(docker run --rm --entrypoint id "$IMG_PREFIX-mobile-analytics:$TAG" -u)"
[ "$uid" = "999" ] || { echo "local.sh: analytics image runs as uid $uid, chart expects 999 — update analytics.runAsUser" >&2; exit 1; }

step "load images into kind"
kind load docker-image --name "$CLUSTER" \
  "$IMG_PREFIX-mobile-analytics:$TAG" "$IMG_PREFIX-mobile-purchase:$TAG" \
  "$IMG_PREFIX-mobile-purchase-migrate:$TAG" "$IMG_PREFIX-dashboard:$TAG" \
  "$IMG_PREFIX-admin:$TAG" "$IMG_PREFIX-admin-migrate:$TAG"

step "host IP (Compose DBs) as seen from the kind node"
# ahostsv4: the EndpointSlice is IPv4 and `getent hosts` may return an IPv6 address first.
HOST_IP="$(docker exec "$CLUSTER-control-plane" getent ahostsv4 host.docker.internal 2>/dev/null | awk '{print $1}' | head -1 || true)"
[ -n "$HOST_IP" ] || HOST_IP="$(docker network inspect kind -f '{{(index .IPAM.Config 0).Gateway}}')"
echo "HOST_IP=$HOST_IP"

step "throwaway secrets (dev creds from infra/docker-compose.yml)"
kubectl create ns "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic myampix-analytics \
  --from-literal=DATABASE_URL="postgresql://myampix:myampix_dev@postgres:5432/myampix" \
  --from-literal=REDIS_URL="redis://redis:6379" \
  --from-literal=CLICKHOUSE_PASSWORD="myampix_dev" \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -base64 48)" \
  --from-literal=JWT_REFRESH_SECRET="$(openssl rand -base64 48)" \
  --from-literal=TOTP_ENC_KEY="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic myampix-purchase \
  --from-literal=DATABASE_URL="postgresql://mobile_purchase:mobile_purchase_dev@mobile-purchase-postgres:5433/mobile_purchase" \
  --from-literal=STORE_CREDENTIALS_ENC_KEY="$(openssl rand -base64 32)" \
  --from-literal=GOOGLE_PUBSUB_SHARED_SECRET="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# Reset the throwaway admin smoke DB so the seed (and its printed credentials) are fresh each run.
docker exec myampix-postgres-1 psql -U myampix -d postgres -c 'DROP DATABASE IF EXISTS admin_console_kind' >/dev/null 2>&1 || true
ADMIN_PW="smoke-$(openssl rand -hex 12)"
kubectl -n "$NS" create secret generic myampix-admin \
  --from-literal=DATABASE_URL="postgresql://myampix:myampix_dev@postgres:5432/admin_console_kind" \
  --from-literal=ANALYTICS_DATABASE_URL="postgresql://myampix:myampix_dev@postgres:5432/myampix" \
  --from-literal=PURCHASE_DATABASE_URL="postgresql://mobile_purchase:mobile_purchase_dev@mobile-purchase-postgres:5433/mobile_purchase" \
  --from-literal=REDIS_URL="redis://redis:6379" \
  --from-literal=CLICKHOUSE_PASSWORD="myampix_dev" \
  --from-literal=ADMIN_DEFAULT_EMAIL="smoke@myampix.local" \
  --from-literal=ADMIN_DEFAULT_PASSWORD="$ADMIN_PW" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null

step "helm upgrade --install (hooks migrate first, then rollout)"
major="$(helm version --template '{{.Version}}' | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$major" -ge 4 ]; then ROLLBACK_FLAG=--rollback-on-failure; else ROLLBACK_FLAG=--atomic; fi
helm upgrade --install myampix "$ROOT/infra/helm/myampix" -n "$NS" \
  -f "$ROOT/infra/helm/myampix/values.local.yaml" --set hostDbs.ip="$HOST_IP" \
  "$ROLLBACK_FLAG" --wait --timeout 10m

step "assertions"
fail() { echo "local.sh: FAIL — $1" >&2; kubectl -n "$NS" get pods,jobs; exit 1; }
[ "$(kubectl -n "$NS" get job myampix-analytics-migrate -o jsonpath='{.status.succeeded}')" = "1" ] || fail "analytics migrate job not succeeded"
[ "$(kubectl -n "$NS" get job myampix-purchase-migrate -o jsonpath='{.status.succeeded}')" = "1" ] || fail "purchase migrate job not succeeded"
for d in mobile-analytics mobile-purchase-api mobile-purchase-scheduler dashboard admin; do
  kubectl -n "$NS" rollout status "deploy/$d" --timeout=120s >/dev/null || fail "deploy/$d not available"
done
BASE="http://localhost:$HTTP_PORT"
# ingress-nginx picks up freshly-Ready endpoints with a short lag; give it a few seconds before asserting.
for _ in $(seq 1 30); do
  curl -fsS -H 'Host: api.localhost' "$BASE/health/ready" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS -H 'Host: api.localhost' "$BASE/health/ready" | grep -q '"status":"ready"' || fail "api.localhost /health/ready"
curl -fsS -H 'Host: purchase.localhost' "$BASE/health/ready" | grep -q '"status":"ready"' || fail "purchase.local /health/ready"
curl -fsS -H 'Host: app.localhost' "$BASE/" | grep -q '<div id="root">' || fail "app.local SPA shell"
curl -fsS -H 'Host: app.localhost' "$BASE/config.js" | grep -q "purchaseApiBaseUrl: 'http://purchase.localhost:8089'" || fail "app.local runtime config.js"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Host: app.localhost' "$BASE/api/v1/auth/refresh")"
[ "$code" = "401" ] || fail "app.local/api should proxy to analytics (got HTTP $code, expected 401)"
kubectl -n "$NS" get hpa >/dev/null || fail "HPAs missing"

# Admin console: seeded login → forced password change → authenticated cluster status (design §8).
[ "$(kubectl -n "$NS" get job myampix-admin-migrate -o jsonpath='{.status.succeeded}')" = "1" ] || fail "admin migrate job not succeeded"
curl -fsS -H 'Host: admin.localhost' "$BASE/login" | grep -q 'MyAmpix Ops' || fail "admin login page"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.localhost' "$BASE/api/admin/status")" = "401" ] || fail "admin API must be 401 unauthenticated"
JAR="$(mktemp)"
curl -fsS -c "$JAR" -X POST -H 'Host: admin.localhost' -H 'Origin: http://admin.localhost' -H 'content-type: application/json' \
  -d "{\"email\":\"smoke@myampix.local\",\"password\":\"$ADMIN_PW\"}" "$BASE/api/auth/login" | grep -q '"ok":true' || fail "admin seeded login"
[ "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -H 'Host: admin.localhost' "$BASE/api/admin/status")" = "403" ] || fail "admin data must be blocked while password change is pending"
curl -fsS -b "$JAR" -X POST -H 'Host: admin.localhost' -H 'Origin: http://admin.localhost' -H 'content-type: application/json' \
  -d "{\"currentPassword\":\"$ADMIN_PW\",\"newPassword\":\"$ADMIN_PW-rotated\"}" "$BASE/api/account/password" | grep -q '"ok":true' || fail "admin forced password change"
STATUS_JSON="$(curl -fsS -b "$JAR" -H 'Host: admin.localhost' "$BASE/api/admin/status")"
grep -q '"available":true' <<<"$STATUS_JSON" || fail "admin status must see the cluster"
grep -q '"name":' <<<"$STATUS_JSON" || fail "admin status must list at least one node"
rm -f "$JAR"

printf '\n\033[1;32mSMOKE OK\033[0m  (cluster %s kept; `pnpm k8s:local down` to delete)\n' "$CLUSTER"
kubectl -n "$NS" get pods,hpa,ingress
cat <<INFO

Browse the stack (no /etc/hosts changes needed):
  Dashboard      http://app.localhost:$HTTP_PORT      (sign in with your usual dev account)
  Analytics API  http://api.localhost:$HTTP_PORT/health/ready
  Purchase API   http://purchase.localhost:$HTTP_PORT/health/ready
  Admin console  http://admin.localhost:$HTTP_PORT    →  smoke@myampix.local / $ADMIN_PW-rotated
                 (throwaway smoke account; the assertions already rotated its seeded password)
INFO
