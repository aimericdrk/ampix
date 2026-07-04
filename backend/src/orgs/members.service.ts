import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import type { MemberListItem, UpdatedMember } from './members.types';

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

  /** 404 if `targetUserId` isn't a member of `orgId`; 409 if this would demote the last admin. */
  async changeRole(orgId: string, targetUserId: string, newRole: Role): Promise<UpdatedMember> {
    return this.prisma.$transaction(async (tx) => {
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
    });
  }

  /** 404 if `targetUserId` isn't a member of `orgId`; 409 if this would remove the last admin. */
  async remove(orgId: string, targetUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { userId_orgId: { userId: targetUserId, orgId } },
      });
      if (!membership) throw this.notFound();
      if (membership.role === 'admin') {
        const adminCount = await tx.membership.count({ where: { orgId, role: 'admin' } });
        if (adminCount <= 1) throw this.lastAdminConflict('remove');
      }
      await tx.membership.delete({ where: { userId_orgId: { userId: targetUserId, orgId } } });
    });
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
}
