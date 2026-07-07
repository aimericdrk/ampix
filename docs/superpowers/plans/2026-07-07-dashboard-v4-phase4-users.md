# Dashboard v4 — Phase 4 (Users: search-by-name, disambiguation, per-user path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users be found by name/profile/aliases with a disambiguation results table, and add an identity-correct per-user screen-path map to the profile.

**Architecture:** Extend the existing user-search query to match a whitelist of profile string properties + aliased anon_ids and return richer rows (name/email); add an optional `distinct_ids` filter to the screen-paths query (mirroring the click-heatmap `distinct_ids` already shipped). Frontend: migrate the users list to the `DataTable` primitive and add a per-user `PathMap` fed by the profile's `distinct_ids`.

**Tech Stack:** NestJS + ClickHouse (backend), React + TanStack Query + Recharts (frontend), jest / vitest + msw.

## Global Constraints
- Every user-supplied value is a bound ClickHouse `query_param`; profile KEYS searched are a fixed whitelist of OUR OWN constants embedded as SQL literals (never caller input) — same rule as `property-resolver`/identity.
- No new deps. Do NOT touch the `MyAmpMix→MyAmpix` rebrand / formatter drift; stage only each task's files (targeted hunks if a file also carries rebrand lines; never `sdk/` or `pnpm-lock.yaml`).
- No co-author trailer; `feat/fix(...)` per task.
- Backend: `cd backend && pnpm build` + `pnpm test` green. Frontend: `cd dashboard && pnpm exec tsc --noEmit` + `pnpm test` green. Verify each task before its commit. (Implementers LEAVE changes in the working tree; the orchestrator commits with rebrand-clean staging.)
- Reuse the Phase-1 `DataTable` primitive and the existing `PathMap`; do not rebuild them.

---

## File Structure
Backend modify: `analytics.service.ts` (`listUsers`), `analytics.types.ts` (`UserListItem`), `screen-paths.schema.ts`, `screen-paths.compiler.ts`; tests `analytics.service.spec.ts` / `analytics.controller.spec.ts` / `screen-paths.compiler.spec.ts` + e2e where easy; docs `2026-07-02-shared-contracts.md` (§14, §19).
Frontend modify: `lib/api/types.ts` (`UserListItem`, `ScreenPathsQuery`), `features/analytics/components/UsersPage.tsx`, `features/analytics/components/UserProfilePage.tsx`, `test/msw/handlers.ts`, page tests.

---

### Task 1: Backend — user search over profile props + aliases, richer rows

**Files:** Modify `backend/src/analytics/analytics.service.ts` (`listUsers`), `analytics.types.ts`; tests `analytics.service.spec.ts` (+ controller/e2e if easy); docs §14.

**Interfaces (Produces):**
- `UserListItem` gains `name: string | null; email: string | null;` (backend `analytics.types.ts` + returned by `listUsers`).
- Behavior: `search` (when present) matches a user when a case-insensitive SUBSTRING of `search` occurs in ANY of: the canonical id, an aliased `anon_id`, or a whitelisted profile string property. `name`/`email` in each row come from the profile.

- [ ] **Step 1: Write failing tests** (`analytics.service.spec.ts`, mocking `clickhouse.query`): assert the compiled SQL for a `search` (a) binds `{search:String}` (never interpolates the term), (b) references the profile whitelist keys via `JSONExtractString(toJSONString(...properties), '<key>')` for the fixed whitelist `name,email,username,$name,$email` (OUR literals), (c) still groups/paginates by the canonical uid, and (d) the mapped response rows include `name`/`email`. Add an injection case: a `search` containing SQL metacharacters stays only in params.
- [ ] **Step 2: Run, verify fail** (`cd backend && pnpm test -- analytics.service.spec`).
- [ ] **Step 3: Implement.** In `listUsers`: keep the `canonicalization()` CTE/join + `uid`. Add a LEFT JOIN of `user_profiles FINAL` on the canonical id (like `getUserProfile` reads `user_profiles`) to extract `name`/`email` (first non-empty of the whitelist keys) and to search them. Define `const USER_SEARCH_PROFILE_KEYS = ['name','email','username','$name','$email'] as const;` (module const). Replace the `startsWith(uid,{search})` clause with an OR of case-insensitive substring matches (`positionCaseInsensitiveUTF8(<expr>, {search:String}) > 0`) over: `uid`, `e.distinct_id` (raw/alias), and each `JSONExtractString(toJSONString(up.properties), '<literalKey>')`. Bind `search` once. SELECT `name`/`email` via `JSONExtractString` of the profile (coalesce the whitelist to the first non-empty, or pick `name`/`email` keys respectively; empty → null). Keep `limit+1` look-ahead + `next_cursor` on the canonical uid. Map rows to include `name: row.name || null, email: row.email || null`.
- [ ] **Step 4: Run tests + `pnpm build`.** Green.
- [ ] **Step 5: Docs** — §14 users explorer: note search now also matches profile name/email/username + aliases, and rows carry `name`/`email`.
- [ ] **Step 6: Commit** (orchestrator): `feat(analytics): user search over profile name/email + aliases, richer rows`.

---

### Task 2: Backend — screen-paths `distinct_ids` filter (per-user paths)

**Files:** Modify `backend/src/analytics/screen-paths.schema.ts`, `screen-paths.compiler.ts`; test `screen-paths.compiler.spec.ts`; docs §19.

