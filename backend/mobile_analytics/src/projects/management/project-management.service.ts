import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_EVENT_SOURCE, type EventSource } from '@myampix/contracts';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { ClickHouseService } from '../../clickhouse/clickhouse.service';
import { ProblemException } from '../../common/problem-details';
import { generateSdkToken } from '../../common/sdk-token';
import { isUuidShaped } from '../../common/uuid';
import { REDIS } from '../../redis/redis.module';
import { sdkTokenCacheKey } from '../../ingestion/sdk-token.guard';
import type { PurgeDataDto } from './project-management.schemas';
import type {
  CreatedProject,
  CreatedToken,
  PurgeDataResult,
  SdkTokenListItem,
  UpdatedProject,
} from './project-management.types';

const DEFAULT_TOKEN_LABEL = 'default';
/** Prisma's error code for a Postgres serialization failure (SQLSTATE 40001) surfaced from an
 *  interactive transaction — see {@link ProjectManagementService.runSerializable}. */
const SERIALIZATION_FAILURE_CODE = 'P2034';

/**
 * Project + SDK-token management (contracts §13). `orgId`/`projectId` route params are assumed
 * already validated to exist (RolesGuard resolved+checked them before the controller method
 * ran). Token mutations additionally re-scope by `projectId` themselves (see listTokens/
 * createToken/revokeToken) so a `:tokenId` belonging to a DIFFERENT project can never be reached
 * just because the caller happens to be admin of SOME project — ids are never trusted alone.
 */
