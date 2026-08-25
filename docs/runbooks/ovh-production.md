# Runbook — MyAmpix in production on `atclub-analytics` (OVH bare metal)

The live deployment. Written against the machine as it was actually built, not as a plan.
For the generic VPS recipe see [`vps-k3s.md`](vps-k3s.md); this file records what *this* box runs,
what was changed from that recipe and why, and everything an operator needs day to day.

---

## 0. What is running

| | |
|---|---|
| Host | OVH bare metal, `P12R-M/10G-2T/OVH`, 12 vCPU / 62 GB RAM / 878 GB RAID (`/dev/md3`) |
| OS | Ubuntu 26.04 LTS, kernel 7.0.0-29-generic |
| Public IPv4 | `37.187.71.20` |
| Public IPv6 | `2001:41d0:b:b14::/64` (address configured, **no default route** — IPv6 is not in service) |
| Orchestrator | k3s v1.36.3 (single node, Traefik + metrics-server + local-path) |
| Datastores | Docker Compose on the host, bound to `172.17.0.1` only |
| TLS | Let's Encrypt via cert-manager, HTTP-01, auto-renewing |

### Public URLs

| Service | URL |
|---|---|
| Dashboard (the product) | https://app.37.187.71.20.nip.io |
| Analytics API + SDK ingestion | https://api.37.187.71.20.nip.io |
| Purchase service | https://purchase.37.187.71.20.nip.io |
| Admin / ops console | https://admin.37.187.71.20.nip.io |

`nip.io` is wildcard DNS: `<anything>.37.187.71.20.nip.io` resolves to `37.187.71.20` with no DNS
configuration at all. These are ordinary public hostnames, so Let's Encrypt issues ordinary
browser-trusted certificates for them. See §5 to move onto a real domain.

Port 80 permanently redirects (301) to 443 on every host.

### Credentials

Every generated password and key is in **`/home/ubuntu/myampix-secrets.txt`** (mode 600, root of the
`ubuntu` home, outside the repo). That file is the master copy — **back it up somewhere off this
machine.** Losing it is not fatal (the values also live in `infra/.env.prod` and in the k8s Secrets)
but it is the only place they are collected together.

---

## 1. Topology, and why

```
                    internet
                       │  :80 → 301 → :443
                       ▼
              ┌──────────────────┐
              │ Traefik (k3s)    │  Let's Encrypt certs via cert-manager
              └────────┬─────────┘
      ┌────────────┬───┴────────┬──────────────┐
      ▼            ▼            ▼              ▼
  dashboard   mobile-        mobile-        admin
   (2 pods)   analytics      purchase-api   (1 pod)
              (HPA 2→8)      (HPA 2→4)         │
                  │              │             │ reads docker.sock (ro)
                  │              │             │ + k8s API (namespaced RBAC)
                  ▼              ▼             ▼
        ═══════ 172.17.0.1 (docker bridge, host-local) ═══════
              │            │            │            │
          Postgres     ClickHouse     Redis     Postgres
          (myampix +   (analytics)              (mobile_purchase)
        admin_console)
              └──────── Docker Compose, restart: unless-stopped ────────┘
```

Also running: `mobile-purchase-scheduler` (exactly 1 replica, never autoscaled — the in-process
cron must not run twice).

**Why the datastores are not in k3s.** They are the one thing on this box with irreplaceable state.
Keeping them in Compose on the host means a k3s upgrade, a bad Helm release, or a wiped cluster
cannot touch the data — `k3s-uninstall.sh` would leave every byte intact.

**Why `BIND_IP=172.17.0.1`.** The generic runbook wants a private interface; an OVH dedicated server
has none. The docker bridge is the correct substitute: it is a host-local address, reachable from the
host and from the k3s pod network (verified), and unroutable from the internet. `ss -ltnp` shows every
datastore port bound to `172.17.0.1` and never `0.0.0.0`.

**Why images are built here instead of pulled from GHCR.** The chart's default flow pulls
`ghcr.io/<owner>/myampix-*` built by `.github/workflows/images.yml`. This box builds all six images
locally and imports them straight into k3s's containerd, so deploying needs no registry, no PAT, and
no CI round-trip. `image.owner: local` is just a namespace inside the image name — there is no
registry called `ghcr.io/local` and nothing is ever pulled (`pullPolicy: IfNotPresent`, and the
images are already present).

