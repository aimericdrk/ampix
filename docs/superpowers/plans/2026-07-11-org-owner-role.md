# Org-level `owner` role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single, transferable, untouchable org `owner` that has implicit access to every project in the org, plus a control in org settings for owner/admins to grant or remove a user's per-project access.

**Architecture:** `owner` becomes the top of the org role hierarchy (`owner > admin > analyst > viewer`), so it passes every existing `@Roles('admin')` route by rank with no route changes. Owner project access is *derived* at the single `ProjectsService.resolveProjectRole` seam — no `ProjectMembership` rows are minted. Ownership transfer and the org-scoped project-access grant endpoints reuse the existing serializable/owner-safety machinery in `MembersService` / `ProjectMembersService`.

**Tech Stack:** NestJS + Prisma (Postgres) backend with Jest specs (real-Postgres integration specs + mocked-Prisma unit specs); React + TanStack Query + Vitest + MSW dashboard.

## Global Constraints

- Keep files under 500 lines; typed interfaces for public APIs (project CLAUDE.md).
- Do NOT commit any file — the user commits. Each task's "Commit" step lists the `git add`/message for the user to run; the implementer stages nothing unless the user says so.
- Backend error responses use `ProblemException` (RFC7807) with `{ status, title, detail }`.
- Org role hierarchy: `owner > admin > analyst > viewer`. Project role hierarchy unchanged: `owner > admin > analyst > viewer`.
- `owner` is reachable ONLY via org creation or ownership transfer — never via invitation. Invitation roles stay `admin | analyst | viewer`.
- Exactly one owner per org, always. Transfer is atomic (never observably 0 or 2 owners).
- Owner project access is derived at the seam — never minted as `ProjectMembership` rows.
- Assignable roles from the org-settings project-access control: `viewer | analyst | admin` (never project `owner`).
- Migration + code deploy together.

---

## File Structure

**Backend — modify:**
- `backend/prisma/schema.prisma` — add `owner` to `enum Role`.
- `backend/src/authz/org-role-resolver.service.ts` — `ROLE_RANK` gains `owner: 4`.
- `backend/src/authz/role.schema.ts` — add `orgRoleSchema` (with owner) alongside the invite-only `roleSchema`.
- `backend/src/orgs/orgs.service.ts` + `orgs.types.ts` — creator becomes `owner`.
- `backend/src/projects/projects.service.ts` — org-owner short-circuit in `resolveProjectRole`.
- `backend/src/orgs/members.schemas.ts` — `changeMemberRoleSchema` accepts owner (for transfer).
- `backend/src/orgs/members.service.ts` — transfer + owner protection; drop last-admin guards.
- `backend/src/orgs/members.controller.ts` — pass `actorUserId` into `changeRole`.
- `backend/src/orgs/orgs.module.ts` — register the new project-access provider/controller.

**Backend — create:**
- `backend/prisma/migrations/<ts>_add_owner_role/migration.sql` — `ALTER TYPE "Role" ADD VALUE`.
- `backend/prisma/migrations/<ts>_backfill_org_owner/migration.sql` — promote one admin per org.
- `backend/src/orgs/org-project-access.types.ts` — response types.
- `backend/src/orgs/org-project-access.schemas.ts` — request body schema.
- `backend/src/orgs/org-project-access.service.ts` — list + set project access, actor-role mapping, self-escalation guard.
- `backend/src/orgs/org-project-access.controller.ts` — `GET` + `PUT` routes.
- `backend/src/orgs/org-project-access.service.spec.ts`, `backend/src/orgs/owner-backfill.spec.ts`.

**Frontend — modify:**
- `dashboard/src/lib/api/types.ts` — `OrgRole` gains `owner`; new project-access interfaces.
- `dashboard/src/features/orgs/api.ts` — project-access + transfer hooks.
- `dashboard/src/features/orgs/components/OrgSettingsPage.tsx` — owner row lock, transfer dialog, manage-project-access dialog.
- `dashboard/src/test/msw/handlers.ts` — owner fixture + transfer semantics + new endpoints.
- `dashboard/src/features/orgs/components/org-settings.test.tsx` — updated + new tests.

---

## Task 1: Add `owner` to the org `Role` enum + rank

**Files:**
- Modify: `backend/prisma/schema.prisma:10-14`
- Modify: `backend/src/authz/org-role-resolver.service.ts:19`
- Create: `backend/prisma/migrations/<timestamp>_add_owner_role/migration.sql`
- Test: `backend/src/authz/org-role-resolver.service.spec.ts`

**Interfaces:**
- Produces: `Role` union now includes `'owner'`; `roleRank('owner') === 4` (highest). Every exhaustive `Record<Role, …>` must handle `owner`.

- [ ] **Step 1: Write the failing test** — append to `org-role-resolver.service.spec.ts`:

```ts
import { roleRank } from './org-role-resolver.service';

describe('roleRank — owner tier', () => {
  it('ranks owner above admin', () => {
    expect(roleRank('owner')).toBeGreaterThan(roleRank('admin'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/authz/org-role-resolver.service.spec.ts -t "owner tier"`
Expected: FAIL — TS error / `owner` not assignable to `Role` (enum not yet added).

- [ ] **Step 3: Add `owner` to the Prisma enum** — `backend/prisma/schema.prisma`:

```prisma
enum Role {
  owner
  admin
  analyst
  viewer
}
```

- [ ] **Step 4: Generate the enum-add migration (create-only) and client**

Run: `cd backend && npx prisma migrate dev --create-only --name add_owner_role && npx prisma generate`
Expected: a new `migrations/<ts>_add_owner_role/migration.sql` containing `ALTER TYPE "Role" ADD VALUE 'owner';`. Confirm it contains ONLY the enum addition (no data statements — the backfill is a separate migration in Task 8). If Prisma placed `owner` last in the enum, that is fine; ordering does not affect `ROLE_RANK`.

