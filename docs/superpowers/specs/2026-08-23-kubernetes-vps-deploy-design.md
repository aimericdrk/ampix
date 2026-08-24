# MyAmpix — Kubernetes (k3s on a VPS) deployment — Design

**Date:** 2026-08-23
**Status:** Approved design (assumptions listed in §0.2 — strike any that are wrong)
**Roadmap item:** this *is* **X1 (Deploy pipeline)** from `2026-07-16-revenuecat-parity-program-roadmap.md` — it replaces the July infra spec's Cloud Run topology (`2026-07-02-infra-cicd-design.md` §4) with a self-hosted Kubernetes one. §2/§3/§4.5 of that spec (root tooling, local Compose, backups) remain valid.
**Goal:** Run the two backend services (and the dashboard) on a single VPS under **k3s**, with horizontal autoscaling, gated database migrations, TLS ingress, and a copy-pasteable runbook — sized for **hundreds of thousands of monthly users** (≈20–100 M events/month), with a path to add nodes later without rewriting manifests.

---

## §0. Constraints, principles, assumptions

### §0.1 Constraints (always in force)
- **Self-hosted, manual ops.** The operator provisions the VPS, installs k3s, and runs every deploy by hand. No cloud-provider APIs, no Terraform/Ansible, no GitOps controller. Everything is driven by `helm`, `kubectl`, `docker compose`, and a runbook.
- **Zero paid SaaS** (master design §10). Images on GHCR (free), TLS from Let's Encrypt, everything else OSS.
- **Datastores stay in Docker Compose on the host** (operator decision). k3s runs only the application workloads. Pods reach the DBs over the VPS private interface.
- **No application code changes.** (One Dockerfile fix was needed: the `mobile_purchase` `migrate` stage installs `openssl` so the Prisma CLI detects the bundled `openssl-3.0.x` schema engine instead of trying to download one at runtime — impossible as a non-root, network-less Job.) The services already expose `/health` (liveness) and `/health/ready` (readiness), call `enableShutdownHooks()`, and `mobile_purchase` already has `SCHEDULER_ENABLED` and a `migrate` image target. The design uses those seams as-is.
- **Secrets never in git.** Real values live in gitignored env files and are turned into `Secret` objects by a script; only `*.example` files are committed.
- **Files under 500 lines; `/docs` for markdown; no new root-level files** except the GitHub workflow.

### §0.2 Assumptions (made because the operator was not available to answer)
1. **k3s** is the distribution (single binary, bundles Traefik + local-path storage + metrics-server-compatible API). Manifests are plain Kubernetes and also run on kind/k3d/other distros.
2. **cert-manager** provides TLS (HTTP-01) on the bundled **Traefik** ingress. The operator owns DNS: `api.<domain>`, `purchase.<domain>`, `app.<domain>` → VPS public IP.
3. **metrics-server** is installed (k3s ships it by default) so CPU-based HPA works.
4. **Images are built in GitHub Actions and pushed to GHCR**; deploy is manual.
5. **The dashboard is included** as a small nginx workload ("host all of this project on a VPS"). It is a toggleable chart component (`dashboard.enabled`).
6. **Deferred / out of scope:** Prometheus + Grafana, NetworkPolicy, multi-node scheduling constraints, GitOps, DB backup tooling (host-level; July spec §4.5), log shipping. Each is listed in §11 with the hook it would attach to.

---

## §1. Topology

```
                      VPS (public IP, ufw)
Internet ──443──▶ Traefik (k3s, hostPort 80/443)
                   ├─ api.<domain>            ─▶ Service mobile-analytics      ─▶ Deployment (HPA 2→6)
                   ├─ app.<domain>/api, /ingest─▶ Service mobile-analytics     (same-origin: auth cookies work, no CORS)
                   ├─ app.<domain>/            ─▶ Service dashboard            ─▶ Deployment (1–2, nginx)
                   └─ purchase.<domain>        ─▶ Service mobile-purchase-api  ─▶ Deployment (HPA 2→4)
                                                  Deployment mobile-purchase-scheduler (replicas=1, Recreate)
 pods ──▶ Service (no selector) + EndpointSlice ──▶ <VPS private IP>:{5432,5433,8123,9000,6379}
          postgres · mobile-purchase-postgres · clickhouse · redis      └─ docker compose (host): Postgres ×2, ClickHouse, Redis
```