@Injectable()
export class ProjectManagementService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly clickhouse: ClickHouseService,
  ) {}

  /**
   * Creates the project + an initial ingest SdkToken, atomically, and makes `userId` (the
   * creator) an `owner` ProjectMembership on it — otherwise an org admin who creates a project
   * would immediately be locked out of it under the per-project access model.
   *
   * SECURITY: runs Serializable (see {@link runSerializable}) for the same reason `add` in
   * `ProjectMembersService` does — the creator has already passed the org RolesGuard in this
   * same request, so the window is much narrower than a stale pre-check, but the theoretical race
   * is identical in shape: a concurrent org-member removal (SERIALIZABLE, cascades
   * ProjectMemberships) could otherwise interleave with a READ COMMITTED create and leave an
   * `owner` ProjectMembership for a caller whose org Membership no longer exists. Serializable
   * isolation here means Postgres SSI detects that conflict against the removal's transaction
   * just like it does for `add`.
   */
  async createForOrg(
    orgId: string,
    name: string,
    userId: string,
    timezone?: string,
  ): Promise<CreatedProject> {
    const token = generateSdkToken();
    const project = await this.runSerializable(() =>
      this.prisma.$transaction(
        async (tx) => {
          const created = await tx.project.create({
            data: { orgId, name, timezone: timezone ?? 'UTC', createdById: userId },
          });
          await tx.sdkToken.create({
            data: { projectId: created.id, token, label: DEFAULT_TOKEN_LABEL },
          });
          await tx.projectMembership.create({
            data: { userId, projectId: created.id, role: 'owner' },
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    return {
      id: project.id,
      org_id: project.orgId,
      name: project.name,
      timezone: project.timezone,
      ingest_token: token,
    };
  }

  async update(
    projectId: string,
    changes: { name?: string; timezone?: string },
  ): Promise<UpdatedProject> {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.timezone !== undefined && { timezone: changes.timezone }),
      },
    });
    return { id: project.id, name: project.name, timezone: project.timezone };
  }

  /** Cascades to sdk_tokens via the FK's ON DELETE CASCADE; ClickHouse event data is left as-is. */
  async remove(projectId: string): Promise<void> {
    await this.prisma.project.delete({ where: { id: projectId } });
  }

  /**
   * Irreversibly wipes the selected data scopes for a project, keeping the project itself
   * (and its tokens/members) intact. Owner-only (enforced at the controller). Each scope:
   *  - `analytics`  — all ClickHouse rows for the project (events, profiles, identity mappings,
   *                   daily rollups).
   *  - `revenuecat` — the project's SubscriptionState + webhook journal (the integration row,
   *                   i.e. the connection itself, is kept so a re-sync can repopulate).
   *  - `saved`      — saved dashboards, cohorts, and reports (dashboard tiles cascade).
   */
  async purgeData(projectId: string, dto: PurgeDataDto): Promise<PurgeDataResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (project === null) {
      throw new ProblemException({ status: 404, title: 'Not Found', detail: 'Project not found' });
    }

    const cleared: PurgeDataResult['cleared'] = {
      analytics: false,
      revenuecat: false,
      saved: false,
    };

    if (dto.scopes.analytics === true) {
      await this.clickhouse.deleteProjectData(projectId);
      cleared.analytics = true;
    }
    if (dto.scopes.revenuecat === true) {
      await this.prisma.subscriptionState.deleteMany({ where: { projectId } });
      await this.prisma.revenueCatWebhookEvent.deleteMany({ where: { projectId } });
      cleared.revenuecat = true;
    }
    if (dto.scopes.saved === true) {
      await this.prisma.dashboard.deleteMany({ where: { projectId } });
      await this.prisma.cohort.deleteMany({ where: { projectId } });
      await this.prisma.savedReport.deleteMany({ where: { projectId } });
      cleared.saved = true;
    }

    return { cleared };
  }

  async listTokens(projectId: string): Promise<SdkTokenListItem[]> {
    const tokens = await this.prisma.sdkToken.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((token) => ({
      id: token.id,
      token: token.token,
      label: token.label,
      source: token.source,
      created_at: token.createdAt.toISOString(),
    }));
  }

  /**
   * `source` is write-once: there is no update path for it, and rotation (dashboard-side) creates a
   * replacement carrying the same value. Changing it on a live token would silently re-classify
   * every event ingested after the change while leaving the earlier ones under the old label.
   */
  async createToken(
    projectId: string,
    label?: string,
    source: EventSource = DEFAULT_EVENT_SOURCE,
  ): Promise<CreatedToken> {
    const token = await this.prisma.sdkToken.create({
      data: { projectId, token: generateSdkToken(), label: label ?? DEFAULT_TOKEN_LABEL, source },
    });
    return { id: token.id, token: token.token, label: token.label, source: token.source };
  }

  /**
   * Sets `revokedAt` AND proactively deletes the SdkTokenGuard's Redis cache entry for this
   * token, so revocation takes effect immediately rather than waiting out the guard's 60s cache
   * TTL (see sdk-token.guard.ts's SDK_TOKEN_CACHE_TTL_SECONDS comment). 404 if `tokenId` isn't
   * UUID-shaped, doesn't belong to `projectId`, or is already revoked (it's no longer a live
   * token to revoke).
   */
  async revokeToken(projectId: string, tokenId: string): Promise<void> {
    if (!isUuidShaped(tokenId)) throw this.tokenNotFound();
    const token = await this.prisma.sdkToken.findUnique({ where: { id: tokenId } });
    if (!token || token.projectId !== projectId || token.revokedAt !== null) {
      throw this.tokenNotFound();
    }
    await this.prisma.sdkToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    await this.deleteCacheEntry(sdkTokenCacheKey(token.token));
  }

  private async deleteCacheEntry(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Cache unavailable — the guard's Postgres fallback (on cache miss) still enforces
      // revocation correctly; only the eventual-consistency window (<=60s) is affected.
    }
  }

  /**
   * Runs `run` (a full `$transaction(...)` call) and retries it EXACTLY ONCE if Postgres aborts
   * it with a serialization failure — see the identical helper (and its full write-skew
   * rationale) in `orgs/members/members.service.ts` and `projects/members/project-members.service.ts`.
   */
  private async runSerializable<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === SERIALIZATION_FAILURE_CODE) {
        return run();
      }
      throw err;
    }
  }

  private tokenNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Token not found' });
  }
}
