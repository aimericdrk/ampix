# Kubernetes (k3s on a VPS) Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Helm chart + host-DB Compose overlay + image CI + operator runbook so both backend services (and the dashboard) run on a single-VPS k3s cluster with HPA, hook-gated migrations and TLS.

**Architecture:** One Helm chart (`infra/helm/myampix`) renders every workload; migrations are `pre-install,pre-upgrade` hook Jobs; datastores stay in Docker Compose on the host and are reached through selector-less Services + EndpointSlices; images come from GHCR via a GitHub Actions matrix; the deploy is a manual `helm upgrade --install` wrapped by `scripts/k8s/deploy.sh`.

**Tech Stack:** Helm (3 or 4 — `deploy.sh` handles both), Kubernetes ≥1.28 (k3s, kind for the smoke test), Traefik (prod) / ingress-nginx (kind), cert-manager, kubeconform, Docker buildx, GHCR, nginx-unprivileged.

**Spec:** `docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md`

## Global Constraints

- **No application code changes** (`backend/*/src`, Prisma schemas/migrations, dashboard `src/`). Only infra, Dockerfile (dashboard, new), workflows, scripts, docs.
- **No secret values in git.** Only `*.example` files are committed; `.gitignore` gains the real-file patterns (Task 5).
- **NEVER commit** — the user commits (CLAUDE.md). No co-author trailers. Tasks therefore end at "verify", not "commit".
- **Files < 500 lines.** Markdown under `docs/`, scripts under `scripts/`, config under `infra/`.
- Image names: `ghcr.io/<owner>/myampix-{mobile-analytics,mobile-purchase,mobile-purchase-migrate,dashboard}`.
- Kubernetes resource names: `mobile-analytics`, `mobile-purchase-api`, `mobile-purchase-scheduler`, `dashboard`; hook Jobs `<release>-analytics-migrate`, `<release>-purchase-migrate`; Secrets `myampix-analytics`, `myampix-purchase`, pull secret `ghcr-pull`; namespace `myampix`; release `myampix`.
- Container UIDs: analytics image `USER app` = **999** (verified in Task 9; the chart sets `runAsUser` explicitly because `runAsNonRoot` cannot verify a *named* user), purchase distroless `nonroot` = 65532, nginx-unprivileged = 101.
- Prettier already ignores `*.yml`/`*.yaml` and `docs/`; ESLint ignores nothing new (no JS added). `pnpm lint && pnpm format:check` must stay green.
- Tools needed on the dev machine: `helm`, `kubeconform`, `kind` (`brew install helm kubeconform kind`) — Docker is present.

---

### Task 1: Chart skeleton + lint harness

**Files:**
- Create: `infra/helm/myampix/Chart.yaml`, `infra/helm/myampix/.helmignore`, `infra/helm/myampix/values.yaml`, `infra/helm/myampix/templates/_helpers.tpl`, `scripts/k8s/lint.sh`
- Modify: `package.json` (root scripts)

**Interfaces:**
- Produces: helper templates `myampix.labels` (ctx: root), `myampix.selectorLabels` (dict root/name/component), `myampix.image` (dict root/name), `myampix.scheme` (root), `myampix.podSecurityContext`, `myampix.containerSecurityContext`, `myampix.imagePullSecrets` (root), `myampix.tlsSecret` (string host). Values keys listed in `values.yaml` below are the contract for every later task.

- [ ] **Step 1: Install tooling**

Run: `brew install helm kubeconform kind` then `helm version --short && kubeconform -v && kind version`
Expected: three versions print (helm v3.x or v4.x).

- [ ] **Step 2: Create `infra/helm/myampix/Chart.yaml`**

```yaml
apiVersion: v2
name: myampix
description: MyAmpix backend services (mobile-analytics, mobile-purchase) and dashboard on Kubernetes.
type: application
version: 0.1.0
# The image tag is a value (image.tag); appVersion is informational only.
appVersion: "latest"
kubeVersion: ">=1.28.0-0"
home: https://github.com/aimericdrk/MyAmpix
keywords: [analytics, subscriptions, nestjs]
```

- [ ] **Step 3: Create `infra/helm/myampix/.helmignore`**

```
.DS_Store
*.swp
*.orig
*.tmp
```

- [ ] **Step 4: Create `infra/helm/myampix/values.yaml`**

```yaml
# MyAmpix Helm chart — default values.
# Design: docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md
# Copy values.prod.example.yaml → infra/values.prod.yaml (gitignored) for a real cluster.

image:
  registry: ghcr.io
  # GitHub user/org that owns the packages (lowercase). CI pushes ghcr.io/<owner>/myampix-<component>.
  owner: CHANGE_ME
  # Overridden per deploy: scripts/k8s/deploy.sh <tag>  (e.g. sha-1a2b3c4 or v1.2.0)
  tag: latest
  pullPolicy: IfNotPresent
  # Name of a docker-registry Secret (created by scripts/k8s/secrets.sh). "" if the packages are public.
  pullSecret: ghcr-pull

# Public hostnames (DNS A records → the VPS). app = dashboard + same-origin /api,/ingest proxy to analytics.
hosts:
  api: api.example.com
  purchase: purchase.example.com
  app: app.example.com

ingress:
  # traefik on k3s; nginx in the kind smoke test. No controller-specific annotations are used by the chart.
  className: traefik
  annotations: {}

tls:
  enabled: true
  # ClusterIssuer name. createIssuer renders it (cert-manager must already be installed).
  issuer: letsencrypt
  createIssuer: true
  email: CHANGE_ME@example.com
  acmeServer: https://acme-v02.api.letsencrypt.org/directory

# Datastores run in Docker Compose on the host (infra/docker-compose.prod.yml). The chart renders a
# selector-less Service + EndpointSlice per entry so pods use the SAME hostnames as Compose.
hostDbs:
  # VPS private IP the Compose ports are bound to (BIND_IP in infra/.env.prod).
  ip: 10.0.0.2
  services:
    - name: postgres
      ports: [{ name: postgres, port: 5432 }]
    - name: mobile-purchase-postgres
      # Host-published on :5433 → reachable as mobile-purchase-postgres:5433 (ports are NOT remapped:
      # the migrate hook Jobs reach these names via hostAliases, which can't remap ports).
      ports: [{ name: postgres, port: 5433 }]
    - name: clickhouse
      ports:
        - { name: http, port: 8123 }
        - { name: native, port: 9000 }
    - name: redis
      ports: [{ name: redis, port: 6379 }]

migrations:
  activeDeadlineSeconds: 600
  resources:
    requests: { cpu: 100m, memory: 128Mi }
    limits: { cpu: 500m, memory: 512Mi }

analytics:
  enabled: true
  # Secret with DATABASE_URL, REDIS_URL, CLICKHOUSE_PASSWORD, JWT_*_SECRET, TOTP_ENC_KEY (+ optional keys).
  secretName: myampix-analytics
  # UID/GID of the image's `app` user (useradd -r → 999 on node:22-bookworm-slim).
  runAsUser: 999
  runAsGroup: 999
  # Non-secret env (rendered into a ConfigMap; NODE_ENV and PORT are fixed by the template).
  env:
    CLICKHOUSE_URL: http://clickhouse:8123
    CLICKHOUSE_USER: default
    CLICKHOUSE_DB: analytics
    COOKIE_SECURE: "true"
    LOG_LEVEL: info
  replicas: 2 # used only when autoscaling.enabled=false
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6
    targetCPUUtilizationPercentage: 70
  pdb:
    minAvailable: 1
  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits: { cpu: "1", memory: 512Mi }

purchase:
  enabled: true
  # Secret with DATABASE_URL, STORE_CREDENTIALS_ENC_KEY, GOOGLE_PUBSUB_SHARED_SECRET.
  secretName: myampix-purchase
  runAsUser: 65532
  runAsGroup: 65532
  # "" → derived from hosts.app (https://app.example.com). Comma-separated to allow several.
  dashboardOrigins: ""
  env:
    ANALYTICS_INTERNAL_URL: http://mobile-analytics:8088
    GOOGLE_PUSH_AUTH_MODE: shared_secret
    APPLE_BUNDLE_IDS: com.myampix.app
    LOG_LEVEL: info
  api:
    replicas: 2
    autoscaling:
      enabled: true
      minReplicas: 2
      maxReplicas: 4
      targetCPUUtilizationPercentage: 70
    pdb:
      minAvailable: 1
    resources:
      requests: { cpu: 200m, memory: 192Mi }
      limits: { cpu: "1", memory: 384Mi }
  scheduler:
    enabled: true
    # Exactly one replica, Recreate strategy — the in-process @nestjs/schedule cron must never run twice.
    env:
      EXPIRY_SWEEP_CRON: "*/5 * * * *"
    resources:
      requests: { cpu: 100m, memory: 192Mi }
      limits: { cpu: 500m, memory: 384Mi }

dashboard:
  enabled: true
  runAsUser: 101
  runAsGroup: 101
  replicas: 2
  # "" = same origin (the app host proxies /api and /ingest to analytics → auth cookies stay first-party).
  apiBaseUrl: ""
  # "" → derived from hosts.purchase.
  purchaseApiBaseUrl: ""
  resources:
    requests: { cpu: 50m, memory: 32Mi }
    limits: { cpu: 200m, memory: 64Mi }
```

