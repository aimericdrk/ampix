#!/usr/bin/env bash
# Creates a dashboard account on the running cluster. This instance has SIGNUP_ENABLED=false, so
# this is the only way in — it runs the same provisioning as the signup endpoint would
# (user + personal org + default project + SDK ingest token) and prints a one-time password.
#   Usage: scripts/k8s/create-account.sh <email> "<Full Name>" [password]
set -euo pipefail
EMAIL="${1:?usage: create-account.sh <email> \"<Full Name>\" [password]}"
NAME="${2:?usage: create-account.sh <email> \"<Full Name>\" [password]}"
NS="${NAMESPACE:-myampix}"
ARGS=(--email "$EMAIL" --name "$NAME")
[ $# -ge 3 ] && ARGS+=(--password "$3")
kubectl -n "$NS" exec deploy/mobile-analytics -- node dist/scripts/create-account.js "${ARGS[@]}"
