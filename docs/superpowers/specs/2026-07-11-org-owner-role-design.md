# Org-level `owner` role — design

**Date:** 2026-07-11
**Branch:** builds on `feat/per-project-roles`
**Status:** approved (design), pending implementation plan

## Problem

Today the org creator becomes an org `admin`, and org roles are `admin / analyst / viewer`.
Project access is granted *only* via explicit `ProjectMembership` rows — org admins get **no**
implicit project access. There is no single, protected "owner of the whole organization", and no
way to grant/remove a user's per-project access from the org settings screen (you must open each
project individually).

We want:

1. The org creator to become an **owner** with access to **every** project in the org.
2. The owner to be able to edit everyone's role, while **no one** can edit the owner.
3. A control in the org settings **Members** section to grant or remove a user's access to a
   specific project.

## Locked decisions (from brainstorming)

- **Single, transferable owner.** Exactly one owner per org (the creator). No one can edit or
  remove the owner. The owner can *transfer* ownership to another member; on transfer the new
  person becomes owner and the previous owner drops to `admin`. The org always has exactly one
  owner.
- **Grant control usable by owner + org admins.** Both the owner and org admins can grant/remove a
  user's project access from the org members section. Guarded so an admin cannot grant access to
  **themselves** (owner is exempt). The project-level `owner` role is **not** assignable from this
  control (only viewer/analyst/admin).
- **Implicit owner access at the one seam** (no minted rows).
- **Drop the last-admin guards** (owner makes org lockout impossible).
- **Migration promotes the smallest-`userId` admin** of each existing org to owner.

## Model

### Role enum

`enum Role { owner admin analyst viewer }` — `owner` is the new top tier.

Org role hierarchy becomes `owner > admin > analyst > viewer`, encoded in
`OrgRoleResolverService.ROLE_RANK` as `{ viewer: 1, analyst: 2, admin: 3, owner: 4 }`.

Because `RolesGuard` gates by `roleRank(role) >= roleRank(required)`, **owner automatically passes
every existing `@Roles('admin')` (and lower) route** — no route decorators change. Adding `owner`
to the `Record<Role, number>` is a compile-time-forcing change: TypeScript will flag every
exhaustive `Role` switch/record until `owner` is handled.

### Invariant: exactly one owner per org

- **Org creation** mints the creator as `owner` (was `admin`).
- The **owner is protected**: no role change or removal may target the current owner directly.
- **Transfer** is the only way ownership moves, and it is atomic (see below), so the org is never
  observably at 0 or 2 owners.

This single-owner invariant **replaces** the current "≥1 admin" invariant. The existing last-admin
guards in `MembersService.changeRole` / `MembersService.remove` are removed: with a guaranteed,
untouchable owner who outranks admin, the org can never be locked out of admin-gated actions, so
the guards are obsolete. (The `soleProjectOwnerConflict` / project-orphan guard in
`MembersService.remove` **stays** — it protects a different invariant.)

## Owner ⇒ access to every project (implicit at the seam)

`ProjectsService.resolveProjectRole(userId, projectId)` gains a short-circuit: after resolving the
project (and its `orgId`), if the caller's **org** `Membership.role === 'owner'`, return project
role `'owner'` — regardless of whether a `ProjectMembership` row exists.

- Flows through `assertMembership` (which calls `resolveProjectRole`) to all ~19 analytics /
  screenshot callers, and through `ProjectRolesGuard`, for free.
- **No `ProjectMembership` rows are minted** for the owner — access is derived, not stored. Nothing
  to backfill on new-project creation, nothing to clean up on transfer.
- Project-creator owner rows and the "≥1 project owner per project" rule are **unchanged**.
  Org-owner power is *additive* on top of the per-project model.
- **Consequence:** the org owner does not appear as a row in any project's member list. They hold
  blanket access above the per-project membership table. This is acceptable and called out in the
  UI ("Owner has access to all projects").

Implementation note: keep the extra org-membership lookup cheap — resolve project → check the
caller's org membership; if `owner`, return `'owner'`; otherwise fall back to the existing
`ProjectMembership` lookup (403 if none). Exact query ordering is an implementation detail as long
as an org owner always resolves to `'owner'`.

## Ownership transfer

Handled inside `MembersService.changeRole(orgId, targetUserId, newRole)`:

- When `newRole === 'owner'`, treat the call as a **transfer** rather than a plain role update:
  in one `Serializable` transaction, set the target's membership role to `owner` and set the
  current owner's membership role to `admin`.
- **Authorization** (enforced at the route + service): only the **current owner** may initiate a
  transfer. The org-members route stays `@Roles('admin')` for ordinary role changes, but assigning
  `owner` additionally requires the actor to *be* the current owner — otherwise 403.
- **Owner protection:** any `changeRole` or `remove` whose target is the current owner is rejected
  (403/409) *except* the transfer path itself (which demotes the old owner as an atomic side
  effect of promoting the new one). A member must transfer ownership away before they can be
  removed from the org (subject to the existing project-orphan guard).
- Atomicity uses the existing `runSerializable` retry wrapper for the same write-skew reasons
  documented on that method.

## Per-project grant control (org members section)

New **org-scoped** endpoints, gated `@Roles('admin')` (owner passes by rank). Kept separate from
project *data* access so org admins gain membership-management power **without** gaining implicit
read access to project analytics.

### Endpoints

- `GET /api/v1/orgs/:orgId/members/:userId/project-access`
  → `{ projects: [{ projectId, name, role: ProjectRole | null }] }` for **all** projects in the
  org (`role: null` = the user has no access to that project). A dedicated read; not the
  user-scoped `GET /projects` list.