Why one VPS is acceptable at this scale: both services are stateless Node processes; 100k MAU ≈ tens of requests/s sustained with bursts — well inside 2–6 replicas on a 4–8 vCPU box. The single node is a *availability* limit, not a capacity one; §11 notes the multi-node path.

---

## §2. Repository layout

```
infra/helm/myampix/
  Chart.yaml                       apiVersion v2, name myampix, version 0.1.0, appVersion "sha"
  values.yaml                      defaults (safe, local-friendly); documented per key
  values.local.yaml                kind/k3d smoke-test overrides (no TLS, host.docker.internal DBs)
  values.prod.example.yaml         what the operator copies to a gitignored values.prod.yaml
  templates/
    _helpers.tpl                   names, labels, checksum helper, image ref helper
    external-dbs.yaml              4× Service(no selector) + EndpointSlice → hostDbs.ip
    cluster-issuer.yaml            cert-manager ClusterIssuer (letsencrypt), gated by tls.enabled
    analytics-configmap.yaml       analytics-deployment.yaml  analytics-service.yaml
    analytics-hpa.yaml             analytics-pdb.yaml         analytics-migrate-job.yaml  analytics-ingress.yaml
    purchase-configmap.yaml        purchase-api-deployment.yaml  purchase-scheduler-deployment.yaml
    purchase-service.yaml          purchase-hpa.yaml  purchase-pdb.yaml  purchase-migrate-job.yaml  purchase-ingress.yaml
    dashboard-configmap.yaml       dashboard-deployment.yaml  dashboard-service.yaml  dashboard-ingress.yaml
infra/k8s/secrets/
  analytics.env.example            JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, TOTP_ENC_KEY, DATABASE_URL, CLICKHOUSE_PASSWORD, REDIS_URL, MISTRAL_API_KEY
  purchase.env.example             DATABASE_URL, STORE_CREDENTIALS_ENC_KEY, GOOGLE_PUBSUB_SHARED_SECRET
scripts/k8s/
  secrets.sh                       creates/updates the two Secrets + the GHCR pull secret from the env files
  deploy.sh                        helm upgrade --install wrapper (TAG, values file, --atomic --wait, prints rollout status)
  lint.sh                          helm lint + helm template | kubeconform + rendered-manifest assertions (§9.1, §9.3)
  local.sh                         kind smoke test (§9.2)
infra/docker-compose.prod.yml      host-DB overlay (private-IP binds, restart policy, creds from infra/.env.prod)
infra/.env.prod.example            DB passwords + BIND_IP for the prod overlay
dashboard/Dockerfile               multi-stage: pnpm build → nginx:alpine (+ config.js rendered from env)
dashboard/nginx/default.conf.template   SPA fallback, gzip, cache headers, /config.js no-cache
dashboard/nginx/config.js.template      window.___MYAMPIX_CONFIG__ = { apiBaseUrl, purchaseApiBaseUrl }
dashboard/Dockerfile.dockerignore
.github/workflows/images.yml       build + push the 3 images to GHCR
.github/workflows/ci.yml           + job `k8s` (helm lint, helm template | kubeconform) — path-filtered
docs/runbooks/vps-k3s.md           the operator runbook (§10)
.gitignore                         + infra/k8s/secrets/* (!*.example, !README.md), infra/values.prod.yaml, infra/.env.prod
```

`pnpm-workspace` and root `package.json` are untouched except two convenience scripts: `k8s:lint` (helm lint + kubeconform) and `k8s:local` (kind smoke test, §9).

