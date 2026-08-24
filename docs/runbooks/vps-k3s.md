# Runbook — MyAmpix on a VPS with k3s

Design: `docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md`. Everything below is done by hand,
once per VPS, in order. Commands assume Ubuntu 24.04, a sudo user, and the repo cloned at `~/MyAmpix`.

## 0. What you end up with

- Docker Compose on the host runs Postgres ×2, ClickHouse, Redis (bound to the VPS private IP).
- k3s runs `mobile-analytics` (HPA 2–6), `mobile-purchase-api` (HPA 2–4), `mobile-purchase-scheduler` (1),
  `dashboard` (2), and the `admin` ops console (1) behind Traefik with Let's Encrypt certificates for
  `api.`, `purchase.`, `app.`, `admin.<domain>`.
- Deploys: `scripts/k8s/deploy.sh <tag>` (migrations run first; automatic rollback on failure).

Minimum VPS: 4 vCPU, 8 GB RAM, 80 GB SSD. DNS: A records for the four hosts (`api.`, `purchase.`, `app.`, `admin.`) → the VPS public IP.

## 1. VPS preparation

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw
# Private IP the databases will listen on (pick the non-public interface; if the VPS has none, use the
# docker bridge 172.17.0.1 — it is only reachable from the host and its containers/pods).
ip -4 addr show | grep inet
export BIND_IP=10.0.0.2   # <- yours
# Firewall: SSH + HTTP(S) from anywhere; DB ports only from the k3s pod/service CIDRs and the host.
sudo ufw default deny incoming
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
for p in 5432 5433 8123 9000 6379; do
  sudo ufw allow from 10.42.0.0/16 to "$BIND_IP" port $p proto tcp   # k3s pods
  sudo ufw allow from 10.43.0.0/16 to "$BIND_IP" port $p proto tcp   # k3s services
done
sudo ufw enable && sudo ufw status numbered
# Docker Engine (for the host datastores)
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker "$USER" && newgrp docker
```

## 2. Host datastores (Docker Compose)

```bash
cd ~/MyAmpix
cp infra/.env.prod.example infra/.env.prod
# edit infra/.env.prod: BIND_IP, three passwords (openssl rand -base64 32)
docker compose --env-file infra/.env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --wait
docker compose --env-file infra/.env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps
ss -ltnp | grep -E '5432|5433|8123|9000|6379'   # every line must show $BIND_IP, never 0.0.0.0
```
Backups are a host concern: nightly `pg_dump` ×2 + `clickhouse-backup` to object storage (July infra spec §4.5).

## 3. k3s

```bash
curl -sfL https://get.k3s.io | sh -            # Traefik, CoreDNS, metrics-server, local-path included
sudo k3s kubectl get nodes                     # STATUS Ready
# Use kubectl/helm as your user (on the VPS) …
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown "$USER" ~/.kube/config
# … or copy ~/.kube/config to your laptop and replace 127.0.0.1 with the VPS public IP (port 6443 must
# then be allowed from your IP only: sudo ufw allow from <your-ip> to any port 6443 proto tcp).
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash   # installs latest helm
kubectl get pods -A
```

## 4. Cluster add-ons

```bash
# cert-manager (Let's Encrypt)
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true --wait
# Traefik: redirect HTTP→HTTPS cluster-wide (k3s re-applies this file on restart)
sudo tee /var/lib/rancher/k3s/server/manifests/traefik-config.yaml >/dev/null <<'EOF'
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
spec:
  valuesContent: |-
    ports:
      web:
        redirectTo:
          port: websecure