---

## 2. What was installed and changed on this machine

Everything below is already done. It is recorded so the box can be rebuilt.

### 2.1 Packages and services

```bash
# Docker Engine 29.7.2 + Compose v5.5.0
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && sudo systemctl enable --now docker

# k3s (kubeconfig world-readable so the ubuntu user can use kubectl)
curl -sfL https://get.k3s.io | sudo sh -s - --write-kubeconfig-mode 644
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown ubuntu:ubuntu ~/.kube/config && chmod 600 ~/.kube/config
sudo ln -sf /usr/local/bin/k3s /usr/local/bin/kubectl

# Helm 3.21.4
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | sudo bash

# cert-manager
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager \
  --create-namespace --set crds.enabled=true --wait
```

### 2.2 Traefik HTTP→HTTPS redirect — note the corrected key path

`/var/lib/rancher/k3s/server/manifests/traefik-config.yaml` (k3s re-applies this at every start):

```yaml
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata: { name: traefik, namespace: kube-system }
spec:
  valuesContent: |-
    ports:
      web:
        http:
          redirections:
            entryPoint: { to: websecure, scheme: https, permanent: true }
```

The `ports.web.redirectTo.port` form printed in older docs is **pre-v27 chart syntax**. The Traefik
chart k3s 1.36 ships (`40.1.4+up40.1.0`) accepts it without error and silently ignores it, leaving
port 80 serving plaintext. The correct path nests under `http:`. `vps-k3s.md` has been corrected.

Verify with `kubectl -n kube-system get deploy traefik -o jsonpath='{...args}' | grep redirect` —
three `--entryPoints.web.http.redirections.*` args must be present.

### 2.3 Firewall (ufw, enabled at boot)

```
default deny incoming / allow outgoing / allow routed   ← "routed" is required: ufw's default
22/tcp, 80/tcp, 443/tcp                 from anywhere      DROP on FORWARD breaks pod networking
anything                                from 10.42.0.0/16  (k3s pods)
anything                                from 10.43.0.0/16  (k3s services)
anything                                from 172.17.0.0/16 (docker bridge)
```

The k8s API (`:6443`) and kubelet (`:10250`) are **not** open to the internet — administer the
cluster over SSH from this host. Nothing else is exposed.

### 2.4 Boot-time units

| Unit | Role |
|---|---|
| `docker.service` | enabled — brings the datastores back via `restart: unless-stopped` |
| `myampix-datastores.service` | enabled — `docker compose up -d --wait` at boot; reconciles the stack even if a container was manually stopped, and blocks until every healthcheck passes |
| `k3s.service` | enabled — recreates every pod from cluster state |
| `myampix-backup.timer` | enabled — 03:30 UTC nightly, `Persistent=true` so a missed run fires at next boot |
| `myampix-postboot-check.service` | enabled — after every boot, waits for the stack to converge and appends a verdict to `/var/log/myampix-postboot.log` |
| `myampix-backup-trigger.path` | enabled — watches for `/var/backups/myampix/.run-now` so the admin console can request an out-of-schedule backup |

Nothing here needs a human after a power cut. Startup order is not enforced between k3s and the
datastores: if pods come up first they crash-loop for a few seconds with `P1001 Can't reach database
server` and Kubernetes restarts them into a healthy state. This is expected and self-healing — it
happened once during the initial deploy and resolved on its own in under 10 seconds.

### Measured recovery (2026-08-24)

The whole runtime was destroyed deliberately — `k3s-killall.sh` (every pod, every containerd shim,
CNI interfaces torn down) plus `systemctl stop docker` (every datastore container) — and then
restarted **only** through systemd, which is the same path boot takes:

| | |
|---|---|
| Datastores healthy again | +6s |
| All 8 app pods Running | +13s |
| All four public endpoints back to 200 | **under ~75s** |
| Human intervention required | none |
| Data lost | none — both orgs, the user table, and every ClickHouse row survived |

**Do not judge recovery by `ss -ltnp | grep :443`.** k3s's service LB (`svclb-traefik`) publishes 80
and 443 through CNI `hostPort` DNAT rules, not a host-level listening socket, so `ss` shows nothing
on those ports even when the stack is perfectly healthy. Probe the endpoints with `curl` instead —
that is what `scripts/ops/postboot-check.sh` does.