- `PUT /api/v1/orgs/:orgId/members/:userId/project-access/:projectId`
  Body `{ role: 'viewer' | 'analyst' | 'admin' | null }`.
  - non-null → grant or change the user's role on that project (upsert semantics: add if no row,
    else change role).
  - `null` → remove the user's access to that project.

(Using `PUT` with an upsert/remove body keeps a single idempotent endpoint. A `DELETE` variant may
be used instead of `role: null` if that reads cleaner during implementation — behavior identical.)

### Service behavior (`OrgProjectAccessService` or a method on the org members service)

- Resolve the **actor's org role** (owner or admin — guaranteed ≥ admin by the guard).
- **Self-escalation guard:** if the actor is an `admin` and `targetUserId === actor.id`, reject
  with 403. Owner is exempt.
- Verify the **target is an org member** and the **project belongs to `:orgId`** (else 404).
- Map **actor org role → project actor role** for reuse of existing owner-safety logic:
  `owner → 'owner'`, `admin → 'admin'`.
- Delegate to the existing `ProjectMembersService.add / changeRole / remove`, passing the mapped
  actor role. This inherits `assertMayTouch` (only owner touches owner), the last-project-owner
  guard, and the serializable/write-skew protection. Consequently an org **admin cannot** grant,
  change, or remove a project **owner** row (they map to project-`admin`, which `assertMayTouch`
  blocks from owner-touching); the assignable roles from this control are viewer/analyst/admin.

## Frontend (`dashboard/src/features/orgs/components/OrgSettingsPage.tsx`)

### Types

- `OrgRole` gains `'owner'`: `type OrgRole = 'owner' | 'admin' | 'analyst' | 'viewer'`.
- `ORG_ROLES` includes `owner` for display, but `owner` is **not** offered in the plain role
  dropdown (assigning it goes through the Transfer flow).

### Members section

- The owner's row renders a locked **owner** badge — no role `<select>`, no **Remove** button.
- Non-owner rows keep the role dropdown (viewer/analyst/admin) for admins, as today.
- **Transfer ownership** action, visible to the owner only: a dialog to pick a member and confirm.
  On success the current user drops to admin and the chosen member becomes owner.
- **Manage project access** action on each member row, visible to owner + admin: opens a dialog
  listing the org's projects, each with a role select `None / viewer / analyst / admin`.
  - An admin's own row does not show this control (self-escalation block mirrored client-side; the
    server enforces it regardless).
  - Projects where the member already holds project-`owner` render locked (an admin can't change
    them; server enforces via `assertMayTouch`).
  - Uses the new `GET`/`PUT` project-access endpoints; invalidates the relevant queries on change.

### API client / hooks

- Add `owner` to the org role types.
- Add hooks: `useMemberProjectAccess(orgId, userId)` (query) and
  `useSetMemberProjectAccess(orgId, userId)` (mutation) wrapping the two new endpoints.
- Add a `useTransferOwnership(orgId)` mutation (or reuse `useUpdateMemberRole` with
  `role: 'owner'`), plus success handling that refreshes the members list and the caller's own org
  role (the initiator is now an admin).

## Migration

Prisma migration, deployed together with the code:

1. Add `owner` to the `Role` enum (`ALTER TYPE "Role" ADD VALUE 'owner'`). Postgres requires the
   enum value be added in its own committed step before it can be used in the same
   transaction/data update — the data backfill runs as a separate statement/migration step after
   the enum value is committed.
2. **Backfill one owner per existing org.** For each org, promote exactly one admin to `owner`.
   Since there is no stored org creator (`Organization` has no creator column and `Membership` has
   no `createdAt`), pick **deterministically the admin with the smallest `userId`** in that org.
   Orgs with no admin (should not occur under the current last-admin guard) are left unchanged.

This preserves the "exactly one owner per org" invariant for pre-existing data on ship. Because
owner access is derived at the seam, no `ProjectMembership` rows are created by the migration.

## Testing

- **Backend unit/spec:**
  - `resolveProjectRole` returns `owner` for an org owner on any project in the org (with and
    without an existing `ProjectMembership` row); still 403 for a non-owner non-member.
  - Org creation makes the creator `owner`.
  - `changeRole` transfer: promoting a member to `owner` demotes the current owner to admin
    atomically; only the current owner may initiate; owner row can't be changed/removed directly;
    exactly-one-owner holds under concurrent transfer attempts (serializable retry).
  - Last-admin guards removed: demoting/removing the last admin now succeeds (owner still present).
  - Org-scoped project-access endpoints: owner and admin can grant/change/remove viewer/analyst/
    admin; admin **cannot** self-grant; admin **cannot** touch a project-owner row; target must be
    an org member; project must belong to the org; owner-safety + last-project-owner rules hold.
  - `ROLE_RANK`/`roleRank` treat owner as highest; owner passes `@Roles('admin')` routes.
- **Backend e2e:** an org owner reads a project they were never explicitly added to; an org admin
  grants a member viewer access to a project from the org endpoint and the member can then read it.
- **Frontend:** owner row is locked (no select/remove); transfer dialog flow; manage-project-access
  dialog lists projects and toggles roles; admin's own row hides the control; MSW fixtures updated
  with `owner`.
- **Migration:** backfill spec — each seeded org ends with exactly one owner = its smallest-`userId`
  admin.

## Out of scope

- Assigning the project-level `owner` role from the org settings control (stays in the per-project
  members section).
- Surfacing the org owner as a synthetic row inside each project's member list.
- Multiple org owners / co-owners.
- Any change to the invitation flow beyond it continuing to issue admin/analyst/viewer invites
  (owner is reached only via creation or transfer, never via invite).

## Related

- `docs/superpowers/specs/2026-07-10-per-project-roles-design.md` — the per-project RBAC this builds on.
- Memory: `per-project-roles`, `neon-redesign`.