**Interfaces (Produces):** `ScreenPathsQuery` gains optional `distinct_ids?: string[]`; when present the compiled query restricts to `e.distinct_id IN {distinctIds:Array(String)}` (bound array). Mirrors the click-heatmap `distinct_ids` shipped in v3.

- [ ] **Step 1: Write failing tests** (`screen-paths.compiler.spec.ts`): with `distinct_ids: ['u1','anon1']` the SQL contains `distinct_id IN {distinctIds:Array(String)}` and `params.distinctIds` equals the array; without it, no such clause; an id with SQL metacharacters stays only in params.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** `screen-paths.schema.ts`: add `distinct_ids: z.array(z.string().min(1)).max(1000).optional()`. `screen-paths.compiler.ts`: after the base WHERE (`e.project_id = {projectId:UUID}` + the `$screen_view`/date/anchor clauses), if `query.distinct_ids?.length`, append `AND e.distinct_id IN {distinctIds:Array(String)}` and set `params.distinctIds = query.distinct_ids`. Add a doc note: identity-correct per-user filter, caller passes the user's §17 identity set (canonical + anon ids from `GET /users/:distinctId`); bound array, injection-safe.
- [ ] **Step 4: Run tests + `pnpm build`.**
- [ ] **Step 5: Docs** — §19 screen-paths: optional `distinct_ids` (`distinct_id IN (…)`, bound) for a per-user path map.
- [ ] **Step 6: Commit** (orchestrator): `feat(analytics): optional distinct_ids filter on screen-paths for per-user paths`.

---

### Task 3: Frontend — users disambiguation table

**Files:** Modify `dashboard/src/lib/api/types.ts` (`UserListItem` + `ScreenPathsQuery`), `features/analytics/components/UsersPage.tsx`, `test/msw/handlers.ts`, `users.test.tsx` (or the UsersPage test).

**Interfaces (Consumes):** the Phase-1 `DataTable` (`components/ui/DataTable.tsx`); `useUsersList(projectId, search)`.

- [ ] **Step 1: Write failing test.** With the msw `GET /users` returning multiple matches carrying `name`/`email`, `UsersPage` renders a `DataTable` with columns Name, id/email, Last seen, Events (sortable); a search updates results; clicking a row navigates to `/projects/$projectId/users/$distinctId`. Keep pagination ("load more") working.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Add `name: string | null; email: string | null;` to frontend `UserListItem`; add `distinct_ids?: string[]` to `ScreenPathsQuery`. Update the msw `GET /users` fixture to include `name`/`email` and support multi-match on `search`. Replace the ad-hoc table in `UsersPage` with `DataTable` (columns: Name (name ?? '—'), id/email (email ?? distinct_id, mono), Last seen (relative/date), Events (right-aligned `tabular-nums`); `onRowClick` → navigate; `rowKey` = distinct_id). Keep the search box + infinite "load more".
- [ ] **Step 4: Run tests + `tsc`.**
- [ ] **Step 5: Commit** (orchestrator): `feat(dashboard): users disambiguation table (search by name/email, sortable rows)`.

---

### Task 4: Frontend — per-user path map on the profile

**Files:** Modify `dashboard/src/features/analytics/components/UserProfilePage.tsx`, `user-profile.test.tsx`.

**Interfaces (Consumes):** `useRunScreenPaths` (`features/analytics/api.ts`), `PathMap` (`components/PathMap.tsx`), `CollapsibleSection` (already wrapping profile sections), the profile's `data.distinct_ids` (already returned by `getUserProfile`), `useScreens` for `screenHashes`.

- [ ] **Step 1: Write failing test.** On the profile, a collapsible "Screen path" (per-user path map) section runs `POST /query/screen-paths` with `distinct_ids` equal to the profile's `distinct_ids` (assert the request body via msw) and renders the `PathMap` (`path-map` testid) when nodes exist, with an empty state otherwise. Keep existing profile assertions (timeline, tap heatmap) passing.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Add a per-user path section to `UserProfilePage` (inside a `CollapsibleSection`, consistent with the others): run `useRunScreenPaths` for the user on mount / when `data.distinct_ids` is ready — a screen-paths query over a sensible default range with `distinct_ids: data.distinct_ids`, `direction:'forward'`, `steps:3`, `max_nodes_per_step:6`, `unit:'user'`. Render the result via `PathMap` (reuse `screenHashes` from `useScreens`), with loading/empty states. Note in a comment that `distinct_ids` makes it identity-correct. Distinguish this from the existing lightweight `$screen_view` mini-diagram (keep or fold — prefer keeping the mini-diagram as a quick summary and adding the full interactive PathMap below it; if redundant, replace the mini-diagram with the PathMap and say so).
- [ ] **Step 4: Run tests + `tsc`.**
- [ ] **Step 5: Commit** (orchestrator): `feat(dashboard): identity-correct per-user path map on the profile`.

---

## Self-Review (against the spec)
- Search by name/aliases + richer rows → T1; disambiguation results table → T3. ✓
- Per-user path map (identity-correct) → T2 (backend filter) + T4 (frontend). ✓
- Collapsible timeline already shipped (foundation T2); profile sections stay collapsible. ✓
- Placeholder scan: none — concrete files, SQL intent, whitelist constant, tests, commits.
- Type consistency: `UserListItem.name/email` and `ScreenPathsQuery.distinct_ids` are added on both backend and frontend identically; `distinct_ids` filter mirrors the shipped click-heatmap pattern.
- Deferred: Phase 5 (scale-features menu) — separate planning doc.
