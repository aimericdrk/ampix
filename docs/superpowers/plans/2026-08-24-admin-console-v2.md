# Admin Console v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Executed inline by the session that authored `docs/superpowers/specs/2026-08-24-admin-console-v2-design.md` — the spec is the contract; tasks below are the order of work, each ending verified (typecheck + vitest green; smoke at the end).

**Goal:** TOTP 2FA, restart/scale ops actions, and sampler-based alerting/history for `admin/`, plus chart/CI wiring, smoke coverage, and refreshed repo docs.

## Global Constraints
As v1 plan (no commits, no secrets, <500-line files, `pnpm --filter @myampix/admin typecheck|test|build` green per task). New deps allowed: `qrcode` (+types). One Prisma migration `ops_console_v2`.

### Task 1 — Crypto + TOTP engine (TDD)
`src/lib/crypto.ts` (AES-256-GCM encrypt/decrypt with env `TOTP_ENC_KEY`, base64/hex-32 validation shared with env.ts), `src/lib/totp.ts` (base32 enc/dec, hotp, totp, verify ±1 window, secret+otpauth generation). Tests: RFC 4226/6238 vectors, base32 round-trip, window edges, GCM round-trip + tamper + wrong-key.

### Task 2 — Schema + migration + session pending-gate
Prisma: `totpSecretEnc`, `totpEnabledAt`, `AdminRecoveryCode`, `AdminSession.totpPendingUntil`, `MetricSnapshot`, `AlertEvent`; migrate dev (`ops_console_v2`). `session.ts`: pending sessions invalid for `validateSessionToken` (except explicit `allowPending`); `auth.ts`: `attemptLogin` marks pending when TOTP enabled and returns `totpRequired`. Tests updated + pending-gating tests.

### Task 3 — 2FA routes + login/account UI
`/api/auth/totp` (verify code|recovery on pending session, 5-strike revoke), `/api/account/totp/{setup,enable,disable}`; reset-password clears TOTP; login page code step; account page enrolment card (QR via `qrcode`, recovery codes shown once, disable form). Audit actions extended. Tests: route-logic helpers (verifyTotpLogin, enrolment state machine) with mock Prisma.

### Task 4 — Ops actions
`kube.ts` `kubePatch`; `/api/admin/ops/{restart,scale}` (namespace-scoped, allowlist by live lookup, HPA refusal, bounds, audit); Kubernetes page action buttons + confirm dialog. Chart: `admin-rbac-ops.yaml` (namespaced Role/Binding, `admin.opsActions.enabled`), `POD_NAMESPACE` downward API, lint assertions (ClusterRole still read-only; ops Role namespaced). Tests: patch bodies, bounds, HPA refusal, name validation.

### Task 5 — Sampler + alerts + history UI
`src/lib/rules.ts` (pure evaluate: samples→rule states; 2-tick open, 1-tick close), `src/lib/sampler.ts` (collect→snapshot→prune→evaluate→persist AlertEvents→webhook), `instrumentation.ts` (advisory-lock single-flight), `/api/admin/alerts`, `/api/admin/history?keys=…&hours=24`, `/api/admin/ops/sample` (manual tick), `/alerts` page, nav badge, Overview sparklines (inline SVG). env.ts: `TOTP_ENC_KEY`, `ALERT_WEBHOOK_URL`, `SAMPLE_INTERVAL_MINUTES`, `POD_NAMESPACE`. Tests: rule transitions, prune window, sparkline path builder, webhook payload.

### Task 6 — Wiring + smoke + docs
`admin.env.example` (+TOTP_ENC_KEY, ALERT_WEBHOOK_URL), values (opsActions), runbook (2FA enrolment step, ops actions note, alerts), `local.sh` smoke additions (TOTP enrol/login via node-computed codes, recovery login, restart action, sampler tick + alerts 200), full `pnpm k8s:local` green, k8s:lint green. Update root `README.md`, `DOCUMENTATION.md`, `HOW-TO-USE.md`, `SETUP.md` for: k8s/VPS deploy (X1), admin console v1+v2, new scripts/workflows/packages. graphify update; memory update.

## Self-review
Spec Phase 1→T1–3, Phase 2→T4, Phase 3→T5, env/testing/wiring→T2/T6. Docs refresh (user request) → T6.
