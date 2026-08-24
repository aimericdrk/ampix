# Admin/Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `admin/` — a Next.js App Router ops console (auth + sessions in Postgres, k8s/docker/datastore monitoring) and wire it into the Helm chart, CI, and images pipeline.

**Architecture:** One workspace package `admin/`; Prisma → own `admin_console` DB; custom cookie-session auth (spec §3 is the contract); four polled JSON endpoints backed by `lib/{kube,docker,datastores}.ts`; standalone Docker image + `migrate` image; chart component `admin` with read-only RBAC.

**Tech Stack:** Next.js (App Router, standalone), React, Tailwind v4, Prisma, argon2, zod, pg, @clickhouse/client, ioredis, undici, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-admin-console-design.md` — every §3 numbered rule is a requirement; the executor re-reads it per task.

## Global Constraints

- User commits; never commit; no secrets in git; files <500 lines.
- Package name `@myampix/admin`; image names `myampix-admin`, `myampix-admin-migrate`; Secret `myampix-admin`; host value `hosts.admin`.
- Cookie `__Host-admx` (secure) / `admx` (dev). Session: sha256 token hash, idle 12 h, absolute 7 d, 5-min touch throttle.
- Lockout: 5/email + 10/IP per 15 min, 15-min lock, generic error message.
- All mutating route handlers call `assertSameOrigin`; no state-changing GETs.
- `pnpm --filter @myampix/admin test|typecheck|build` must pass at the end of every task that touches `admin/`.

### Task 1: Package scaffold + env + Prisma schema/migration
`pnpm-workspace.yaml` +`- admin`; `.gitignore` +`admin/generated/`; create package.json (scripts: dev/build/start/typecheck/test/prisma; `prepare: prisma generate`), next.config.ts (standalone + §6 headers), tsconfig, Tailwind v4 wiring, vitest.config.ts (node env, `src/**/*.test.ts`), `src/lib/env.ts` (zod schema per spec §5, aggregated errors, test), `prisma/schema.prisma` exactly per spec §2 (client output `../generated/client`), first migration generated with `prisma migrate dev` against a throwaway `admin_console` DB on the local Compose Postgres. Verify: install, typecheck, env test green.

### Task 2: Password + session + origin + audit libs (TDD)
`src/lib/password.ts` (argon2id, `passwordSchema` ≥12), `src/lib/session.ts` (createSession/validateSessionToken/touch/revoke/revokeAll; cookie (de)serialization helpers; expiry math pure + tested), `src/lib/origin.ts` (`assertSameOrigin(req)` Origin→Referer fallback vs Host), `src/lib/audit.ts`. Tests: policy edges; token→hash roundtrip; idle/absolute expiry; revoked rejection; touch throttle (no write <5 min); origin accept/reject matrix (missing origin on mutating = reject).

### Task 3: Login/lockout + auth helpers + auth routes
`src/lib/auth.ts`: `attemptLogin(email, password, ip, ua)` implementing spec §3.1–2 (dummy-verify timing guard, window queries on AdminLoginAttempt, lockedUntil, audit writes, opportunistic cleanup); `requireSession()` (reads cookie via `next/headers`, validates, returns {user, session} or throws redirect/401 per context); `POST /api/auth/login` (JSON; shares attemptLogin; sets cookie), `POST /api/auth/logout`, `POST /api/auth/logout-all`, `GET /api/healthz` (200 + readiness DB ping ?ready=1). Tests: lockout matrices (5th fail locks, success resets, IP window), disabled-user, generic error strings.

### Task 4: Middleware + login page + authed shell
`src/middleware.ts` (cookie presence → redirect `/login`, matcher excludes `/login`, `/api/auth/login`, `/api/healthz`, `_next`, favicon). `/login` page (server action calling attemptLogin; generic failure; redirects to `/`). `(auth)/layout.tsx`: `requireSession()`; must-change-password gate (redirect to `/account?pw=1` for every page but account/logout); left nav (Overview, Kubernetes, Docker, Datastores, Users, Audit, Account), user chip + logout button (form POST). Dark, dense, Tailwind-only styling.

### Task 5: Monitoring libs (TDD on mappers)
`src/lib/kube.ts` (in-cluster client per spec §4: token/CA read, token re-read >60 s old, `get(path)`; mappers: nodes+nodeMetrics→NodeView, pods+podMetrics→PodView, deployments, hpas, jobs, warning events, certificates 404-tolerant, stats/summary fs). `src/lib/docker.ts` (undici unix-socket client; containers list; one-shot stats → cpuPercent/mem math per spec §4; `DOCKER_SOCK` empty ⇒ `{available:false}`). `src/lib/datastores.ts` (pg ×2, clickhouse, redis probes, 2.5 s timeout each, independent failures). Tests on fixture JSON for every mapper + docker CPU math + timeout wrapper.

### Task 6: Data routes + pages
`GET /api/admin/status|kubernetes|docker|datastores` (requireSession; assemble from libs; `cache: 'no-store'`). Pages (client components with a shared `usePoll(url, 10_000)` hook, visibility-paused; tables + stat tiles, red/green states, graceful per-section error banners): Overview (node CPU/RAM/disk gauges, uptime, versions, service health tiles with per-dependency checks), Kubernetes (deployments, HPAs, pods w/ restarts+usage, jobs, events, certs), Docker (containers table or "socket not mounted"), Datastores (per-store cards: status/size/connections/memory).

### Task 7: Users, audit, account pages + management routes
Routes (all POST, origin-checked, requireSession): `/api/users` create, `/api/users/[id]/disable|enable|reset-password`; guards: no self-disable, never disable the last enabled user; disable/reset revoke sessions + set mustChangePassword; all audited. `/users` page (table + create form w/ generated temp password shown once). `/audit` (latest 200, action filter). `/account` (change password — current pw required, revokes other sessions; active session list w/ revoke buttons; logout-all). `POST /api/account/password`, `POST /api/sessions/[id]/revoke`. Tests: guard logic (self-disable, last-user), password change revocation.

### Task 8: Dockerfile (+ migrate target incl. `scripts/migrate.mjs` bootstrap+seed), Dockerfile.dockerignore; local docker run test proving: healthz 200, `/login` 200, unauth `/` → 307, seeded login via `/api/auth/login` sets cookie, authed `/api/admin/datastores` 200 against Compose DBs (k8s/docker sections degrade gracefully outside a cluster).

### Task 9: Chart component (`admin-{rbac,configmap,deployment,service,ingress,migrate-job}.yaml` per spec §7), values ×3, `admin.env.example`, `secrets.sh` + `deploy.sh` untouched (secret loop gains `admin`), `lint.sh` assertions (read-only RBAC verbs only, dockerSock off ⇒ no hostPath rendered, still no Secret objects), `images.yml` +2 matrix entries, `ci.yml` `admin` job + path filter, runbook §5/§7 additions + admin section.

### Task 10: kind smoke test extension (build/load both admin images; throwaway secret; assertions per spec §8) + full `pnpm k8s:local` run green; final `pnpm -F @myampix/admin test/typecheck/build`, `pnpm k8s:lint`, `graphify update .`, memory update.

## Self-review
Spec §1→T1, §2→T1, §3.1–2→T3, §3.3–5→T2/T3/T7, §3.6→T2 (+usage T3/T7), §3.7→T2/T7, §3.8→T8, §3.9–10→T7, §4→T5/T6, §5→T1, §6→T1/T8/T9, §7→T9, §8→T2/3/5/7/8/10. Gaps: none.