There is a real convergence window of roughly a minute after the pods report Running, during which
Traefik and the service-LB iptables plumbing are still settling and requests fail. That is normal;
it resolves itself.

### 2.5 Changes made to the repository

| File | Change |
|---|---|
| `docs/runbooks/vps-k3s.md` | Corrected the Traefik redirect syntax (§2.2) |
| `infra/docker-compose.prod.yml` | ClickHouse gains a `/backups` bind mount + the config that declares the backup disk |
| `infra/clickhouse/config.d/backups.xml` | **new** — declares `Disk('backups')` so `BACKUP DATABASE` works |
| `scripts/k8s/build-local-images.sh` | **new** — builds all six images and imports them into k3s containerd |
| `scripts/k8s/create-account.sh` | **new** — wrapper for creating dashboard accounts on a closed instance |
| `scripts/ops/backup.sh` | **new** — nightly backup of all four datastores |
| `scripts/ops/status.sh` | **new** — one-shot health snapshot |
| `infra/values.prod.yaml` | **new**, gitignored — the live Helm values |
| `infra/.env.prod`, `infra/k8s/secrets/*.env` | **new**, gitignored — the live credentials |

---

## 3. Every configuration value

Real values are in `/home/ubuntu/myampix-secrets.txt`. This section is the map: what each one is,
where it lives, and what breaks without it.

### 3.1 `infra/.env.prod` — host datastores only

| Variable | Value / how it was generated | Purpose |
|---|---|---|
| `BIND_IP` | `172.17.0.1` | Address the datastore ports bind to. Never make this `0.0.0.0`. |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Superuser `myampix` on the analytics Postgres |
| `MOBILE_PURCHASE_POSTGRES_PASSWORD` | `openssl rand -hex 24` | Superuser `mobile_purchase` on the purchase Postgres |
| `CLICKHOUSE_PASSWORD` | `openssl rand -hex 24` | ClickHouse `default` user |

> Hex, not `base64`, deliberately: these three are embedded in `postgresql://` URLs, and base64's
> `/` and `+` need URL-encoding — a footgun that produces confusing auth failures.

### 3.2 `infra/k8s/secrets/analytics.env` → Secret `myampix-analytics`

| Variable | Value | Effect if wrong/missing |
|---|---|---|
| `DATABASE_URL` | `postgresql://myampix:$POSTGRES_PASSWORD@postgres:5432/myampix` | Service will not boot |
| `REDIS_URL` | `redis://redis:6379` | Rate limiting + token cache dead |
| `CLICKHOUSE_PASSWORD` | = `$CLICKHOUSE_PASSWORD` | No event storage or querying |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 32` | Refuses to boot outside `NODE_ENV=test`. **Rotating it logs everyone out.** |
| `JWT_REFRESH_SECRET` | `openssl rand -base64 32` | Same |
| `TOTP_ENC_KEY` | `openssl rand -hex 32` (must decode to exactly 32 bytes) | Refuses to boot. **Rotating it makes every enrolled 2FA secret undecryptable** — every user must re-enrol. |
| `MISTRAL_API_KEY` | *not set* | "Ask your data" returns 503. Optional. |
| `FIREBASE_STORAGE_BUCKET` | *not set* | SDK screenshots fall back to an in-memory store (lost on restart). Optional; also needs `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON, which the chart does not mount yet. |

### 3.3 `infra/k8s/secrets/purchase.env` → Secret `myampix-purchase`

| Variable | Value | Effect |
|---|---|---|
| `DATABASE_URL` | `postgresql://mobile_purchase:$MOBILE_PURCHASE_POSTGRES_PASSWORD@mobile-purchase-postgres:5433/mobile_purchase` | Service will not boot. Port really is 5433 both inside and outside the cluster. |
| `STORE_CREDENTIALS_ENC_KEY` | `openssl rand -base64 32` | AES-256 key for `App.storeCredentials`. **Rotating it makes every stored store credential undecryptable.** |
| `GOOGLE_PUBSUB_SHARED_SECRET` | `openssl rand -hex 32` | Google Play RTDN push token. Unset ⇒ every Google push is rejected. |

