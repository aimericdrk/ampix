import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { isUuidShaped } from '../../common/uuid';
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

  /**
   * SECURITY-CRITICAL atomicity: the org-membership re-check, the existing-project-member check,
   * and the `create()` all run inside ONE Serializable transaction (see {@link runSerializable}
   * for the write-skew rationale). Without this, `add`'s org-membership read and its `create()`
   * are two separate READ COMMITTED statements — a concurrent org-member removal (which runs
   * SERIALIZABLE itself and cascade-deletes ProjectMemberships, see `orgs/members.service.ts`)
   * can commit in between: `add` reads "org member: yes", the removal deletes the org Membership
   * and cascades away any ProjectMembership, then `add`'s `create()` commits anyway — minting a
   * ProjectMembership for someone who is no longer an org member, violating this feature's core
   * invariant "project member ⇒ org member". Postgres SSI only detects that conflict when BOTH
   * sides are serializable, so `add` must be serializable too.
   */
  async add(projectId: string, actorRole: ProjectRole, targetUserId: string, role: ProjectRole): Promise<UpdatedProjectMember> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    this.assertMayTouch(actorRole, null, role);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw this.projectNotFound();
    return this.runSerializable(() =>
      this.prisma.$transaction(async (tx) => {
        const orgMembership = await tx.membership.findUnique({
          where: { userId_orgId: { userId: targetUserId, orgId: project.orgId } },
        });
        if (!orgMembership) throw this.notOrgMember();
        // `add` only ADDS. Re-roling an existing member must go through changeRole so the owner /
        // last-owner guards apply — otherwise an admin could demote an owner via this endpoint.
        const existing = await tx.projectMembership.findUnique({
          where: { userId_projectId: { userId: targetUserId, projectId } },
        });
        if (existing) throw this.alreadyMember();
        // The pre-check above gives the clean 409 in the common case. A concurrent same-key
        // insert is normally caught by Postgres SSI first (surfacing as a P2034 serialization
        // failure, retried once by runSerializable) but keep the P2002 catch too for safety —
        // e.g. if isolation is ever weakened, or the unique-constraint race wins the timing.
        try {
          await tx.projectMembership.create({ data: { userId: targetUserId, projectId, role } });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw this.alreadyMember();
          throw err;
        }
        return { user_id: targetUserId, role };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  async changeRole(projectId: string, actorUserId: string, actorRole: ProjectRole, targetUserId: string, newRole: ProjectRole): Promise<UpdatedProjectMember> {
    if (!isUuidShaped(targetUserId)) throw this.userNotFound();
    // An actor may never change their OWN role — that would let e.g. an admin self-promote (to
    // owner) or self-demote, sidestepping the owner / last-owner guards below. Role changes must
    // always be applied by a different, sufficiently-privileged member.
    if (targetUserId === actorUserId) throw this.cannotChangeSelf();
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
  private cannotChangeSelf(): ProblemException {
    return new ProblemException({ status: 403, title: 'Forbidden', detail: 'You cannot change your own role' });
  }
}
