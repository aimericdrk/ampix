import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ClickHouseService, fromChDateTime64 } from '../../clickhouse/clickhouse.service';
import { ProblemException } from '../../common/problem-details';
import { ErasureService, type ErasureResult } from '../../erasure/erasure.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from '../../projects/core/projects.service';
import { canonicalization, RESOLVE_CANONICAL_ID_SQL } from '../support/identity';
import type { DeletedEventResponse, HiddenUserListItem, HiddenUsersResponse } from '../analytics.types';

/** Same bounds as the ingest id fields (contracts §4 idSchema: 1–255 chars). */
const distinctIdSchema = z.string().trim().min(1).max(255);

/** `events.insert_id` is a ClickHouse UUID column (contracts §5) — anything else is a 400, not a
 *  query that fails inside ClickHouse with a type error. */
const insertIdSchema = z.string().trim().uuid();

/**
 * A ceiling on how many users one project may hide. The hidden set is read on every audience query
 * and bound into ClickHouse as a `{hiddenIds:Array(String)}` param, so it has to stay small — this
 * is a curation tool for test accounts and staff, not a substitute for the erase path or for a
 * cohort filter. Hitting it is a 409, never a silent truncation, because silently ignoring a hide
 * would leave a user the operator believes is gone still on screen.
 */
const MAX_HIDDEN_USERS_PER_PROJECT = 1000;

/**
 * Removing an end user from the dashboard (contracts §17). Two modes, deliberately both offered at
 * the point of deletion rather than one being guessed for the operator:
 *
 *  - `hide` — reversible. Writes a `hidden_users` row; the user drops out of the Users list, their
 *    profile 404s, and their rows stop appearing in the live feed. Every event stays on disk, so
 *    aggregate charts (insights, funnels, retention, revenue) are UNCHANGED. This is the right
 *    mode for a test account or a staff device polluting the audience list.
 *  - `erase` — irreversible, and the same code path as the GDPR/account-deletion endpoint
 *    (`DELETE /ingest/users/:distinctId`): ErasureService wipes the events, profile and identity
 *    mappings in ClickHouse plus the RevenueCat mirrors in Postgres, for the requested id AND
 *    every anon/canonical id linked to it.
 *
 * Both resolve the requested id to its CANONICAL id first (contracts §17), so acting on one of a
 * user's anon ids acts on the whole merged identity rather than half of it.
 *
 * `deleteUserEvent` is the third, narrowest action on the same surface: one row of one user's
 * timeline, for the mis-fired or test event that should never have been recorded.
 */