Apple/Google store credentials themselves are **not** here — you enter those per-app in the dashboard
under Settings → integrations, which is what you asked for.

### 3.4 `infra/k8s/secrets/admin.env` → Secret `myampix-admin`

| Variable | Value | Effect |
|---|---|---|
| `DATABASE_URL` | `postgresql://myampix:$POSTGRES_PASSWORD@postgres:5432/admin_console` | Console will not boot. The migrate job creates this DB automatically. |
| `ANALYTICS_DATABASE_URL` / `PURCHASE_DATABASE_URL` / `CLICKHOUSE_PASSWORD` / `REDIS_URL` | probe targets | Each unset value just greys out that monitoring tile |
| `TOTP_ENC_KEY` | `openssl rand -hex 32` | Independent of the analytics one. Unset ⇒ 2FA enrolment unavailable. |
| `ADMIN_DEFAULT_EMAIL` / `ADMIN_DEFAULT_PASSWORD` | seeded account | Seeded **only while the user table is empty**; never resurrects. Password change forced at first login. |
| `ALERT_WEBHOOK_URL` | *not set* | Optional Slack/Discord webhook for alert open/resolve |

### 3.5 `infra/values.prod.yaml` — non-secret chart config

Notable choices, all overridable:

```yaml
image: { owner: local, pullSecret: "", pullPolicy: IfNotPresent }   # locally built images
hosts:  { api|purchase|app|admin: *.37.187.71.20.nip.io }
tls:    { enabled: true, issuer: letsencrypt, email: aimeric.rouyer.pro@gmail.com }
hostDbs.ip: 172.17.0.1
analytics.env.SIGNUP_ENABLED: "false"       # closed instance, see §4.3
analytics.env.COOKIE_SECURE: "true"         # mandatory in production; the app refuses to boot otherwise
analytics.autoscaling:  { min 2, max 8, target 70% CPU }
purchase.api.autoscaling: { min 2, max 4, target 70% CPU }
admin.dockerSock: { enabled: true, gid: 986 }   # `getent group docker | cut -d: -f3`
```

Autoscaling ranges are raised above the chart defaults (which assume a 4 vCPU / 8 GB VPS) because
this machine has 12 vCPU and 62 GB. At max scale the workloads request ~3.4 vCPU — comfortable.

---

## 4. Day-2 operations

### 4.1 Is everything healthy?

```bash
scripts/ops/status.sh
```

systemd units, datastore containers, deployments, HPAs, unready pods, certificate expiry, all four
public endpoints, latest backups, and disk. Or use the admin console at
https://admin.37.187.71.20.nip.io.

### 4.2 Deploying a code change

```bash
git pull
scripts/k8s/build-local-images.sh              # builds + imports; prints the tag it used
scripts/k8s/deploy.sh sha-<the-tag-it-printed>
```

`deploy.sh` runs the three migration Jobs as Helm pre-upgrade hooks first; if any fails the release
is rolled back automatically and no Deployment is touched. Rolling updates are `maxUnavailable: 0`,
so there is no downtime.

```bash
helm -n myampix history myampix
helm -n myampix rollback myampix <REVISION>    # NOTE: does not undo DB migrations
```

### 4.3 Creating accounts (signups are closed)

```bash
scripts/k8s/create-account.sh someone@example.com "Their Name"
```

Prints a one-time password and provisions user + personal org + default project + SDK ingest token.
To reopen public registration, set `analytics.env.SIGNUP_ENABLED: "true"` in `infra/values.prod.yaml`
and redeploy the same tag.

### 4.4 Logs

```bash
kubectl -n myampix logs -l app.kubernetes.io/name=mobile-analytics --tail=200 -f
kubectl -n myampix logs -l app.kubernetes.io/name=admin --tail=200 -f
sudo docker logs myampix-postgres-1 --tail 100
```

### 4.5 Backups

Nightly at 03:30 UTC into `/var/backups/myampix`, **30 days retained**, pruned automatically:

- `postgres/myampix-<ts>.dump` — orgs, users, projects, ingest tokens
- `postgres/admin_console-<ts>.dump` — console users, alerts, samples
- `postgres/mobile_purchase-<ts>.dump` — apps, subscribers, entitlements, purchases