- [ ] **Step 5: Add the rank** — `backend/src/authz/org-role-resolver.service.ts`, update `ROLE_RANK` and its doc comment:

```ts
const ROLE_RANK: Record<Role, number> = { viewer: 1, analyst: 2, admin: 3, owner: 4 };

/** owner > admin > analyst > viewer, as a comparable number ("a route needs role >= the required level"). */
export function roleRank(role: Role): number {
  return ROLE_RANK[role];
}
```

- [ ] **Step 6: Typecheck to surface every exhaustive `Role` use**

Run: `cd backend && npx tsc --noEmit`
Expected: PASS. If any `Record<Role, …>` or switch is now non-exhaustive, fix it to handle `owner` (grep `Record<Role` and `case 'admin'`). Do NOT add `owner` to the invite `roleSchema` (that stays admin/analyst/viewer — handled in Task 5).

- [ ] **Step 7: Apply the migration and run the test**

Run: `cd backend && npx prisma migrate dev && npx jest src/authz/org-role-resolver.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit** (user runs)

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/authz/org-role-resolver.service.ts backend/src/authz/org-role-resolver.service.spec.ts
git commit -m "feat(backend): add org owner role to Role enum + rank"
```

---

## Task 2: Org creation mints the creator as `owner`

**Files:**
- Modify: `backend/src/orgs/orgs.service.ts:14-22`
- Modify: `backend/src/orgs/orgs.types.ts` (the `CreatedOrg.role` type, if it is narrowed)
- Test: `backend/src/orgs/orgs.service.spec.ts`

**Interfaces:**
- Produces: `OrgsService.create(userId, name)` returns `{ id, name, role: 'owner' }` and writes a `Membership` with `role: 'owner'`.

- [ ] **Step 1: Write the failing test** — in `orgs.service.spec.ts`, add/adjust a case:

```ts
it('makes the creator the org owner', async () => {
  const created = await service.create(user.id, 'Acme');
  expect(created.role).toBe('owner');
  const membership = await prisma.membership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId: created.id } },
  });
  expect(membership?.role).toBe('owner');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/orgs/orgs.service.spec.ts -t "creator the org owner"`
Expected: FAIL — role is `'admin'`.

- [ ] **Step 3: Implement** — `backend/src/orgs/orgs.service.ts`:

```ts
  /** Creates the org and an owner Membership for the creator, atomically. */
  async create(userId: string, name: string): Promise<CreatedOrg> {
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name } });
      await tx.membership.create({ data: { userId, orgId: created.id, role: 'owner' } });
      return created;
    });
    return { id: org.id, name: org.name, role: 'owner' };
  }
```

If `orgs.types.ts` narrows `CreatedOrg.role` to a literal (e.g. `'admin'`), widen it to `Role`.

- [ ] **Step 4: Update any existing spec assumptions** — search `orgs.service.spec.ts` / `orgs.controller.spec.ts` for `role).toBe('admin')` on creation and update to `'owner'`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npx jest src/orgs/orgs.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (user runs)

```bash
git add backend/src/orgs/orgs.service.ts backend/src/orgs/orgs.types.ts backend/src/orgs/orgs.service.spec.ts
git commit -m "feat(backend): org creator becomes owner"
```

---

## Task 3: Implicit owner access at `resolveProjectRole`

**Files:**
- Modify: `backend/src/projects/projects.service.ts:90-105`
- Test: `backend/src/projects/projects.service.spec.ts`

**Interfaces:**
- Consumes: `Membership` (org role), `Project.orgId`.
- Produces: `resolveProjectRole(userId, projectId)` returns `'owner'` for a user whose **org** membership on the project's org is `owner`, even with no `ProjectMembership` row; otherwise unchanged (existing `ProjectMembership` lookup, 403 if none, 404 if project/uuid bad).

- [ ] **Step 1: Write the failing tests** — in `projects.service.spec.ts`:

```ts
it('resolves an org owner to project owner without a ProjectMembership row', async () => {
  // orgOwner has Membership role 'owner' on the project's org, and NO projectMembership row
  const role = await service.resolveProjectRole(orgOwner.id, project.id);
  expect(role).toBe('owner');
});

it('still 403s a non-owner org member with no project membership', async () => {
  await expect(service.resolveProjectRole(plainOrgMember.id, project.id)).rejects.toMatchObject({
    problem: { status: 403 },
  });
});
```

Seed `orgOwner` with `membership.create({ userId, orgId: project.orgId, role: 'owner' })` and no `projectMembership`; `plainOrgMember` with org role `analyst` and no project membership.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/projects/projects.service.spec.ts -t "org owner"`
Expected: FAIL — org owner currently 403s (no project membership).

- [ ] **Step 3: Implement the short-circuit** — `backend/src/projects/projects.service.ts`, inside `resolveProjectRole` after the project lookup, before the `projectMembership` lookup:

```ts
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw this.notFound();
    }
    // Org owners have derived owner access to every project in their org — no ProjectMembership
    // row is minted for them (per-project-roles owner model is additive above the org owner).
    const orgMembership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (orgMembership?.role === 'owner') {
      return 'owner';
    }
    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!membership) {
      throw this.forbidden();
    }
    return membership.role;
