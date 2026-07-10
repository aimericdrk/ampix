import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
import type { MemberListItem, UpdatedMember } from './members.types';

/** Prisma's error code for a Postgres serialization failure (SQLSTATE 40001) surfaced from an
 *  interactive transaction — see {@link MembersService.runSerializable}. */
const SERIALIZATION_FAILURE_CODE = 'P2034';

/**
 * Org member listing/role-change/removal (contracts §13). `orgId` is assumed already validated
 * to exist (RolesGuard resolved it before the controller method ran). The last-admin protections
 * here are SECURITY-CRITICAL: without them an org could be left with zero admins, permanently
 * locking every member out of admin-only mutations.
 */
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string): Promise<MemberListItem[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId },
      include: { user: true },
    });
    return memberships.map((membership) => ({
      user: { id: membership.user.id, email: membership.user.email, name: membership.user.name },
      role: membership.role,
    }));
  }

  /**
   * 404 if `targetUserId` isn't UUID-shaped or isn't a member of `orgId`; 409 if this would
   * demote the last admin. SECURITY-CRITICAL atomicity: see {@link runSerializable}.
   */
  async changeRole(orgId: string, targetUserId: string, newRole: Role): Promise<UpdatedMember> {
    if (!isUuidShaped(targetUserId)) throw this.notFound();
    return this.runSerializable(() =>
      this.prisma.$transaction(
        async (tx) => {
          const membership = await tx.membership.findUnique({
            where: { userId_orgId: { userId: targetUserId, orgId } },
          });
          if (!membership) throw this.notFound();
          if (membership.role === 'admin' && newRole !== 'admin') {
            const adminCount = await tx.membership.count({ where: { orgId, role: 'admin' } });
            if (adminCount <= 1) throw this.lastAdminConflict('demote');
          }
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

  /**
   * 404 if `targetUserId` isn't UUID-shaped or isn't a member of `orgId`; 409 if this would
   * remove the last admin, OR if this would leave any project in the org with zero owners.
   * On success, the target's `ProjectMembership` rows for this org's projects are cascade-deleted
   * along with the org `Membership` itself. SECURITY-CRITICAL atomicity: see
   * {@link runSerializable}. The orphan check and cascade run INSIDE the same serializable
   * transaction as the last-admin check for the same write-skew-safety reason (see
   * `runSerializable`'s doc comment) — otherwise a concurrent org-member removal and project
   * ownership change could race past both reads and leave a project permanently unmanageable.
   */
  async remove(orgId: string, targetUserId: string): Promise<void> {
    if (!isUuidShaped(targetUserId)) throw this.notFound();
    await this.runSerializable(() =>
      this.prisma.$transaction(
        async (tx) => {
          const membership = await tx.membership.findUnique({
            where: { userId_orgId: { userId: targetUserId, orgId } },
          });
          if (!membership) throw this.notFound();
          if (membership.role === 'admin') {
            const adminCount = await tx.membership.count({ where: { orgId, role: 'admin' } });
            if (adminCount <= 1) throw this.lastAdminConflict('remove');
          }

          // Projects in this org this user owns:
          const ownedHere = await tx.projectMembership.findMany({
            where: { userId: targetUserId, role: 'owner', project: { orgId } },
            select: { projectId: true },
          });
          for (const { projectId } of ownedHere) {
            const owners = await tx.projectMembership.count({ where: { projectId, role: 'owner' } });
            if (owners <= 1) throw this.soleProjectOwnerConflict();
          }
          // Cascade: drop their project memberships in this org before removing org membership.
          await tx.projectMembership.deleteMany({ where: { userId: targetUserId, project: { orgId } } });

          await tx.membership.delete({ where: { userId_orgId: { userId: targetUserId, orgId } } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /**
   * Runs `run` (a full `$transaction(...)` call) and retries it EXACTLY ONCE if Postgres aborts
   * it with a serialization failure.
   *
   * Why this is needed (and why a single conditional UPDATE/DELETE statement alone would NOT be
   * enough): the last-admin guard above reads the admin count, then writes, all inside one DB
   * transaction — but at the default READ COMMITTED isolation level that is still vulnerable to
   * "write skew". Two concurrent transactions — one demoting admin A, one demoting admin B of the
   * SAME org — each read the admin count (2), each see it's > 1, and each go on to write a
   * DIFFERENT row (A's, B's). Neither write conflicts with the other at the row level, so both
   * commit — leaving zero admins, exactly the outcome this guard exists to prevent. This is a
   * classic write-skew anomaly, and no amount of restructuring the read+write into a single SQL
   * statement fixes it UNLESS that statement also takes an explicit lock on every admin row.
   * Postgres's SERIALIZABLE isolation (SSI) instead detects the anomaly via predicate locking and
   * aborts one of the two transactions with a serialization failure (SQLSTATE 40001 / Prisma
   * P2034) — we retry that one, and the retry re-reads the now-committed state.
   */
  private async runSerializable<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (this.isSerializationFailure(err)) return run();
      throw err;
    }
  }

  private isSerializationFailure(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === SERIALIZATION_FAILURE_CODE
    );
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Member not found' });
  }

  private lastAdminConflict(action: 'demote' | 'remove'): ProblemException {
    return new ProblemException({
      status: 409,
      title: 'Conflict',
      detail: `Cannot ${action} the last admin of this organization`,
    });
  }

  private soleProjectOwnerConflict(): ProblemException {
    return new ProblemException({
      status: 409,
      title: 'Conflict',
      detail:
        'Cannot remove this member; they are the only owner of one or more projects. Reassign ownership first.',
    });
  }
}
