# Per-Project Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-project roles (`owner > admin > analyst > viewer`) so org members are granted access to specific projects at a specific level, replacing today's "every org member sees every project."

**Architecture:** New `ProjectMembership` table + a `@ProjectRoles()`/`ProjectRolesGuard`/`ProjectRoleResolverService` trio parallel to the existing org authz. The access-model flip happens at one seam — `ProjectsService.assertMembership` starts requiring a `ProjectMembership` row instead of an org `Membership`. A migration backfills existing access so nothing breaks. Backend first (model → authz → members API), then frontend, then e2e.

**Tech Stack:** NestJS 11 + Prisma 6 + Postgres (backend, `backend/`); React 18 + TanStack Query/Router + Vitest (dashboard, `dashboard/`).

**Spec:** `docs/superpowers/specs/2026-07-10-per-project-roles-design.md`

## Global Constraints

- Backend commands run from `/Users/aimeric/Documents/personnal-project/MyAmpix/backend`; frontend from `/Users/aimeric/Documents/personnal-project/MyAmpix/dashboard`.
- Project role ladder: `owner > admin > analyst > viewer`. Rank: owner=4, admin=3, analyst=2, viewer=1.
- Role-change rules (service layer, not just rank): only an **Owner** may set a target to `owner`, change a target who is currently `owner`, or remove an `owner`; an **Admin** may only manage `{admin, analyst, viewer}` among targets currently in `{admin, analyst, viewer}`; every project keeps **≥1 Owner** (demoting/removing the last Owner → 409).
- Org-member removal is **blocked (409)** if it would leave any project in the org with zero Owners; on success, the user's `ProjectMembership` rows in that org are deleted. No org-admin claim/delete escape hatch.
- Backfill maps org→project role on all existing projects: **admin→owner, analyst→analyst, viewer→viewer**. Migration + code ship together (code without backfill locks everyone out).
- Concurrency safety for last-Owner and orphan guards MUST use the existing `runSerializable` + `Prisma.TransactionIsolationLevel.Serializable` pattern (see `backend/src/orgs/members.service.ts` — write-skew is a real anomaly here).
- Never touch user-WIP files (this branch is separate work — check `git status`; do not stage unrelated dirty files). NEVER add Co-Authored-By trailers. Files under 500 lines.
- Every backend task: `pnpm --dir backend test` (Vitest/Jest — use the repo's configured runner; check `backend/package.json` `scripts.test`) green + `pnpm --dir backend build` (or `tsc`) clean before commit. Every frontend task: `pnpm --dir dashboard typecheck && pnpm --dir dashboard test`.
- 404/403/409 error bodies use the existing `ProblemException` (`backend/src/common/problem-details`).

## File structure

Backend (all under `backend/src/`):
- `prisma/schema.prisma` — new enum + model + `Project.createdById` (Task 1).
- `authz/project-role-resolver.service.ts`, `authz/project-roles.decorator.ts`, `authz/project-roles.guard.ts`, `authz/project-role.schema.ts` — new authz trio (Task 2).
- `projects/projects.service.ts` — flip `assertMembership`, add `resolveProjectRole`, update `listForUser`, `role` on list item (Task 3).
- `projects/project-management.service.ts` + `auth/auth.service.ts` — set `createdById` + owner membership on create (Task 3).
- `projects/project-members.{service,controller,schemas,types}.ts` — new members sub-resource (Tasks 4–6).
- `orgs/members.service.ts` — orphan guard on removal (Task 7).

Frontend (all under `dashboard/src/`):
- `lib/api/types.ts`, `features/projects/api.ts` — types + hooks (Task 8).
- `features/projects/components/ProjectDetailPage.tsx` + a new `ProjectMembersSection` (Task 9).

---

## Task 1: Prisma model + migration + backfill

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<generated>/migration.sql` (Prisma generates; you then append the backfill)
- Test: `backend/src/projects/project-membership-backfill.spec.ts` (create)

**Interfaces:**
- Produces: Prisma models `ProjectMembership { userId, projectId, role: ProjectRole, createdAt }` (composite PK `[userId, projectId]`), enum `ProjectRole = owner|admin|analyst|viewer`, and `Project.createdById String?`. Prisma client types `ProjectRole`, `ProjectMembership` importable from `@prisma/client`.

- [ ] **Step 1: Add the enum, model, and relations to `schema.prisma`.** After the existing `enum Role { ... }` block add:

```prisma
enum ProjectRole {
  owner
  admin
  analyst
  viewer
}
```

Add to `model User { ... }` (in the relations list): `projectMemberships ProjectMembership[]`
Add to `model Project { ... }`: 
```prisma
  createdById       String?             @map("created_by") @db.Uuid
  createdBy         User?               @relation("ProjectCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  projectMemberships ProjectMembership[]
```
Add to `model User { ... }`: `createdProjects Project[] @relation("ProjectCreatedBy")`
Add the new model:
```prisma
model ProjectMembership {
  userId    String      @map("user_id") @db.Uuid
  projectId String      @map("project_id") @db.Uuid
  role      ProjectRole
  createdAt DateTime    @default(now()) @map("created_at")

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([userId, projectId])
  @@index([projectId])
  @@map("project_memberships")
}
```

- [ ] **Step 2: Generate the migration.** Run: `pnpm prisma migrate dev --name per_project_roles --create-only`
Expected: a new `backend/prisma/migrations/<ts>_per_project_roles/migration.sql` containing `CREATE TYPE "ProjectRole"`, `CREATE TABLE "project_memberships"`, and `ALTER TABLE "projects" ADD COLUMN "created_by"`.

- [ ] **Step 3: Append the backfill to that `migration.sql`** (after the generated DDL):

```sql
-- Backfill: preserve today's access. Every current org member gets a project membership on every
-- project in their org. admin -> owner (they had full control), analyst -> analyst, viewer -> viewer.
INSERT INTO "project_memberships" ("user_id", "project_id", "role", "created_at")
SELECT m."user_id", p."id",
       (CASE m."role"
          WHEN 'admin'   THEN 'owner'
          WHEN 'analyst' THEN 'analyst'
          ELSE 'viewer'
        END)::"ProjectRole",
       now()
FROM "memberships" m
JOIN "projects" p ON p."org_id" = m."org_id"
ON CONFLICT ("user_id", "project_id") DO NOTHING;
```

- [ ] **Step 4: Apply + regenerate client.** Run: `pnpm prisma migrate dev --name per_project_roles` then `pnpm prisma generate`.
Expected: migration applies clean; `ProjectRole` importable from `@prisma/client`.

- [ ] **Step 5: Write the backfill test** (`project-membership-backfill.spec.ts`) using the repo's Testcontainers Postgres helper (copy the harness import from `backend/src/projects/projects.service.spec.ts`). Seed: one org, one admin user, one analyst user, one project; run `prisma migrate deploy` against the container (the helper already does this); then assert:

```ts
it('backfills admin as owner and analyst as analyst on existing projects', async () => {
  const rows = await prisma.projectMembership.findMany({ where: { projectId: project.id } });
  const byUser = new Map(rows.map((r) => [r.userId, r.role]));
  expect(byUser.get(adminUser.id)).toBe('owner');
  expect(byUser.get(analystUser.id)).toBe('analyst');
});
```
(If the container harness seeds BEFORE migrations, instead insert memberships/projects via raw SQL pre-migration; check how `projects.service.spec.ts` orders container setup and mirror it. If backfill-order testing is impractical in the harness, assert the mapping via a direct SQL run of the backfill statement against seeded rows and note it in the report.)

- [ ] **Step 6: Run** `pnpm --dir backend test project-membership-backfill` — PASS.
- [ ] **Step 7: Commit** `feat(backend): ProjectMembership model + role backfill migration`.

## Task 2: Project authz trio (rank, resolver, guard, decorator, schema)

**Files:**
- Create: `backend/src/authz/project-role.schema.ts`, `project-role-resolver.service.ts`, `project-roles.decorator.ts`, `project-roles.guard.ts`
- Modify: `backend/src/authz/authz.module.ts`
- Test: `backend/src/authz/project-role-resolver.service.spec.ts`, `backend/src/authz/project-roles.guard.spec.ts`

**Interfaces:**
- Produces:
  - `projectRoleRank(role: ProjectRole): number` and `PROJECT_ROLE_RANK` (owner=4, admin=3, analyst=2, viewer=1).
  - `ProjectRoleResolverService.resolveProjectId(params): Promise<string>` (from `:projectId` or `:tokenId`), `.resolveProjectRole(userId, projectId): Promise<ProjectRole>` (404 unknown project, 403 no membership), `.resolve(userId, params): Promise<{ projectId; role }>`.
  - `@ProjectRoles(role)` decorator (metadata key `PROJECT_ROLES_KEY = 'requiredProjectRole'`).
  - `ProjectRolesGuard` (403 when `projectRoleRank(role) < projectRoleRank(required)`).
  - `projectRoleSchema = z.enum(['owner','admin','analyst','viewer'])`.

- [ ] **Step 1: `project-role.schema.ts`:**
```ts
import { z } from 'zod';
export const projectRoleSchema = z.enum(['owner', 'admin', 'analyst', 'viewer']);
```

- [ ] **Step 2: Write failing resolver test** (`project-role-resolver.service.spec.ts`): unknown projectId → 404 (ProblemException status 404); project exists but user has no ProjectMembership → 403; membership present → returns its role. Mirror the arrange/act/assert style of `org-role-resolver.service.spec.ts`. Run — FAIL (module missing).

- [ ] **Step 3: `project-role-resolver.service.ts`:**
```ts
import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';

export interface ProjectRouteParams {
  projectId?: string;
  tokenId?: string;
}
export interface ResolvedProjectAccess {
  projectId: string;
  role: ProjectRole;
}

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, analyst: 2, admin: 3, owner: 4 };
export function projectRoleRank(role: ProjectRole): number {
  return PROJECT_ROLE_RANK[role];
}

@Injectable()
export class ProjectRoleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveProjectId(params: ProjectRouteParams): Promise<string> {
    if (params.projectId !== undefined) {
      if (!isUuidShaped(params.projectId)) throw this.notFound();
      const project = await this.prisma.project.findUnique({ where: { id: params.projectId } });
      if (!project) throw this.notFound();
      return project.id;
    }
    if (params.tokenId !== undefined) {
      if (!isUuidShaped(params.tokenId)) throw this.notFound();
      const token = await this.prisma.sdkToken.findUnique({ where: { id: params.tokenId } });
      if (!token) throw this.notFound();
      return token.projectId;
    }
    throw new Error('ProjectRoleResolverService: route has no projectId/tokenId param');
  }

  async resolveProjectRole(userId: string, projectId: string): Promise<ProjectRole> {
    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!membership) throw this.forbidden();
    return membership.role;
  }

  async resolve(userId: string, params: ProjectRouteParams): Promise<ResolvedProjectAccess> {
    const projectId = await this.resolveProjectId(params);
    const role = await this.resolveProjectRole(userId, projectId);
    return { projectId, role };
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Not found' });
  }
  private forbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'You are not a member of this project',
    });
  }
}
```

- [ ] **Step 4: `project-roles.decorator.ts`:**
```ts
import { SetMetadata } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
export const PROJECT_ROLES_KEY = 'requiredProjectRole';
export const ProjectRoles = (role: ProjectRole) => SetMetadata(PROJECT_ROLES_KEY, role);
```

- [ ] **Step 5: `project-roles.guard.ts`** (mirror `roles.guard.ts` exactly, swapping resolver + key + rank):
```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ProjectRole } from '@prisma/client';
import { ProblemException } from '../common/problem-details';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoleResolverService, projectRoleRank } from './project-role-resolver.service';
import { PROJECT_ROLES_KEY } from './project-roles.decorator';