```

Update the method's doc comment to note the org-owner short-circuit.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/projects/projects.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (user runs)

```bash
git add backend/src/projects/projects.service.ts backend/src/projects/projects.service.spec.ts
git commit -m "feat(backend): org owner has derived access to every project"
```

---

## Task 4: Ownership transfer + owner protection; drop last-admin guards

**Files:**
- Modify: `backend/src/authz/role.schema.ts`
- Modify: `backend/src/orgs/members.schemas.ts`
- Modify: `backend/src/orgs/members.service.ts`
- Modify: `backend/src/orgs/members.controller.ts`
- Test: `backend/src/orgs/members.service.spec.ts`, `backend/src/orgs/members.service.unit.spec.ts`

**Interfaces:**
- Consumes: `runSerializable`, `Membership`.
- Produces:
  - `orgRoleSchema = z.enum(['owner','admin','analyst','viewer'])` (exported from `role.schema.ts`); `roleSchema` unchanged (`admin|analyst|viewer`).
  - `MembersService.changeRole(orgId, actorUserId, targetUserId, newRole)` — **new signature** (adds `actorUserId`). `newRole === 'owner'` performs an atomic transfer; direct changes to the current owner's row are rejected.
  - `MembersService.remove(orgId, targetUserId)` — now also rejects removing the current owner (409). Last-admin guards removed from both methods; the project-orphan guard stays.

- [ ] **Step 1: Add the owner-inclusive schema** — `backend/src/authz/role.schema.ts`:

```ts
import { z } from 'zod';

/** The three §13 invitable Membership roles, in the shape client bodies send them. */
export const roleSchema = z.enum(['admin', 'analyst', 'viewer']);

/** Full org role set incl. `owner` — used where a member's role can be set to owner (transfer). */
export const orgRoleSchema = z.enum(['owner', 'admin', 'analyst', 'viewer']);
```

`backend/src/orgs/members.schemas.ts`:

```ts
import { z } from 'zod';
import { orgRoleSchema } from '../authz/role.schema';

export const changeMemberRoleSchema = z.object({ role: orgRoleSchema });
export type ChangeMemberRoleDto = z.infer<typeof changeMemberRoleSchema>;
```

- [ ] **Step 2: Write failing tests** — in `members.service.spec.ts` (real Postgres):

```ts
describe('changeRole — ownership transfer', () => {
  it('promoting a member to owner demotes the current owner to admin, atomically', async () => {
    // owner = creator (role owner), member = admin in same org
    const result = await service.changeRole(orgId, owner.id, member.id, 'owner');
    expect(result).toEqual({ user_id: member.id, role: 'owner' });
    expect((await membershipRole(orgId, member.id))).toBe('owner');
    expect((await membershipRole(orgId, owner.id))).toBe('admin');
    expect(await ownerCount(orgId)).toBe(1);
  });

  it('rejects a transfer initiated by a non-owner (403)', async () => {
    await expect(service.changeRole(orgId, admin.id, member.id, 'owner')).rejects.toMatchObject({
      problem: { status: 403 },
    });
  });

  it('rejects changing the current owner’s role directly (must transfer)', async () => {
    await expect(service.changeRole(orgId, owner.id, owner.id, 'admin')).rejects.toMatchObject({
      problem: { status: 409 },
    });
  });
});

describe('last-admin guard removed', () => {
  it('lets the owner demote the only admin (owner keeps the org reachable)', async () => {
    // org has exactly one admin besides the owner
    const result = await service.changeRole(orgId, owner.id, admin.id, 'viewer');
    expect(result.role).toBe('viewer');
  });
});

