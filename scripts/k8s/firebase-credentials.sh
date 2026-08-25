#!/usr/bin/env bash
# Loads a Google service-account JSON into the cluster so the analytics backend can write screenshots
# to Firebase Storage. The file never enters the repo, the image, or the values file — it lives only
# in a Kubernetes Secret, projected read-only into the pod at GOOGLE_APPLICATION_CREDENTIALS.
#
#   Usage: scripts/k8s/firebase-credentials.sh /path/to/service-account.json
#
# Afterwards, in infra/values.prod.yaml:
#     analytics:
#       googleCredentials:
#         enabled: true
#       env:
#         FIREBASE_STORAGE_BUCKET: your-bucket.appspot.com
# then redeploy:  scripts/k8s/deploy.sh <tag>
set -euo pipefail
SRC="${1:?usage: firebase-credentials.sh /path/to/service-account.json}"
NS="${NAMESPACE:-myampix}"
SECRET="${SECRET_NAME:-myampix-google-credentials}"
# Must match analytics.googleCredentials.secretKey in the chart values.
KEY="service-account.json"

[ -f "$SRC" ] || { echo "firebase-credentials.sh: $SRC not found" >&2; exit 1; }
command -v kubectl >/dev/null || { echo "firebase-credentials.sh: kubectl not found" >&2; exit 1; }

# Fail loudly on the wrong file: a downloaded OAuth *client* JSON looks similar but has no
# private_key, and firebase-admin would only complain at the first upload, long after deploy.
python3 - "$SRC" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    sys.exit(f"not valid JSON: {e}")
missing = [k for k in ("type", "project_id", "private_key", "client_email") if k not in d]
if missing:
    sys.exit(f"missing key(s) {missing} — this does not look like a service-account key")
if d.get("type") != "service_account":
    sys.exit(f'type is "{d.get("type")}", expected "service_account"')
print(f'  valid service account: {d["client_email"]}  (project {d["project_id"]})')
PY

kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"
kubectl -n "$NS" create secret generic "$SECRET" \
  --from-file="$KEY=$SRC" --dry-run=client -o yaml | kubectl apply -f -
echo "firebase-credentials.sh: Secret $SECRET updated in namespace $NS"
echo "next: set analytics.googleCredentials.enabled=true + FIREBASE_STORAGE_BUCKET in infra/values.prod.yaml, then scripts/k8s/deploy.sh <tag>"
