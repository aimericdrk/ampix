#!/usr/bin/env bash
# Runs once after every boot (myampix-postboot-check.service) and appends a verdict to
# /var/log/myampix-postboot.log. Waits for the stack to converge before judging, so a slow start is
# recorded as "recovered in Ns" rather than a false failure.
LOG=/var/log/myampix-postboot.log
ROOT=/home/ubuntu/atclub_analytics
NS=myampix
BASE="${BASE_DOMAIN:-37.187.71.20.nip.io}"
DEADLINE=$((SECONDS + 600))

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

say "=== post-boot check starting (uptime $(cut -d' ' -f1 /proc/uptime)s) ==="

ok=0
while [ $SECONDS -lt $DEADLINE ]; do
  ready=$(kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -c '1/1 *Running')
  dbs=$(docker ps --filter name=myampix --filter health=healthy -q 2>/dev/null | wc -l)
  codes=""
  for h in app api purchase admin; do
    p=/healthz; [ "$h" = api ] && p=/health/ready; [ "$h" = purchase ] && p=/health/ready; [ "$h" = admin ] && p=/api/healthz
    codes="$codes $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "https://$h.$BASE$p" 2>/dev/null)"
  done
  if [ "${ready:-0}" -ge 8 ] && [ "${dbs:-0}" -ge 4 ] && [ "$codes" = " 200 200 200 200" ]; then
    say "RECOVERED after ${SECONDS}s — 4/4 datastores healthy, ${ready} pods Running, all endpoints 200"
    ok=1; break
  fi
  sleep 10
done

[ $ok -eq 1 ] || say "FAILED to converge within 600s — datastores=${dbs:-0}/4 pods=${ready:-0} endpoints=${codes}"
say "=== post-boot check done ==="