---

## §3. Workloads

Common to every pod: `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`, `terminationGracePeriodSeconds: 30`, rolling update `maxUnavailable: 0, maxSurge: 1`, labels `app.kubernetes.io/{name,component,instance,part-of=myampix,managed-by=Helm}`, a `checksum/config` pod annotation (ConfigMap hash) so config changes roll pods.

### §3.1 `mobile-analytics` (Deployment)
- Image `ghcr.io/<owner>/myampix-mobile-analytics:<tag>` (existing `runtime` stage).
- `command: ["node", "dist/main.js"]` — bypasses `docker-entrypoint.sh`'s boot-time `prisma migrate deploy` (unsafe with N replicas). The entrypoint stays for Compose/local; no Dockerfile change.
- Env: ConfigMap (`NODE_ENV=production`, `PORT=8088`, `CLICKHOUSE_URL=http://clickhouse:8123`, `CLICKHOUSE_USER`, `CLICKHOUSE_DB`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN`, `LOG_LEVEL`, `INGEST_*` overrides if set) + Secret `myampix-analytics` (`DATABASE_URL`, `REDIS_URL`, `CLICKHOUSE_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOTP_ENC_KEY`, optional `MISTRAL_API_KEY`, `FIREBASE_STORAGE_BUCKET`).
- Probes: liveness `GET /health` (period 10 s, failure 3), readiness `GET /health/ready` (period 5 s, failure 2, timeout 3 s — the handler already caps itself at 2.5 s), startup probe `GET /health` (failure 30 × 2 s).
- `preStop: exec sleep 5` (bookworm image has a shell) so Traefik stops routing before SIGTERM.
- Resources: requests `250m / 256Mi`, limits `1000m / 512Mi`. HPA: CPU 70 %, min 2, max 6, scale-down stabilisation 120 s. PDB `minAvailable: 1`.
- `emptyDir` at `/tmp` + `readOnlyRootFilesystem: true`.

### §3.2 `mobile-purchase-api` (Deployment)
- Image `ghcr.io/<owner>/myampix-mobile-purchase:<tag>` (existing distroless `runtime` stage, uid 65532).
- Env: ConfigMap (`NODE_ENV=production`, `PORT=8090`, `SCHEDULER_ENABLED=false`, `ANALYTICS_INTERNAL_URL=http://mobile-analytics:8088`, `DASHBOARD_ORIGINS=https://app.<domain>`, `APPLE_BUNDLE_IDS`, `APPLE_APP_APPLE_ID`, `GOOGLE_PUSH_AUTH_MODE`, `LOG_LEVEL`) + Secret `myampix-purchase` (`DATABASE_URL`, `STORE_CREDENTIALS_ENC_KEY`, `GOOGLE_PUBSUB_SHARED_SECRET`).
- Probes as §3.1 on :8090. `preStop: exec ["/nodejs/bin/node","-e","setTimeout(()=>{},5000)"]` (distroless: no shell).
- Resources: requests `200m / 192Mi`, limits `1000m / 384Mi`. HPA CPU 70 %, min 2, max 4. PDB `minAvailable: 1`. `emptyDir` `/tmp` (Prisma engine), `readOnlyRootFilesystem: true`.

### §3.3 `mobile-purchase-scheduler` (Deployment)
- Same image and env as §3.2 except `SCHEDULER_ENABLED=true`. `replicas: 1` (not HPA-managed), `strategy: Recreate` — at most one expiry-sweep cron runner exists at any instant. Liveness/readiness as above (it still serves HTTP, but has **no Service/Ingress**). Requests `100m / 192Mi`, limits `500m / 384Mi`.
- Rationale: `SchedulerModule` uses in-process `@nestjs/schedule`; the `SCHEDULER_ENABLED` flag was added precisely for "a future split worker" (`app-config.ts`).

### §3.4 `dashboard` (Deployment, `dashboard.enabled`)
- New `dashboard/Dockerfile`: stage 1 `node:22-bookworm-slim` + pnpm (`--filter @myampix/dashboard...`, builds `@myampix/contracts` first, `pnpm --filter @myampix/dashboard build`); stage 2 `nginxinc/nginx-unprivileged:1.27-alpine` (runs as uid 101, listens on 8080) with `dist/` at `/usr/share/nginx/html`, `default.conf.template` and `config.js.template` under `/etc/nginx/templates/` — the official image's entrypoint renders `*.template` with `envsubst` at start, so `/config.js` is produced from `API_BASE_URL` / `PURCHASE_API_BASE_URL` and overrides the dev `public/config.js`.
- nginx config: `try_files $uri /index.html` (SPA), `gzip on`, immutable cache for `/assets/*`, `Cache-Control: no-store` for `/config.js` and `/index.html`, `/healthz` → 200.
- In prod values `API_BASE_URL=""` (same-origin via the `app.<domain>/api,/ingest` ingress rules → refresh cookie works) and `PURCHASE_API_BASE_URL=https://purchase.<domain>`.
- `replicas: 2`, requests `50m / 32Mi`, limits `200m / 64Mi`, probes on `/healthz`.

---

## §4. Database migrations (Helm hooks)

Two `Job`s annotated `helm.sh/hook: pre-install,pre-upgrade`, `helm.sh/hook-weight: "-5"`, `helm.sh/hook-delete-policy: before-hook-creation` (the previous job — succeeded or failed — is removed before the next run, so logs of a failed migration stay visible until the next attempt), `backoffLimit: 0`, `restartPolicy: Never`, `activeDeadlineSeconds: 600`, `ttlSecondsAfterFinished` unset (kept for inspection).

| Job | Image | Command | Env |
|---|---|---|---|
| `myampix-analytics-migrate` | analytics `runtime` image (has the global `prisma` CLI) | `["prisma","migrate","deploy","--schema","prisma/schema.prisma"]` | Secret `myampix-analytics` (`DATABASE_URL`) |
| `myampix-purchase-migrate` | purchase **`migrate`** image (`ghcr.io/<owner>/myampix-mobile-purchase-migrate:<tag>`) | image default CMD | Secret `myampix-purchase` (`DATABASE_URL`) |

**Hooks run before the release's regular resources exist**, so the `postgres`/`mobile-purchase-postgres` Services (§6) are not resolvable yet when the Jobs start. Both Jobs therefore carry `hostAliases` (rendered from `hostDbs.ip` + the service names) — same hostnames, same ports, no dependency on the Services. This is why in-cluster ports must equal host ports (`mobile-purchase-postgres:5433`, see §6).

`scripts/k8s/deploy.sh` runs `helm upgrade --install myampix infra/helm/myampix -n myampix --create-namespace -f values.prod.yaml --set image.tag=<tag> --atomic --wait --timeout 10m`. Helm runs both hooks to completion **before** touching any Deployment; a hook failure aborts the release (`--atomic` rolls back), so a bad migration never meets a new serving revision — the rule the purchase Dockerfile and the analytics entrypoint comment both encode.

The purchase `migrate` stage becomes a third published image (it's already a named Dockerfile target; `images.yml` pushes it).

---

## §5. Configuration & secrets

- **Values** (`values.yaml`): `image.registry/owner/tag/pullPolicy/pullSecret`, `domain`, `hosts.{api,purchase,app}`, `tls.{enabled,issuer,email}`, `hostDbs.ip` + per-DB ports, per-service `{enabled, replicas (scheduler/dashboard), resources, autoscaling{min,max,cpu}, env (map of non-secret overrides)}`, `dashboard.enabled`, `ingress.className`.
- **ConfigMaps** render the non-secret env per service from values; the Deployment carries `checksum/config` so edits roll pods.
- **Secrets** are *not* rendered by the chart (their values are never in any values file). `scripts/k8s/secrets.sh` does `kubectl create secret generic myampix-analytics --from-env-file=infra/k8s/secrets/analytics.env --dry-run=client -o yaml | kubectl apply -f -` (idempotent), same for purchase, and `kubectl create secret docker-registry ghcr-pull …` from `GHCR_USER`/`GHCR_TOKEN` env vars. The chart references the Secret names via `envFrom`. Rotating a secret = edit file → `secrets.sh` → `kubectl rollout restart deploy -l app.kubernetes.io/part-of=myampix` (documented in the runbook; no `checksum/secret` because the chart doesn't own the Secret).
- The example env files list **every** variable each service's `app-config.ts` schema reads, annotated required/optional, so the operator never discovers a missing var at boot. `DATABASE_URL` hosts use the in-cluster DNS names (`postgres:5432`, `mobile-purchase-postgres:5433`), `REDIS_URL=redis://redis:6379`.

---

## §6. Host databases (Compose on the VPS)

`infra/docker-compose.prod.yml` is an overlay on the existing `infra/docker-compose.yml`:
- Ports bind to `${BIND_IP}` (the VPS **private** IP, or the Docker bridge gateway `172.17.0.1` if the VPS has no private interface) instead of `0.0.0.0`: `${BIND_IP}:5432:5432`, `${BIND_IP}:5433:5432`, `${BIND_IP}:8123:8123`, `${BIND_IP}:9000:9000`, `${BIND_IP}:6379:6379`.
- Passwords from `infra/.env.prod` (`POSTGRES_PASSWORD`, `MOBILE_PURCHASE_POSTGRES_PASSWORD`, `CLICKHOUSE_PASSWORD`); `restart: unless-stopped`; admin UIs (`adminer`, `ch-ui`) get `profiles: [debug]` so they don't start by default.
- Redis: `--requirepass` is **not** added (would change `REDIS_URL` semantics and the dev contract); the firewall is the boundary. Noted in §11.
- Command: `docker compose --env-file infra/.env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --wait`.

Cluster side: `external-dbs.yaml` renders, for each of `postgres`, `mobile-purchase-postgres`, `clickhouse`, `redis`, a `Service` with no selector and a matching `EndpointSlice` (`addressType: IPv4`, `endpoints[0].addresses: [hostDbs.ip]`, the right port(s)). Pods therefore use **the same hostnames as Compose**, and changing the VPS IP is a one-value change. Ports are **identical in-cluster and on the host** (`mobile-purchase-postgres:5433`, not a 5432→5433 remap) because the migrate hook Jobs reach the same names through `hostAliases` (§4), which cannot remap ports. Firewall: `ufw allow from 10.42.0.0/16 to <BIND_IP> port 5432,5433,8123,9000,6379 proto tcp` (k3s default pod CIDR) and `ufw deny` those ports from anywhere else.

---

## §7. Ingress & TLS

- Standard `networking.k8s.io/v1 Ingress` objects, `ingressClassName: traefik`, annotation `cert-manager.io/cluster-issuer: <tls.issuer>`, one `tls.secretName` per host.
- `analytics-ingress`: host `api.<domain>` (all paths) **and** host `app.<domain>` paths `/api`, `/ingest` (Prefix) → `mobile-analytics:8088`. `dashboard-ingress`: host `app.<domain>` path `/` → `dashboard:8080`. Traefik matches the longer prefix first. `purchase-ingress`: host `purchase.<domain>` → `mobile-purchase-api:8090`.
- `cluster-issuer.yaml`: `ClusterIssuer letsencrypt` with ACME HTTP-01 via `ingress.class: traefik`, `email: tls.email`; rendered only when `tls.enabled`. (cert-manager itself is installed once via its upstream Helm chart — runbook step.)
- HTTP→HTTPS redirect is **not** expressed in the chart (no controller-specific annotations, so the same Ingress objects run under ingress-nginx in the kind smoke test). On k3s it is enabled cluster-wide once via a Traefik `HelmChartConfig` (`ports.web.redirectTo.port: websecure`) — runbook §10.4. cert-manager's HTTP-01 solver Ingress is exempt from that redirect by Traefik's ACME handling, so certificates still issue.
- Body size: Traefik has no default request-size cap; the apps' own `INGEST_MAX_BODY_KB` stays the limit.

---

## §8. Images & CI

- **`.github/workflows/images.yml`** — trigger: `push` to `main`, tags `v*`, `workflow_dispatch`. Matrix over `{mobile-analytics (runtime), mobile-purchase (runtime), mobile-purchase-migrate (purchase Dockerfile, target migrate), dashboard}`. `docker/setup-buildx-action`, `docker/login-action` (GHCR, `GITHUB_TOKEN`, `packages: write`), `docker/metadata-action` tags `sha-<7>`, `latest` (main), `vX.Y.Z`; `docker/build-push-action` with `context: .`, `platforms: linux/amd64` (VPS arch; arm64 can be added later — doubles build time), GHA cache `type=gha,scope=<image>`. Dashboard build passes no `VITE_*` at build time (config is runtime `/config.js`).
- **`ci.yml`** — new path-filtered job `k8s` (`infra/helm/**`, `infra/k8s/**`, `scripts/k8s/**`, `dashboard/Dockerfile`, workflows): installs `helm` and `kubeconform`, runs `helm lint infra/helm/myampix -f values.prod.example.yaml`, then `helm template … | kubeconform -strict -ignore-missing-schemas -summary` (ignore-missing covers cert-manager CRDs; a `-schema-location` for the CRD catalog is added so `ClusterIssuer` is validated too).
- Image naming: `ghcr.io/<owner>/myampix-<component>`; `<owner>` comes from `github.repository_owner` in CI and `image.owner` in values.

---

## §9. Testing & verification

1. **Static:** `pnpm k8s:lint` (= `scripts/k8s/lint.sh`) = `helm lint` (prod-example values + local values) + `kubeconform -strict`. Runs in CI.
2. **Smoke (local, real cluster):** `pnpm k8s:local` (= `scripts/k8s/local.sh`): creates a `kind` cluster (extraPortMappings 80/443) with the upstream kind `ingress-nginx` manifest — the chart's `ingress.className` is a value (`nginx` in `values.local.yaml`, `traefik` in prod) and the chart uses no controller-specific annotations, so the same Ingress objects are exercised, builds the 4 images locally (`docker build` with the same targets CI uses) and `kind load`s them, applies throwaway secrets from the `*.example` files pointing at the host Compose stack (`hostDbs.ip` = the IPv4 of `host.docker.internal` as seen from the kind node — `getent ahostsv4`, since the EndpointSlice is IPv4; DBs must be up via `pnpm infra:up`), then `helm upgrade --install … -f values.local.yaml --atomic --wait`. Asserts: both migrate Jobs `Complete`; all Deployments `Available`; `curl -H 'Host: api.local' localhost/health/ready` → 200 with all checks true; same for `purchase.local/health/ready` and `app.local/` (HTML). Tear-down flag.
3. **Chart unit checks** (cheap, in the same script as lint): `helm template` + `yq`/grep assertions — scheduler Deployment has `SCHEDULER_ENABLED=true` and `replicas: 1` and `Recreate`; API Deployment has `SCHEDULER_ENABLED=false`; analytics Deployment `command` is `node dist/main.js`; hook Jobs carry the hook annotations; no Secret object is rendered; every container sets `runAsNonRoot`.
4. **Dashboard image:** `docker run -e API_BASE_URL=https://x -e PURCHASE_API_BASE_URL=https://y -p 8080:8080 …` then `curl /config.js` contains both URLs and `curl /` is the SPA shell.

Acceptance for this sub-project: (1)–(4) pass locally; CI green; the runbook has been followed top-to-bottom once on a kind cluster as a stand-in for the VPS.

---

## §10. Runbook (`docs/runbooks/vps-k3s.md`) — outline

1. **VPS prep** — Ubuntu 24.04, 4 vCPU / 8 GB minimum; `ufw` allow 22/80/443, deny the DB ports publicly; note the private IP (`BIND_IP`); swap off or k3s `--disable` nothing. Docker Engine install.
2. **Host DBs** — clone repo, `cp infra/.env.prod.example infra/.env.prod`, fill, `docker compose … up -d --wait`; verify with `pg_isready`/`clickhouse-client`; `ufw` rules for the pod CIDR.
3. **k3s** — `curl -sfL https://get.k3s.io | sh -` (Traefik, metrics-server, local-path on by default); copy `/etc/rancher/k3s/k3s.yaml` to the laptop as kubeconfig (or operate on the VPS); `kubectl get nodes`.
4. **Cluster add-ons** — cert-manager (`helm repo add jetstack`, install with CRDs); Traefik global HTTP→HTTPS redirect via `/var/lib/rancher/k3s/server/manifests/traefik-config.yaml` (`HelmChartConfig`); DNS A records for the three hosts.
5. **Secrets** — `cp infra/k8s/secrets/*.example …`, fill (generation commands for JWT/TOTP/enc keys with `openssl rand -base64 …`), `scripts/k8s/secrets.sh` (creates namespace, two Secrets, GHCR pull secret).
6. **Values** — `cp infra/helm/myampix/values.prod.example.yaml infra/values.prod.yaml` (gitignored), set `domain`, `image.owner`, `hostDbs.ip`, `tls.email`.
7. **First deploy** — `scripts/k8s/deploy.sh sha-<7>`; watch `kubectl -n myampix get jobs,pods,ingress,certificate`; verify `https://api.<domain>/health/ready`.
8. **Upgrade** — `deploy.sh <newtag>`; what `--atomic` does on failure; `helm history` / `helm rollback myampix <rev>`.
9. **Day-2** — scale knobs (values `autoscaling.*`, `replicas`), logs (`kubectl logs -l app.kubernetes.io/name=mobile-analytics --tail`), secret rotation + rollout restart, cert renewal check, resource headroom check (`kubectl top`), host DB backups (pointer to July spec §4.5), k3s upgrade.
10. **Adding a node** — `k3s agent` join token; what changes (nothing in the chart; optionally `topologySpreadConstraints` — §11).
11. **Troubleshooting** — ImagePullBackOff (pull secret / package visibility), readiness 503 (DB reachability from a debug pod: `kubectl run -it --rm dbg --image=busybox -- nc -zv postgres 5432`), migrate hook failure (read job logs, fix, redeploy), certificate pending (DNS / port 80 reachability).

---

## §11. Deferred (with attachment points)

| Item | Why deferred | Where it plugs in |
|---|---|---|
| Prometheus + Grafana (kube-prometheus-stack) | ~1 GB RAM on the VPS; no app metrics endpoint yet | `ServiceMonitor` per Service once `/metrics` exists; HPA can then use RPS |
| NetworkPolicy (ingress only from Traefik; egress only to DB ports + DNS) | k3s enforces them, but a wrong rule silently breaks a manual operator; ufw is today's boundary | `templates/networkpolicy.yaml`, gated by `networkPolicy.enabled` |
| Redis AUTH / TLS to DBs | changes the dev contract (`REDIS_URL`), needs cert plumbing | Compose overlay + Secret values |
| Multi-node | single VPS today | add `topologySpreadConstraints` + `podAntiAffinity` (preferred) to the two API Deployments — values-gated |
| GitOps (Argo CD / Flux) | operator wants manual deploys | chart is already the unit of deployment |
| DB backups to object storage | host-level concern; July spec §4.5 | cron on the VPS |
| Log shipping (Loki) | no consumer yet | DaemonSet add-on |
| arm64 images | VPS is amd64 | `platforms:` in `images.yml` |
