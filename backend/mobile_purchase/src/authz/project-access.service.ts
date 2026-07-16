import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProblemException } from '../common/problem-details';

/**
 * Local mirror of the analytics backend's ProjectRole (@prisma/client, that service's own
 * schema) — deliberately NOT imported from analytics' generated Prisma client since these are
 * two separate services with separate databases; only the string values need to line up.
 */
export type ProjectRole = 'viewer' | 'analyst' | 'admin' | 'owner';

const RANK: Record<ProjectRole, number> = { viewer: 1, analyst: 2, admin: 3, owner: 4 };

export function projectRoleRank(role: ProjectRole): number {
  return RANK[role];
}

/** How long a resolved (or denied) role is trusted before re-checking with analytics. */
const CACHE_TTL_MS = 5000;

interface CacheEntry {
  role: ProjectRole | null;
  expiresAt: number;
}

/**
 * Cross-service authz seam: mobile_purchase holds NO JWT secret. It resolves a caller's role on
 * a project by forwarding their `Authorization` header to the analytics backend's internal
 * role-resolution endpoint and trusting its verdict — analytics does the actual JWT
 * verification + membership lookup. Uses the Node 22 global `fetch`.
 */
@Injectable()
export class ProjectAccessService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Returns the caller's role, or `null` if analytics denies the request (401/403/404 — unknown
   * project, non-member, or invalid credentials). Throws a 503 ProblemException when analytics
   * itself is unreachable or errors (network failure / 5xx) — that is NOT a deny, it means the
   * authorization decision could not be made at all.
   */
  async getProjectRole(
    projectId: string,
    authHeader: string | undefined,
  ): Promise<ProjectRole | null> {
    if (!authHeader) return null;

    const cacheKey = `${authHeader}|${projectId}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.role;
    }

    const role = await this.fetchProjectRole(projectId, authHeader);
    this.cache.set(cacheKey, { role, expiresAt: now + CACHE_TTL_MS });
    return role;
  }

  private async fetchProjectRole(
    projectId: string,
    authHeader: string,
  ): Promise<ProjectRole | null> {
    const url = `${this.config.analyticsInternalUrl}/api/v1/internal/projects/${encodeURIComponent(projectId)}/role`;

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: authHeader } });
    } catch {
      throw new ProblemException({
        status: 503,
        title: 'Service Unavailable',
        detail: 'Unable to reach the analytics service to resolve the project role',
      });
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ProblemException({
        status: 503,
        title: 'Service Unavailable',
        detail: `The analytics service returned an unexpected status (${response.status}) while resolving the project role`,
      });
    }

    const body = (await response.json()) as { role: ProjectRole };
    return body.role;
  }
}