@Injectable()
export class ProjectRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: ProjectRoleResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ProjectRole | undefined>(PROJECT_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const params = req.params as Record<string, string | undefined>;
    const { role } = await this.resolver.resolve(req.user!.id, {
      projectId: params.projectId,
      tokenId: params.tokenId,
    });
    if (projectRoleRank(role) < projectRoleRank(required)) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: `Requires ${required} project role or higher`,
      });
    }
    return true;
  }
}
```

- [ ] **Step 6: Write failing guard test** (`project-roles.guard.spec.ts`): a viewer calling an `admin`-required route → 403; an owner → allowed. Mirror `roles.guard.spec.ts`'s mocking of Reflector + resolver. Run — FAIL, then implement is already done → PASS.

- [ ] **Step 7: Register in `authz.module.ts`** — add the three providers/exports:
```ts
providers: [OrgRoleResolverService, RolesGuard, ProjectRoleResolverService, ProjectRolesGuard],
exports: [OrgRoleResolverService, RolesGuard, ProjectRoleResolverService, ProjectRolesGuard],
```
(add the imports at top).

- [ ] **Step 8: Run** `pnpm --dir backend test authz` — PASS. Commit `feat(backend): project-role authz guard, resolver, decorator`.

## Task 3: Flip the access seam — assertMembership, listForUser, project creation

**Files:**
- Modify: `backend/src/projects/projects.service.ts`
- Modify: `backend/src/projects/projects.types.ts` (add `role` to `ProjectListItem`)
- Modify: `backend/src/projects/project-management.service.ts` (create → set createdById + owner membership)
- Modify: `backend/src/auth/auth.service.ts` (registration's default project → owner membership + createdById)
- Test: update `backend/src/projects/projects.service.spec.ts`; add cases

**Interfaces:**
- Consumes: `ProjectMembership` (Task 1).
- Produces: `assertMembership(userId, projectId): Promise<void>` now requires a `ProjectMembership` row (404 unknown project / 403 no project membership); new `resolveProjectRole(userId, projectId): Promise<ProjectRole>`; `ProjectListItem` gains `role: ProjectRole`; `listForUser` returns only projects the user is a member of.

- [ ] **Step 1: Update `ProjectListItem`** in `projects.types.ts`:
```ts
import type { ProjectRole } from '@prisma/client';
export interface ProjectListItem {
  id: string;
  org_id: string;
  org_name: string;
  name: string;
  timezone: string;
  ingest_token: string | null;
  role: ProjectRole;
}
```

- [ ] **Step 2: Rewrite `listForUser`** in `projects.service.ts` to drive off `ProjectMembership`:
```ts
async listForUser(userId: string): Promise<ProjectListItem[]> {
  const memberships = await this.prisma.projectMembership.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          org: true,
          sdkTokens: { where: { revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  return memberships.map((m) => ({
    id: m.project.id,
    org_id: m.project.org.id,
    org_name: m.project.org.name,
    name: m.project.name,
    timezone: m.project.timezone,
    ingest_token: m.project.sdkTokens[0]?.token ?? null,
    role: m.role,
  }));
}
```

- [ ] **Step 3: Flip `assertMembership`** to project membership, and add `resolveProjectRole` (keep the 404/403 semantics — 404 unknown project, 403 no project membership):
```ts
async resolveProjectRole(userId: string, projectId: string): Promise<import('@prisma/client').ProjectRole> {
  if (!UUID_SHAPE.test(projectId)) throw this.notFound();
  const project = await this.prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw this.notFound();
  const membership = await this.prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!membership) throw this.forbidden();
  return membership.role;
}

async assertMembership(userId: string, projectId: string): Promise<void> {
  await this.resolveProjectRole(userId, projectId);
}
```
Update the `forbidden()` detail to `'You are not a member of this project'`. (All 24 existing callers of `assertMembership` keep working unchanged — they only care that it throws or not.)

- [ ] **Step 4: Project creation → owner membership + createdById.** In `project-management.service.ts` create method (currently `tx.project.create({...})` at ~line 36), capture the creating user id (the method must receive `userId` — check its signature; the controller has `req.user!.id`; thread it through if not already) and after creating the project + token, inside the same transaction add:
```ts
await tx.projectMembership.create({ data: { userId, projectId: created.id, role: 'owner' } });
```
and set `createdById: userId` in the `project.create` `data`. In `auth.service.ts` (registration, ~line 62, the default org+project bootstrap) do the same for the freshly-created user: set `createdById: user.id` and `tx.projectMembership.create({ data: { userId: user.id, projectId: project.id, role: 'owner' } })`.

- [ ] **Step 5: Update `projects.service.spec.ts`.** Existing tests that create a project + org membership and expect analytics access now also need a `ProjectMembership` row (or go through the create path which now makes one). Add: (a) a member with a project membership passes `assertMembership`; (b) an org member WITHOUT a project membership gets 403; (c) `listForUser` returns only membership projects with the correct `role`. Disclose every changed assertion in the report.

- [ ] **Step 6: Run** `pnpm --dir backend test projects` — PASS. Commit `feat(backend): per-project access via ProjectMembership at the assertMembership seam`.

## Task 4: Project-members schemas + types

**Files:** Create `backend/src/projects/project-members.schemas.ts`, `project-members.types.ts`

**Interfaces:**
- Produces: `addProjectMemberSchema = z.object({ userId: z.string().uuid(), role: projectRoleSchema })`; `updateProjectMemberRoleSchema = z.object({ role: projectRoleSchema })`; `ProjectMemberListItem { user: {id,email,name}; role: ProjectRole }`; `UpdatedProjectMember { user_id: string; role: ProjectRole }`.

- [ ] **Step 1:** `project-members.schemas.ts`:
```ts
import { z } from 'zod';
import { projectRoleSchema } from '../authz/project-role.schema';
export const addProjectMemberSchema = z.object({ userId: z.string().uuid(), role: projectRoleSchema });
export const updateProjectMemberRoleSchema = z.object({ role: projectRoleSchema });
export type AddProjectMemberDto = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberRoleDto = z.infer<typeof updateProjectMemberRoleSchema>;
```

- [ ] **Step 2:** `project-members.types.ts`:
```ts
import type { ProjectRole } from '@prisma/client';
export interface ProjectMemberListItem {
  user: { id: string; email: string; name: string };
  role: ProjectRole;
}
export interface UpdatedProjectMember {
  user_id: string;
  role: ProjectRole;
}
```

- [ ] **Step 3: Commit** `feat(backend): project-members schemas + types` (no test — pure types/schemas, covered by service tests next).

## Task 5: ProjectMembersService — the security-critical rules

**Files:** Create `backend/src/projects/project-members.service.ts`; Test `backend/src/projects/project-members.service.spec.ts`

**Interfaces:**
- Consumes: `ProjectMemberListItem`, `UpdatedProjectMember` (Task 4); the `runSerializable` pattern from `orgs/members.service.ts`.
- Produces: `list(projectId): Promise<ProjectMemberListItem[]>`; `add(projectId, actorRole, targetUserId, role): Promise<UpdatedProjectMember>`; `changeRole(projectId, actorRole, targetUserId, newRole): Promise<UpdatedProjectMember>`; `remove(projectId, actorRole, targetUserId): Promise<void>`. `actorRole` is the caller's already-resolved project role (the controller resolves it via the guard/resolver and passes it in).

- [ ] **Step 1: Write failing tests** (`project-members.service.spec.ts`) — the rule matrix (use the Testcontainers harness; seed org, project, users, memberships):
  - admin actor changing an owner target → 403 (ProblemException).
  - admin actor setting a target to `owner` → 403.
  - admin actor changing analyst→viewer → OK.
  - owner actor changing an owner→admin when another owner exists → OK.
  - owner actor demoting the **last** owner → 409.
  - owner actor removing the last owner → 409.
  - `add` a user who is NOT an org member of the project's org → 404 (`'User is not a member of this organization'`).
  - `add` as `owner` role by an admin actor → 403.
  - `add` a user who is ALREADY a project member → 409 (`add` only adds; re-roling goes through changeRole).
  Run — FAIL.

- [ ] **Step 2: Implement `project-members.service.ts`:**
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import type { ProjectMemberListItem, UpdatedProjectMember } from './project-members.types';

const SERIALIZATION_FAILURE_CODE = 'P2034';

@Injectable()
export class ProjectMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string): Promise<ProjectMemberListItem[]> {
    const rows = await this.prisma.projectMembership.findMany({
      where: { projectId },
      include: { user: true },
    });
    return rows.map((r) => ({
      user: { id: r.user.id, email: r.user.email, name: r.user.name },
      role: r.role,
    }));
  }

  /** Owner-touching ops require the actor to be an owner. */
  private assertMayTouch(actorRole: ProjectRole, targetRole: ProjectRole | null, nextRole: ProjectRole | null): void {
    const touchesOwner = targetRole === 'owner' || nextRole === 'owner';
    if (touchesOwner && actorRole !== 'owner') {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: 'Only an owner can grant, change, or remove an owner',
      });
    }
  }

  async add(projectId: string, actorRole: ProjectRole, targetUserId: string, role: ProjectRole): Promise<UpdatedProjectMember> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    this.assertMayTouch(actorRole, null, role);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw this.projectNotFound();
    const orgMembership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId: targetUserId, orgId: project.orgId } },
    });
    if (!orgMembership) throw this.notOrgMember();
    // `add` only ADDS. Re-roling an existing member must go through changeRole so the owner /
    // last-owner guards apply — otherwise an admin could demote an owner via this endpoint.
    const existing = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: targetUserId, projectId } },
    });
    if (existing) throw this.alreadyMember();
    await this.prisma.projectMembership.create({ data: { userId: targetUserId, projectId, role } });
    return { user_id: targetUserId, role };
  }

  async changeRole(projectId: string, actorRole: ProjectRole, targetUserId: string, newRole: ProjectRole): Promise<UpdatedProjectMember> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const m = await tx.projectMembership.findUnique({
          where: { userId_projectId: { userId: targetUserId, projectId } },
        });
        if (!m) throw this.userNotFound();
        this.assertMayTouch(actorRole, m.role, newRole);
        if (m.role === 'owner' && newRole !== 'owner') {
          const owners = await tx.projectMembership.count({ where: { projectId, role: 'owner' } });
          if (owners <= 1) throw this.lastOwner('demote');
        }
        await tx.projectMembership.update({
          where: { userId_projectId: { userId: targetUserId, projectId } },
          data: { role: newRole },
        });
        return { user_id: targetUserId, role: newRole };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  async remove(projectId: string, actorRole: ProjectRole, targetUserId: string): Promise<void> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    await this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const m = await tx.projectMembership.findUnique({
          where: { userId_projectId: { userId: targetUserId, projectId } },
        });
        if (!m) throw this.userNotFound();
        this.assertMayTouch(actorRole, m.role, null);
        if (m.role === 'owner') {
          const owners = await tx.projectMembership.count({ where: { projectId, role: 'owner' } });
          if (owners <= 1) throw this.lastOwner('remove');
        }
        await tx.projectMembership.delete({
          where: { userId_projectId: { userId: targetUserId, projectId } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  private async runSerializable<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === SERIALIZATION_FAILURE_CODE) return run();
      throw err;
    }
  }

  private projectNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Project not found' });
  }
  private userNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Member not found' });
  }
  private notOrgMember(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'User is not a member of this organization' });
  }
  private alreadyMember(): ProblemException {
    return new ProblemException({ status: 409, title: 'Conflict', detail: 'User is already a member of this project' });
  }
  private lastOwner(action: 'demote' | 'remove'): ProblemException {
    return new ProblemException({ status: 409, title: 'Conflict', detail: `Cannot ${action} the last owner of this project` });
  }
}
```

- [ ] **Step 3: Run** `pnpm --dir backend test project-members.service` — PASS. Commit `feat(backend): project members service with owner-safety rules`.

## Task 6: ProjectMembersController + module wiring

**Files:** Create `backend/src/projects/project-members.controller.ts`; Modify `backend/src/projects/projects.module.ts`; Test `backend/src/projects/project-members.controller.spec.ts`

**Interfaces:**
- Consumes: `ProjectMembersService` (Task 5), `ProjectRoleResolverService` + `ProjectRolesGuard` + `@ProjectRoles` (Task 2).
- The controller resolves the **actor's** project role (needed by the service rules) via `ProjectRoleResolverService.resolveProjectRole(req.user.id, projectId)` after the guard has already authorized the minimum rank.

- [ ] **Step 1: `project-members.controller.ts`:**
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '../auth/auth.schemas';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthRequest } from '../auth/auth.types';
import { ProjectRoles } from '../authz/project-roles.decorator';
import { ProjectRolesGuard } from '../authz/project-roles.guard';
import { ProjectRoleResolverService } from '../authz/project-role-resolver.service';
import { addProjectMemberSchema, updateProjectMemberRoleSchema } from './project-members.schemas';
import { ProjectMembersService } from './project-members.service';
import type { ProjectMemberListItem, UpdatedProjectMember } from './project-members.types';

