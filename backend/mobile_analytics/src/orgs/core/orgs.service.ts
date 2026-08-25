import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatedOrg, OrgListItem, RenamedOrg } from './orgs.types';

/**
 * Organization CRUD (contracts §13). Creation and listing are "any authenticated user" actions —
 * the org/role scoping for mutations (rename, etc.) is enforced by RolesGuard at the route, not
 * here; this service trusts that whatever `orgId` it's given has already passed that gate.
 */
@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
  ) {}

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

  /**
   * Deletes the org and everything under it. Owner-only (enforced by RolesGuard at the route);
   * `orgId` is assumed already validated to exist.
   *
   * Postgres does the structural work through the FKs' ON DELETE CASCADE: memberships,
   * invitations, and every project — which in turn cascades its SDK tokens, project memberships,
   * cohorts, saved reports, dashboards, screen captures, and RevenueCat rows.
   *
   * ClickHouse does NOT cascade, so the per-project event data is deleted explicitly first. This
   * deliberately diverges from {@link ProjectManagementService.remove}, which keeps a deleted
   * project's events: deleting a single project leaves the org standing, so an operator can still
   * reach that data, whereas after an org delete nothing can ever address these project ids again
   * — keeping the rows would strand them in ClickHouse permanently.
   *
   * ORDER MATTERS. ClickHouse is purged BEFORE the Postgres cascade, and the two cannot share a
   * transaction. Purging first means a ClickHouse failure aborts the whole delete with the org
   * fully intact (safe, retryable). The reverse order would risk dropping the org and then failing
   * to purge, leaving exactly the stranded rows this method exists to avoid.
   */
  async remove(orgId: string, actorUserId?: string): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { orgId },
      select: { id: true },
    });
    // Logged at `log` (info), not debug: this is irreversible and unattributable after the fact.
    // Successful requests are demoted to debug by app.module's customLogLevel, so without this the
    // only record that an organization ever existed is its absence.
    this.logger.log(
      `org.delete orgId=${orgId} actor=${actorUserId ?? 'unknown'} projects=${projects.length} [${projects
        .map((p) => p.id)
        .join(',')}]`,
    );
    for (const project of projects) {
      await this.clickhouse.deleteProjectData(project.id);
    }
    await this.prisma.organization.delete({ where: { id: orgId } });
    this.logger.log(`org.delete complete orgId=${orgId} actor=${actorUserId ?? 'unknown'}`);
  }
}
