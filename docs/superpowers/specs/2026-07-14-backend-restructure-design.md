# Backend restructure + security pass — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** `backend/` NestJS app (247 `.ts` files)

## Problem

The backend is split into sound top-level feature modules, but the heavy modules
dump every file flat into one directory:

| Module | Files (src + spec) |
|--------|-------------------|
| `analytics/` | 51 |
| `auth/` | 26 |
| `revenuecat/` | 25 |
| `orgs/` | 20 |
| `projects/` | 19 |

Two source files also exceed 400 lines: `analytics/analytics.service.ts` (793)
and `revenuecat/rc-metrics.service.ts` (492).

The user also asked for a security review of the whole backend.

## Decisions (locked)

- **Depth:** reorganize the 5 heavy modules into subfolders **and** split the 2
  large files. Small modules untouched.
- **Layout:** **Hybrid** — capability folders **plus** a `controllers/` +
  `services/` layer split inside each heavy module.
- **Tests:** stay co-located, move with their source. Jest `testMatch`
  (`src/**/*.spec.ts`, recursive) needs no change.
- **Security:** folded into the reorg, but every security **fix** is its own
  commit, separate from file-move commits.
- **Commits:** the user commits, not the assistant.

## Conventions

- Moves use `git mv` (preserve history), then every relative import is fixed
  (imports are all relative today — no path aliases except `@myampix/contracts`).
- Verify with `npm run build` + `npm test` after **each module**, not at the end.
- Commit types never mixed: (a) pure move/rename, (b) file split, (c) security fix.
- No barrel `index.ts` files (matches current repo).

## Target layouts

### analytics/ (worked example)

```
analytics/
  analytics.module.ts
  analytics.types.ts
  controllers/   analytics | advanced-analytics | v2-analytics  (.controller.ts + specs)
  services/      analytics.service (split) | advanced-analytics | v2-analytics
  queries/       funnels/ retention/ flows/ engagement/ histogram/
                 insights/ (insights.compiler + insights-query.schema)
                 screen-paths/ click-heatmap/     (compiler+schema+specs together)
  support/       filter-compiler (+cohort-filter spec) | property-resolver
                 identity | bucket-grid | read-query.util
  ai/            mistral.service
```

`analytics.service.ts` (793) → split into `services/`:
`insights-query.service.ts`, `metadata.service.ts` (event names / properties /
values), `users.service.ts` (live events / listUsers / getUserProfile),
`summaries.service.ts` (sessions / revenue). Keep a thin `analytics.service.ts`
facade only if existing consumers depend on the class directly (verify usages
first).

### auth/

`controllers/`, `services/`, `tokens/` (token, refresh-token, jwt-auth.guard,
cookies), `two-factor/` (totp, recovery-code, attempt-limiter), `crypto/`
(aes-gcm + password.service), `schemas/`, `test-support/`.

### revenuecat/

`webhook/` (controller+guard+processor+schema), `admin/`, `metrics/`
(rc-metrics.service split at 492 → summary / attribution), `api/` (client),
`identity/`, `mapping/` (event-mapper), `backfill/`.

### orgs/

Capability folders `members/`, `project-access/` (org-project-access.*),
`core/` (orgs.* + owner-backfill) — each with its controller/service/schema/types
+ specs.

### projects/

`management/` (project-management.*), `members/` (project-members.* +
membership-backfill), `core/` (projects.*).

## Security checklist (audited per module, Critical/High fixed inline)

- **ClickHouse injection (top risk):** every `${...}` in analytics/revenuecat SQL
  — confirm user-controlled values (search, property/event names, cursor,
  breakdown) are parameterized or allow-listed, not string-concatenated.
- **AuthZ:** guards applied on every controller route; org/project role resolvers
  not bypassable; IDOR on project/org-scoped resources.
- **Ingestion:** SDK-token guard, rate-limiter correctness, event-normalizer input
  validation.
- **Webhooks:** RevenueCat signature verification (timing-safe, correct secret).
- **Auth/crypto:** JWT verification, refresh-token rotation/reuse detection, TOTP +
  recovery-code constant-time compare, cookie flags (HttpOnly/Secure/SameSite),
  password hashing params.
- **Cross-cutting:** secrets never logged, Zod validation at every boundary,
  problem-details filter doesn't leak internals.

Findings → short ranked report. Critical/High fixed with a test proving the fix;
Medium/Low reported for the user's call.

## Execution order & verification

Per module, lowest-risk first: `revenuecat` → `orgs` → `projects` → `auth` →
`analytics`.

For each module:
1. `git mv` files into new structure
2. fix relative imports
3. `npm run build`
4. `npm test` (module + full suite)
5. security audit + fixes (separate commits)
6. hand off for the user to commit

Nothing proceeds to the next module until build + full test suite are green.
Run `graphify update .` at the end.
