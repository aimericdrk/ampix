import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isUuidShaped } from '../common/uuid';
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

  /**
   * Scoped to `orgId` so an admin of org A can never delete org B's invitation by id. A
   * non-UUID-shaped `invitationId` short-circuits to 404 instead of letting Postgres throw on an
   * invalid `uuid` column comparison (it can never match a real invitation either way).
   */
  async remove(orgId: string, invitationId: string): Promise<void> {
    if (!isUuidShaped(invitationId)) throw this.notFound();
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
   *
   * SECURITY-CRITICAL atomicity: claiming the invitation is a compare-and-swap —
   * `updateMany({ where: { token, acceptedBy: null, expiresAt: { gt: now } }, data: {
   * acceptedBy: userId } })` — a single conditional UPDATE, so exactly one concurrent caller can
   * ever flip `acceptedBy` from null for a given token (Postgres serializes concurrent UPDATEs
   * that target the SAME row: the loser blocks until the winner commits, then re-evaluates its
   * WHERE clause against the now-committed row and finds `acceptedBy` no longer null, so it
   * affects 0 rows). Only the caller that wins the CAS (`count === 1`) goes on to create the
   * Membership, and it does so — plus the existing-membership re-check — inside the SAME
   * transaction as the CAS, so a crash between "claim" and "create membership" can never leave
   * an invitation marked accepted with no corresponding membership.
   */
  async accept(token: string, userId: string): Promise<AcceptedInvitation> {
    const now = new Date();

    const claimed = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.invitation.updateMany({
        where: { token, acceptedBy: null, expiresAt: { gt: now } },
        data: { acceptedBy: userId },
      });
      if (cas.count === 0) return null; // lost the race (or nothing to win) — resolve outside

      const invitation = await tx.invitation.findUnique({ where: { token } });
      if (!invitation) {
        // Can't happen: the CAS above just updated this exact row inside this transaction.
        throw new Error('InvitationsService.accept: invitation vanished after winning the CAS');
      }

      const existingMembership = await tx.membership.findUnique({
        where: { userId_orgId: { userId, orgId: invitation.orgId } },
      });
      if (existingMembership) {
        // Already a member some other way — keep their EXISTING role, never let this
        // invitation's role clobber it, even though we just (re-)marked it accepted.
        return { org_id: invitation.orgId, role: existingMembership.role };
      }

      await tx.membership.create({
        data: { userId, orgId: invitation.orgId, role: invitation.role },
      });
      return { org_id: invitation.orgId, role: invitation.role };
    });

    if (claimed) return claimed;

    // Lost the CAS (or there was nothing to win): resolve WHY without ever writing anything.
    // The only successful outcome from here on is the idempotent already-a-member case — a
    // second, different caller never gets to "win" by any other path.
    const invitation = await this.prisma.invitation.findUnique({ where: { token } });
    if (!invitation) throw this.notFound();

    const existingMembership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: invitation.orgId } },
    });
    if (existingMembership) {
      return { org_id: invitation.orgId, role: existingMembership.role };
    }

    throw this.gone(); // expired, or already accepted (single-use) by this or another caller
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
