# Backend Restructure + Security Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the 5 heavy backend modules into capability + layer subfolders, split the 2 oversized service files, and fix any Critical/High security issues found along the way — without changing runtime behavior.

**Architecture:** NestJS app under `backend/src`. Moves are done with `git mv` (history preserved), then relative imports are repaired using the TypeScript compiler as the error oracle (`npm run build`). Every module is proven with `npm run build` + `npm test` before moving to the next. Security fixes and file-splits are separate commits from pure moves.

**Tech Stack:** NestJS, TypeScript, Jest (`testMatch: src/**/*.spec.ts`), Zod, ClickHouse client, Prisma.

## Global Constraints

- Working directory for all commands: `backend/` (`cd backend` first).
- Imports are **relative** (no path aliases except `@myampix/contracts`). Moving a file breaks (a) its own imports and (b) every importer of it — both across modules.
- Jest `testMatch` is recursive (`src/**/*.spec.ts`) — co-located specs in new subfolders are picked up with **no config change**.
- Keep every `.spec.ts` **co-located**, moving it in the same `git mv` as its source.
- **No barrel `index.ts` files.**
- Commit types are never mixed: (a) pure move/rename, (b) file split, (c) security fix.
- **The user commits, not the implementer.** Where a step says "commit", stage the changes and STOP for the user to run the commit, unless the user has explicitly authorized committing.
- Never weaken a test to make it pass. If a moved test fails, the import path is wrong — fix the path, not the test.
- No behavior change in reorg/split tasks: the only edits are import paths, `@Module` provider paths, and mechanical extraction. Public method signatures stay identical.

### Standard Reorg Procedure (referenced by every module task)

Each module task performs these steps. The per-task section supplies only the exact `mkdir`/`git mv` commands; the loop below is identical every time:

1. **Snapshot green:** `npm run build && npm test -- <module>` → both pass before touching anything.
2. **Create dirs + move:** run the task's `mkdir -p` and `git mv` block.
3. **Fix imports via compiler loop:** run `npm run build`. For each `TS2307` / "Cannot find module" error, update the relative path to the file's new location. Repeat until build is clean. Search for external importers of moved files with `grep -rn "from '.*<module>/<oldname>'" src` and fix those too.
4. **Update the `@Module`:** open `<module>.module.ts` (and `app.module.ts` if it imports moved providers) and fix the `import` paths for controllers/providers. Provider *class lists* are unchanged — only import paths move.
5. **Test:** `npm test -- <module>` then the full suite `npm test`. All green.
6. **Security audit** (see task's checklist), fix Critical/High as a separate commit with a test.
7. **Stage for the user to commit** (pure-move commit, then any split commit, then any security-fix commit — separately).

---

## Task 1: Reorganize `revenuecat/`

**Files:**
- Move all `src/revenuecat/*.ts` (except `revenuecat.module.ts`) into capability subfolders.
- Modify: `src/revenuecat/revenuecat.module.ts` (import paths), `src/app.module.ts` if it imports revenuecat internals.

**Interfaces:**
- Produces: same exported classes (`RcWebhookController`, `RcWebhookGuard`, `RcWebhookProcessor`, `RcAdminController`, `RcAdminService`, `RcMetricsController`, `RcMetricsService`, `RcApiClient`, `RcIdentityService`, `RcEventMapper`, `RcBackfillService`) at new paths.

- [ ] **Step 1: Snapshot green**

Run: `cd backend && npm run build && npm test -- revenuecat`
Expected: build succeeds, revenuecat suite PASS.

- [ ] **Step 2: Create dirs and move files**

```bash
cd backend
mkdir -p src/revenuecat/{webhook,admin,metrics,api,identity,mapping,backfill}
git mv src/revenuecat/rc-webhook.controller.ts src/revenuecat/rc-webhook.controller.spec.ts \
       src/revenuecat/rc-webhook.guard.ts src/revenuecat/rc-webhook.guard.spec.ts \
       src/revenuecat/rc-webhook.processor.ts src/revenuecat/rc-webhook.processor.spec.ts \
       src/revenuecat/rc-webhook.schema.ts src/revenuecat/webhook/
git mv src/revenuecat/rc-admin.controller.ts src/revenuecat/rc-admin.controller.spec.ts \
       src/revenuecat/rc-admin.service.ts src/revenuecat/rc-admin.service.spec.ts \
       src/revenuecat/rc-admin.schema.ts src/revenuecat/admin/
git mv src/revenuecat/rc-metrics.controller.ts src/revenuecat/rc-metrics.controller.spec.ts \
       src/revenuecat/rc-metrics.service.ts src/revenuecat/rc-metrics.service.spec.ts \
       src/revenuecat/metrics/
git mv src/revenuecat/rc-api.client.ts src/revenuecat/rc-api.client.spec.ts src/revenuecat/api/
git mv src/revenuecat/rc-identity.service.ts src/revenuecat/rc-identity.service.spec.ts src/revenuecat/identity/
git mv src/revenuecat/rc-event-mapper.ts src/revenuecat/rc-event-mapper.spec.ts src/revenuecat/mapping/
git mv src/revenuecat/rc-backfill.service.ts src/revenuecat/rc-backfill.service.spec.ts src/revenuecat/backfill/
```

- [ ] **Step 3: Fix imports (compiler loop)**

Run: `npm run build` — fix each unresolved relative path to the new location. Also run:
`grep -rn "revenuecat/rc-" src --include=*.ts | grep -v "src/revenuecat/"`
to find external importers and repair them. Repeat `npm run build` until clean.

- [ ] **Step 4: Fix `revenuecat.module.ts` import paths**

Update every `import` in `src/revenuecat/revenuecat.module.ts` to the new subfolder paths (class list unchanged). Re-run `npm run build`.
Expected: build clean.

- [ ] **Step 5: Run tests**

Run: `npm test -- revenuecat && npm test`
Expected: all PASS.

- [ ] **Step 6: Security audit — webhook & api**

Verify and note findings:
- `webhook/rc-webhook.guard.ts`: signature verification uses a constant-time compare (`crypto.timingSafeEqual`), rejects missing/blank signature, and reads the secret from config (not hardcoded).
- `webhook/rc-webhook.processor.ts`: payload validated by the Zod schema before use; unknown event types handled without throwing raw internals.
- `api/rc-api.client.ts`: API key sourced from config; not logged; errors don't echo the key.
If a Critical/High issue exists, write a failing test proving it, fix it, and keep it as a **separate** commit.

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(revenuecat): group module into capability subfolders"
```
STOP — let the user commit.

---

## Task 2: Split `revenuecat/metrics/rc-metrics.service.ts` (492 lines)

**Files:**
- Modify: `src/revenuecat/metrics/rc-metrics.service.ts` (becomes a thin facade)
- Create: `src/revenuecat/metrics/rc-summary.service.ts`, `src/revenuecat/metrics/rc-attribution.service.ts`
- Modify: `src/revenuecat/revenuecat.module.ts` (add new providers), `src/revenuecat/metrics/rc-metrics.controller.ts` (unchanged if it injects `RcMetricsService`)
- Test: existing `rc-metrics.service.spec.ts` stays and must remain green.

**Interfaces:**
- Consumes: `ClickhouseService`, existing SQL expression constants (`PERIOD_EXPR`, `PRICE_EXPR`, `RC_INITIAL`, `RC_RENEWAL`, etc.) — move shared constants into `rc-metrics.service.ts` top scope or a `metrics/rc-metrics.constants.ts` and import into both sub-services.
- Produces: `RcMetricsService.getSummary(...)` and `RcMetricsService.getAttribution(...)` with **identical signatures**, delegating to `RcSummaryService.getSummary` and `RcAttributionService.getAttribution`.

- [ ] **Step 1: Confirm the two method groups**

`getSummary` (line ~134) + its private helpers = summary concern. `getAttribution` (line ~306) + helpers = attribution concern. Shared: the SQL expression constants and `ClickhouseService`.

- [ ] **Step 2: Extract shared constants**

Create `src/revenuecat/metrics/rc-metrics.constants.ts` and move the module-level SQL expression constants there. Import them back into `rc-metrics.service.ts`. Run `npm run build`; run `npm test -- rc-metrics`.
Expected: PASS (pure move of constants).

- [ ] **Step 3: Create `RcSummaryService`**

Move `getSummary` and its private helpers into `src/revenuecat/metrics/rc-summary.service.ts` as an `@Injectable()` class depending on `ClickhouseService` + the constants. Leave `RcMetricsService.getSummary` delegating: `return this.summary.getSummary(...)`.

- [ ] **Step 4: Create `RcAttributionService`**

Move `getAttribution` + helpers into `src/revenuecat/metrics/rc-attribution.service.ts` the same way; `RcMetricsService.getAttribution` delegates.

- [ ] **Step 5: Register providers**

Add `RcSummaryService`, `RcAttributionService` to `revenuecat.module.ts` `providers`. Inject both into `RcMetricsService` constructor.

- [ ] **Step 6: Build and test**

Run: `npm run build && npm test -- revenuecat && npm test`
Expected: all PASS with no test edits (facade preserves behavior).

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(revenuecat): split rc-metrics.service into summary + attribution"
```
STOP.

---

## Task 3: Reorganize `orgs/`

**Files:**
- Move `src/orgs/*.ts` (except `orgs.module.ts`) into `members/`, `project-access/`, `core/`.
- Modify: `src/orgs/orgs.module.ts`, and any external importer of orgs internals.

**Interfaces:**
- Produces: `OrgsController/Service`, `MembersController/Service`, `OrgProjectAccessController/Service` at new paths; types/schemas move alongside.

- [ ] **Step 1: Snapshot green**

Run: `npm run build && npm test -- orgs` → PASS.

- [ ] **Step 2: Create dirs and move**

```bash
cd backend
mkdir -p src/orgs/{members,project-access,core}
git mv src/orgs/members.controller.ts src/orgs/members.controller.spec.ts \
       src/orgs/members.service.ts src/orgs/members.service.spec.ts src/orgs/members.service.unit.spec.ts \
       src/orgs/members.schemas.ts src/orgs/members.types.ts src/orgs/members/
git mv src/orgs/org-project-access.controller.ts src/orgs/org-project-access.service.ts \
       src/orgs/org-project-access.service.spec.ts src/orgs/org-project-access.schemas.ts \
       src/orgs/org-project-access.types.ts src/orgs/project-access/
git mv src/orgs/orgs.controller.ts src/orgs/orgs.controller.spec.ts src/orgs/orgs.service.ts \
       src/orgs/orgs.service.spec.ts src/orgs/orgs.schemas.ts src/orgs/orgs.types.ts \
       src/orgs/owner-backfill.spec.ts src/orgs/core/
```

- [ ] **Step 3: Fix imports (compiler loop)**

`npm run build`; fix relative paths. External importers: `grep -rn "orgs/members\|orgs/org-project-access\|orgs/orgs\.\|orgs/owner-backfill" src --include=*.ts | grep -v "src/orgs/"`. Note `orgs/orgs.service` etc. are commonly imported by `invitations`, `projects`, `authz` — fix each.

- [ ] **Step 4: Fix `orgs.module.ts`**

Update import paths. `npm run build` → clean.

- [ ] **Step 5: Test**

Run: `npm test -- orgs && npm test`
Expected: PASS.

- [ ] **Step 6: Security audit — access control**

- `members/members.service.ts` + `project-access/org-project-access.service.ts`: every mutating method asserts the caller's org role (owner/admin) before acting; no IDOR (org/project id from the request is checked against membership, not trusted).
- `core/orgs.service.ts`: org creation/rename authorization; owner cannot be removed leaving an org ownerless.
Fix Critical/High as a separate commit with a test.

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(orgs): group into members / project-access / core"
```
STOP.

---

## Task 4: Reorganize `projects/`

**Files:**
- Move `src/projects/*.ts` (except `projects.module.ts`) into `management/`, `members/`, `core/`.
- Modify: `src/projects/projects.module.ts`, external importers.

- [ ] **Step 1: Snapshot green**

Run: `npm run build && npm test -- projects` → PASS.

- [ ] **Step 2: Create dirs and move**

```bash
cd backend
mkdir -p src/projects/{management,members,core}
git mv src/projects/project-management.controller.ts src/projects/project-management.controller.spec.ts \
       src/projects/project-management.service.ts src/projects/project-management.service.spec.ts \
       src/projects/project-management.schemas.ts src/projects/project-management.types.ts \
       src/projects/management/
git mv src/projects/project-members.controller.ts src/projects/project-members.controller.spec.ts \
       src/projects/project-members.service.ts src/projects/project-members.service.spec.ts \
       src/projects/project-members.schemas.ts src/projects/project-members.types.ts \
       src/projects/project-membership-backfill.spec.ts src/projects/members/
git mv src/projects/projects.controller.ts src/projects/projects.controller.spec.ts \
       src/projects/projects.service.ts src/projects/projects.service.spec.ts \
       src/projects/projects.types.ts src/projects/core/
```

- [ ] **Step 3: Fix imports (compiler loop)**

`npm run build`; fix paths. External importers: `grep -rn "projects/project-management\|projects/project-members\|projects/projects\." src --include=*.ts | grep -v "src/projects/"` (analytics, ingestion, authz, screenshots commonly import `projects.service`).

- [ ] **Step 4: Fix `projects.module.ts`**

Update import paths. `npm run build` → clean.

- [ ] **Step 5: Test**

Run: `npm test -- projects && npm test` → PASS.

- [ ] **Step 6: Security audit — project scoping**

- `core/projects.service.ts`: `assertMembership`/access check is applied on every read and write path (this is the RBAC access-flip seam); a user cannot read/mutate a project they aren't a member of.
- `members/project-members.service.ts`: role changes require adequate caller role; cannot escalate self.
- SDK token / project API key generation (if here) uses a CSPRNG and is stored hashed.
Fix Critical/High as a separate commit with a test.

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(projects): group into management / members / core"
```
STOP.

---

## Task 5: Reorganize `auth/`

**Files:**
- Move into `controllers/`, `services/`, `tokens/`, `two-factor/`, `crypto/` (exists), `schemas/`. `test-support/` already nested.
- Modify: `src/auth/auth.module.ts`, external importers (many — `jwt-auth.guard`, `auth.schemas`, `auth.types`, `cookies` are imported repo-wide).

- [ ] **Step 1: Snapshot green**

Run: `npm run build && npm test -- auth` → PASS.

- [ ] **Step 2: Create dirs and move**

```bash
cd backend
mkdir -p src/auth/{controllers,services,tokens,two-factor,schemas}
git mv src/auth/auth.controller.ts src/auth/auth.controller.spec.ts src/auth/controllers/
git mv src/auth/auth.service.ts src/auth/auth.service.spec.ts \
       src/auth/auth-config.util.ts src/auth/auth-config.util.spec.ts src/auth/services/
git mv src/auth/token.service.ts src/auth/token.service.spec.ts \
       src/auth/refresh-token.service.ts src/auth/refresh-token.service.spec.ts \
       src/auth/jwt-auth.guard.ts src/auth/jwt-auth.guard.spec.ts \
       src/auth/cookies.ts src/auth/cookies.spec.ts src/auth/tokens/
git mv src/auth/totp.service.ts src/auth/totp.service.spec.ts \
       src/auth/recovery-code.service.ts src/auth/recovery-code.service.spec.ts \
       src/auth/two-factor-attempt-limiter.ts src/auth/two-factor-attempt-limiter.spec.ts \
       src/auth/two-factor/
git mv src/auth/password.service.ts src/auth/password.service.spec.ts src/auth/crypto/
git mv src/auth/auth.schemas.ts src/auth/auth.schemas.spec.ts src/auth/schemas/
```

Note: `auth.types.ts` stays at `auth/` root (imported very widely; keeping it put minimizes churn).

- [ ] **Step 3: Fix imports (compiler loop)**

`npm run build`; fix paths. `jwt-auth.guard` and `cookies` and `auth.schemas` are imported across most modules — run `grep -rn "auth/jwt-auth.guard\|auth/cookies\|auth/auth.schemas" src --include=*.ts | grep -v "src/auth/"` and repair each. Repeat until clean.

- [ ] **Step 4: Fix `auth.module.ts`**

Update import paths (providers unchanged). `npm run build` → clean.

- [ ] **Step 5: Test**

Run: `npm test -- auth && npm test` → PASS.

- [ ] **Step 6: Security audit — auth core**

- `tokens/jwt-auth.guard.ts`: verifies signature + expiry; rejects `alg:none`/tampered tokens; extracts identity only from verified claims.
- `tokens/refresh-token.service.ts`: refresh tokens are hashed at rest, rotated on use, and reuse is detected/revoked.
- `tokens/cookies.ts`: auth cookies set `HttpOnly`, `Secure`, `SameSite`.
- `two-factor/totp.service.ts` + `recovery-code.service.ts`: codes compared with constant-time equality; recovery codes stored hashed; `two-factor-attempt-limiter.ts` actually throttles.
- `crypto/password.service.ts`: strong hash (argon2/bcrypt) with sane cost; `crypto/aes-gcm.ts`: random IV per encryption, auth tag verified.
Fix Critical/High as a separate commit with a test.

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(auth): group into controllers / services / tokens / two-factor / crypto / schemas"
```
STOP.

---

## Task 6: Reorganize `analytics/`

**Files:**
- Move into `controllers/`, `services/`, `queries/<type>/`, `support/`. `ai/` already nested. `analytics.types.ts` stays at root.
- Modify: `src/analytics/analytics.module.ts`, external importers.

- [ ] **Step 1: Snapshot green**

Run: `npm run build && npm test -- analytics` → PASS.

- [ ] **Step 2: Create dirs and move**

```bash
cd backend
mkdir -p src/analytics/{controllers,services,support}
mkdir -p src/analytics/queries/{funnels,retention,flows,engagement,histogram,insights,screen-paths,click-heatmap}

git mv src/analytics/analytics.controller.ts src/analytics/analytics.controller.spec.ts \
       src/analytics/advanced-analytics.controller.ts src/analytics/v2-analytics.controller.ts \
       src/analytics/controllers/
git mv src/analytics/analytics.service.ts src/analytics/analytics.service.spec.ts \
       src/analytics/advanced-analytics.service.ts src/analytics/advanced-analytics.service.spec.ts \
       src/analytics/v2-analytics.service.ts src/analytics/v2-analytics.service.spec.ts \
       src/analytics/services/

git mv src/analytics/funnels.compiler.ts src/analytics/funnels.compiler.spec.ts \
       src/analytics/funnels.schema.ts src/analytics/funnels.schema.spec.ts src/analytics/queries/funnels/
git mv src/analytics/retention.compiler.ts src/analytics/retention.compiler.spec.ts \
       src/analytics/retention.schema.ts src/analytics/retention.schema.spec.ts src/analytics/queries/retention/
git mv src/analytics/flows.compiler.ts src/analytics/flows.compiler.spec.ts \
       src/analytics/flows.schema.ts src/analytics/flows.schema.spec.ts src/analytics/queries/flows/
git mv src/analytics/engagement.compiler.ts src/analytics/engagement.compiler.spec.ts \
       src/analytics/engagement.schema.ts src/analytics/queries/engagement/
git mv src/analytics/histogram.compiler.ts src/analytics/histogram.compiler.spec.ts \
       src/analytics/histogram.schema.ts src/analytics/queries/histogram/
git mv src/analytics/insights.compiler.ts src/analytics/insights.compiler.spec.ts \
       src/analytics/insights-query.schema.ts src/analytics/insights-query.schema.spec.ts src/analytics/queries/insights/
git mv src/analytics/screen-paths.compiler.ts src/analytics/screen-paths.compiler.spec.ts \
       src/analytics/screen-paths.schema.ts src/analytics/queries/screen-paths/
git mv src/analytics/click-heatmap.compiler.ts src/analytics/click-heatmap.compiler.spec.ts \
       src/analytics/click-heatmap.schema.ts src/analytics/queries/click-heatmap/

git mv src/analytics/filter-compiler.ts src/analytics/filter-compiler.spec.ts \
       src/analytics/cohort-filter.compiler.spec.ts \
       src/analytics/property-resolver.ts src/analytics/property-resolver.spec.ts \
       src/analytics/identity.ts src/analytics/identity.spec.ts \
       src/analytics/bucket-grid.ts src/analytics/bucket-grid.spec.ts \
       src/analytics/read-query.util.ts src/analytics/read-query.util.spec.ts \
       src/analytics/support/
```

- [ ] **Step 3: Fix imports (compiler loop)**

`npm run build`; fix relative paths (compilers import `support/filter-compiler`, `support/property-resolver`, etc.). External importers: `grep -rn "analytics/" src --include=*.ts | grep -v "src/analytics/"` (cohorts, reports commonly import analytics compilers/schemas). Repeat until clean.

- [ ] **Step 4: Fix `analytics.module.ts`**

Update import paths. `npm run build` → clean.

- [ ] **Step 5: Test**

Run: `npm test -- analytics && npm test` → PASS.

- [ ] **Step 6: Security audit — ClickHouse injection (highest priority)**

For every `${...}` interpolation in `services/*.service.ts` and `queries/**/*.compiler.ts` + `support/*`:
- User-controlled values (search string, event/property names, cursor, breakdown keys, filter values) MUST be passed as ClickHouse query **parameters** (`{name:Type}` + `query_params`) or validated against an allow-list — never concatenated into SQL.
- `projectId`/`userId` scoping is always applied so a query can't read another tenant's data.
Confirm `support/read-query.util.ts` and `support/filter-compiler.ts` are where escaping/parameterization lives and that it is used everywhere. For any concatenated user value, write a failing test with an injection payload, fix to parameterized/allow-listed, keep as a **separate** commit.

- [ ] **Step 7: Stage for commit**

```bash
git add -A
# User commits: "refactor(analytics): group into controllers / services / queries / support"
```
STOP.

---

## Task 7: Split `analytics/services/analytics.service.ts` (793 lines) via facade

**Files:**
- Modify: `src/analytics/services/analytics.service.ts` → thin facade delegating to 4 sub-services.
- Create: `src/analytics/services/insights-query.service.ts`, `metadata.service.ts`, `users.service.ts`, `summaries.service.ts`.
- Modify: `src/analytics/analytics.module.ts` (register sub-services).
- Test: existing `analytics.service.spec.ts` stays and must remain green (it tests the facade).

**Interfaces:**
- Consumes: `ClickhouseService`, `IdentityResolver`/property helpers already used, module-level constants (`DURATION_MS_EXPR`, `PRICE_EXPR`, `canon`, row-mapping helper near line 175).
- Produces: `AnalyticsService` keeps identical public methods (`runInsightsQuery`, `listEventNames`, `listProperties`, `listPropertyValues`, `getLiveEvents`, `listUsers`, `getUserProfile`, `getSessionsSummary`, `getRevenueSummary`), each delegating to a sub-service method of the same name.

- [ ] **Step 1: Extract shared helpers/constants**

Move module-level constants + the shared row-mapping helper into `src/analytics/services/analytics.shared.ts`. Import into `analytics.service.ts`. Run `npm run build && npm test -- analytics.service`.
Expected: PASS (pure move).

- [ ] **Step 2: Create `MetadataService`**

Move `listEventNames`, `listProperties`, `listPropertyValues` into `metadata.service.ts` (`@Injectable`, depends on `ClickhouseService` + shared). Facade methods delegate.

- [ ] **Step 3: Create `UsersService`**

Move `getLiveEvents`, `listUsers`, `getUserProfile` into `users.service.ts`. Facade delegates.

- [ ] **Step 4: Create `SummariesService`**

Move `getSessionsSummary`, `getRevenueSummary` into `summaries.service.ts`. Facade delegates.

- [ ] **Step 5: Create `InsightsQueryService`**

Move `runInsightsQuery` (+ its private helpers) into `insights-query.service.ts`. Facade delegates.

- [ ] **Step 6: Register + inject**

Add the 4 services to `analytics.module.ts` `providers`; inject all 4 into `AnalyticsService` constructor. `AnalyticsService` now contains only delegating one-liners.

- [ ] **Step 7: Build and test**

Run: `npm run build && npm test -- analytics && npm test`
Expected: all PASS, no test edits.

- [ ] **Step 8: Stage for commit**

```bash
git add -A
# User commits: "refactor(analytics): split analytics.service into metadata/users/summaries/insights"
```
STOP.

---

## Task 8: Cross-cutting security audit (unmoved modules)

**Files (audit only; fixes as separate commits with tests):**
- `src/ingestion/*` (sdk-token.guard, rate-limit.guard, rate-limiter, event-normalizer, profile-writer, ingest-auth)
- `src/authz/*` (roles.guard, project-roles.guard, org-role-resolver, project-role-resolver)
- `src/common/*` (problem-details.filter, json-body.middleware, sdk-token)
- `src/clickhouse/clickhouse.service.ts`

- [ ] **Step 1: Ingestion**

Verify: `sdk-token.guard.ts` validates the SDK token against a hashed store with constant-time compare; `rate-limiter.ts`/`rate-limit.guard.ts` enforce per-key limits and fail closed; `event-normalizer.ts` validates/limits payload size and rejects malformed input; `profile-writer.ts` doesn't allow property injection that overwrites reserved fields.

- [ ] **Step 2: AuthZ resolvers/guards**

Verify: `roles.guard.ts` + `project-roles.guard.ts` deny by default (no role metadata ⇒ deny), resolvers query membership fresh (not from client-supplied claims), and there's no path that returns a role for a non-member.

- [ ] **Step 3: Common**

Verify: `problem-details.filter.ts` never serializes stack traces / internal messages to clients in production; `json-body.middleware.ts` enforces a body-size cap; `common/sdk-token.ts` generation uses a CSPRNG.

- [ ] **Step 4: ClickHouse service**

Verify `clickhouse.service.ts` exposes a parameterized query path and that raw-string query methods are only fed trusted SQL.

- [ ] **Step 5: Report + fix**

Produce a ranked findings list (Critical/High/Medium/Low). For each Critical/High: failing test → fix → separate commit. Report Medium/Low to the user for a scope decision — do not fix without approval.

- [ ] **Step 6: Stage any fixes for commit**

```bash
git add -A
# User commits per fix, e.g.: "fix(security): <specific issue>"
```
STOP.

---

## Task 9: Finalize

- [ ] **Step 1: Full green + lint**

Run: `cd backend && npm run build && npm test && npm run lint`
Expected: all PASS.

- [ ] **Step 2: Confirm no orphaned flat files**

Run: `for d in analytics auth revenuecat orgs projects; do echo "$d:"; ls -1 src/$d/*.ts 2>/dev/null; done`
Expected: only `*.module.ts` (and `*.types.ts` intentionally kept at root) remain flat.

- [ ] **Step 3: Update knowledge graph**

Run: `cd /Users/aimeric/Documents/personnal-project/MyAmpix && graphify update .`

- [ ] **Step 4: Hand off**

Summarize to the user: modules restructured, files split, security findings + fixes (with severity), and anything Medium/Low left for their decision.

---

## Self-Review Notes

- **Spec coverage:** reorg of all 5 heavy modules (Tasks 1,3,4,5,6) ✓; split of both large files (Tasks 2,7) ✓; security folded per-module (Steps 6 in each) + cross-cutting (Task 8) ✓; co-located tests ✓; separate commit types ✓; execution order revenuecat→orgs→projects→auth→analytics ✓; graphify update ✓.
- **Placeholders:** none — every move has exact `git mv`; audits list concrete files/checks.
- **Type consistency:** facades (Tasks 2, 7) preserve exact public method names; sub-service method names mirror facade names.
- **Deviation from generic TDD:** reorg/split tasks are behavior-preserving, so existing specs act as the regression gate (no new failing test first). New failing tests are written only for security fixes, where TDD applies literally.