describe('remove — owner protection', () => {
  it('refuses to remove the current owner (409)', async () => {
    await expect(service.remove(orgId, owner.id)).rejects.toMatchObject({ problem: { status: 409 } });
  });
});
```

Add helpers `membershipRole(orgId, userId)` and `ownerCount(orgId)` mirroring the file's existing seed helpers.

- [ ] **Step 3: Run to verify they fail**

Run: `cd backend && npx jest src/orgs/members.service.spec.ts -t "transfer|owner|last-admin"`
Expected: FAIL — `changeRole` has the wrong arity / no transfer / still has last-admin guard.

- [ ] **Step 4: Implement `changeRole`** — `backend/src/orgs/members.service.ts` (replace the method):

```ts
  /**
   * 404 if `targetUserId` isn't UUID-shaped or isn't a member of `orgId`.
   * `newRole === 'owner'` is an ATOMIC OWNERSHIP TRANSFER: only the current owner (`actorUserId`)
   * may initiate it; the target becomes owner and the current owner is demoted to admin in one
   * serializable transaction, preserving "exactly one owner". The current owner's row can never be
   * changed directly (transfer only) — 409. There is no last-admin guard: a protected owner always
   * outranks admin, so the org can't be locked out. SECURITY-CRITICAL atomicity: see runSerializable.
   */
  async changeRole(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    newRole: Role,
  ): Promise<UpdatedMember> {
    if (!isUuidShaped(targetUserId)) throw this.notFound();
    return this.runSerializable(() =>
      this.prisma.$transaction(
        async (tx) => {
          const target = await tx.membership.findUnique({
            where: { userId_orgId: { userId: targetUserId, orgId } },
          });
          if (!target) throw this.notFound();

          if (newRole === 'owner') {
            // Transfer: actor must be the current owner.
            const actor = await tx.membership.findUnique({
              where: { userId_orgId: { userId: actorUserId, orgId } },
            });
            if (!actor || actor.role !== 'owner') throw this.transferForbidden();
            if (target.role === 'owner') return { user_id: targetUserId, role: 'owner' as Role };
            await tx.membership.update({
              where: { userId_orgId: { userId: actorUserId, orgId } },
              data: { role: 'admin' },
            });
            await tx.membership.update({
              where: { userId_orgId: { userId: targetUserId, orgId } },
              data: { role: 'owner' },
            });
            return { user_id: targetUserId, role: 'owner' as Role };
          }

          // Non-transfer change: the current owner's role can't be set directly.
          if (target.role === 'owner') throw this.ownerImmutable('change');
          await tx.membership.update({
            where: { userId_orgId: { userId: targetUserId, orgId } },
            data: { role: newRole },
          });
          return { user_id: targetUserId, role: newRole };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
```

- [ ] **Step 5: Implement `remove`** — remove the last-admin guard, keep the project-orphan guard, add owner protection:

```ts
  async remove(orgId: string, targetUserId: string): Promise<void> {
    if (!isUuidShaped(targetUserId)) throw this.notFound();
    await this.runSerializable(() =>
      this.prisma.$transaction(
        async (tx) => {
          const membership = await tx.membership.findUnique({
            where: { userId_orgId: { userId: targetUserId, orgId } },
          });
          if (!membership) throw this.notFound();
          if (membership.role === 'owner') throw this.ownerImmutable('remove');

          const ownedHere = await tx.projectMembership.findMany({
            where: { userId: targetUserId, role: 'owner', project: { orgId } },
            select: { projectId: true },
          });
          for (const { projectId } of ownedHere) {
            const owners = await tx.projectMembership.count({ where: { projectId, role: 'owner' } });
            if (owners <= 1) throw this.soleProjectOwnerConflict();
          }
          await tx.projectMembership.deleteMany({ where: { userId: targetUserId, project: { orgId } } });
          await tx.membership.delete({ where: { userId_orgId: { userId: targetUserId, orgId } } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
```

Delete the now-unused `lastAdminConflict` helper; add:

```ts
  private transferForbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'Only the current owner can transfer ownership',
    });
  }

  private ownerImmutable(action: 'change' | 'remove'): ProblemException {
    return new ProblemException({
      status: 409,
      title: 'Conflict',
      detail:
        action === 'remove'
          ? 'Cannot remove the organization owner; transfer ownership first'
          : "Cannot change the owner's role directly; transfer ownership instead",
    });
  }
```

- [ ] **Step 6: Update the controller** — `backend/src/orgs/members.controller.ts` `changeRole`, pass the actor:

```ts
  @Patch(':userId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async changeRole(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<UpdatedMember> {
    const dto = parseOrThrow(changeMemberRoleSchema, body);
    return this.members.changeRole(orgId, req.user!.id, userId, dto.role);
  }
```

Add `Req` to the `@nestjs/common` import and `import type { AuthRequest } from '../auth/auth.types';`.

- [ ] **Step 7: Update the unit spec** — `members.service.unit.spec.ts` calls `service.changeRole(ORG_ID, USER_1, 'viewer')` (3 args). Update all such calls to the new 4-arg signature, e.g. `service.changeRole(ORG_ID, USER_1, USER_1, 'viewer')`, and drop any assertion that depended on the removed last-admin `count` path.

- [ ] **Step 8: Run to verify pass**

Run: `cd backend && npx jest src/orgs/members`
Expected: PASS. Then `npx tsc --noEmit` → PASS.

- [ ] **Step 9: Commit** (user runs)

```bash
git add backend/src/authz/role.schema.ts backend/src/orgs/members.schemas.ts backend/src/orgs/members.service.ts backend/src/orgs/members.controller.ts backend/src/orgs/members.service.spec.ts backend/src/orgs/members.service.unit.spec.ts
git commit -m "feat(backend): ownership transfer + owner protection; drop last-admin guards"
```

---

## Task 5: Org-scoped project-access endpoints

**Files:**
- Create: `backend/src/orgs/org-project-access.types.ts`
- Create: `backend/src/orgs/org-project-access.schemas.ts`
- Create: `backend/src/orgs/org-project-access.service.ts`
- Create: `backend/src/orgs/org-project-access.controller.ts`
- Modify: `backend/src/orgs/orgs.module.ts`
- Test: `backend/src/orgs/org-project-access.service.spec.ts`

**Interfaces:**
- Consumes: `OrgRoleResolverService.resolve(userId, { orgId })` → `{ role }`; `ProjectMembersService.add/changeRole/remove(projectId, actorRole: ProjectRole, targetUserId, role?)`.
- Produces:
  - `GET /api/v1/orgs/:orgId/members/:userId/project-access` → `{ projects: Array<{ projectId: string; name: string; role: ProjectRole | null }> }`.
  - `PUT /api/v1/orgs/:orgId/members/:userId/project-access/:projectId` body `{ role: 'viewer'|'analyst'|'admin'|null }` → `{ projectId, role }` (204-style body echo) / removes when `null`.
  - `OrgProjectAccessService.list(orgId, targetUserId)` and `.set(orgId, actorUserId, actorOrgRole, targetUserId, projectId, role)`.

- [ ] **Step 1: Types + schema**

`org-project-access.types.ts`:

```ts
import type { ProjectRole } from '@prisma/client';

export interface ProjectAccessItem {
  projectId: string;
  name: string;
  role: ProjectRole | null;
}
export interface ListProjectAccessResponse {
  projects: ProjectAccessItem[];
}
```

`org-project-access.schemas.ts` (the settable roles never include `owner`; `null` clears access):

```ts
import { z } from 'zod';

export const setProjectAccessSchema = z.object({
  role: z.enum(['viewer', 'analyst', 'admin']).nullable(),
});
export type SetProjectAccessDto = z.infer<typeof setProjectAccessSchema>;
```

- [ ] **Step 2: Write failing service tests** — `org-project-access.service.spec.ts` (real Postgres):

```ts
describe('OrgProjectAccessService', () => {
  it('lists every org project with the target’s role (null where none)', async () => {
    // projectA: target is analyst; projectB: target has no membership
    const { projects } = await service.list(orgId, target.id);
    expect(projects).toEqual(
      expect.arrayContaining([
        { projectId: projectA.id, name: projectA.name, role: 'analyst' },
        { projectId: projectB.id, name: projectB.name, role: null },
      ]),
    );
  });

  it('an admin actor grants a member viewer access (add)', async () => {
    const res = await service.set(orgId, admin.id, 'admin', target.id, projectB.id, 'viewer');
    expect(res).toEqual({ projectId: projectB.id, role: 'viewer' });
  });

  it('a null role removes access', async () => {
    await service.set(orgId, admin.id, 'admin', target.id, projectA.id, null);
    const row = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: target.id, projectId: projectA.id } },
    });
    expect(row).toBeNull();
  });

  it('blocks an admin from managing their OWN project access (403)', async () => {
    await expect(
      service.set(orgId, admin.id, 'admin', admin.id, projectB.id, 'viewer'),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('lets the owner manage their own access (exempt from self-guard)', async () => {
    const res = await service.set(orgId, owner.id, 'owner', owner.id, projectB.id, 'viewer');
    expect(res.role).toBe('viewer');
  });

  it('blocks an admin from touching a project-owner row (delegates to assertMayTouch, 403)', async () => {
    // target is project owner of projectA
    await expect(
      service.set(orgId, admin.id, 'admin', target.id, projectA.id, 'viewer'),
    ).rejects.toMatchObject({ problem: { status: 403 } });
  });

  it('404s when the project is not in the org', async () => {
    await expect(
      service.set(orgId, admin.id, 'admin', target.id, otherOrgProject.id, 'viewer'),
    ).rejects.toMatchObject({ problem: { status: 404 } });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && npx jest src/orgs/org-project-access.service.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the service** — `org-project-access.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ProjectRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import { ProjectMembersService } from '../projects/project-members.service';
import type { ListProjectAccessResponse } from './org-project-access.types';

/**
 * Grant/inspect a specific org member's per-project access from org settings. Authorized at the
 * route by RolesGuard('admin') — so the actor is an org owner or admin. Kept separate from project
 * DATA access: an org admin can MANAGE membership here without gaining implicit read access to
 * project analytics. Actual mutations delegate to ProjectMembersService, inheriting its
 * owner-safety + serializable/write-skew guards.
 */
@Injectable()
export class OrgProjectAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectMembers: ProjectMembersService,
  ) {}

  async list(orgId: string, targetUserId: string): Promise<ListProjectAccessResponse> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    const projects = await this.prisma.project.findMany({
      where: { orgId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    const rows = await this.prisma.projectMembership.findMany({
      where: { userId: targetUserId, project: { orgId } },
      select: { projectId: true, role: true },
    });
    const roleByProject = new Map(rows.map((r) => [r.projectId, r.role]));
    return {
      projects: projects.map((p) => ({
        projectId: p.id,
        name: p.name,
        role: roleByProject.get(p.id) ?? null,
      })),
    };
  }

  /** `role === null` removes access; otherwise upsert (add if absent, else change role). */
  async set(
    orgId: string,
    actorUserId: string,
    actorOrgRole: Role,
    targetUserId: string,
    projectId: string,
    role: ProjectRole | null,
  ): Promise<{ projectId: string; role: ProjectRole | null }> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    // Self-escalation guard: an admin can't manage their own project access; owner is exempt.
    if (actorOrgRole !== 'owner' && targetUserId === actorUserId) throw this.selfForbidden();

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.orgId !== orgId) throw this.projectNotFound();

    // Map the actor's ORG role to the equivalent project actor role so ProjectMembersService's
    // owner-safety rules apply unchanged: org owner acts as project owner; org admin as project admin.
    const projectActorRole: ProjectRole = actorOrgRole === 'owner' ? 'owner' : 'admin';

    const existing = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: targetUserId, projectId } },
    });

    if (role === null) {
      if (!existing) return { projectId, role: null };
      await this.projectMembers.remove(projectId, projectActorRole, targetUserId);
      return { projectId, role: null };
    }
    if (!existing) {
      const res = await this.projectMembers.add(projectId, projectActorRole, targetUserId, role);
      return { projectId, role: res.role };
    }
    const res = await this.projectMembers.changeRole(projectId, projectActorRole, targetUserId, role);
    return { projectId, role: res.role };
  }

  private userNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Member not found' });
  }
  private projectNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Project not found' });
  }
  private selfForbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'Admins cannot change their own project access',
    });
  }
}
```

Note: `ProjectMembersService.add` already 404s when the target isn't an org member and 409s on duplicates — those flow through as-is.

- [ ] **Step 5: Implement the controller** — `org-project-access.controller.ts`:

```ts
import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { Roles } from '../authz/roles.decorator';
import { RolesGuard } from '../authz/roles.guard';
import { OrgRoleResolverService } from '../authz/org-role-resolver.service';
import { setProjectAccessSchema } from './org-project-access.schemas';
import { OrgProjectAccessService } from './org-project-access.service';
import type { ListProjectAccessResponse } from './org-project-access.types';

@Controller('api/v1/orgs/:orgId/members/:userId/project-access')
@UseGuards(JwtAuthGuard)
export class OrgProjectAccessController {
  constructor(
    private readonly access: OrgProjectAccessService,
    private readonly resolver: OrgRoleResolverService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async list(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ): Promise<ListProjectAccessResponse> {
    return this.access.list(orgId, userId);
  }

  @Put(':projectId')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async set(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ projectId: string; role: string | null }> {
    const dto = parseOrThrow(setProjectAccessSchema, body);
    const { role: actorOrgRole } = await this.resolver.resolve(req.user!.id, { orgId });
    return this.access.set(orgId, req.user!.id, actorOrgRole, userId, projectId, dto.role);
  }
}
```

- [ ] **Step 6: Register in the module** — `backend/src/orgs/orgs.module.ts`: add `OrgProjectAccessService` to `providers`, `OrgProjectAccessController` to `controllers`, and ensure `ProjectMembersService` + `OrgRoleResolverService` are available (import the projects/authz module or add the providers). Run `npx tsc --noEmit` and fix any DI wiring errors.

- [ ] **Step 7: Run to verify pass**

Run: `cd backend && npx jest src/orgs/org-project-access.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit** (user runs)

```bash
git add backend/src/orgs/org-project-access.* backend/src/orgs/orgs.module.ts
git commit -m "feat(backend): org-scoped per-project access grant endpoints"
```

---

## Task 6: E2E — owner reads any project; admin grants access

**Files:**
- Test: extend the existing e2e suite that covers per-project visibility (e.g. `backend/test/*.e2e-spec.ts` — mirror the file that houses the per-project-roles e2e added in commit `89ec53a`).

**Interfaces:**
- Consumes: the running Nest app + seeded org/projects.

- [ ] **Step 1: Write the e2e test**

```ts
it('an org owner reads a project they were never explicitly added to', async () => {
  // create org (creator = owner), create a project via another admin path, owner has no projectMembership
  const res = await request(app).get(`/api/v1/projects/${projectId}/events/summary`)
    .set('Authorization', `Bearer ${ownerToken}`);
  expect(res.status).toBe(200);
});

it('an admin grants a member viewer access from org settings, then the member can read', async () => {
  await request(app)
    .put(`/api/v1/orgs/${orgId}/members/${member.id}/project-access/${projectId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: 'viewer' })
    .expect(200);
  const read = await request(app).get(`/api/v1/projects/${projectId}/events/summary`)
    .set('Authorization', `Bearer ${memberToken}`);
  expect(read.status).toBe(200);
});
```

- [ ] **Step 2: Run**

Run: `cd backend && npx jest --config test/jest-e2e.json -t "org owner|grants a member"`
Expected: PASS. (If the repo's e2e runner differs, use the same command the existing per-project e2e uses.)

- [ ] **Step 3: Commit** (user runs)

```bash
git add backend/test
git commit -m "test(e2e): org owner cross-project read + admin project-access grant"
```

---

## Task 7: Migration — backfill one owner per existing org

**Files:**
- Create: `backend/prisma/migrations/<ts>_backfill_org_owner/migration.sql`
- Test: `backend/src/orgs/owner-backfill.spec.ts`

**Interfaces:**
- Produces: every existing org has exactly one `owner` = the admin with the smallest `userId`.

- [ ] **Step 1: Write the failing backfill spec** — `owner-backfill.spec.ts` (real Postgres; applies the SQL and asserts), mirroring `project-membership-backfill.spec.ts`:

```ts
it('promotes exactly one admin (smallest userId) per org to owner', async () => {
  // seed org with admins A (uuid ...01) and B (...02) + a viewer; run the backfill SQL
  await prisma.$executeRawUnsafe(BACKFILL_SQL);
  expect(await roleOf(orgId, adminA.id)).toBe('owner'); // smallest uuid
  expect(await roleOf(orgId, adminB.id)).toBe('admin');
  const owners = await prisma.membership.count({ where: { orgId, role: 'owner' } });
  expect(owners).toBe(1);
});
```

- [ ] **Step 2: Create the migration** (create-only, then hand-write SQL):

Run: `cd backend && npx prisma migrate dev --create-only --name backfill_org_owner`

Replace the generated `migration.sql` body with a per-org promotion of the lexicographically smallest admin `user_id`:

```sql
-- Promote exactly one admin per org to owner: the admin with the smallest user_id.
-- Orgs with no admin are left unchanged. Runs after the enum value 'owner' was committed
-- in the earlier add_owner_role migration.
WITH first_admin AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM memberships
  WHERE role = 'admin'
  ORDER BY org_id, user_id ASC
)
UPDATE memberships m
SET role = 'owner'
FROM first_admin fa
WHERE m.org_id = fa.org_id AND m.user_id = fa.user_id;
```

- [ ] **Step 3: Run the spec**

Run: `cd backend && npx jest src/orgs/owner-backfill.spec.ts`
Expected: PASS.

- [ ] **Step 4: Apply and sanity-check**

Run: `cd backend && npx prisma migrate dev`
Expected: applies cleanly on top of `add_owner_role`.

- [ ] **Step 5: Commit** (user runs)

```bash
git add backend/prisma/migrations backend/src/orgs/owner-backfill.spec.ts
git commit -m "feat(backend): migration backfilling one owner per existing org"
```

---

## Task 8: Frontend types, hooks, and MSW test infra

**Files:**
- Modify: `dashboard/src/lib/api/types.ts:112-114, 199-201`
- Modify: `dashboard/src/features/orgs/api.ts`
- Modify: `dashboard/src/test/msw/handlers.ts`

**Interfaces:**
- Produces:
  - `type OrgRole = 'owner' | 'admin' | 'analyst' | 'viewer'`; `ORG_ROLES` stays `['admin','analyst','viewer']` (assignable-in-dropdown set — owner excluded).
  - `interface ProjectAccessItem { projectId: string; name: string; role: ProjectRole | null }`, `interface ListProjectAccessResponse { projects: ProjectAccessItem[] }`.
  - Hooks: `useMemberProjectAccess(orgId, userId)`, `useSetMemberProjectAccess(orgId, userId)`, `useTransferOwnership(orgId)`.

- [ ] **Step 1: Types** — `dashboard/src/lib/api/types.ts`:

```ts
/** Role matrix: owner > admin > analyst > viewer. `owner` is reached only via creation/transfer. */
export type OrgRole = 'owner' | 'admin' | 'analyst' | 'viewer';

/** Roles assignable via the org role dropdown / invitations — owner is NOT here (transfer only). */
export const ORG_ROLES: OrgRole[] = ['admin', 'analyst', 'viewer'];
```

Append near the per-project types:

```ts
export interface ProjectAccessItem {
  projectId: string;
  name: string;
  role: ProjectRole | null;
}
export interface ListProjectAccessResponse {
  projects: ProjectAccessItem[];
}
export interface SetProjectAccessRequest {
  role: 'viewer' | 'analyst' | 'admin' | null;
}
```

- [ ] **Step 2: Hooks** — `dashboard/src/features/orgs/api.ts`:

```ts
export function useMemberProjectAccess(orgId: string, userId: string | null) {
  return useQuery({
    queryKey: ['orgs', orgId, 'members', userId, 'project-access'],
    enabled: userId !== null,
    queryFn: () =>
      apiFetch<ListProjectAccessResponse>(
        `/api/v1/orgs/${orgId}/members/${userId}/project-access`,
      ),
  });
}

export function useSetMemberProjectAccess(orgId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, role }: { projectId: string } & SetProjectAccessRequest) =>
      apiFetch<{ projectId: string; role: OrgRole | null }>(
        `/api/v1/orgs/${orgId}/members/${userId}/project-access/${projectId}`,
        { method: 'PUT', body: { role } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['orgs', orgId, 'members', userId, 'project-access'],
      });
    },
  });
}

/** Transfer ownership to `userId`. On success the caller drops to admin — refresh orgs + members. */
export function useTransferOwnership(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/v1/orgs/${orgId}/members/${userId}`, {
        method: 'PATCH',
        body: { role: 'owner' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'members'] });
      void queryClient.invalidateQueries({ queryKey: ORGS_QUERY_KEY });
    },
  });
}
```

Add the new type imports to the existing `import type { … }` block.

- [ ] **Step 3: MSW — owner fixture + handlers** — `dashboard/src/test/msw/handlers.ts`:
  1. Promote `TEST_USER` in `TEST_ORG_ID` from `admin` to `owner` in the seeded `memberships` (line ~638). Keep `MFA_USER` analyst, `THIRD_ORG_USER` viewer. (The org-create handler at line ~924 keeps minting `owner` too — update `role: 'admin'` → `role: 'owner'` in both the pushed membership and the `CreateOrgResponse`.)
  2. In `PATCH /api/v1/orgs/:orgId/members/:userId`: when `body.role === 'owner'`, implement transfer — require the caller be the current owner (else `problem(403, …)`); set target → owner and caller → admin. When the target is the current owner and `role !== 'owner'`, `problem(409, …)`. Remove the last-admin 409 branch (demoting the last admin now succeeds).
  3. In `DELETE /api/v1/orgs/:orgId/members/:userId`: `problem(409, …)` if the target is the org owner.
  4. Add `GET /api/v1/orgs/:orgId/members/:userId/project-access` returning every project in the org with the target's `projectRoleFor` (null when none), and `PUT …/project-access/:projectId` applying add/change/remove against `orgsState.projectMemberships` with the self-escalation guard (admin caller can't target themselves) and the project-owner-immutability guard for admin callers.

- [ ] **Step 4: Typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS (fix `roleBadgeVariant`/`ORG_ROLES` fallout in Task 9 if flagged here; owner display is added there).

- [ ] **Step 5: Commit** (user runs)

```bash
git add dashboard/src/lib/api/types.ts dashboard/src/features/orgs/api.ts dashboard/src/test/msw/handlers.ts
git commit -m "feat(dashboard): owner role types, project-access + transfer hooks, MSW infra"
```

---

## Task 9: OrgSettingsPage — owner lock, transfer, manage project access

**Files:**
- Modify: `dashboard/src/features/orgs/components/OrgSettingsPage.tsx`
- Test: `dashboard/src/features/orgs/components/org-settings.test.tsx`

**Interfaces:**
- Consumes: `useMemberProjectAccess`, `useSetMemberProjectAccess`, `useTransferOwnership`, `useOrgRole`.

- [ ] **Step 1: Write failing tests** — `org-settings.test.tsx` (signed in as `TEST_USER`, now the owner):

```ts
it('locks the owner’s own row (no role select, no remove)', async () => {
  signIn();
  renderApp(`/orgs/${TEST_ORG_ID}/settings`);
  await screen.findByText(TEST_USER.email);
  const row = screen.getByText(TEST_USER.email).closest('tr')!;
  expect(within(row).queryByLabelText(`Role for ${TEST_USER.name}`)).toBeNull();
  expect(within(row).getByText('owner')).toBeInTheDocument();
  expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull();
});

it('transfers ownership to another member', async () => {
  signIn();
  renderApp(`/orgs/${TEST_ORG_ID}/settings`);
  await screen.findByText(MFA_USER.email);
  await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));
  await userEvent.selectOptions(screen.getByLabelText('New owner'), MFA_USER.user.id ?? MFA_USER.id);
  await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));
  await waitFor(() => expect(screen.getByText('owner')).toBeInTheDocument());
});

it('grants a member viewer access to a project from the manage-access dialog', async () => {
  signIn();
  renderApp(`/orgs/${TEST_ORG_ID}/settings`);
  await screen.findByText(MFA_USER.email);
  const row = screen.getByText(MFA_USER.email).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Manage project access' }));
  const projectSelect = await screen.findByLabelText(`${TEST_PROJECT.name} access`);
  await userEvent.selectOptions(projectSelect, 'viewer');
  await waitFor(() => expect(projectSelect).toHaveValue('viewer'));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd dashboard && npx vitest run src/features/orgs/components/org-settings.test.tsx`
Expected: FAIL — controls don't exist yet.

- [ ] **Step 3: Implement `roleBadgeVariant` owner case + role gating** — in `OrgSettingsPage.tsx`:

```ts
function roleBadgeVariant(role: OrgRole): BadgeProps['variant'] {
  if (role === 'owner') return 'accent';
  if (role === 'admin') return 'accent';
  if (role === 'analyst') return 'info';
  return 'default';
}
```

Replace `const isAdmin = role === 'admin';` with `const isOwner = role === 'owner';` and `const canManage = role === 'owner' || role === 'admin';`. Pass `canManage`/`isOwner`/`currentUserId` into `MembersSection` (get the current user id from the auth store/context the app already uses). Use `canManage` where `isAdmin` gated rename/invitations/role controls.

- [ ] **Step 4: Owner-locked row + Transfer** — in `MembersSection`, in the `role` column render:

```tsx
render: (member) => {
  if (member.role === 'owner') return <Badge variant="accent">owner</Badge>;
  return canManage ? (
    <label>
      <span className="sr-only">Role for {member.user.name}</span>
      <select
        className={cn(fieldLook, 'h-8 w-auto px-2 text-sm')}
        value={member.role}
        onChange={(e) => handleRoleChange(member, e.target.value as OrgRole)}
      >
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </label>
  ) : (
    <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
  );
},
```

In the actions column, hide **Remove** for `member.role === 'owner'`. Add a "Transfer ownership" button (rendered once, above/below the table, `isOwner` only) that opens a dialog: a `<select>` labelled "New owner" listing non-owner members, and a "Transfer" button calling `useTransferOwnership(orgId).mutate(selectedUserId)` with success/error toasts.

- [ ] **Step 5: Manage project access dialog** — add a per-row action button "Manage project access" (visible when `canManage`, and hidden on the actor's OWN row unless `isOwner`). Clicking sets `manageUserId`, opening a `Dialog` that calls `useMemberProjectAccess(orgId, manageUserId)` and renders one row per project:

```tsx
{data?.projects.map((p) => (
  <label key={p.projectId} className="flex items-center justify-between gap-2">
    <span>{p.name}</span>
    <select
      aria-label={`${p.name} access`}
      className={cn(fieldLook, 'h-8 w-auto px-2 text-sm')}
      value={p.role ?? 'none'}
      disabled={p.role === 'owner'}
      onChange={(e) => {
        const v = e.target.value;
        setAccess.mutate({ projectId: p.projectId, role: v === 'none' ? null : (v as 'viewer' | 'analyst' | 'admin') });
      }}
    >
      <option value="none">None</option>
      <option value="viewer">viewer</option>
      <option value="analyst">analyst</option>
      <option value="admin">admin</option>
      {p.role === 'owner' && <option value="owner">owner</option>}
    </select>
  </label>
))}
```

Projects where `p.role === 'owner'` render the select disabled (locked). Wire `useSetMemberProjectAccess(orgId, manageUserId)` with an error toast (surface 403/409 problem titles).

- [ ] **Step 6: Run tests + typecheck**

Run: `cd dashboard && npx vitest run src/features/orgs/components/org-settings.test.tsx && npx tsc --noEmit`
Expected: PASS. Update any pre-existing org-settings test that asserted the removed last-admin toast or assumed `TEST_USER` is `admin` (e.g. an "admin" heading/role-label expectation → `owner`).

- [ ] **Step 7: Commit** (user runs)

```bash
git add dashboard/src/features/orgs/components/OrgSettingsPage.tsx dashboard/src/features/orgs/components/org-settings.test.tsx
git commit -m "feat(dashboard): owner-locked row, ownership transfer, per-project access grant UI"
```

---

## Task 10: Full-suite verification

- [ ] **Step 1: Backend**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: PASS. (The pre-existing `analytics-reads.e2e` `distinct_ids` drift noted in the per-project-roles memory is unrelated; confirm no NEW failures.)

- [ ] **Step 2: Frontend**

Run: `cd dashboard && npx tsc --noEmit && npx vitest run && npm run lint`
Expected: PASS.

- [ ] **Step 3: graphify update**

Run: `graphify update .`

- [ ] **Step 4: Final commit if anything remains** (user runs) — only if graphify or lint auto-fixes produced changes.

---

## Self-Review

**Spec coverage:**
- Owner role + rank → Task 1. ✓
- Creator becomes owner → Task 2. ✓
- Owner ⇒ every-project access (implicit at seam) → Task 3. ✓
- Single, transferable, untouchable owner (atomic transfer, owner protection, drop last-admin) → Task 4. ✓
- Owner + admin per-project grant control, self-escalation guard, owner-role not assignable, actor-role mapping → Task 5 (backend), Task 9 (UI). ✓
- Migration backfill (smallest-userId admin) → Task 7. ✓
- Frontend types/hooks/UI + MSW → Tasks 8–9. ✓
- E2E owner cross-project read + admin grant → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows code. The one deliberately under-specified spot (Task 8 §3 handler edits, Task 9 §6 pre-existing-test updates) references exact handler locations/line anchors and exact new behavior rather than "handle it".

**Type consistency:** `changeRole(orgId, actorUserId, targetUserId, newRole)` used consistently in service (Task 4), controller (Task 4 §6), and unit spec (Task 4 §7). `OrgProjectAccessService.set(orgId, actorUserId, actorOrgRole, targetUserId, projectId, role)` matches its controller call. `ProjectAccessItem`/`ListProjectAccessResponse` identical across backend types (Task 5) and frontend types (Task 8). `ORG_ROLES` stays owner-free everywhere; `OrgRole` includes owner everywhere.
