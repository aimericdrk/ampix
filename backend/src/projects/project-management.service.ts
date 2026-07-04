import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { generateSdkToken } from '../common/sdk-token';
import { isUuidShaped } from '../common/uuid';
import { REDIS } from '../redis/redis.module';
import { sdkTokenCacheKey } from '../ingestion/sdk-token.guard';
import type {
  CreatedProject,
  CreatedToken,
  SdkTokenListItem,
  UpdatedProject,
} from './project-management.types';

const DEFAULT_TOKEN_LABEL = 'default';

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
  ) {}

  /** Creates the project + an initial ingest SdkToken, atomically. */
  async createForOrg(orgId: string, name: string, timezone?: string): Promise<CreatedProject> {
    const token = generateSdkToken();
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: { orgId, name, timezone: timezone ?? 'UTC' },
      });
      await tx.sdkToken.create({
        data: { projectId: created.id, token, label: DEFAULT_TOKEN_LABEL },
      });
      return created;
    });
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

  async listTokens(projectId: string): Promise<SdkTokenListItem[]> {
    const tokens = await this.prisma.sdkToken.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((token) => ({
      id: token.id,
      token: token.token,
      label: token.label,
      created_at: token.createdAt.toISOString(),
    }));
  }

  async createToken(projectId: string, label?: string): Promise<CreatedToken> {
    const token = await this.prisma.sdkToken.create({
      data: { projectId, token: generateSdkToken(), label: label ?? DEFAULT_TOKEN_LABEL },
    });
    return { id: token.id, token: token.token, label: token.label };
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

  private tokenNotFound(): ProblemException {
    return new ProblemException({ status: 404, title: 'Not Found', detail: 'Token not found' });
  }
}