@Controller('api/v1/projects/:projectId/members')
@UseGuards(JwtAuthGuard)
export class ProjectMembersController {
  constructor(
    private readonly members: ProjectMembersService,
    private readonly resolver: ProjectRoleResolverService,
  ) {}

  @Get()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('viewer')
  async list(@Param('projectId') projectId: string): Promise<{ members: ProjectMemberListItem[] }> {
    return { members: await this.members.list(projectId) };
  }

  @Post()
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async add(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Body() body: unknown): Promise<UpdatedProjectMember> {
    const dto = parseOrThrow(addProjectMemberSchema, body);
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    return this.members.add(projectId, actorRole, dto.userId, dto.role);
  }

  @Patch(':userId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  async changeRole(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Param('userId') userId: string, @Body() body: unknown): Promise<UpdatedProjectMember> {
    const dto = parseOrThrow(updateProjectMemberRoleSchema, body);
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    return this.members.changeRole(projectId, actorRole, userId, dto.role);
  }

  @Delete(':userId')
  @UseGuards(ProjectRolesGuard)
  @ProjectRoles('admin')
  @HttpCode(204)
  async remove(@Req() req: AuthRequest, @Param('projectId') projectId: string, @Param('userId') userId: string): Promise<void> {
    const actorRole = await this.resolver.resolveProjectRole(req.user!.id, projectId);
    await this.members.remove(projectId, actorRole, userId);
  }
}
```

- [ ] **Step 2: Wire the module** — in `projects.module.ts` add `ProjectMembersController` to `controllers` and `ProjectMembersService` to `providers`.

- [ ] **Step 3: Write controller spec** (`project-members.controller.spec.ts`) mirroring `members.controller.spec.ts`: mock the service + resolver, assert each route calls the service with the resolved actorRole and returns the mapped shape; assert the guard metadata (`@ProjectRoles('admin')` on mutations, `'viewer'` on list). Run — PASS.

- [ ] **Step 4: Run** `pnpm --dir backend test project-members` — PASS. Commit `feat(backend): project members endpoints`.

## Task 7: Org-member removal orphan guard

**Files:** Modify `backend/src/orgs/members.service.ts`; Test extend `backend/src/orgs/members.service.spec.ts`

**Interfaces:**
- Modifies `MembersService.remove(orgId, targetUserId)` to also reject (409) if removal would orphan any project (leave it with zero owners), and to delete the user's `ProjectMembership` rows for that org's projects on success.

- [ ] **Step 1: Write failing tests:** removing an org member who is the **sole owner** of a project in that org → 409 (`'Cannot remove …; they are the only owner of project(s): …'`); removing a member who is a **co-owner** (another owner exists) → OK and their project memberships in that org are gone. Run — FAIL.

- [ ] **Step 2: Extend `remove`** — inside the existing serializable transaction, after the last-admin check and before the membership delete, add the orphan check + cascade:
```ts
// Projects in this org this user owns:
const ownedHere = await tx.projectMembership.findMany({
  where: { userId: targetUserId, role: 'owner', project: { orgId } },
  select: { projectId: true },
});
for (const { projectId } of ownedHere) {
  const owners = await tx.projectMembership.count({ where: { projectId, role: 'owner' } });
  if (owners <= 1) {
    throw new ProblemException({
      status: 409, title: 'Conflict',
      detail: 'Cannot remove this member; they are the only owner of one or more projects. Reassign ownership first.',
    });
  }
}
// Cascade: drop their project memberships in this org before removing org membership.
await tx.projectMembership.deleteMany({ where: { userId: targetUserId, project: { orgId } } });
```
(The `Membership` delete already present stays last.)

- [ ] **Step 3: Run** `pnpm --dir backend test members.service` — PASS. Commit `feat(backend): block org-member removal that would orphan a project`.

## Task 8: Frontend types + hooks

**Files:** Modify `dashboard/src/lib/api/types.ts`, `dashboard/src/features/projects/api.ts`

**Interfaces:**
- Produces: `ProjectRole = 'owner'|'admin'|'analyst'|'viewer'`, `PROJECT_ROLES` array, `ProjectMember` type, `role` field on `Project`/`ProjectListItem`; hooks `useProjectRole(projectId)`, `useProjectMembers(projectId)`, `useAddProjectMember(projectId)`, `useUpdateProjectMemberRole(projectId)`, `useRemoveProjectMember(projectId)`.

- [ ] **Step 1: Types.** In `types.ts` add near the org role types:
```ts
export type ProjectRole = 'owner' | 'admin' | 'analyst' | 'viewer';
export const PROJECT_ROLES: ProjectRole[] = ['owner', 'admin', 'analyst', 'viewer'];
export interface ProjectMember {
  user: { id: string; email: string; name: string };
  role: ProjectRole;
}
```
Add `role: ProjectRole;` to the `Project`/`ProjectListItem` interface(s) (whichever the projects list returns — match the backend `ProjectListItem`).

- [ ] **Step 2: Hooks.** In `features/projects/api.ts` mirror the org member hooks in `features/orgs/api.ts` (same `useQuery`/`useMutation` + `apiFetch` + query-key + invalidation shape). `useProjectRole(projectId)` reads `role` off the cached project from the projects list query (mirror `useOrgRole`). The four member hooks hit `/api/v1/projects/:projectId/members[...]` and invalidate the members query key on success. Write the actual hook bodies by copying the org equivalents and substituting the URL/keys/types — include them in full in the commit (no placeholders).

- [ ] **Step 3:** `pnpm --dir dashboard typecheck` clean. Commit `feat(dashboard): project role types + member hooks`.

## Task 9: ProjectDetailPage members section + project-role gating

**Files:** Modify `dashboard/src/features/projects/components/ProjectDetailPage.tsx` (+ optional new `ProjectMembersSection.tsx` sibling if it would exceed 500 lines); Modify `dashboard/src/features/projects/components/ProjectsPage.tsx` (empty-state copy); Test `dashboard/src/features/projects/components/project-members.test.tsx`

**Interfaces:**
- Consumes: Task 8 hooks; the Neon `Card`/`Badge`/`Select`/`Button`/`DataTable`/`EmptyState` components; the `useMembers(orgId)` hook (org members, to populate the add-member picker).

- [ ] **Step 1: Write the failing UI test** (`project-members.test.tsx`) with MSW handlers for the members endpoints: (a) an Owner sees a role `<select>` including "owner" for other members; (b) an Admin viewing an Owner row sees the role control disabled/absent for that row; (c) the last-owner row's remove control is disabled; (d) the add-member picker lists org members not already on the project. Mirror `org-settings.test.tsx` setup. Run — FAIL.

- [ ] **Step 2: Build `ProjectMembersSection`** (mirror `OrgSettingsPage`'s `MembersSection`, Neon-styled per the sweep recipe): members `DataTable`; role `<select>` whose options + disabled state follow the rules — Admins can't set/alter `owner`, the last-owner control is disabled; an "Add member" row with a `Select` sourced from `useMembers(orgId)` filtered to non-members, plus a role `Select`; remove buttons gated the same way. Gate the whole management UI on `useProjectRole(projectId)` being `admin`+ (owner/admin see controls; analyst/viewer see a read-only list).

- [ ] **Step 3: Switch project-page gating** from `useOrgRole(project.org_id)` to `useProjectRole(project.id)` for the existing admin-gated actions in `ProjectDetailPage` (tokens create/rotate/revoke, rename, log level → `admin`+; delete project → `owner`). Update `ProjectsPage` empty-state copy to "No projects yet — ask an admin to add you to one, or create a project." (keep the create button gated on org-admin as today).

- [ ] **Step 4: Run** `pnpm --dir dashboard typecheck && pnpm --dir dashboard test` — PASS (update `project-detail.test.tsx`/`project-management.test.tsx` only where they asserted org-role gating that is now project-role gating; disclose each). Commit `feat(dashboard): project members section + per-project role gating`.

## Task 10: Tenancy e2e for per-project visibility

**Files:** Modify `dashboard/e2e-functional/tenancy.func.spec.ts`

- [ ] **Step 1:** Read the current spec. It asserts an org member sees all org projects. Change to: an org member sees only projects they have a `ProjectMembership` on; a second org member added to only one of two projects sees exactly that one. Use the existing e2e harness/fixtures. If the harness seeds via the API, the create-project path now grants owner automatically; add a second project the user is NOT added to and assert it's absent from their list and returns 403 on direct access.
- [ ] **Step 2: Run** `pnpm --dir dashboard e2e` (or the func config the file uses). If e2e is environmentally blocked (needs a live backend/browser), capture the reason and mark this task for the user to run — do not chase environment setup. Commit `test(e2e): per-project visibility replaces org-wide project access`.

---

## Self-review notes

- Spec §data-model → Task 1; §authz (rank/resolver/guard/decorator) → Task 2; §enforcement seam (assertMembership flip, listForUser, `role` on project, creation→owner) → Task 3; §API contract (4 member endpoints) → Tasks 4–6; §role-change & membership rules → Task 5; §org-member-removal cascade/orphan block → Task 7; §frontend (types/hooks/ProjectDetailPage/list copy) → Tasks 8–9; §testing (backend units, migration, frontend, e2e) → per-task + Task 10.
- Backfill mapping (admin→owner/analyst→analyst/viewer→viewer) stated in Task 1 Step 3 and its test in Step 5.
- Ship-together constraint (migration + code) is inherent: Task 1 (migration) precedes Task 3 (code flip); both land before any deploy.
- Rank values consistent everywhere: owner=4, admin=3, analyst=2, viewer=1 (Global Constraints + Task 2).
- Names consistent: `ProjectMembership`, `ProjectRole`, `resolveProjectRole`, `assertMembership`, `@ProjectRoles`, `ProjectRolesGuard`, `ProjectRoleResolverService`, `ProjectMembersService`, `ProjectMembersController` across all tasks.
- 403-vs-404 for project non-membership: kept as 403 (matches the existing `assertMembership` shape; backfill ensures existing cross-org isolation tests still get 403).
