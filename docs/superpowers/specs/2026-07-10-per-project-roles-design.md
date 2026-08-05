# Per-Project Roles & Permissions — Design

**Date:** 2026-07-10
**Status:** Approved by user (access model, role ladder, org-admin reach, invite flow, backfill, governance)

## Summary

Today access is org-only: a `Membership(userId, orgId, role)` with `admin | analyst | viewer`, and **every org member can access every project**. This feature adds a **per-project role** so people invited to an org are granted access to specific projects at a specific level — they are not implicitly admins (or even viewers) on every project.

### Decisions (locked)

- **Access model:** org role stays for org-level administration (inviting, creating projects, org settings); a new per-project role governs each project's access. An org member has **no** access to a project until granted a project role.
- **Project role ladder:** `owner > admin > analyst > viewer`.
- **Org-admin reach:** org admins get **no** automatic project access — only where explicitly granted.
- **Invite flow:** unchanged — invite to the org, then Owners/Admins assign the member to projects.
- **Backfill:** for every existing project, each current org member receives a project membership mapping org→project role (**admin → owner**, analyst → analyst, viewer → viewer). Preserves today's access exactly; isolation applies to new members/projects going forward.
- **Governance (block-only, no admin claim):** removing an org member is **blocked** if it would leave any project without an Owner (reassign first). Org admins get **no** ability to claim or delete projects they are not a member of. The ≥1-Owner invariant is enforced within a project too (last Owner can't be demoted/removed).

## Goals

- Grant project access per-user, per-project, at a specific role.
- Project creator becomes **Owner** automatically; Owners can change anyone's role (incl. other Owners); Admins cannot change/remove Owners or mint Owners.
- Preserve all existing access on ship (no lockouts) via backfill.
- Reuse existing patterns (org `RolesGuard`/`@Roles()`, org members UI) rather than inventing new ones.

## Non-goals

- No change to the org invitation system, org roles, or org-level administration.
- No change to SDK ingestion auth (project ingest tokens stay project-scoped; no user project-role involved).
- Project creation stays org-admin-gated (analysts do not gain project-creation).
- No org-admin "claim orphaned project" or cross-project delete escape hatch (per governance decision).

## Data model (Prisma / Postgres)

```prisma
enum ProjectRole {
  owner
  admin
  analyst
  viewer
}

model ProjectMembership {
  userId    String
  projectId String
  role      ProjectRole
  createdAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([userId, projectId])
  @@index([projectId])
}
```

- Add `Project.createdById String?` (nullable; FK to `User`, `onDelete: SetNull`) recorded on creation so the creator/Owner is known going forward.
- Add the inverse relations on `User` and `Project`.

### Migration & backfill

New migration `<ts>_per_project_roles`:
1. Create the `ProjectRole` enum and `ProjectMembership` table; add `Project.createdById`.
2. **Backfill** (single SQL `INSERT … SELECT`): for every `(Membership m, Project p)` where `p.orgId = m.orgId`, insert `ProjectMembership(m.userId, p.id, role)` with
   `role = CASE m.role WHEN 'admin' THEN 'owner' WHEN 'analyst' THEN 'analyst' ELSE 'viewer' END`.
   This guarantees every existing project has ≥1 Owner (its org's admins) and preserves current access.

Run via `pnpm prisma migrate dev --name per_project_roles` (dev) / `migrate deploy` (CI/test), per existing convention.

## Authorization

### Rank

`roleRank(project): owner=3, admin=2, analyst=1, viewer=0` (new `ProjectRoleResolverService`, mirroring `org-role-resolver.service.ts`).

### Enforcement seam

`ProjectsService.assertMembership(userId, projectId)` is the single chokepoint all project/analytics routes use today; it currently checks **org** membership. Change it to require a **`ProjectMembership` row** (404 if none) and return the project role. This flips the whole app to per-project access in one place. Every caller is audited during planning to confirm nothing bypasses it.

### Guard & decorator

New `@ProjectRoles(role)` + `ProjectRolesGuard` + `ProjectRoleResolverService` (parallel to the org trio). Project-scoped routes annotate the minimum project role:

- **viewer** — read analytics (all the existing project analytics GET routes).
- **analyst** — create/update reports, dashboards, cohorts, annotations.
- **admin** — project members management, SDK tokens (create/rotate/revoke), project settings (rename, log level).
- **owner** — delete project; any role change that touches an Owner (see below).

Org-scoped routes keep `@Roles()`/`RolesGuard` unchanged. SDK-token (`tokenId`) ingestion resolution is unchanged.

### Role-change & membership rules (beyond the rank gate)

`PATCH /projects/:projectId/members/:userId` and member add/remove enforce, in the service layer:

- Actor must be project **admin+**.
- **Owner-touching operations require the actor to be an Owner:** setting a target's role to `owner`, changing a target who is currently `owner`, or removing a target who is `owner`.
- An **Admin** may only set roles among `{admin, analyst, viewer}` for targets currently in `{admin, analyst, viewer}`.
- An **Owner** may set any role for anyone (incl. promoting/demoting Owners).
- **≥1-Owner invariant:** a change that would drop a project to zero Owners (demoting/removing the last Owner) is rejected (409).
- Adding a member: target must already be an **org member** of the project's org (add-member picker is drawn from org members not yet on the project); only an Owner may add someone directly as `owner`.

### Org-member removal cascade (governance)

`DELETE /orgs/:orgId/members/:userId` (existing) gains a guard: if removing the user would leave any project in the org with **zero Owners**, reject (409) with the offending project(s) named — the caller must reassign ownership first. On successful removal, the user's `ProjectMembership` rows in that org are deleted (also covered by `onDelete: Cascade` when the user row is deleted, but org-membership removal must explicitly clean project rows).

## API contract

New sub-resource under a project (mirrors `orgs/:orgId/members`):

- `GET  /api/v1/projects/:projectId/members` — `@ProjectRoles('viewer')` — list `{ userId, email, name, role }`.
- `POST /api/v1/projects/:projectId/members` — `@ProjectRoles('admin')` — body `{ userId, role }`; org-membership + owner-grant rules enforced in service.
- `PATCH /api/v1/projects/:projectId/members/:userId` — `@ProjectRoles('admin')` — body `{ role }`; owner rules + last-owner invariant enforced.
- `DELETE /api/v1/projects/:projectId/members/:userId` — `@ProjectRoles('admin')` — owner rules + last-owner invariant.

Response contract changes:

- `Project` and `ProjectListItem` gain `role: ProjectRole` (the caller's project role) — analogous to `Org.role`.
- `ProjectsService.listForUser` returns only projects where the caller has a `ProjectMembership` (was: all projects in the caller's orgs). Project creation sets `createdById` and inserts `ProjectMembership(creator, owner)`.

Zod schemas mirror the org member schemas (`projectRoleSchema`, `addProjectMemberSchema`, `updateProjectMemberRoleSchema`).

## Frontend (`dashboard/`)

- **Types:** `ProjectRole`, `PROJECT_ROLES`, `ProjectMember`; add `role` to `Project`/`ProjectListItem` in `lib/api/types.ts`.
- **Hooks (`features/projects/api.ts`):** `useProjectRole(projectId)` (reads `project.role`), `useProjectMembers`, `useAddProjectMember`, `useUpdateProjectMemberRole`, `useRemoveProjectMember`.
- **ProjectDetailPage:** new **Members** section (Neon card, like `OrgSettingsPage` `MembersSection`): members table with a role `<select>` governed by the hierarchy (Owner sees all options; Admin can't set/alter Owner), an **Add member** picker sourced from `useMembers(orgId)` minus current project members, and remove buttons. Gated on `useProjectRole` (admin+ to manage). All existing admin-gated project actions (tokens, rename, log level, delete) switch from `useOrgRole` to `useProjectRole` with the mapped minimum role (delete → owner).
- **Projects list / switcher:** naturally show only the caller's projects (backend change); adjust empty state copy ("No projects yet — ask an admin to add you, or create one").
- **OrgSettingsPage:** unchanged except optional helper text noting project access is managed per project.

## Testing

- **Backend unit:** `ProjectRoleResolverService` rank resolution (404 when no membership); `ProjectRolesGuard`; project-members service — every rule (admin-can't-touch-owner, admin-can't-mint-owner, owner-changes-anyone, last-owner 409, add-non-org-member rejected); org-member-removal orphan block.
- **Backend controller:** the four member endpoints (authz codes 403/404/409).
- **Migration:** a test asserting backfill produces the expected rows (admin→owner etc.) against a seeded DB.
- **Frontend:** project-members UI test — role-gated controls (Admin can't change an Owner; last-owner control disabled), add/remove flows.
- **E2E (tenancy):** update `dashboard/e2e-functional/tenancy.func.spec.ts` — it currently asserts "any org member sees all org projects"; change to assert per-project visibility (an org member sees only projects they're a member of).

## Rollout note

The `assertMembership` flip + `listForUser` change are a **breaking access-model change**, made non-breaking for existing users solely by the backfill. The migration and the code change must ship together; deploying the code without the backfill would lock every user out of every project.