@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly erasure: ErasureService,
  ) {}

  /**
   * The ids hidden in one project, for the read path to exclude. Returns a plain array (not a Set)
   * because it is bound straight into ClickHouse as `{hiddenIds:Array(String)}`.
   *
   * NOTE: no membership check here — this is an internal read called by services that have already
   * asserted membership for the request. The public list endpoint is `listHiddenUsers`.
   */
  async hiddenIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.hiddenUser.findMany({
      where: { projectId },
      select: { distinctId: true },
    });
    return rows.map((row) => row.distinctId);
  }

  /** GET /users/hidden — who is hidden, who hid them, and when. Viewer+ (a read). */
  async listHiddenUsers(userId: string, projectId: string): Promise<HiddenUsersResponse> {
    await this.projects.assertMembership(userId, projectId);
    const rows = await this.prisma.hiddenUser.findMany({
      where: { projectId },
      orderBy: { hiddenAt: 'desc' },
      include: { hiddenBy: { select: { name: true } } },
    });
    const users: HiddenUserListItem[] = rows.map((row) => ({
      distinct_id: row.distinctId,
      hidden_at: row.hiddenAt.toISOString(),
      hidden_by: row.hiddenBy?.name ?? null,
    }));
    return { users };
  }

  /**
   * POST /users/:distinctId/hide — idempotent (hiding an already-hidden user is a no-op success,
   * not a 409, so a double-click can't fail). Returns the canonical id actually hidden, which may
   * differ from the id passed in.
   */
  async hideUser(userId: string, projectId: string, distinctIdRaw: string): Promise<{ distinct_id: string }> {
    await this.projects.assertMembership(userId, projectId);
    const distinctId = this.parseDistinctId(distinctIdRaw);
    const canonicalId = await this.resolveCanonicalId(projectId, distinctId);

    const existing = await this.prisma.hiddenUser.findUnique({
      where: { projectId_distinctId: { projectId, distinctId: canonicalId } },
    });
    if (existing !== null) return { distinct_id: canonicalId };

    // Counted only on a genuine insert: an idempotent re-hide of an existing row must keep
    // succeeding even for a project already sitting at the ceiling.
    const hiddenCount = await this.prisma.hiddenUser.count({ where: { projectId } });
    if (hiddenCount >= MAX_HIDDEN_USERS_PER_PROJECT) {
      throw new ProblemException({
        status: 409,
        title: 'Conflict',
        detail: `A project may hide at most ${MAX_HIDDEN_USERS_PER_PROJECT} users. Un-hide someone, or use a cohort filter instead.`,
      });
    }

    await this.prisma.hiddenUser.create({
      data: { projectId, distinctId: canonicalId, hiddenById: userId },
    });
    this.logger.log(`hid user: project=${projectId} distinctId=${canonicalId} by=${userId}`);
    return { distinct_id: canonicalId };
  }

  /**
   * DELETE /users/:distinctId/hide — un-hide. Also idempotent: un-hiding someone who is not hidden
   * succeeds, since the caller's intent ("this user should be visible") already holds.
   *
   * Deletes by BOTH the canonical id and the raw requested id: a row written before an anon id was
   * ever linked would be keyed on that anon id, and resolving now would no longer reach it.
   */
  async unhideUser(userId: string, projectId: string, distinctIdRaw: string): Promise<void> {
    await this.projects.assertMembership(userId, projectId);
    const distinctId = this.parseDistinctId(distinctIdRaw);
    const canonicalId = await this.resolveCanonicalId(projectId, distinctId);
    await this.prisma.hiddenUser.deleteMany({
      where: { projectId, distinctId: { in: [...new Set([canonicalId, distinctId])] } },
    });
  }

  /**
   * DELETE /users/:distinctId — the irreversible wipe, delegated to the SAME ErasureService the
   * GDPR ingest endpoint uses, so dashboard-initiated and app-initiated deletion can never drift
   * apart. Any `hidden_users` row for the erased ids is dropped too: keeping one would pin a
   * distinct id in Postgres for a user who no longer exists anywhere else.
   */
  async eraseUser(userId: string, projectId: string, distinctIdRaw: string): Promise<ErasureResult> {
    await this.projects.assertMembership(userId, projectId);
    const distinctId = this.parseDistinctId(distinctIdRaw);
    const result = await this.erasure.erase(projectId, distinctId);
    await this.prisma.hiddenUser.deleteMany({
      where: { projectId, distinctId: { in: result.ids } },
    });
    this.logger.log(
      `erased user from dashboard: project=${projectId} ids=${result.ids.length} by=${userId}`,
    );
    return result;
  }

  /**
   * DELETE /users/:distinctId/events/:insertId — remove ONE event from a user's history.
   *
   * The narrowest of the three destructive actions on this surface: `eraseUser` wipes a person,
   * this drops the single row an operator picked out of their timeline (a test purchase, an event
   * fired by a debug build, a mis-tagged action polluting a funnel). It is still IRREVERSIBLE, and
   * still changes aggregates — the row leaves `events`, so every insight, funnel, retention and
   * revenue number computed from it changes too.
   *
   * The event is read back BEFORE it is deleted, for two reasons:
   *  - Ownership. The row must belong to the user whose profile it was clicked in — resolved
   *    through the §17 canonical id, so an event recorded under one of their anon ids is theirs.
   *    A row that is not theirs (or does not exist) is a 404, never a silent success.
   *  - Cost. The stored `event` and `timestamp` complete the table's primary key, which is what
   *    lets the delete prune to one month partition instead of masking the whole project's events
   *    (see ClickHouseService.deleteEvent).
   *
   * A `$identify` event deleted here leaves its `identity_mappings` row in place on purpose: that
   * mapping is what merges this person's anonymous and identified history, and dropping it would
   * split their profile in two as a side effect of deleting one timeline row.
   */
  async deleteUserEvent(
    userId: string,
    projectId: string,
    distinctIdRaw: string,
    insertIdRaw: string,
  ): Promise<DeletedEventResponse> {
    await this.projects.assertMembership(userId, projectId);
    const distinctId = this.parseDistinctId(distinctIdRaw);
    const insertId = this.parseInsertId(insertIdRaw);
    const canonicalId = await this.resolveCanonicalId(projectId, distinctId);

    const canon = canonicalization();
    const rows = await this.clickhouse.query<{ event: string; timestamp: string }>(
      `WITH ${canon.cte}
       SELECT e.event AS event, e.timestamp AS timestamp
       FROM events AS e
       ${canon.join}
       WHERE e.project_id = {projectId:UUID}
         AND ${canon.uid} = {canonicalId:String}
         AND e.insert_id = {insertId:UUID}
       LIMIT 1`,
      { projectId, canonicalId, insertId },
      canon.settings,
    );
    const row = rows[0];
    if (!row) {
      throw new ProblemException({
        status: 404,
        title: 'Not Found',
        detail: 'No such event for this user',
      });
    }

    await this.clickhouse.deleteEvent(projectId, {
      event: row.event,
      timestamp: row.timestamp,
      insertId,
    });
    this.logger.log(
      `deleted event: project=${projectId} distinctId=${canonicalId} insertId=${insertId} event=${row.event} by=${userId}`,
    );
    return {
      insert_id: insertId,
      event: row.event,
      timestamp: fromChDateTime64(row.timestamp),
    };
  }

  /** Rejects an out-of-bounds id with a 400 rather than letting it reach ClickHouse. */
  private parseDistinctId(raw: string): string {
    const parsed = distinctIdSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: 'distinctId must be 1-255 characters',
      });
    }
    return parsed.data;
  }

  /** Same guard for the event id: a malformed one is a 400 before it reaches a UUID column. */
  private parseInsertId(raw: string): string {
    const parsed = insertIdSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemException({
        status: 400,
        title: 'Bad Request',
        detail: 'insertId must be a UUID',
      });
    }
    return parsed.data;
  }

  /**
   * §17: an anon id that has since been linked resolves to the identified user; a canonical (or
   * simply unknown) id resolves to itself. Same two-step the profile endpoint does, so "hide the
   * user I am looking at" hides exactly the identity the profile showed.
   */
  private async resolveCanonicalId(projectId: string, distinctId: string): Promise<string> {
    const rows = await this.clickhouse.query<{ canonical_id: string }>(RESOLVE_CANONICAL_ID_SQL, {
      projectId,
      distinctId,
    });
    return rows[0]?.canonical_id || distinctId;
  }
}
