import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { ProblemException } from '../common/problem-details';
import type { EventsSummary, ProjectListItem } from './projects.types';

/** UUID-shaped path param guard — a malformed id can never match a real project, so short-circuit
 *  to 404 instead of letting Postgres throw on an invalid `uuid` column comparison. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChEventCountRow {
  event: string;
  count: string | number;
}

/**
 * Projects listing + minimal analytics read (contracts §12). A user may only ever see
 * projects/data for projects they hold a ProjectMembership in — org membership alone is no
 * longer sufficient (per-project access model).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
  ) {}

  /** Every project the authenticated user directly holds a ProjectMembership on. */
  async listForUser(userId: string): Promise<ProjectListItem[]> {
    const memberships = await this.prisma.projectMembership.findMany({
      where: { userId },
      include: {
        project: {
          include: {
            org: true,
            sdkTokens: {
              where: { revokedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
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

  /**
   * Real ClickHouse read over `analytics.events` for one project. `total` and per-event `count`
   * both use `count(DISTINCT insert_id)` (exact under SDK retries); `by_event` is ordered by
   * count desc. All-time, no date filter (MVP). Empty project → `{ total: 0, by_event: [] }`.
   */
  async getEventsSummary(userId: string, projectId: string): Promise<EventsSummary> {
    await this.assertMembership(userId, projectId);

    const rows = await this.clickhouse.query<ChEventCountRow>(
      `SELECT event, count(DISTINCT insert_id) AS count
       FROM events
       WHERE project_id = {projectId:UUID}
       GROUP BY event
       ORDER BY count DESC`,
      { projectId },
    );

    const by_event = rows.map((row) => ({ event: row.event, count: Number(row.count) }));
    const total = by_event.reduce((sum, row) => sum + row.count, 0);
    return { project_id: projectId, total, by_event };
  }

  /**
   * Throws 404 if the project doesn't exist at all; 403 if it exists but `userId` doesn't hold a
   * ProjectMembership on it — org membership is no longer sufficient. SECURITY-CRITICAL: this is
   * the only gate standing between a member of one project and another project's data (even
   * within the SAME org), so it always re-derives the project's existence from Postgres and
   * checks membership against THAT project — never trusts a client-supplied id.
   *
   * Returns the caller's `ProjectRole` so callers that need to distinguish roles (e.g. owner-only
   * actions) can do so without a second query.
   */
  async resolveProjectRole(userId: string, projectId: string): Promise<ProjectRole> {
    if (!UUID_SHAPE.test(projectId)) {
      throw this.notFound();
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw this.notFound();
    }
    const membership = await this.prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } },
    });
    if (!membership) {
      throw this.forbidden();
    }
    return membership.role;
  }

  /**
   * Public (not private) so other read-only, viewer+-gated modules can reuse it verbatim instead
   * of duplicating the check — e.g. AnalyticsService (contracts §14: "reuse
   * ProjectsService.assertMembership ... for viewer+"). Any ProjectMembership row already implies
   * viewer-or-higher access; there is no lower tier to distinguish.
   */
  async assertMembership(userId: string, projectId: string): Promise<void> {
    await this.resolveProjectRole(userId, projectId);
  }

  private notFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Project not found' });
  }

  private forbidden(): ProblemException {
    return new ProblemException({
      status: 403,
      title: 'Forbidden',
      detail: 'You are not a member of this project',
    });
  }
}
