# MyAmpix — Admin/Ops Console (`admin/`) — Design

**Date:** 2026-08-24
**Status:** Approved design (stack + docker.sock + no-TOTP confirmed by the operator; details below proceed under stated defaults)
**Relates to:** `2026-08-23-kubernetes-vps-deploy-design.md` (deploys as a new chart component on the same k3s VPS; distinct from the product dashboard).
**Goal:** A second, operations-focused admin interface — server status, Docker containers, CPU/RAM, Kubernetes workloads, datastore health — reachable from the public internet at `admin.<domain>`, protected by a complete, self-contained authentication and session system backed by Postgres. No public registration; a seeded default account; user management inside the app.

---

## §0. Constraints & decisions

- **Stack: Next.js (App Router)** — operator's choice. New top-level workspace package `admin/` (`@myampix/admin`), TypeScript, React, Tailwind CSS v4, Prisma. `output: 'standalone'` for the Docker image. Everything else follows repo conventions (pnpm workspace, argon2, zod, Prisma-per-service with package-local client output, values-gated Helm component).
- **Docker visibility: hostPath `/var/run/docker.sock`, read-only, values-gated** (`admin.dockerSock.enabled`). Accepted risk (root-equivalent socket) on the operator's single-node cluster; off in the kind smoke test (kind nodes run containerd, no dockerd socket).
- **TOTP 2FA: deferred** (follow-up; the analytics backend's TOTP stack is the porting source).
- **Own database `admin_console`** on the existing host Postgres instance (same server as `myampix`). Rationale: two independent Prisma migration histories cannot share a database (`_prisma_migrations` collides). The migrate job bootstraps the database idempotently (the Compose `POSTGRES_USER` is superuser).
- **No public registration.** Accounts exist only via the seeded default or in-app creation by an existing admin.
- **Secrets never in git**; all sensitive env via the `myampix-admin` Secret (example file + `secrets.sh`).
- **Read-only against the cluster**: the ServiceAccount can get/list/watch, never mutate. The console displays; it does not operate (no restart/scale buttons in v1 — explicit follow-up, needs write RBAC and CSRF-hardened confirmation flows).
- Files < 500 lines; user commits; no co-author trailers.

## §1. Package layout (`admin/`)

```
admin/
  package.json            @myampix/admin — next, react, react-dom, @prisma/client, prisma, argon2, zod,
                          pg, @clickhouse/client, ioredis, undici, tailwindcss, vitest (+ @testing-library later)
  next.config.ts          output:'standalone'; security headers (§6); typedRoutes
  tsconfig.json
  postcss.config.mjs / src/app/globals.css     Tailwind v4 (@import "tailwindcss")
  vitest.config.ts
  prisma/schema.prisma    output ../generated/client (gitignored like purchase's)
  prisma/migrations/…
  scripts/migrate.mjs     bootstrap DB if missing → prisma migrate deploy → seed default admin if users table empty
  src/middleware.ts       cookie-presence gate → /login redirect (cheap; real validation server-side per request)
  src/lib/
    env.ts                zod-validated process.env → typed config (fail fast, aggregated errors)
    db.ts                 PrismaClient singleton
    password.ts           argon2id hash/verify + zod password policy (≥12 chars)
    session.ts            create/validate/touch/revoke sessions; cookie serialization (__Host-admx / admx)
    auth.ts               requireSession()/requireFreshPassword() server helpers; login/lockout logic
    origin.ts             assertSameOrigin(request) for mutating route handlers
    audit.ts              writeAudit(action, actor, detail, ip)
    kube.ts               minimal in-cluster k8s REST client (SA token + CA); typed mappers
    docker.ts             undici Client over unix socket; list containers + one-shot stats; mappers
    datastores.ts         pg / clickhouse / redis probes (ping, sizes, counts) with per-probe timeouts
  src/app/
    login/page.tsx        login form (server action)
    (auth)/layout.tsx     session-required shell: nav, user menu, must-change-password gate
    (auth)/page.tsx       Overview
    (auth)/kubernetes/page.tsx
    (auth)/docker/page.tsx
    (auth)/datastores/page.tsx
    (auth)/users/page.tsx
    (auth)/audit/page.tsx
    (auth)/account/page.tsx     my sessions + change password
    api/admin/…/route.ts  JSON endpoints polled by the client components (status, k8s, docker, datastores)
  Dockerfile + Dockerfile.dockerignore
```

`pnpm-workspace.yaml` gains `- admin`; root `.gitignore` gains `admin/generated/` and `admin/.next/`.

## §2. Data model (Prisma, database `admin_console`)

```prisma
model AdminUser {
  id                 String    @id @default(cuid())
  email              String    @unique
  displayName        String
  passwordHash       String
  disabled           Boolean   @default(false)
  mustChangePassword Boolean   @default(false)
  failedLoginCount   Int       @default(0)
  lockedUntil        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  createdById        String?
  sessions           AdminSession[]
  auditEvents        AdminAuditEvent[]
}
model AdminSession {
  id                String    @id @default(cuid())
  tokenHash         String    @unique          // sha256(token); raw token only ever in the cookie
  user              AdminUser @relation(...)
  userId            String
  createdAt         DateTime  @default(now())
  lastSeenAt        DateTime  @default(now())  // touched at most every 5 min
  idleExpiresAt     DateTime                    // lastSeenAt + 12h
  absoluteExpiresAt DateTime                    // createdAt + 7d
  revokedAt         DateTime?
  ip                String
  userAgent         String
}
model AdminLoginAttempt {                       // brute-force window, works across replicas
  id      String   @id @default(cuid())
  at      DateTime @default(now())
  email   String                                // as submitted (lowercased)
  ip      String
  success Boolean
  @@index([email, at])
  @@index([ip, at])
}
model AdminAuditEvent {
  id      String   @id @default(cuid())
  at      DateTime @default(now())
  actor   AdminUser? @relation(...)
  actorId String?
  action  String                                // login.success login.fail login.locked logout logout_all
                                                // user.create user.disable user.enable user.reset_password
                                                // password.change session.revoke
  detail  Json
  ip      String
  @@index([at])
}
```

## §3. Authentication & session rules (the security contract)

1. **Login** (`POST` server action on /login): lowercase email → attempt-window check → user lookup → `argon2.verify` (a dummy verify runs when the user doesn't exist, so timing doesn't leak existence) → disabled/locked checks → success creates a session + resets `failedLoginCount`. Every attempt (success or fail) writes `AdminLoginAttempt` + audit.
2. **Lockout:** ≥5 failures for one email in 15 min → account locked 15 min (`lockedUntil`). ≥10 failures from one IP in 15 min → that IP refused for 15 min. Responses are the same generic "invalid credentials or temporarily locked" — no oracle. Attempt rows older than 24 h are deleted opportunistically on insert.
3. **Session token:** 32 random bytes (base64url) generated with `crypto.randomBytes`; DB stores only `sha256(token)`. Cookie `__Host-admx` (prod: Secure, httpOnly, SameSite=Lax, Path=/ — the `__Host-` prefix pins host+path+secure) / `admx` in dev (`COOKIE_SECURE=false`).
4. **Validation on every request** (server components + API routes via `requireSession()`): token → hash → lookup; reject if revoked, idle-expired, or absolute-expired; `lastSeenAt`/`idleExpiresAt` touched only when >5 min stale (write-throttling).
5. **Logout** revokes the session; **logout-all** revokes all the user's sessions; `/account` lists active sessions (created, last seen, IP, UA) with per-session revoke.
6. **CSRF:** SameSite=Lax cookie + `assertSameOrigin` (Origin — falling back to Referer — must match the request Host) on every mutating route handler; Server Actions additionally carry Next's built-in origin enforcement. No state-changing GETs.
7. **Password policy:** ≥12 chars (zod). Change-password requires the current password and revokes all *other* sessions. `mustChangePassword` blocks every authenticated page/route except `/account` password change + logout (enforced in `(auth)/layout.tsx`).
8. **Seeded default account:** `scripts/migrate.mjs` — after `prisma migrate deploy`, iff `AdminUser` is empty, create `ADMIN_DEFAULT_EMAIL` with `ADMIN_DEFAULT_PASSWORD` (argon2) and `mustChangePassword: true`. Idempotent; never touches a non-empty table (so deleting the default later is safe). The runbook tells the operator to log in and rotate immediately.
9. **User management** (any active admin — single role in v1, all users are admins): create (with generated or supplied temp password, `mustChangePassword: true`), disable (revokes all their sessions), enable, reset password (revokes sessions, sets `mustChangePassword`). A user cannot disable themselves; the last enabled user cannot be disabled.
10. **Audit:** every action in §2's `action` list, with actor, IP, UA and detail; `/audit` renders the latest 200 with filters.

## §4. Monitoring data sources

| Page | Source | Detail |
|---|---|---|
| Overview | `metrics.k8s.io/v1beta1/nodes`, `/api/v1/nodes`, kubelet `stats/summary` via API-server proxy | per-node CPU/RAM usage vs allocatable, filesystem used/capacity, node conditions, kubelet/k8s version, uptime |
| Overview | in-cluster `GET http://mobile-analytics:8088/health/ready`, `http://mobile-purchase-api:8090/health/ready` | service tiles show each dependency check (postgres/clickhouse/redis) |
| Kubernetes | `apps/v1` deployments, `v1` pods, `batch/v1` jobs, `autoscaling/v2` HPAs, `v1` events (Warning), `cert-manager.io/v1` certificates (404-tolerant), `metrics.k8s.io` pods | ready/desired, restarts, per-pod CPU/RAM, HPA target vs current, recent migrate jobs, cert expiries |
| Docker | unix socket via undici: `/containers/json?all=1`, `/containers/{id}/stats?stream=false&one-shot=true` (parallel, capped) | name, image, state, status, started, per-container CPU% ((cpu_delta/system_delta)×online_cpus) and memory usage/limit. Absent socket → page shows "socket not mounted" state |
| Datastores | `pg` (both DATABASE URLs): `SELECT 1`, `pg_database_size`, `numbackends`, version; `@clickhouse/client`: ping, `system.disks`, top `system.parts` table sizes, version; `ioredis`: `PING`, `INFO memory`, `DBSIZE` | every probe has a 2.5 s timeout and independent failure (one dead store never blanks the page) |

The in-cluster k8s client (`src/lib/kube.ts`) is hand-rolled: reads `/var/run/secrets/kubernetes.io/serviceaccount/{token,ca.crt}`, targets `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`, re-reads the token when stale (BoundServiceAccountToken rotation), typed mappers per resource. No client library dependency.

All four data endpoints are `GET /api/admin/{status,kubernetes,docker,datastores}` route handlers guarded by `requireSession()`; client components poll them every 10 s (visibilitychange-paused).

## §5. Environment (validated in `src/lib/env.ts`)

Secret (`infra/k8s/secrets/admin.env.example` → Secret `myampix-admin`): `DATABASE_URL` (…@postgres:5432/admin_console), `ANALYTICS_DATABASE_URL`, `PURCHASE_DATABASE_URL`, `CLICKHOUSE_PASSWORD`, `REDIS_URL`, `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_PASSWORD`.
ConfigMap: `CLICKHOUSE_URL=http://clickhouse:8123`, `CLICKHOUSE_USER`, `ANALYTICS_INTERNAL_URL=http://mobile-analytics:8088`, `PURCHASE_INTERNAL_URL=http://mobile-purchase-api:8090`, `DOCKER_SOCK=/var/run/docker.sock` (empty ⇒ feature off), `COOKIE_SECURE=true`, `SESSION_IDLE_HOURS=12`, `SESSION_ABSOLUTE_DAYS=7`, `NODE_ENV=production`, `PORT=3000`.

## §6. Hardening

- Headers on every response (next.config): CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'` (Next requires inline for hydration in v1 — nonce-based CSP is a follow-up), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Runs as non-root (uid 1001) with `readOnlyRootFilesystem` (+ emptyDir `/tmp` and `.next/cache` disabled via `distDir` config… `standalone` server needs no writable dirs beyond /tmp).
- `automountServiceAccountToken: true` **only** for this Deployment, bound to a dedicated ServiceAccount with the read-only ClusterRole of §4 (and `nodes/proxy` get for stats/summary).
- docker.sock hostPath mounted read-only; `admin.dockerSock.enabled=false` turns both mount and feature off.
- TLS + HTTP→HTTPS as everywhere (cert-manager/Traefik). Cookie is `__Host-`-pinned.
- The console has no CORS surface (same-origin only, no `Access-Control-Allow-*`).

## §7. Deployment (chart additions)

`admin-{configmap,deployment,service,ingress,migrate-job,rbac}.yaml`, gated by `admin.enabled`:
- **rbac**: ServiceAccount `myampix-admin`, ClusterRole (get/list/watch: nodes, nodes/proxy, pods, events, namespaces; apps: deployments, replicasets; batch: jobs; autoscaling: hpas; cert-manager.io: certificates; metrics.k8s.io: nodes, pods), ClusterRoleBinding.
- **deployment**: image `myampix-admin`, port 3000, probes `GET /api/healthz` (unauthenticated liveness/readiness route returning 200 + DB ping for readiness), HPA-less (replicas value, default 1 — session writes are shared-DB so >1 is safe), docker.sock hostPath when enabled, SA token mounted.
- **migrate-job**: image `myampix-admin-migrate` (Dockerfile `migrate` target: node + prisma CLI + `scripts/migrate.mjs`), same pre-install/pre-upgrade hook pattern + `hostAliases`.
- **ingress**: `admin.<domain>` (`hosts.admin` value) + TLS secret, same issuer.
- values: `admin.{enabled,replicas,resources,runAsUser,secretName,dockerSock.enabled,env}` in `values.yaml`, prod example, local (dockerSock disabled).
- `images.yml`: two matrix entries (`admin` target runner, `admin-migrate` target migrate). `ci.yml`: `admin` job (lint/typecheck/test, path-filtered). `lint.sh`: assertions (RBAC read-only verbs, no Secret rendered, docker.sock absent when disabled). `local.sh`: build+load both admin images, create throwaway `myampix-admin` secret, assert login page 200 via ingress + authenticated status API round-trip with the seeded account.

## §8. Testing

- **Unit (vitest, mock-first):** password policy + hash/verify; session lifecycle (issue → validate → idle-expiry → absolute-expiry → revoke → touch-throttle) against a mock Prisma; lockout windows (email + IP); `assertSameOrigin`; docker stats math; k8s mappers on fixture JSON; env validation failure aggregation.
- **Smoke (kind):** seeded login via `POST` to the login action is brittle from curl — instead the smoke test asserts: `/login` serves 200 through the ingress; `/` unauthenticated redirects (307) to `/login`; `/api/admin/status` unauthenticated → 401; then a scripted login using the seeded credentials via the JSON login route (`POST /api/auth/login`, which the login page's server action shares logic with — the route exists precisely so ops can script a health login) → sets cookie → `/api/admin/status` 200 with node metrics present.
- **CI:** `admin` job runs `pnpm --filter @myampix/admin lint? typecheck, test, build`.

## §9. Out of scope / follow-ups

TOTP 2FA (port from analytics), operational actions (restart deployment, scale — needs write RBAC + confirmation UX), nonce-based CSP, WebAuthn, e-mail for password resets (no SMTP in stack), Prometheus-backed history charts (console shows live state only; history belongs to the deferred Prometheus item of the k8s spec §11), IP allowlisting at Traefik.
