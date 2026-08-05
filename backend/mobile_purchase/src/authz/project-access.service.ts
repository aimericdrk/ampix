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

/**
 * Rank of a role, fail-CLOSED: an unrecognized role ranks as `0`, below every real required
 * role, instead of `undefined` — `undefined < requiredRank` is always `false`, which would fail
 * OPEN and grant access. This is a belt-and-braces guard; `fetchProjectRole` already refuses to
 * hand an unrecognized role to callers in the first place (see `isKnownProjectRole` below).
 */
export function projectRoleRank(role: ProjectRole): number {
  return RANK[role] ?? 0;
}

function isKnownProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RANK, value);
}

/** How long a resolved (or denied) role is trusted before re-checking with analytics. */
const CACHE_TTL_MS = 5000;

/** Upper bound on distinct (authHeader, projectId) cache entries, so a high churn of short-lived
 * tokens can't grow the cache without bound. */
export const MAX_CACHE_ENTRIES = 10_000;

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
   * Returns the caller's role, or `null` if analytics denies the request (403/404 — unknown
   * project or non-member — or a 200 body naming a role mobile_purchase doesn't recognize).
   * Throws a 401 ProblemException when analytics rejects the credentials themselves (expired or
   * missing token) so the caller can re-authenticate, and a 503 ProblemException when analytics
   * itself is unreachable, errors (network failure / 5xx), or returns an unparseable 200 body —
   * none of those are a deny, they mean the authorization decision could not be made at all.
   * 401s and 503s are NOT cached; a resolved role or a deny (`null`) is.
   */
  async getProjectRole(
    projectId: string,
    authHeader: string | undefined,
  ): Promise<ProjectRole | null> {
    if (!authHeader) return null;

    const cacheKey = `${authHeader}|${projectId}`;
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) {
        return cached.role;
      }
      this.cache.delete(cacheKey);
    }

    const role = await this.fetchProjectRole(projectId, authHeader);
    this.setCache(cacheKey, { role, expiresAt: now + CACHE_TTL_MS });
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

    if (response.status === 401) {
      // Not a deny: the credentials themselves are invalid/expired. Surface as 401 so the
      // dashboard re-authenticates instead of treating this as a permanent 403.
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'The analytics service rejected the provided credentials while resolving the project role',
      });
    }
    if (response.status === 403 || response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ProblemException({
        status: 503,
        title: 'Service Unavailable',
        detail: `The analytics service returned an unexpected status (${response.status}) while resolving the project role`,
      });
    }

    let body: { role?: unknown };
    try {
      body = (await response.json()) as { role?: unknown };
    } catch {
      throw new ProblemException({
        status: 503,
        title: 'Service Unavailable',
        detail: 'The analytics service returned a 200 response with an unparseable body while resolving the project role',
      });
    }

    // Fail-closed: a role analytics returns that mobile_purchase doesn't recognize (e.g. a
    // future role added on the analytics side) is treated as a deny, never granted.
    return isKnownProjectRole(body.role) ? body.role : null;
  }

  /** Bounds cache growth: prunes expired entries first, then evicts the oldest entry (Map
   * preserves insertion order) if the cache is still at capacity after pruning. */
  private setCache(key: string, entry: CacheEntry): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [existingKey, existingEntry] of this.cache) {
        if (existingEntry.expiresAt <= now) {
          this.cache.delete(existingKey);
        }
      }
    }
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, entry);
  }
}