- [ ] **Step 5: Create `infra/helm/myampix/templates/_helpers.tpl`**

```
{{/*
Chart-wide labels (every object).
*/}}
{{- define "myampix.labels" -}}
app.kubernetes.io/part-of: myampix
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/*
Selector labels for one component.
Usage: include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api")
*/}}
{{- define "myampix.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Full image reference.
Usage: include "myampix.image" (dict "root" . "name" "mobile-analytics")
*/}}
{{- define "myampix.image" -}}
{{- $img := .root.Values.image -}}
{{- printf "%s/%s/myampix-%s:%s" $img.registry $img.owner .name $img.tag -}}
{{- end }}

{{/* http or https depending on tls.enabled */}}
{{- define "myampix.scheme" -}}
{{- if .Values.tls.enabled }}https{{ else }}http{{ end }}
{{- end }}

{{/* Pod securityContext body shared by every workload (runAsUser/Group are added per component). */}}
{{- define "myampix.podSecurityContext" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* Container securityContext for serving containers (read-only root fs; /tmp is an emptyDir). */}}
{{- define "myampix.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{/* imagePullSecrets block (empty when image.pullSecret is ""). */}}
{{- define "myampix.imagePullSecrets" -}}
{{- if .Values.image.pullSecret }}
imagePullSecrets:
  - name: {{ .Values.image.pullSecret }}
{{- end }}
{{- end }}

{{/* TLS Secret name for a host: api.example.com → api-example-com-tls */}}
{{- define "myampix.tlsSecret" -}}
{{- printf "%s-tls" (replace "." "-" .) -}}
{{- end }}

{{/*
hostAliases mapping every host-DB hostname to hostDbs.ip. Used by the migrate hook Jobs: Helm runs
pre-install/pre-upgrade hooks BEFORE the release's Services exist, so DNS for `postgres` etc. would
not resolve yet. /etc/hosts entries make the Jobs independent of the Services (same names, same ports).
*/}}
{{- define "myampix.hostDbAliases" -}}
hostAliases:
  - ip: {{ .Values.hostDbs.ip | quote }}
    hostnames:
      {{- range .Values.hostDbs.services }}
      - {{ .name }}
      {{- end }}
{{- end }}
```

- [ ] **Step 6: Create `scripts/k8s/lint.sh`** (assertions are added in Task 5; start with lint only)

```bash
#!/usr/bin/env bash
# Static checks for the Helm chart: helm lint (+ kubeconform and rendered-manifest assertions, added
# as the chart grows). Used by `pnpm k8s:lint` and the CI `k8s` job. Needs: helm, kubeconform.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHART="$ROOT/infra/helm/myampix"

for t in helm; do command -v "$t" >/dev/null || { echo "lint.sh: missing tool '$t'" >&2; exit 1; }; done

echo "== helm lint (default values)"
helm lint "$CHART" --set tls.email=lint@example.com

echo "lint.sh: OK"
```

Run: `chmod +x scripts/k8s/lint.sh`

- [ ] **Step 7: Add root scripts to `package.json`** — in the `scripts` block, after `"infra:reset"`:

```json
    "infra:reset": "docker compose -f infra/docker-compose.yml down -v",
    "k8s:lint": "bash scripts/k8s/lint.sh",
    "k8s:local": "bash scripts/k8s/local.sh"
```

- [ ] **Step 8: Verify**