EOF
kubectl -n kube-system rollout status deploy/traefik --timeout=120s
```

## 5. Secrets

```bash
cp infra/k8s/secrets/analytics.env.example infra/k8s/secrets/analytics.env
cp infra/k8s/secrets/purchase.env.example  infra/k8s/secrets/purchase.env
cp infra/k8s/secrets/admin.env.example     infra/k8s/secrets/admin.env
# Fill every CHANGE_ME (generators are in the comments; DB passwords = the ones in infra/.env.prod).
# GHCR pull credentials: a GitHub PAT (classic) with read:packages — skip if your packages are public.
GHCR_USER=<github-user> GHCR_TOKEN=<pat> scripts/k8s/secrets.sh
kubectl -n myampix get secrets
```

## 6. Values

```bash
cp infra/helm/myampix/values.prod.example.yaml infra/values.prod.yaml   # gitignored
# set image.owner (lowercase GitHub user/org), hosts.*, tls.email, hostDbs.ip (= BIND_IP),
# and admin.dockerSock.gid:   getent group docker | cut -d: -f3
```

## 7. First deploy

Take an image tag from the **Images** workflow run summary on GitHub (push to `main` builds
`sha-<7>`; a `vX.Y.Z` git tag builds that too).

```bash
scripts/k8s/deploy.sh sha-1a2b3c4
kubectl -n myampix get jobs,pods,hpa,ingress,certificate
curl -fsS https://api.<domain>/health/ready
curl -fsS https://purchase.<domain>/health/ready
open https://app.<domain>
```
The two `*-migrate` Jobs must show `1/1` Completions; certificates turn `READY True` within ~1 min.

### 7b. Admin console first login

Open `https://admin.<domain>` and sign in with `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` from
`infra/k8s/secrets/admin.env`. The console forces a password change immediately. Then create your real
account(s) under **Users**, sign in as one, and disable nothing until a second account works. The
default seed only ever runs while the user table is empty — it never resurrects.

Then, per account, under **My account → Two-factor authentication**: scan the QR with an
authenticator app and store the 10 one-time recovery codes somewhere safe (shown once). Lost
authenticator = another admin resets your password (which also clears 2FA), or a recovery code.

Day-2 from the console: **Kubernetes** page has restart/scale per deployment (type-the-name
confirmation; scale refuses HPA-managed deployments — change the chart values instead). **Alerts**
page + nav badge: CPU/mem/disk, datastore/service down, degraded deployments, certificates <14 days;
snapshots every `SAMPLE_INTERVAL_MINUTES` (default 5) kept 7 days; optional `ALERT_WEBHOOK_URL`
pushes open/resolve events to a Slack/Discord-style webhook.

## 8. Upgrade / rollback

```bash
scripts/k8s/deploy.sh sha-<new>        # migrations first; on failure Helm rolls back automatically
helm -n myampix history myampix
helm -n myampix rollback myampix <REVISION>   # manual rollback (does NOT undo DB migrations)
```

## 9. Day-2

| Need | Command |
|---|---|
| Logs | `kubectl -n myampix logs -l app.kubernetes.io/name=mobile-analytics --tail=200 -f` |
| Scale knobs | edit `infra/values.prod.yaml` (`analytics.autoscaling.*`, `purchase.api.autoscaling.*`, `dashboard.replicas`) then redeploy the same tag |
| Close signups | `analytics.env.SIGNUP_ENABLED: "false"` in `infra/values.prod.yaml`, redeploy; create accounts with `kubectl -n myampix exec deploy/mobile-analytics -- node dist/scripts/create-account.js --email … --name …` (SETUP.md §8) |
| Rotate a secret | edit the env file → `scripts/k8s/secrets.sh` → `kubectl -n myampix rollout restart deploy -l app.kubernetes.io/part-of=myampix` |
| Headroom | `kubectl top pods -n myampix`, `kubectl top node` |
| Certificates | `kubectl -n myampix get certificate` (renewed automatically by cert-manager) |
| k3s upgrade | `curl -sfL https://get.k3s.io \| sh -` (in-place; pods restart) |
| Host DB restart | `docker compose --env-file infra/.env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml restart` |

## 10. Adding a node later

On the server: `sudo cat /var/lib/rancher/k3s/server/node-token`. On the new VPS:
`curl -sfL https://get.k3s.io | K3S_URL=https://<server-private-ip>:6443 K3S_TOKEN=<token> sh -`.
Nothing in the chart changes; allow the new node's pod CIDR in `ufw` on the DB host.

## 11. Troubleshooting

| Symptom | Check |
|---|---|
| `ImagePullBackOff` | package visibility on GHCR, `ghcr-pull` secret present, `image.owner` lowercase |
| readiness `503` / pods not Ready | `kubectl -n myampix run -it --rm dbg --image=busybox -- nc -zv postgres 5432` — if it fails: `hostDbs.ip`, `ufw`, Compose `ps` |
| migrate Job failed | `kubectl -n myampix logs job/myampix-analytics-migrate` (kept until the next deploy); fix, redeploy |
| certificate stuck `False` | DNS points at the VPS? port 80 open? `kubectl -n myampix describe certificaterequest` |
| `CreateContainerConfigError` "non-numeric user" | image `USER` changed — update `*.runAsUser` in values |
