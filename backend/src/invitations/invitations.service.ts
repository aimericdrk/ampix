import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import type {
  AcceptedInvitation,
  CreatedInvitation,
  InvitationListItem,
  PublicInvitation,
} from './invitations.types';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (contracts §13)
const TOKEN_BYTES = 24;

/**
 * Shareable-link invitations (contracts §13, no email provider). `orgId`/`invitationId` scoping
 * to a given org is assumed already validated by the caller (RolesGuard resolves+checks org
 * access for the org-scoped routes) EXCEPT where noted: `remove` and the public
 * get-by-token/accept paths re-derive their own scoping here because they aren't solely gated by
 * `:orgId` (an invitationId or token could otherwise be used to reach across orgs).
 */
@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, role: Role): Promise<CreatedInvitation> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await this.prisma.invitation.create({
      data: { orgId, role, token, expiresAt },
    });
    return {
      id: invitation.id,
      role: invitation.role,
      token: invitation.token,
      invite_path: `/invite/${invitation.token}`,
      expires_at: invitation.expiresAt.toISOString(),
    };
  }

  /** Pending = not accepted AND not expired. */
  async listPending(orgId: string): Promise<InvitationListItem[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: { orgId, acceptedBy: null, expiresAt: { gt: new Date() } },
    });
    return invitations.map((invitation) => ({
      id: invitation.id,
      role: invitation.role,
      expires_at: invitation.expiresAt.toISOString(),
    }));
  }

  /** Scoped to `orgId` so an admin of org A can never delete org B's invitation by id. */
  async remove(orgId: string, invitationId: string): Promise<void> {
    const result = await this.prisma.invitation.deleteMany({
      where: { id: invitationId, orgId },
    });
    if (result.count === 0) throw this.notFound();
  }

  async getByToken(token: string): Promise<PublicInvitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { org: true },
    });
    if (!invitation) throw this.notFound();
    if (this.isExpiredOrAccepted(invitation.expiresAt, invitation.acceptedBy)) throw this.gone();
    return {
      org_name: invitation.org.name,
      role: invitation.role,
      expires_at: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Creates Membership(caller, org, role) and marks the invitation accepted. Single-use: a
   * SECOND user calling accept on an already-accepted token gets 410. The SAME user calling
   * accept again (any reason, e.g. a retried request) is idempotent — 200, keeping whatever role
   * they ended up with, never re-applying the invitation's role over an already-different one.
   */
  async accept(token: string, userId: string): Promise<AcceptedInvitation> {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({ where: { token } });
      if (!invitation) throw this.notFound();
      if (invitation.expiresAt < new Date()) throw this.gone();
      if (invitation.acceptedBy && invitation.acceptedBy !== userId) throw this.gone();

      const existingMembership = await tx.membership.findUnique({
        where: { userId_orgId: { userId, orgId: invitation.orgId } },
      });

      if (existingMembership) {
        if (!invitation.acceptedBy) {
          await tx.invitation.update({
            where: { id: invitation.id },
            data: { acceptedBy: userId },
          });
        }
        return { org_id: invitation.orgId, role: existingMembership.role };
      }

      await tx.membership.create({
        data: { userId, orgId: invitation.orgId, role: invitation.role },
      });
      await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedBy: userId } });
      return { org_id: invitation.orgId, role: invitation.role };
    });
  }

  private isExpiredOrAccepted(expiresAt: Date, acceptedBy: string | null): boolean {
    return expiresAt < new Date() || acceptedBy !== null;
  }

  private notFound(): ProblemException {
    return new ProblemException({
      status: 404,
      title: 'Not Found',
      detail: 'Invitation not found',
    });
  }

  private gone(): ProblemException {
    return new ProblemException({
      status: 410,
      title: 'Gone',
      detail: 'Invitation has expired or already been used',
    });
  }
}
