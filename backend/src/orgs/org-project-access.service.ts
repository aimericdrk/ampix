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
 *
 * SELF-ACCESS SEMANTICS: the org OWNER is exempt from THIS service's self-escalation guard (an
 * admin can't manage their own project access, but an owner can grant/manage their own). That
 * exemption fully covers the ADD path (granting themselves access to a project they have no
 * ProjectMembership row in yet). However, when an owner ALREADY holds a ProjectMembership row and
 * re-targets themselves, `set()` delegates to ProjectMembersService.changeRole, whose project-level
 * self-guard (`if (targetUserId === actorUserId) throw cannotChangeSelf()`) unconditionally 403s —
 * so an owner cannot RE-ROLE their own existing project membership through this endpoint. That is an
 * intentional, deliberate project-level invariant we are NOT changing here; owners rarely need it,
 * since they already hold derived owner access to every project in the org (Task 3).
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
    // Short-circuit a malformed projectId to 404 rather than letting a bad uuid literal reach
    // Postgres and surface as a generic 500 (matches the rest of the codebase, see common/uuid.ts).
    if (!isUuidShaped(projectId)) throw this.projectNotFound();
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
    // ProjectMembersService.changeRole also forbids an actor from changing their OWN project role
    // (a distinct, project-scoped self-guard from the org-level one above) — pass actorUserId
    // through unchanged so that guard still applies when it's the same person.
    const res = await this.projectMembers.changeRole(
      projectId,
      actorUserId,
      projectActorRole,
      targetUserId,
      role,
    );
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