**ClickHouse events are deliberately NOT backed up.** They are the largest and fastest-growing
dataset here and are reconstructible telemetry rather than system-of-record state — everything that
defines the product (accounts, orgs, projects, ingest tokens, billing) lives in the three Postgres
databases above. The ClickHouse `backups` disk stays configured, so a one-off snapshot is always
available on demand (see the RESTORE/BACKUP commands below).

Manage it all from the admin console's **Backups** page (`admin.<domain>/backups`): last-run status,
next run, per-database freshness, run-now, download, delete, and the exact restore command per file.
From the shell:

```bash
sudo systemctl start myampix-backup.service          # run one now
sudo journalctl -u myampix-backup.service -n 20      # check the last run
sudo cat /var/backups/myampix/.last-run.json         # machine-readable status (the console reads this)
```

**How the console triggers a run.** The admin pod cannot reach systemd, so "Run backup now" writes
`/var/backups/myampix/.run-now`; `myampix-backup-trigger.path` notices and starts the same service
the nightly timer does. There is exactly one backup implementation — the on-demand run and the
scheduled run are byte-for-byte identical.

**Permissions.** The backup tree is `root:myampix-backup` mode `2770` (setgid, so files the
root-run script creates inherit the group). The admin pod joins that group via
`admin.backups.gid` in the chart values — that is how a non-root pod reads and deletes
root-created backups without the files ever leaving root ownership.

Alerting is wired in: `backup.stale` (a database's newest backup >36h), `backup.failed` (last run
errored), and `backup.missing` (a database with no backup at all) open alerts through the existing
rules engine and webhook.

Restore:

```bash
# Postgres
sudo docker exec -i -e PGPASSWORD=<pw> myampix-postgres-1 \
  pg_restore -U myampix -d myampix --clean --if-exists < /var/backups/myampix/postgres/myampix-<ts>.dump

# ClickHouse — only if you took a manual snapshot; the nightly job no longer produces these.
sudo docker exec myampix-clickhouse-1 clickhouse-client --user default --password <pw> \
  --query "BACKUP DATABASE analytics TO Disk('backups','manual-<ts>.zip')"
sudo docker exec myampix-clickhouse-1 clickhouse-client --user default --password <pw> \
  --query "RESTORE DATABASE analytics FROM Disk('backups','manual-<ts>.zip')"
```

The console shows the exact restore command for any Postgres file ("Copy restore cmd"). Restoring is
deliberately not a button: it overwrites a live database and cannot be undone.

> **These backups are on the same disk as the data.** That protects against a bad migration or a
> dropped table, not against losing the machine. See §5.3 for pushing them off-box. The backup
> script honours `BACKUP_DEST`, so pointing it at a mounted OVH Backup Storage share is a one-line
> change.

### 4.6 Rotating a credential

Edit the relevant `infra/k8s/secrets/*.env`, then:

```bash
scripts/k8s/secrets.sh
kubectl -n myampix rollout restart deploy -l app.kubernetes.io/part-of=myampix
```

Mind the three one-way doors flagged in §3: `JWT_*_SECRET` (logs everyone out), `TOTP_ENC_KEY`
(forces 2FA re-enrolment), `STORE_CREDENTIALS_ENC_KEY` (orphans stored store credentials).

### 4.7 Certificate renewal

cert-manager renews automatically at ~30 days remaining. No action needed. To check:

```bash
kubectl -n myampix get certificate
```

---

## 5. OVH-side setup

Nothing in the OVH control panel is required for the service to run — it is live now. These are the
things worth doing, roughly in priority order.

### 5.1 Buy a domain and drop nip.io  ← the one that actually matters

`nip.io` works and is genuinely TLS-secured, but it is a third-party DNS service you do not control.
If it goes away or gets rate-limited by Let's Encrypt, certificate renewal fails. A domain is ~€10/yr.

OVH Control Panel → **Web Cloud → Domain names → Order**. Then under **DNS zone**, add:

| Type | Subdomain | Target |
|---|---|---|
| A | `app` | `37.187.71.20` |
| A | `api` | `37.187.71.20` |
| A | `purchase` | `37.187.71.20` |
| A | `admin` | `37.187.71.20` |

Then on the server:

