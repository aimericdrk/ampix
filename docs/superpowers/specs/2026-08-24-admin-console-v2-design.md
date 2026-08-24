# MyAmpix — Admin Console v2 (2FA · Ops actions · Alerting/history) — Design

**Date:** 2026-08-24 · **Status:** Approved (operator: "all of these") · **Parent:** `2026-08-24-admin-console-design.md` (v1). One Prisma migration (`ops_console_v2`) covers all three phases.

## Phase 1 — TOTP 2FA

- **Model:** `AdminUser.totpSecretEnc String?` (AES-256-GCM, key = new optional secret env `TOTP_ENC_KEY`, base64/hex 32 bytes — same validation rules as the analytics backend; unset ⇒ 2FA enrolment unavailable, login unaffected), `AdminUser.totpEnabledAt DateTime?`; new `AdminRecoveryCode { id, userId, codeHash (sha256), usedAt? }`.
- **TOTP engine:** hand-rolled RFC 6238/4226 (HMAC-SHA1, 30 s step, 6 digits, ±1 window) + RFC 4648 base32 — no OTP dependency; unit-tested against the RFC test vectors. QR for enrolment via the `qrcode` package (data-URL, client-rendered).
- **Login flow:** password OK **and** `totpEnabledAt` set ⇒ the created session is *pending* (`AdminSession.totpPendingUntil = now+5 min`). Pending sessions are rejected by `requireSession`/`requireSessionApi`/data guard; only `POST /api/auth/totp` accepts them. Correct TOTP (or an unused recovery code) clears pending (+ audit `login.totp` / `login.recovery_code`); 5 wrong codes or expiry revokes the session (audit `login.totp_locked`). JSON login returns `{ok:true, totpRequired:true}`; the login page shows a code step.
- **Enrolment (/account):** `POST /api/account/totp/setup` (stores encrypted secret, `totpEnabledAt` still null; returns otpauth URI + base32) → `POST /api/account/totp/enable {code}` (verifies against the pending secret; sets `totpEnabledAt`; returns 10 one-time recovery codes, shown once) → `POST /api/account/totp/disable {code|recoveryCode, currentPassword}`. All audited (`totp.enable`/`totp.disable`); admin **reset-password also clears TOTP** (lost-phone recovery path, audited).

## Phase 2 — Operational actions (restart · scale)

- **Server:** `kubePatch(path, body, contentType)` in `kube.ts`. Actions restricted to the release namespace (`POD_NAMESPACE` downward-API env): `POST /api/admin/ops/restart {deployment}` → strategic-merge patch of `kubectl.kubernetes.io/restartedAt`; `POST /api/admin/ops/scale {deployment, replicas}` → `/scale` subresource, bounds 0–10, refuses HPA-managed deployments (409 + explanation). Both: origin check, active session, audit (`ops.restart`/`ops.scale` with target+replicas), name validated against the live deployment list.
- **RBAC:** the read `ClusterRole` stays read-only (lint-asserted). New **namespaced** `Role` + `RoleBinding` (`admin-rbac-ops.yaml`, gated `admin.opsActions.enabled`, default true): `apps/deployments` + `deployments/scale`, verbs `get, patch, update`, release namespace only. `POD_NAMESPACE` via downward API.
- **UI:** action buttons on the Kubernetes page (app-namespace deployments only) with typed-name confirmation dialog; result toast; audit trail visible on /audit.

## Phase 3 — Alerting & history (Prometheus-free)

- **Model:** `MetricSnapshot { id, at, key, value Float }` (keys like `node.cpu.pct/<node>`, `node.mem.pct`, `node.fs.pct`, `ds.up/<store>`, `svc.up/<svc>`, `deploy.ready.pct/<name>`, `cert.days/<name>`), `AlertEvent { id, kind, key, message, openedAt, resolvedAt?, lastValue }`.
- **Sampler:** Next `instrumentation.ts` `register()` starts an in-process loop every `SAMPLE_INTERVAL_MINUTES` (default 5). A Postgres advisory lock (`pg_try_advisory_lock`) makes it single-flight across replicas. Each tick: collect (reuses v1 kube/datastore libs) → write snapshots → prune >7 days → evaluate rules → open/close `AlertEvent`s → optional `ALERT_WEBHOOK_URL` POST (`{event: opened|resolved, kind, key, message, value, at}` — works with Slack/Discord-style webhooks; failures logged, never fatal).
- **Fixed rules (v1.. keep simple, thresholds via env with defaults):** node CPU >90 %, mem >90 %, disk >85 %, datastore down, service /health/ready down, deployment ready<desired, certificate <14 days. Open after 2 consecutive breaching ticks (no flapping), close on first clear tick.
- **UI:** open-alert badge in the shell nav; `/alerts` page (open + last 50 resolved); Overview gains 24 h sparklines (inline SVG from snapshots) for node CPU/mem/disk.

## Env additions (all optional)
Secret: `TOTP_ENC_KEY`, `ALERT_WEBHOOK_URL`. ConfigMap/values: `SAMPLE_INTERVAL_MINUTES` (5), `POD_NAMESPACE` (downward API, fallback `myampix`).

## Testing
Unit: RFC 6238/4226 vectors + base32 round-trip; pending-session gating; recovery-code single-use; AES-GCM round-trip + wrong-key failure; scale bounds + HPA refusal; restart patch body; rule evaluation open/close/flap-guard transitions; snapshot pruning window. Smoke (kind): enrol TOTP via API (compute codes in-script from the returned secret with node), logout, login → `totpRequired` → verify → data 200; recovery-code login; `ops/restart` of `dashboard` → rollout completes; `/api/admin/alerts` 200 and ≥1 snapshot row after a forced sampler tick (`POST /api/admin/ops/sample` — session-gated manual trigger, also useful operationally).

## Out of scope
WebAuthn, email delivery, nonce-CSP, per-user alert rules UI, Prometheus (unchanged from v1 §9).
