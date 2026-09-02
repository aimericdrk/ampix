import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { ProblemException } from '../../common/problem-details';
import { EVENT_SOURCE_EXPR } from '../../analytics/support/property-resolver';
import type { EventsSummary, ProjectListItem, ProjectStat } from './projects.types';

/** UUID-shaped path param guard — a malformed id can never match a real project, so short-circuit
 *  to 404 instead of letting Postgres throw on an invalid `uuid` column comparison. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ChEventCountRow {
  event: string;
  count: string | number;
  client_count: string | number;
  server_count: string | number;
}

/**
 * Projects listing + minimal analytics read (contracts §12). A user may only ever see
 * projects/data for projects they hold a ProjectMembership in — org membership alone is no
 * longer sufficient (per-project access model), except for org owners, who get derived owner
 * access to every project in their org (see `resolveProjectRole`).
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
            revenuecatIntegration: { select: { id: true } },
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
      integrations: { revenuecat: m.project.revenuecatIntegration !== null },
    }));
  }

  /**
   * Real ClickHouse read over `analytics.events` for one project. `total` and per-event `count`
   * both use `count(DISTINCT insert_id)` (exact under SDK retries); `by_event` is ordered by
   * count desc. All-time, no date filter (MVP). Empty project → `{ total: 0, by_event: [] }`.
   *
   * Each row also splits that count by who emitted the event — `client_count` (SDK) vs
   * `server_count` (a backend: the app's own server, the RevenueCat webhook writer) — via the
   * same {@link EVENT_SOURCE_EXPR} the §14 query engine uses, so pre-`source`-column rows are
   * classified identically here and there. The two split counts sum to `count`: the expression is
   * total, every row resolves to exactly one of the two labels. An event name can legitimately
   * appear on both sides (the same name tracked from the app AND from the backend), which is why
   * this is a per-name split rather than a single label.
   */
  async getEventsSummary(userId: string, projectId: string): Promise<EventsSummary> {
    await this.assertMembership(userId, projectId);

    const rows = await this.clickhouse.query<ChEventCountRow>(
      `SELECT event,
              count(DISTINCT insert_id) AS count,
              uniqExactIf(insert_id, ${EVENT_SOURCE_EXPR} = 'client') AS client_count,
              uniqExactIf(insert_id, ${EVENT_SOURCE_EXPR} = 'server') AS server_count
       FROM events
       WHERE project_id = {projectId:UUID}
       GROUP BY event
       ORDER BY count DESC`,
      { projectId },
    );

    const by_event = rows.map((row) => ({
      event: row.event,
      count: Number(row.count),
      client_count: Number(row.client_count),
      server_count: Number(row.server_count),
    }));
    const total = by_event.reduce((sum, row) => sum + row.count, 0);
    return { project_id: projectId, total, by_event };
  }

  /**
   * Per-project list stats — distinct user count + the most common `country` super-property value
   * (the same property HomePage's geo breakdown uses), over `analytics.events`, all-time. Runs one
   * ClickHouse query set across EVERY project the user holds a membership on rather than N
   * per-project reads, so the list page stays cheap. Projects with no events (or no country data)
   * report `user_count: 0` / `top_country: null`.
   */
  async getProjectStats(userId: string): Promise<ProjectStat[]> {
    const memberships = await this.prisma.projectMembership.findMany({
      where: { userId },
      select: { projectId: true },
    });
    const projectIds = memberships.map((m) => m.projectId);
    if (projectIds.length === 0) return [];

    const [counts, topCountries] = await Promise.all([
      this.clickhouse.query<{ project_id: string; user_count: string | number }>(
        `SELECT project_id, uniqExact(distinct_id) AS user_count
         FROM events
         WHERE project_id IN ({projectIds:Array(UUID)})
         GROUP BY project_id`,
        { projectIds },
      ),
      this.clickhouse.query<{ project_id: string; country: string }>(
        `SELECT project_id,
                JSONExtractString(toJSONString(properties), 'country') AS country,
                uniqExact(distinct_id) AS users
         FROM events
         WHERE project_id IN ({projectIds:Array(UUID)})
           AND JSONExtractString(toJSONString(properties), 'country') != ''
         GROUP BY project_id, country
         ORDER BY users DESC
         LIMIT 1 BY project_id`,
        { projectIds },
      ),
    ]);

    const countByProject = new Map(counts.map((r) => [r.project_id, Number(r.user_count)]));
    const countryByProject = new Map(topCountries.map((r) => [r.project_id, r.country]));

    return projectIds.map((id) => ({
      project_id: id,
      user_count: countByProject.get(id) ?? 0,
      top_country: countryByProject.get(id) ?? null,
    }));
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
   *
   * Org owners get derived owner access to every project in their org: an `owner`-rank
   * `Membership` on the project's org resolves to `'owner'` even with no `ProjectMembership` row
   * — no per-project row is ever minted for them. This is additive above the per-project
   * membership model, so it's checked before the `ProjectMembership` lookup.
   */
  async resolveProjectRole(userId: string, projectId: string): Promise<ProjectRole> {
    if (!UUID_SHAPE.test(projectId)) {
      throw this.notFound();
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw this.notFound();
    }
    const orgMembership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (orgMembership?.role === 'owner') {
      return 'owner';
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