Run: `pnpm k8s:lint`
Expected: `1 chart(s) linted, 0 chart(s) failed` then `lint.sh: OK`. (A chart with only `_helpers.tpl` renders nothing — that's fine for lint.)

---

### Task 2: External DB Services + ClusterIssuer

**Files:**
- Create: `infra/helm/myampix/templates/external-dbs.yaml`, `infra/helm/myampix/templates/cluster-issuer.yaml`

**Interfaces:**
- Produces: in-cluster DNS names `postgres`, `mobile-purchase-postgres`, `clickhouse`, `redis` (ports per `values.hostDbs.services`); `ClusterIssuer/<tls.issuer>`.

- [ ] **Step 1: Create `templates/external-dbs.yaml`**

```yaml
{{- /*
Datastores live in Docker Compose on the VPS. For each entry in hostDbs.services render a
selector-less Service plus a hand-managed EndpointSlice pointing at hostDbs.ip, so pods resolve the
same hostnames Compose uses (postgres, clickhouse, redis, mobile-purchase-postgres).
*/ -}}
{{- range .Values.hostDbs.services }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ .name }}
  labels:
    {{- include "myampix.labels" $ | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" $ "name" .name "component" "external-db") | nindent 4 }}
spec:
  type: ClusterIP
  ports:
    {{- range .ports }}
    - name: {{ .name }}
      port: {{ .port }}
      protocol: TCP
    {{- end }}
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: {{ .name }}-host
  labels:
    kubernetes.io/service-name: {{ .name }}
    endpointslice.kubernetes.io/managed-by: helm
    {{- include "myampix.labels" $ | nindent 4 }}
addressType: IPv4
ports:
  {{- range .ports }}
  - name: {{ .name }}
    port: {{ .port }}
    protocol: TCP
  {{- end }}
endpoints:
  - addresses:
      - {{ $.Values.hostDbs.ip | quote }}
    conditions:
      ready: true
{{- end }}
```

- [ ] **Step 2: Create `templates/cluster-issuer.yaml`**

```yaml
{{- if and .Values.tls.enabled .Values.tls.createIssuer }}
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: {{ .Values.tls.issuer }}
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
spec:
  acme:
    server: {{ .Values.tls.acmeServer }}
    email: {{ required "tls.email is required when tls.enabled" .Values.tls.email }}
    privateKeySecretRef:
      name: {{ .Values.tls.issuer }}-account-key
    solvers:
      - http01:
          ingress:
            ingressClassName: {{ .Values.ingress.className }}
{{- end }}
```

- [ ] **Step 3: Verify**

Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/external-dbs.yaml | grep -c '^kind: EndpointSlice'`
Expected: `4`
Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/external-dbs.yaml | grep -A3 'name: mobile-purchase-postgres-host' -m1 >/dev/null && helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/external-dbs.yaml | awk '/name: mobile-purchase-postgres-host/,/endpoints:/' | grep 'port: 5433'`
Expected: one line `    port: 5433`.
Run: `helm template t infra/helm/myampix 2>&1 | grep -c 'tls.email is required'`
Expected: `1` (the `required` guard fires without an email).

---

### Task 3: mobile-analytics workloads

**Files:**
- Create: `templates/analytics-configmap.yaml`, `templates/analytics-deployment.yaml`, `templates/analytics-service.yaml`, `templates/analytics-hpa.yaml`, `templates/analytics-pdb.yaml`, `templates/analytics-migrate-job.yaml`, `templates/analytics-ingress.yaml` (all under `infra/helm/myampix/`)

**Interfaces:**
- Produces: `Service/mobile-analytics:8088` (used by purchase's `ANALYTICS_INTERNAL_URL` and by the dashboard ingress in Task 5).

- [ ] **Step 1: `templates/analytics-configmap.yaml`**

```yaml
{{- if .Values.analytics.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-analytics-config
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
data:
  NODE_ENV: production
  PORT: "8088"
  {{- range $k, $v := .Values.analytics.env }}
  {{ $k }}: {{ $v | quote }}
  {{- end }}
{{- end }}
```

- [ ] **Step 2: `templates/analytics-deployment.yaml`**

```yaml
{{- if .Values.analytics.enabled }}
{{- $a := .Values.analytics }}
{{- $sel := dict "root" . "name" "mobile-analytics" "component" "api" }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mobile-analytics
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
spec:
  {{- if not $a.autoscaling.enabled }}
  replicas: {{ $a.replicas }}
  {{- end }}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" $sel | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/analytics-configmap.yaml") . | sha256sum }}
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 30
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        runAsUser: {{ $a.runAsUser }}
        runAsGroup: {{ $a.runAsGroup }}
      containers:
        - name: api
          image: {{ include "myampix.image" (dict "root" . "name" "mobile-analytics") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          # Bypass docker-entrypoint.sh: it runs `prisma migrate deploy` at boot, which must not race
          # across replicas. Migrations run once in the pre-upgrade hook Job (analytics-migrate-job.yaml).
          command: ["node", "dist/main.js"]
          ports:
            - name: http
              containerPort: 8088
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-analytics-config
            - secretRef:
                name: {{ $a.secretName }}
          startupProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          lifecycle:
            preStop:
              # Let the ingress/endpoints drop this pod before SIGTERM (Nest handles SIGTERM via enableShutdownHooks).
              exec:
                command: ["sleep", "5"]
          resources:
            {{- toYaml $a.resources | nindent 12 }}
          securityContext:
            {{- include "myampix.containerSecurityContext" . | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

- [ ] **Step 3: `templates/analytics-service.yaml`**

```yaml
{{- if .Values.analytics.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: mobile-analytics
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
  ports:
    - name: http
      port: 8088
      targetPort: http
      protocol: TCP
{{- end }}
```

- [ ] **Step 4: `templates/analytics-hpa.yaml`**

```yaml
{{- if and .Values.analytics.enabled .Values.analytics.autoscaling.enabled }}
{{- $as := .Values.analytics.autoscaling }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mobile-analytics
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mobile-analytics
  minReplicas: {{ $as.minReplicas }}
  maxReplicas: {{ $as.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $as.targetCPUUtilizationPercentage }}
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 120
{{- end }}
```

- [ ] **Step 5: `templates/analytics-pdb.yaml`**

```yaml
{{- if .Values.analytics.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mobile-analytics
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
spec:
  minAvailable: {{ .Values.analytics.pdb.minAvailable }}
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 6 }}
{{- end }}
```

- [ ] **Step 6: `templates/analytics-migrate-job.yaml`**

```yaml
{{- if .Values.analytics.enabled }}
{{- $a := .Values.analytics }}
{{- $sel := dict "root" . "name" "mobile-analytics" "component" "migrate" }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-analytics-migrate
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
  annotations:
    # Runs to completion BEFORE any Deployment is touched; a failure aborts the release.
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    # Previous run (success or failure) is deleted right before the next one, so failed-job logs stay
    # inspectable until you redeploy.
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: 0
  activeDeadlineSeconds: {{ .Values.migrations.activeDeadlineSeconds }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      {{- include "myampix.hostDbAliases" . | nindent 6 }}
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        runAsUser: {{ $a.runAsUser }}
        runAsGroup: {{ $a.runAsGroup }}
      containers:
        - name: migrate
          # Same runtime image as the API: it carries the global `prisma` CLI (see the Dockerfile).
          image: {{ include "myampix.image" (dict "root" . "name" "mobile-analytics") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command: ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
          env:
            - name: CHECKPOINT_DISABLE # no Prisma CLI telemetry/update checks from the cluster
              value: "1"
          envFrom:
            - secretRef:
                name: {{ $a.secretName }}
          resources:
            {{- toYaml .Values.migrations.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

- [ ] **Step 7: `templates/analytics-ingress.yaml`** (the `app` host's `/api` + `/ingest` rules live in the dashboard ingress, Task 5, so each host has exactly one TLS owner)

```yaml
{{- if .Values.analytics.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mobile-analytics
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api") | nindent 4 }}
  annotations:
    {{- if .Values.tls.enabled }}
    cert-manager.io/cluster-issuer: {{ .Values.tls.issuer }}
    {{- end }}
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.tls.enabled }}
  tls:
    - hosts: [{{ .Values.hosts.api | quote }}]
      secretName: {{ include "myampix.tlsSecret" .Values.hosts.api }}
  {{- end }}
  rules:
    - host: {{ .Values.hosts.api | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mobile-analytics
                port:
                  name: http
{{- end }}
```

- [ ] **Step 8: Verify**

Run: `pnpm k8s:lint`
Expected: OK.
Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/analytics-deployment.yaml | grep -E 'command: \["node", "dist/main.js"\]|runAsUser: 999|readOnlyRootFilesystem: true|checksum/config'`
Expected: four matching lines.
Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/analytics-migrate-job.yaml | grep -E 'helm.sh/hook: pre-install,pre-upgrade|backoffLimit: 0|"prisma", "migrate", "deploy"'`
Expected: three matching lines.

---

### Task 4: mobile-purchase workloads (API + scheduler)

**Files:**
- Create: `templates/purchase-configmap.yaml`, `templates/purchase-api-deployment.yaml`, `templates/purchase-scheduler-deployment.yaml`, `templates/purchase-service.yaml`, `templates/purchase-hpa.yaml`, `templates/purchase-pdb.yaml`, `templates/purchase-migrate-job.yaml`, `templates/purchase-ingress.yaml`

**Interfaces:**
- Consumes: `Service/mobile-analytics:8088` (Task 3) via `purchase.env.ANALYTICS_INTERNAL_URL`.
- Produces: `Service/mobile-purchase-api:8090`.

- [ ] **Step 1: `templates/purchase-configmap.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
{{- $p := .Values.purchase }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-purchase-config
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
data:
  NODE_ENV: production
  PORT: "8090"
  # The API replicas never run the in-process cron; the scheduler Deployment overrides this to "true".
  SCHEDULER_ENABLED: "false"
  # CORS allowlist for the dashboard (credentialed cross-origin requests). Derived from hosts.app.
  DASHBOARD_ORIGINS: {{ default (printf "%s://%s" (include "myampix.scheme" .) .Values.hosts.app) $p.dashboardOrigins | quote }}
  {{- range $k, $v := $p.env }}
  {{ $k }}: {{ $v | quote }}
  {{- end }}
{{- end }}
```

- [ ] **Step 2: `templates/purchase-api-deployment.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
{{- $p := .Values.purchase }}
{{- $sel := dict "root" . "name" "mobile-purchase" "component" "api" }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mobile-purchase-api
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
spec:
  {{- if not $p.api.autoscaling.enabled }}
  replicas: {{ $p.api.replicas }}
  {{- end }}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" $sel | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/purchase-configmap.yaml") . | sha256sum }}
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 30
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        runAsUser: {{ $p.runAsUser }}
        runAsGroup: {{ $p.runAsGroup }}
      containers:
        - name: api
          # Distroless runtime stage: ENTRYPOINT is `node`, CMD is dist/main.js. No shell.
          image: {{ include "myampix.image" (dict "root" . "name" "mobile-purchase") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 8090
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-purchase-config
            - secretRef:
                name: {{ $p.secretName }}
          startupProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          lifecycle:
            preStop:
              # distroless has no `sleep`; node is at /nodejs/bin/node in gcr.io/distroless/nodejs22.
              exec:
                command: ["/nodejs/bin/node", "-e", "setTimeout(() => {}, 5000)"]
          resources:
            {{- toYaml $p.api.resources | nindent 12 }}
          securityContext:
            {{- include "myampix.containerSecurityContext" . | nindent 12 }}
          volumeMounts:
            - name: tmp # Prisma's query engine writes here
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

- [ ] **Step 3: `templates/purchase-scheduler-deployment.yaml`**

```yaml
{{- if and .Values.purchase.enabled .Values.purchase.scheduler.enabled }}
{{- $p := .Values.purchase }}
{{- $sel := dict "root" . "name" "mobile-purchase" "component" "scheduler" }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mobile-purchase-scheduler
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
spec:
  # Exactly one cron runner, ever: replicas pinned to 1 and Recreate (old pod fully gone before the
  # new one starts). Not HPA-managed. See SCHEDULER_ENABLED in backend/mobile_purchase/src/config/app-config.ts.
  replicas: 1
  revisionHistoryLimit: 5
  strategy:
    type: Recreate
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" $sel | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/purchase-configmap.yaml") . | sha256sum }}
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 30
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        runAsUser: {{ $p.runAsUser }}
        runAsGroup: {{ $p.runAsGroup }}
      containers:
        - name: scheduler
          image: {{ include "myampix.image" (dict "root" . "name" "mobile-purchase") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http # health probes only — no Service/Ingress points here
              containerPort: 8090
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-purchase-config
            - secretRef:
                name: {{ $p.secretName }}
          env:
            # `env` wins over `envFrom`: this replica is THE scheduler.
            - name: SCHEDULER_ENABLED
              value: "true"
            {{- range $k, $v := $p.scheduler.env }}
            - name: {{ $k }}
              value: {{ $v | quote }}
            {{- end }}
          startupProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet: { path: /health/ready, port: http }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          resources:
            {{- toYaml $p.scheduler.resources | nindent 12 }}
          securityContext:
            {{- include "myampix.containerSecurityContext" . | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

- [ ] **Step 4: `templates/purchase-service.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: mobile-purchase-api
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
  ports:
    - name: http
      port: 8090
      targetPort: http
      protocol: TCP
{{- end }}
```

- [ ] **Step 5: `templates/purchase-hpa.yaml`**

```yaml
{{- if and .Values.purchase.enabled .Values.purchase.api.autoscaling.enabled }}
{{- $as := .Values.purchase.api.autoscaling }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mobile-purchase-api
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mobile-purchase-api
  minReplicas: {{ $as.minReplicas }}
  maxReplicas: {{ $as.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $as.targetCPUUtilizationPercentage }}
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 120
{{- end }}
```

- [ ] **Step 6: `templates/purchase-pdb.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: mobile-purchase-api
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
spec:
  minAvailable: {{ .Values.purchase.api.pdb.minAvailable }}
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 6 }}
{{- end }}
```

- [ ] **Step 7: `templates/purchase-migrate-job.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
{{- $p := .Values.purchase }}
{{- $sel := dict "root" . "name" "mobile-purchase" "component" "migrate" }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-purchase-migrate
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
  annotations:
    helm.sh/hook: pre-install,pre-upgrade
    helm.sh/hook-weight: "-5"
    helm.sh/hook-delete-policy: before-hook-creation
spec:
  backoffLimit: 0
  activeDeadlineSeconds: {{ .Values.migrations.activeDeadlineSeconds }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      {{- include "myampix.hostDbAliases" . | nindent 6 }}
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        # The migrate stage is node:22-bookworm-slim (no USER) — run it as the same non-root uid as the runtime.
        runAsUser: {{ $p.runAsUser }}
        runAsGroup: {{ $p.runAsGroup }}
      containers:
        - name: migrate
          # Dedicated `migrate` image target: `prisma migrate deploy` and exit (Dockerfile §migrate).
          image: {{ include "myampix.image" (dict "root" . "name" "mobile-purchase-migrate") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          env:
            - name: CHECKPOINT_DISABLE
              value: "1"
          envFrom:
            - secretRef:
                name: {{ $p.secretName }}
          resources:
            {{- toYaml .Values.migrations.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
{{- end }}
```

- [ ] **Step 8: `templates/purchase-ingress.yaml`**

```yaml
{{- if .Values.purchase.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mobile-purchase-api
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "mobile-purchase" "component" "api") | nindent 4 }}
  annotations:
    {{- if .Values.tls.enabled }}
    cert-manager.io/cluster-issuer: {{ .Values.tls.issuer }}
    {{- end }}
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.tls.enabled }}
  tls:
    - hosts: [{{ .Values.hosts.purchase | quote }}]
      secretName: {{ include "myampix.tlsSecret" .Values.hosts.purchase }}
  {{- end }}
  rules:
    - host: {{ .Values.hosts.purchase | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mobile-purchase-api
                port:
                  name: http
{{- end }}
```

- [ ] **Step 9: Verify**

Run: `pnpm k8s:lint`
Expected: OK.
Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/purchase-scheduler-deployment.yaml | grep -E 'replicas: 1|type: Recreate|name: SCHEDULER_ENABLED' -A1 | grep -cE 'replicas: 1|Recreate|value: "true"'`
Expected: `3`
Run: `helm template t infra/helm/myampix --set tls.email=a@b.c --show-only templates/purchase-configmap.yaml | grep -E 'SCHEDULER_ENABLED: "false"|DASHBOARD_ORIGINS: "https://app.example.com"'`
Expected: both lines.

---

### Task 5: Dashboard workloads, env values files, lint assertions, CI job, gitignore

**Files:**
- Create: `templates/dashboard-configmap.yaml`, `templates/dashboard-deployment.yaml`, `templates/dashboard-service.yaml`, `templates/dashboard-ingress.yaml`, `infra/helm/myampix/values.prod.example.yaml`, `infra/helm/myampix/values.local.yaml`
- Modify: `scripts/k8s/lint.sh` (full version), `.github/workflows/ci.yml` (filter + job), `.gitignore`

**Interfaces:**
- Consumes: `Service/mobile-analytics:8088` (Task 3) for the `/api`, `/ingest` same-origin rules.
- Produces: `Service/dashboard:8080`; the dashboard image contract (Task 7): listens on **8080**, reads `API_BASE_URL` and `PURCHASE_API_BASE_URL`, serves `/healthz`.

- [ ] **Step 1: `templates/dashboard-configmap.yaml`**

```yaml
{{- if .Values.dashboard.enabled }}
{{- $d := .Values.dashboard }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-dashboard-config
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "dashboard" "component" "web") | nindent 4 }}
data:
  # Rendered into /config.js by the nginx image at start (window.___MYAMPIX_CONFIG__).
  API_BASE_URL: {{ $d.apiBaseUrl | quote }}
  PURCHASE_API_BASE_URL: {{ default (printf "%s://%s" (include "myampix.scheme" .) .Values.hosts.purchase) $d.purchaseApiBaseUrl | quote }}
{{- end }}
```

- [ ] **Step 2: `templates/dashboard-deployment.yaml`**

```yaml
{{- if .Values.dashboard.enabled }}
{{- $d := .Values.dashboard }}
{{- $sel := dict "root" . "name" "dashboard" "component" "web" }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" $sel | nindent 4 }}
spec:
  replicas: {{ $d.replicas }}
  revisionHistoryLimit: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      {{- include "myampix.selectorLabels" $sel | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "myampix.labels" . | nindent 8 }}
        {{- include "myampix.selectorLabels" $sel | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/dashboard-configmap.yaml") . | sha256sum }}
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 15
      {{- include "myampix.imagePullSecrets" . | nindent 6 }}
      securityContext:
        {{- include "myampix.podSecurityContext" . | nindent 8 }}
        runAsUser: {{ $d.runAsUser }}
        runAsGroup: {{ $d.runAsGroup }}
      containers:
        - name: web
          image: {{ include "myampix.image" (dict "root" . "name" "dashboard") }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          envFrom:
            - configMapRef:
                name: {{ .Release.Name }}-dashboard-config
          livenessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 10
          readinessProbe:
            httpGet: { path: /healthz, port: http }
            periodSeconds: 5
          resources:
            {{- toYaml $d.resources | nindent 12 }}
          securityContext:
            {{- include "myampix.containerSecurityContext" . | nindent 12 }}
          volumeMounts:
            # nginx-unprivileged writes its pid/cache under /tmp and the envsubst'd templates into conf.d.
            - name: tmp
              mountPath: /tmp
            - name: confd
              mountPath: /etc/nginx/conf.d
      volumes:
        - name: tmp
          emptyDir: {}
        - name: confd
          emptyDir: {}
{{- end }}
```

- [ ] **Step 3: `templates/dashboard-service.yaml`**

```yaml
{{- if .Values.dashboard.enabled }}
apiVersion: v1
kind: Service
metadata:
  name: dashboard
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "dashboard" "component" "web") | nindent 4 }}
spec:
  type: ClusterIP
  selector:
    {{- include "myampix.selectorLabels" (dict "root" . "name" "dashboard" "component" "web") | nindent 4 }}
  ports:
    - name: http
      port: 8080
      targetPort: http
      protocol: TCP
{{- end }}
```

- [ ] **Step 4: `templates/dashboard-ingress.yaml`** — owns the `app` host: `/api` and `/ingest` → analytics (same-origin cookies), `/` → dashboard

```yaml
{{- if .Values.dashboard.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: dashboard
  labels:
    {{- include "myampix.labels" . | nindent 4 }}
    {{- include "myampix.selectorLabels" (dict "root" . "name" "dashboard" "component" "web") | nindent 4 }}
  annotations:
    {{- if .Values.tls.enabled }}
    cert-manager.io/cluster-issuer: {{ .Values.tls.issuer }}
    {{- end }}
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  {{- if .Values.tls.enabled }}
  tls:
    - hosts: [{{ .Values.hosts.app | quote }}]
      secretName: {{ include "myampix.tlsSecret" .Values.hosts.app }}
  {{- end }}
  rules:
    - host: {{ .Values.hosts.app | quote }}
      http:
        paths:
          {{- if .Values.analytics.enabled }}
          # Same-origin API for the SPA (dashboard.apiBaseUrl = ""): the httpOnly refresh cookie stays first-party.
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: mobile-analytics
                port:
                  name: http
          - path: /ingest
            pathType: Prefix
            backend:
              service:
                name: mobile-analytics
                port:
                  name: http
          {{- end }}
          - path: /
            pathType: Prefix
            backend:
              service:
                name: dashboard
                port:
                  name: http
{{- end }}
```

- [ ] **Step 5: `infra/helm/myampix/values.prod.example.yaml`**

```yaml
# Copy to infra/values.prod.yaml (gitignored) and fill every CHANGE_ME. Deploy with:
#   scripts/k8s/deploy.sh <image-tag>            (defaults to infra/values.prod.yaml)
image:
  owner: CHANGE_ME # your GitHub user/org, lowercase
  pullSecret: ghcr-pull # "" if the GHCR packages are public

hosts:
  api: api.CHANGE_ME.com
  purchase: purchase.CHANGE_ME.com
  app: app.CHANGE_ME.com

tls:
  enabled: true
  email: CHANGE_ME@example.com

hostDbs:
  ip: 10.0.0.2 # BIND_IP from infra/.env.prod (VPS private IP the Compose DBs listen on)

# Optional overrides (defaults in values.yaml are sized for a 4 vCPU / 8 GB VPS):
# analytics:
#   autoscaling: { minReplicas: 2, maxReplicas: 6 }
# purchase:
#   env:
#     APPLE_BUNDLE_IDS: com.your.app
#     APPLE_APP_APPLE_ID: "123456789"
```

- [ ] **Step 6: `infra/helm/myampix/values.local.yaml`** (kind smoke test — Task 9 sets `hostDbs.ip` at runtime)

```yaml
# kind smoke test (scripts/k8s/local.sh). Images are built locally and `kind load`ed under these names.
image:
  owner: local
  tag: dev
  pullPolicy: IfNotPresent
  pullSecret: ""
hosts:
  api: api.local
  purchase: purchase.local
  app: app.local
ingress:
  className: nginx
tls:
  enabled: false
hostDbs:
  ip: 127.0.0.1 # overridden with --set hostDbs.ip=<host ip as seen from the kind node>
analytics:
  autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 2, targetCPUUtilizationPercentage: 70 }
  resources:
    requests: { cpu: 100m, memory: 192Mi }
    limits: { cpu: "1", memory: 512Mi }
purchase:
  api:
    autoscaling: { enabled: true, minReplicas: 1, maxReplicas: 2, targetCPUUtilizationPercentage: 70 }
    resources:
      requests: { cpu: 50m, memory: 128Mi }
      limits: { cpu: "1", memory: 384Mi }
  scheduler:
    resources:
      requests: { cpu: 50m, memory: 128Mi }
      limits: { cpu: 500m, memory: 384Mi }
dashboard:
  replicas: 1
  purchaseApiBaseUrl: http://purchase.local:8080
```

- [ ] **Step 7: Replace `scripts/k8s/lint.sh` with the full version**

```bash
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
```

- [ ] **Step 8: Add the CI job** — in `.github/workflows/ci.yml`:

(a) add an output + filter to the `changes` job:
```yaml
      k8s: ${{ steps.filter.outputs.k8s }}
```
and in `filters:`:
```yaml
            k8s:
              - 'infra/helm/**'
              - 'infra/k8s/**'
              - 'scripts/k8s/**'
              - '.github/workflows/ci.yml'
```
(b) append the job (after `sdk`):
```yaml
  k8s:
    name: Kubernetes — helm lint, kubeconform, invariants
    needs: changes
    if: needs.changes.outputs.k8s == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/setup-helm@v4
      - name: Install kubeconform
        run: |
          curl -sSL https://github.com/yannh/kubeconform/releases/latest/download/kubeconform-linux-amd64.tar.gz |
            sudo tar -xz -C /usr/local/bin kubeconform
      - name: Lint chart
        run: bash scripts/k8s/lint.sh
```

- [ ] **Step 9: `.gitignore`** — append:

```
# Kubernetes / VPS deploy — real secrets and per-environment values (NEVER commit)
infra/k8s/secrets/*
!infra/k8s/secrets/*.example
infra/values.prod.yaml
infra/.env.prod
!infra/.env.prod.example
```

- [ ] **Step 10: Verify**

Run: `pnpm k8s:lint`
Expected: helm lint ×2 OK, kubeconform summary with 0 invalid / 0 errors (prod: ClusterIssuer validated via the catalog), `lint.sh: OK`.
Run: `pnpm lint && pnpm format:check`
Expected: green (yaml and docs are prettier-ignored; no JS changed).

---

### Task 6: Host-DB Compose overlay, secret examples, `secrets.sh`, `deploy.sh`

**Files:**
- Create: `infra/docker-compose.prod.yml`, `infra/.env.prod.example`, `infra/k8s/secrets/analytics.env.example`, `infra/k8s/secrets/purchase.env.example`, `scripts/k8s/secrets.sh`, `scripts/k8s/deploy.sh`

**Interfaces:**
- Produces: Secrets `myampix-analytics`, `myampix-purchase`, `ghcr-pull` in namespace `myampix`; `deploy.sh <tag> [values]`.

- [ ] **Step 1: `infra/docker-compose.prod.yml`**

```yaml
# Production overlay for the host datastores on the VPS (k3s runs only the apps; see
# docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md §6 and docs/runbooks/vps-k3s.md).
# Usage:
#   docker compose --env-file infra/.env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --wait
# Differences from the dev file: ports bound to ${BIND_IP} only (the VPS private IP, reachable from the
# k3s pod network — never 0.0.0.0), real passwords from infra/.env.prod, restart policy, admin UIs off.
services:
  clickhouse:
    ports:
      - "${BIND_IP}:8123:8123"
      - "${BIND_IP}:9000:9000"
    environment:
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "clickhouse-client --user default --password \"$$CLICKHOUSE_PASSWORD\" --query 'SELECT 1'",
        ]
    restart: unless-stopped

  postgres:
    ports:
      - "${BIND_IP}:5432:5432"
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    restart: unless-stopped

  redis:
    ports:
      - "${BIND_IP}:6379:6379"
    restart: unless-stopped

  mobile-purchase-postgres:
    ports:
      - "${BIND_IP}:5433:5432"
    environment:
      POSTGRES_PASSWORD: ${MOBILE_PURCHASE_POSTGRES_PASSWORD}
    restart: unless-stopped

  # Admin UIs are dev conveniences — not started in prod unless you ask for the `debug` profile.
  adminer:
    profiles: ["debug"]
  ch-ui:
    profiles: ["debug"]
```

- [ ] **Step 2: `infra/.env.prod.example`**

```
# Copy to infra/.env.prod (gitignored) on the VPS. Used ONLY by docker compose --env-file for the
# host datastores (infra/docker-compose.prod.yml). The same passwords go into the k8s secret env files.
# VPS private IP the DB ports are bound to (e.g. 10.0.0.2). Must be reachable from the k3s pod CIDR.
BIND_IP=10.0.0.2
# openssl rand -base64 32  (for each)
POSTGRES_PASSWORD=CHANGE_ME
MOBILE_PURCHASE_POSTGRES_PASSWORD=CHANGE_ME
CLICKHOUSE_PASSWORD=CHANGE_ME
```

- [ ] **Step 3: `infra/k8s/secrets/analytics.env.example`**

```
# Secret env for mobile-analytics → Secret myampix-analytics (scripts/k8s/secrets.sh).
# Copy to analytics.env (gitignored), fill every CHANGE_ME. Hostnames are the in-cluster Service names
# rendered by the chart (same names as infra/docker-compose.yml). Non-secret vars live in the chart values.
# Schema: backend/mobile_analytics/src/config/app-config.ts

# Postgres (password = POSTGRES_PASSWORD from infra/.env.prod)
DATABASE_URL=postgresql://myampix:CHANGE_ME@postgres:5432/myampix
REDIS_URL=redis://redis:6379
# = CLICKHOUSE_PASSWORD from infra/.env.prod
CLICKHOUSE_PASSWORD=CHANGE_ME
# >= 32 chars each:  openssl rand -base64 48
JWT_ACCESS_SECRET=CHANGE_ME
JWT_REFRESH_SECRET=CHANGE_ME
# exactly 32 bytes, hex:  openssl rand -hex 32
TOTP_ENC_KEY=CHANGE_ME

# Optional — uncomment to enable:
# "Ask your data" (Mistral)
#MISTRAL_API_KEY=
# Screenshot storage bucket (needs GOOGLE_APPLICATION_CREDENTIALS mounted separately — not covered by the chart)
#FIREBASE_STORAGE_BUCKET=
```

- [ ] **Step 4: `infra/k8s/secrets/purchase.env.example`**

```
# Secret env for mobile-purchase → Secret myampix-purchase (scripts/k8s/secrets.sh).
# Copy to purchase.env (gitignored), fill every CHANGE_ME.
# Schema: backend/mobile_purchase/src/config/app-config.ts

# Own Postgres (password = MOBILE_PURCHASE_POSTGRES_PASSWORD from infra/.env.prod). Port 5433 = the host-published port.
DATABASE_URL=postgresql://mobile_purchase:CHANGE_ME@mobile-purchase-postgres:5433/mobile_purchase
# AES-256 key for App.storeCredentials, base64 of 32 bytes:  openssl rand -base64 32
STORE_CREDENTIALS_ENC_KEY=CHANGE_ME
# Google Pub/Sub push token (?token=…). Unset → every Google push is rejected.  openssl rand -hex 32
GOOGLE_PUBSUB_SHARED_SECRET=CHANGE_ME
```

- [ ] **Step 5: `scripts/k8s/secrets.sh`**

```bash
#!/usr/bin/env bash
# Creates/updates the MyAmpix Kubernetes Secrets from the gitignored env files (idempotent):
#   infra/k8s/secrets/analytics.env → Secret myampix-analytics
#   infra/k8s/secrets/purchase.env  → Secret myampix-purchase
#   $GHCR_USER + $GHCR_TOKEN         → docker-registry Secret ghcr-pull (skipped when unset)
# Usage: [NAMESPACE=myampix] [GHCR_USER=… GHCR_TOKEN=…] scripts/k8s/secrets.sh
# After rotating a value: re-run, then `kubectl -n myampix rollout restart deploy -l app.kubernetes.io/part-of=myampix`.
set -euo pipefail
NS="${NAMESPACE:-myampix}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/infra/k8s/secrets"

command -v kubectl >/dev/null || { echo "secrets.sh: kubectl not found" >&2; exit 1; }
kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"

for svc in analytics purchase; do
  f="$DIR/$svc.env"
  [ -f "$f" ] || { echo "secrets.sh: missing $f — copy $svc.env.example and fill it" >&2; exit 1; }
  if grep -q 'CHANGE_ME' "$f"; then echo "secrets.sh: $f still contains CHANGE_ME" >&2; exit 1; fi
  kubectl -n "$NS" create secret generic "myampix-$svc" --from-env-file="$f" \
    --dry-run=client -o yaml | kubectl apply -f -
done

if [ -n "${GHCR_USER:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  kubectl -n "$NS" create secret docker-registry ghcr-pull \
    --docker-server=ghcr.io --docker-username="$GHCR_USER" --docker-password="$GHCR_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
else
  echo "secrets.sh: GHCR_USER/GHCR_TOKEN not set — skipping ghcr-pull (fine if the GHCR packages are public; then set image.pullSecret: \"\")"
fi
echo "secrets.sh: done (namespace $NS)"
```

- [ ] **Step 6: `scripts/k8s/deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploy/upgrade MyAmpix on the cluster your kubeconfig points at.
# Usage: scripts/k8s/deploy.sh <image-tag> [values-file]
#   e.g. scripts/k8s/deploy.sh sha-1a2b3c4          (values: infra/values.prod.yaml)
# Runs the migrate hook Jobs first, then rolls the Deployments; on ANY failure the release is rolled
# back to the previous revision (--atomic on Helm 3, --rollback-on-failure on Helm 4).
set -euo pipefail
TAG="${1:?usage: deploy.sh <image-tag> [values-file]}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALUES="${2:-$ROOT/infra/values.prod.yaml}"
NS="${NAMESPACE:-myampix}"
RELEASE="${RELEASE:-myampix}"

for t in helm kubectl; do command -v "$t" >/dev/null || { echo "deploy.sh: missing $t" >&2; exit 1; }; done
[ -f "$VALUES" ] || { echo "deploy.sh: values file $VALUES not found (copy infra/helm/myampix/values.prod.example.yaml)" >&2; exit 1; }

major="$(helm version --template '{{.Version}}' | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$major" -ge 4 ]; then ROLLBACK_FLAG=--rollback-on-failure; else ROLLBACK_FLAG=--atomic; fi

echo "deploy.sh: release=$RELEASE ns=$NS tag=$TAG values=$VALUES"
helm upgrade --install "$RELEASE" "$ROOT/infra/helm/myampix" \
  -n "$NS" --create-namespace -f "$VALUES" --set image.tag="$TAG" \
  "$ROLLBACK_FLAG" --wait --timeout 10m
echo
kubectl -n "$NS" get deploy,hpa,ingress
```

Run: `chmod +x scripts/k8s/secrets.sh scripts/k8s/deploy.sh`

- [ ] **Step 7: Verify**

Run: `docker compose --env-file infra/.env.prod.example -f infra/docker-compose.yml -f infra/docker-compose.prod.yml config | grep -E 'published|restart: unless-stopped' | head -12`
Expected: `published: "5432"` etc. with `host_ip: 10.0.0.2` lines nearby, and 4× `restart: unless-stopped`. (`config` only renders — nothing starts.)
Run: `docker compose --env-file infra/.env.prod.example -f infra/docker-compose.yml -f infra/docker-compose.prod.yml config --services`
Expected: `clickhouse mobile-purchase-postgres postgres redis` (adminer/ch-ui absent — profile gated).
Run: `bash -n scripts/k8s/secrets.sh && bash -n scripts/k8s/deploy.sh && git check-ignore -q infra/k8s/secrets/analytics.env infra/.env.prod infra/values.prod.yaml && ! git check-ignore -q infra/k8s/secrets/analytics.env.example infra/.env.prod.example && echo gitignore-ok`
Expected: `gitignore-ok`.

---

### Task 7: Dashboard image (nginx-unprivileged + runtime `config.js`)

**Files:**
- Create: `dashboard/Dockerfile`, `dashboard/Dockerfile.dockerignore`, `dashboard/nginx/default.conf.template`, `dashboard/nginx/config.js.template`

**Interfaces:**
- Produces: image listening on **8080** as uid 101; env `API_BASE_URL`, `PURCHASE_API_BASE_URL` → `/config.js`; `/healthz` → 200. Matches Task 5's Deployment.

- [ ] **Step 1: `dashboard/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
# MyAmpix dashboard image — static Vite build served by nginx (unprivileged, :8080).
# Build context is the REPO ROOT (pnpm workspace). Runtime config (backend origins) is NOT baked in:
# the nginx entrypoint renders /config.js from API_BASE_URL / PURCHASE_API_BASE_URL at container start
# (dashboard/src/lib/config.ts reads window.___MYAMPIX_CONFIG__ from /config.js).

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /app
# Workspace manifests so the lockfile importers resolve; only the dashboard's deps are installed.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY backend/mobile_analytics/package.json backend/mobile_analytics/package.json
COPY backend/mobile_purchase/package.json backend/mobile_purchase/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY dashboard dashboard
RUN pnpm install --frozen-lockfile --filter @myampix/dashboard...
RUN pnpm --filter @myampix/dashboard build

# ---------- runtime ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Templates are rendered by the image's entrypoint (envsubst) into /etc/nginx/conf.d/ at start.
COPY dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY dashboard/nginx/config.js.template /etc/nginx/templates/config.js.template
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html
# Only these two variables are substituted — nginx's own $uri/$host etc. are left alone.
ENV NGINX_ENVSUBST_FILTER='^(API_BASE_URL|PURCHASE_API_BASE_URL)$' \
    API_BASE_URL="" \
    PURCHASE_API_BASE_URL=""
EXPOSE 8080
```

- [ ] **Step 2: `dashboard/Dockerfile.dockerignore`**

```
# Ignore patterns for dashboard/Dockerfile (build context = repo root, so patterns are root-relative).
**/node_modules
**/dist
**/coverage
**/.env
**/.env.*
!**/.env.example
dashboard/e2e
dashboard/e2e-functional
dashboard/test-results
dashboard/playwright-report
**/*.test.ts
**/*.test.tsx
.git
**/.DS_Store
```

- [ ] **Step 3: `dashboard/nginx/default.conf.template`**

```nginx
# Rendered to /etc/nginx/conf.d/default.conf by the nginx entrypoint (only $API_BASE_URL and
# $PURCHASE_API_BASE_URL are substituted, see NGINX_ENVSUBST_FILTER in the Dockerfile).
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;
  gzip_min_length 1024;

  # Kubernetes probes.
  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 'ok';
  }

  # Runtime config rendered from env at container start (overrides the dev public/config.js in dist/).
  location = /config.js {
    alias /etc/nginx/conf.d/config.js;
    default_type application/javascript;
    add_header Cache-Control "no-store";
  }

  # Hashed Vite assets: cache forever.
  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  # SPA fallback; index.html must always be revalidated so a new deploy is picked up.
  location / {
    add_header Cache-Control "no-cache";
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 4: `dashboard/nginx/config.js.template`**

```javascript
// MyAmpix runtime configuration — rendered from the container environment at start.
// '' = same origin (the app host proxies /api and /ingest to the analytics backend).
window.___MYAMPIX_CONFIG__ = {
  apiBaseUrl: '${API_BASE_URL}',
  purchaseApiBaseUrl: '${PURCHASE_API_BASE_URL}',
};
```

- [ ] **Step 5: Build and test the image**

Run:
```bash
docker build -f dashboard/Dockerfile -t myampix-dashboard:test . &&
docker run -d --rm --name dash-test -p 18080:8080 -e API_BASE_URL= -e PURCHASE_API_BASE_URL=https://purchase.example.com myampix-dashboard:test &&
sleep 2 &&
curl -fsS localhost:18080/healthz && echo &&
curl -fsS localhost:18080/config.js &&
curl -fsS localhost:18080/ | grep -q '<div id="root">' && echo "spa ok" &&
curl -fsS localhost:18080/some/deep/route | grep -q '<div id="root">' && echo "fallback ok" &&
docker exec dash-test id -u &&
docker stop dash-test
```
Expected: `ok`, a `config.js` containing `apiBaseUrl: ''` and `purchaseApiBaseUrl: 'https://purchase.example.com'`, `spa ok`, `fallback ok`, uid `101`.
If `pnpm install --frozen-lockfile` complains about the lockfile not matching the workspace, change the Dockerfile to `COPY packages/contracts packages/contracts` (full dir, as the backend Dockerfiles do) and rebuild.

---

### Task 8: Image CI → GHCR

**Files:**
- Create: `.github/workflows/images.yml`

**Interfaces:**
- Produces: `ghcr.io/<owner>/myampix-{mobile-analytics,mobile-purchase,mobile-purchase-migrate,dashboard}:{sha-<7>,latest,vX.Y.Z}` consumed by `image.owner`/`image.tag`.

- [ ] **Step 1: Create the workflow**

```yaml
name: Images

# Builds the four deployable images and pushes them to GHCR. Deploys are manual:
#   scripts/k8s/deploy.sh sha-<7>   (tag printed in the job summary)
on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

concurrency:
  group: images-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read
  packages: write

jobs:
  build:
    name: ${{ matrix.name }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: mobile-analytics
            dockerfile: backend/mobile_analytics/Dockerfile
            target: runtime
          - name: mobile-purchase
            dockerfile: backend/mobile_purchase/Dockerfile
            target: runtime
          - name: mobile-purchase-migrate
            dockerfile: backend/mobile_purchase/Dockerfile
            target: migrate
          - name: dashboard
            dockerfile: dashboard/Dockerfile
            target: runtime
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/myampix-${{ matrix.name }}
          tags: |
            type=sha,prefix=sha-
            type=ref,event=tag
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          target: ${{ matrix.target }}
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
      - name: Summary
        run: |
          {
            echo "### ${{ matrix.name }}"
            echo '```'
            echo "${{ steps.meta.outputs.tags }}"
            echo '```'
            echo "Deploy: \`scripts/k8s/deploy.sh sha-$(git rev-parse --short=7 HEAD)\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 2: Verify**

Run: `python3 -c "import yaml" 2>/dev/null && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/images.yml')); print('yaml ok')" || npx --yes yaml@2 lint .github/workflows/images.yml 2>/dev/null || echo "no yaml parser available — rely on the visual check"`
Expected: `yaml ok` (or the fallback message). Also eyeball: 4 matrix entries, `packages: write`, `context: .`.

---

### Task 9: kind smoke test (`scripts/k8s/local.sh`) — run it

**Files:**
- Create: `scripts/k8s/local.sh`
- Modify: `backend/mobile_purchase/Dockerfile` (migrate stage: `RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*` right after `ENV NODE_ENV=production` — without it the Prisma CLI misdetects `openssl-1.1.x`, misses the bundled `openssl-3.0.x` schema engine and tries to download one into root-owned `node_modules`, which fails as a non-root Job)

**Interfaces:**
- Consumes: chart + `values.local.yaml` (Task 5), images built from the three Dockerfiles.

- [ ] **Step 1: Create `scripts/k8s/local.sh`**

```bash
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
  kind create cluster --name "$CLUSTER" --config=- <<EOF
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
EOF
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
fi

step "verify the analytics image's app uid matches values.yaml (runAsUser: 999)"
uid="$(docker run --rm --entrypoint id "$IMG_PREFIX-mobile-analytics:$TAG" -u)"
[ "$uid" = "999" ] || { echo "local.sh: analytics image runs as uid $uid, chart expects 999 — update analytics.runAsUser" >&2; exit 1; }

step "load images into kind"
kind load docker-image --name "$CLUSTER" \
  "$IMG_PREFIX-mobile-analytics:$TAG" "$IMG_PREFIX-mobile-purchase:$TAG" \
  "$IMG_PREFIX-mobile-purchase-migrate:$TAG" "$IMG_PREFIX-dashboard:$TAG"

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
for d in mobile-analytics mobile-purchase-api mobile-purchase-scheduler dashboard; do
  kubectl -n "$NS" rollout status "deploy/$d" --timeout=120s >/dev/null || fail "deploy/$d not available"
done
BASE="http://localhost:$HTTP_PORT"
# ingress-nginx picks up freshly-Ready endpoints with a short lag; give it a few seconds before asserting.
for _ in $(seq 1 30); do
  curl -fsS -H 'Host: api.local' "$BASE/health/ready" >/dev/null 2>&1 && break; sleep 1
done
curl -fsS -H 'Host: api.local' "$BASE/health/ready" | grep -q '"status":"ready"' || fail "api.local /health/ready"
curl -fsS -H 'Host: purchase.local' "$BASE/health/ready" | grep -q '"status":"ready"' || fail "purchase.local /health/ready"
curl -fsS -H 'Host: app.local' "$BASE/" | grep -q '<div id="root">' || fail "app.local SPA shell"
curl -fsS -H 'Host: app.local' "$BASE/config.js" | grep -q "purchaseApiBaseUrl: 'http://purchase.local:8080'" || fail "app.local runtime config.js"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Host: app.local' "$BASE/api/v1/auth/refresh")"
[ "$code" = "401" ] || fail "app.local/api should proxy to analytics (got HTTP $code, expected 401)"
kubectl -n "$NS" get hpa >/dev/null || fail "HPAs missing"

printf '\n\033[1;32mSMOKE OK\033[0m  (cluster %s kept; `pnpm k8s:local down` to delete)\n' "$CLUSTER"
kubectl -n "$NS" get pods,hpa,ingress
```

Run: `chmod +x scripts/k8s/local.sh`

- [ ] **Step 2: Start the dev DB stack and run the smoke test**

Run: `pnpm infra:up && pnpm k8s:local`
Expected: ends with `SMOKE OK`. Image builds take several minutes the first time (argon2 compiles in the analytics builder).

Known adjustments if an assertion fails:
- analytics uid ≠ 999 → set `analytics.runAsUser/runAsGroup` in `values.yaml` to the printed uid and update the `runAsUser: 999` assertion in `lint.sh` and the Global Constraints note.
- a serving pod crashloops with `EROFS`/`read-only file system` → that container needs another `emptyDir` at the printed path; add it to the Deployment template (keep `readOnlyRootFilesystem: true`).
- `api.local /health/ready` 503 → ClickHouse/Redis/Postgres unreachable from the kind node: check `HOST_IP` and that `pnpm infra:up` is healthy (`docker compose -f infra/docker-compose.yml ps`).

- [ ] **Step 3: Verify rollback-on-failure once** (hook failure must not roll anything out)

Run: `helm upgrade myampix infra/helm/myampix -n myampix -f infra/helm/myampix/values.local.yaml --set hostDbs.ip=$(docker exec myampix-smoke-control-plane getent hosts host.docker.internal | awk '{print $1}') --set image.tag=does-not-exist --wait --timeout 3m $( [ "$(helm version --template '{{.Version}}' | cut -c2)" -ge 4 ] && echo --rollback-on-failure || echo --atomic ); echo "exit=$?"; kubectl -n myampix get deploy mobile-analytics -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'`
Expected: non-zero exit (hook job `ErrImagePull` → deadline/failed), and the printed image is still `ghcr.io/local/myampix-mobile-analytics:dev` (no rollout happened).

---

### Task 10: Operator runbook

**Files:**
- Create: `docs/runbooks/vps-k3s.md`

- [ ] **Step 1: Write the runbook** (copy-pasteable; every command is real)

````markdown
# Runbook — MyAmpix on a VPS with k3s

Design: `docs/superpowers/specs/2026-08-23-kubernetes-vps-deploy-design.md`. Everything below is done by hand,
once per VPS, in order. Commands assume Ubuntu 24.04, a sudo user, and the repo cloned at `~/MyAmpix`.

## 0. What you end up with

- Docker Compose on the host runs Postgres ×2, ClickHouse, Redis (bound to the VPS private IP).
- k3s runs `mobile-analytics` (HPA 2–6), `mobile-purchase-api` (HPA 2–4), `mobile-purchase-scheduler` (1),
  `dashboard` (2), behind Traefik with Let's Encrypt certificates for `api.`, `purchase.`, `app.<domain>`.
- Deploys: `scripts/k8s/deploy.sh <tag>` (migrations run first; automatic rollback on failure).

Minimum VPS: 4 vCPU, 8 GB RAM, 80 GB SSD. DNS: A records for the three hosts → the VPS public IP.

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
# Fill every CHANGE_ME (generators are in the comments; DB passwords = the ones in infra/.env.prod).
# GHCR pull credentials: a GitHub PAT (classic) with read:packages — skip if your packages are public.
GHCR_USER=<github-user> GHCR_TOKEN=<pat> scripts/k8s/secrets.sh
kubectl -n myampix get secrets
```

## 6. Values

```bash
cp infra/helm/myampix/values.prod.example.yaml infra/values.prod.yaml   # gitignored
# set image.owner (lowercase GitHub user/org), hosts.*, tls.email, hostDbs.ip (= BIND_IP)
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
````

- [ ] **Step 2: Verify** — `wc -l docs/runbooks/vps-k3s.md` < 500; every script path mentioned exists (`ls scripts/k8s/*.sh infra/k8s/secrets/*.example infra/helm/myampix/values.prod.example.yaml`).

---

### Task 11: Final verification

- [ ] **Step 1:** `pnpm k8s:lint` → OK.
- [ ] **Step 2:** `pnpm lint && pnpm format:check` → green.
- [ ] **Step 3:** `SKIP_BUILD=1 pnpm k8s:local` → `SMOKE OK` (re-run after any template fix); then `pnpm k8s:local down`.
- [ ] **Step 4:** `git status --short` — confirm no `*.env` / `values.prod.yaml` / secrets show up; only the intended new files.
- [ ] **Step 5:** `graphify update .` (keeps the knowledge graph current, per CLAUDE.md).

---

## Self-review against the spec

- §1 topology → Tasks 2–5 (Services/Ingresses), Task 6 (host binding). ✔
- §2 layout → every listed file has a task; `infra/k8s/secrets/README.md` was dropped (the `.example` headers carry the same three lines — YAGNI). ✔
- §3 workloads (probes, preStop, RO fs, UIDs, HPA, PDB, Recreate scheduler, dashboard envsubst) → Tasks 3–5, 7. ✔
- §4 hooks → Tasks 3/4 Jobs, rollback proven in Task 9 Step 3. ✔
- §5 config/secrets → ConfigMaps + `envFrom` Secrets (Tasks 3–5), `secrets.sh` + examples (Task 6), no rendered Secret (lint assertion). ✔
- §6 host DBs → Task 2 (EndpointSlices), Task 6 (overlay, ufw in runbook). ✔
- §7 ingress/TLS → Tasks 3/4/5 Ingresses, ClusterIssuer (Task 2), redirect via HelmChartConfig (runbook §4). ✔
- §8 CI → Task 5 (`k8s` job), Task 8 (`images.yml`). ✔
- §9 testing → Task 5 (lint/kubeconform/assertions), Task 9 (kind smoke), Task 7 (image test). ✔
- §10 runbook → Task 10. ✔
- §11 deferred → untouched by design.