```bash
# edit the four `hosts:` values in infra/values.prod.yaml
scripts/k8s/deploy.sh sha-<current-tag>
kubectl -n myampix get certificate -w        # four new certs, READY True in ~1 min
```

cert-manager issues fresh certificates for the new names automatically. Old nip.io certs can be
deleted afterwards. **Wait for DNS to propagate before deploying** — HTTP-01 validation fails if
Let's Encrypt cannot yet resolve the new names to this IP.

### 5.2 Reverse DNS (PTR)

OVH Control Panel → **Bare Metal Cloud → Dedicated Servers → your server → Network → IPs → Reverse DNS**.
Set `37.187.71.20` → `atclub-analytics.<yourdomain>` (or whatever host name you settle on). Only
matters if this box ever sends email; harmless to set now.

### 5.3 Off-site backups — OVH Backup Storage

Dedicated servers include **500 GB of Backup Storage** free. Activate it under
**Dedicated Servers → your server → Backup Storage**, whitelist this server's IP, and it is exposed
over NFS/CIFS/FTP. Mount it and point the backup script at it:

```bash
sudo mount -t nfs <your>.backup.ovh.net:/export/ftpbackup/<your-account> /mnt/ovh-backup
# then in /etc/systemd/system/myampix-backup.service:
#   Environment=BACKUP_DEST=/mnt/ovh-backup/myampix
```

Add the mount to `/etc/fstab` so it survives reboot. This is the single highest-value item after
§5.1 — right now a disk failure loses both the data and the backups.

### 5.4 OVH monitoring / auto-reboot

**Dedicated Servers → your server → Monitoring.** OVH pings the server and can raise an alert or
trigger an automatic hard reboot when it stops responding. Enable the email alert at minimum. The
auto-reboot is safe here: everything comes back on its own (§2.4).

### 5.5 Edge Network Firewall (optional)

OVH offers a stateless firewall in front of the machine (**Network → IP → Firewall**). `ufw` already
covers this box, and the OVH firewall is stateless and easy to lock yourself out with. Skip it unless
you specifically want DDoS-level filtering — OVH's anti-DDoS is on permanently regardless and needs
no configuration.

### 5.6 IPv6 (optional, currently non-functional)

The `2001:41d0:b:b14::/64` address is configured but there is no default route, so IPv6 does not
work. OVH's IPv6 gateway must be added explicitly. Leave it unless you need IPv6 — the service is
fully reachable over IPv4. If you do enable it later, add `AAAA` records alongside the `A` records
in §5.1.

### 5.7 Rescue mode

Worth knowing before you need it: **Dedicated Servers → your server → Netboot → Rescue** reboots into
a rescue OS with your disks mountable. Credentials are emailed. This is the way back in if the box
ever fails to boot.

---

## 6. Known issues and follow-ups

1. **Backups are on the same disk as the data.** §5.3 fixes this. Highest-priority open item.
2. **`nip.io` is a third-party dependency** in the certificate renewal path. §5.1 fixes this.
3. **Prisma OpenSSL warning in `mobile-analytics`.** Its logs carry
   `Prisma failed to detect the libssl/openssl version to use … Defaulting to "openssl-1.1.x"`.
   The service works — the fallback engine loads fine — but `backend/mobile_purchase/Dockerfile` and
   `admin/Dockerfile` both install `openssl` in their runtime stages with comments explaining that
   this exact misdetection breaks them. `backend/mobile_analytics/Dockerfile` does not. Adding
   `openssl` to its runtime stage removes a latent fragility and the log noise. Deliberately not
   changed during initial deploy to avoid churning a working image.
4. **First-boot DB race.** Pods can start before the datastores accept connections and crash-loop
   briefly. Self-healing (§2.4). An init container that waits on Postgres would make boot silent.
5. **Firebase screenshot storage is unconfigured**, so screenshots live in an in-memory store and are
   lost on pod restart. Needs `FIREBASE_STORAGE_BUCKET` plus a mounted service-account JSON —
   the Helm chart has no volume for the credentials file yet, so this needs a small chart change.
6. **`admin.dockerSock` is enabled**, which is root-equivalent access to the host for anything that
   compromises the admin pod. It is what makes the console's Docker page work. Set
   `admin.dockerSock.enabled: false` in `infra/values.prod.yaml` if you would rather not have it.
