import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatedOrg, OrgListItem, RenamedOrg } from './orgs.types';

/**
 * Organization CRUD (contracts §13). Creation and listing are "any authenticated user" actions —
 * the org/role scoping for mutations (rename, etc.) is enforced by RolesGuard at the route, not
 * here; this service trusts that whatever `orgId` it's given has already passed that gate.
 */
@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the org and an owner Membership for the creator, atomically. */
  async create(userId: string, name: string): Promise<CreatedOrg> {
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name } });
      await tx.membership.create({ data: { userId, orgId: created.id, role: 'owner' } });
      return created;
    });
    return { id: org.id, name: org.name, role: 'owner' };
  }

  /** The caller's orgs, with their role in each. */
  async listForUser(userId: string): Promise<OrgListItem[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { org: true },
    });
    return memberships.map((membership) => ({
      id: membership.org.id,
      name: membership.org.name,
      role: membership.role,
    }));
  }

  /** Renames the org. `orgId` is assumed already validated to exist (RolesGuard resolved it). */
  async rename(orgId: string, name: string): Promise<RenamedOrg> {
    const org = await this.prisma.organization.update({ where: { id: orgId }, data: { name } });
    return { id: org.id, name: org.name };
  }
}
