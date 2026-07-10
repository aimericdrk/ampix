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
    // The pre-check above gives the clean 409 in the common case, but it and the create() below
    // are not atomic: two concurrent adds of the same (userId, projectId) both pass the check,
    // then one loses the PK unique constraint (Prisma P2002). Map that to the same 409 so the
    // race surfaces as a Conflict rather than a raw 500.
    try {
      await this.prisma.projectMembership.create({ data: { userId: targetUserId, projectId, role } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw this.alreadyMember();
      throw err;
    }
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
