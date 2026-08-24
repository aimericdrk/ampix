#!/usr/bin/env bash
# Static checks for the Helm chart (pnpm k8s:lint, CI job `k8s`):
#   1. helm lint with the prod-example and local values
#   2. helm template | kubeconform -strict (built-in schemas + CRD catalog for cert-manager)
#   3. assertions on the rendered manifests that encode the design's invariants
# Needs: helm, kubeconform (brew install helm kubeconform).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHART="$ROOT/infra/helm/myampix"
PROD="$CHART/values.prod.example.yaml"
LOCAL="$CHART/values.local.yaml"
CRD_CATALOG='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'

for t in helm kubeconform; do
  command -v "$t" >/dev/null || { echo "lint.sh: missing tool '$t' (brew install $t)" >&2; exit 1; }
done

fail() { echo "lint.sh: FAIL — $1" >&2; exit 1; }

echo "== helm lint"
helm lint "$CHART" -f "$PROD" --set tls.email=lint@example.com --set image.owner=lint
helm lint "$CHART" -f "$LOCAL"

render() { helm template myampix "$CHART" "$@"; }
show()   { helm template myampix "$CHART" -f "$PROD" --set tls.email=lint@example.com --set image.owner=lint --show-only "templates/$1"; }

echo "== kubeconform (prod example)"
render -f "$PROD" --set tls.email=lint@example.com --set image.owner=lint |
  kubeconform -strict -summary -kubernetes-version 1.31.0 \
    -schema-location default -schema-location "$CRD_CATALOG"
echo "== kubeconform (local)"
render -f "$LOCAL" | kubeconform -strict -summary -kubernetes-version 1.31.0

echo "== assertions"
ALL="$(render -f "$PROD" --set tls.email=lint@example.com --set image.owner=lint)"

[ "$(grep -c '^kind: Secret$' <<<"$ALL")" -eq 0 ] || fail "chart must not render Secrets"
[ "$(grep -c 'runAsNonRoot: true' <<<"$ALL")" -eq 6 ] || fail "expected 6 pod templates with runAsNonRoot (2 jobs + 4 deployments)"
[ "$(grep -c '^kind: EndpointSlice$' <<<"$ALL")" -eq 4 ] || fail "expected 4 EndpointSlices for the host DBs"
[ "$(grep -c '^kind: Ingress$' <<<"$ALL")" -eq 3 ] || fail "expected 3 Ingresses (api, purchase, app)"
[ "$(grep -c 'cert-manager.io/cluster-issuer: letsencrypt' <<<"$ALL")" -eq 3 ] || fail "every Ingress must reference the ClusterIssuer"

show analytics-deployment.yaml | grep -q 'command: \["node", "dist/main.js"\]' || fail "analytics must bypass the migrate-at-boot entrypoint"
show analytics-deployment.yaml | grep -q 'runAsUser: 999' || fail "analytics runAsUser must be the image's app uid (999)"
show analytics-migrate-job.yaml | grep -q 'helm.sh/hook: pre-install,pre-upgrade' || fail "analytics migrate must be a pre-install/upgrade hook"
show purchase-migrate-job.yaml | grep -q 'helm.sh/hook: pre-install,pre-upgrade' || fail "purchase migrate must be a pre-install/upgrade hook"
show purchase-migrate-job.yaml | grep -q 'myampix-mobile-purchase-migrate:' || fail "purchase migrate must use the migrate image"
show analytics-migrate-job.yaml | grep -q 'hostAliases:' || fail "analytics migrate must carry hostAliases (hooks run before Services exist)"
show purchase-migrate-job.yaml | grep -q 'hostAliases:' || fail "purchase migrate must carry hostAliases (hooks run before Services exist)"
show purchase-configmap.yaml | grep -q 'SCHEDULER_ENABLED: "false"' || fail "purchase API must not run the scheduler"
SCHED="$(show purchase-scheduler-deployment.yaml)"
grep -q 'replicas: 1' <<<"$SCHED" || fail "scheduler must have replicas: 1"
grep -q 'type: Recreate' <<<"$SCHED" || fail "scheduler must use Recreate"
grep -A1 'name: SCHEDULER_ENABLED' <<<"$SCHED" | grep -q 'value: "true"' || fail "scheduler must set SCHEDULER_ENABLED=true"
show dashboard-ingress.yaml | grep -q 'path: /api' || fail "app host must proxy /api to analytics"
show dashboard-ingress.yaml | grep -q 'path: /ingest' || fail "app host must proxy /ingest to analytics"
show purchase-configmap.yaml | grep -q 'DASHBOARD_ORIGINS: "https://app.CHANGE_ME.com"' || fail "DASHBOARD_ORIGINS must derive from hosts.app"

echo "lint.sh: OK"
