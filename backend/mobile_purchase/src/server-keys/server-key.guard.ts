import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';

/** The ServerKey resolved from `Authorization: Bearer mp_srv_…`, attached for downstream guards. */
export interface ResolvedServerKey {
  projectId: string;
  canErase: boolean;
}

export interface RequestWithServerKey extends Request {
  serverKey: ResolvedServerKey;
}

/** Format check before the DB round-trip — a malformed key can't be a row, so don't go looking. */
export const SERVER_KEY_REGEX = /^mp_srv_[0-9a-f]{32}$/;

function unauthorized(detail = 'Missing, invalid, or revoked server key'): ProblemException {
  return new ProblemException({ status: 401, title: 'Unauthorized', detail });
}

/**
 * The public SDK key every other /v1 route takes. Presenting one here is the predictable mistake —
 * it is the credential an app already holds — so say what to use instead rather than leaving the
 * caller to guess from a generic rejection. Nothing leaks: this only recognises the shape of a key
 * the caller sent us, and it is their own public key.
 */
const PUBLIC_SDK_KEY_PREFIX = 'mp_pub_';

/**
 * Authenticates a project's own backend by its `ServerKey`, read from `Authorization: Bearer <key>`.
 * The sibling of {@link PublicApiKeyGuard} for the routes a client must never reach: that one
 * authenticates the app (a key that ships to devices), this one authenticates the customer's
 * server (a key that never does). Both resolve nothing but a project scope — capability checks
 * are separate guards, so a route always states what it needs.
 *
 * Deliberately uncached, unlike the analytics side's SDK-token guard: server keys front rare
 * server-to-server calls, not the ingest hot path, so a single indexed lookup per request is
 * cheaper than reasoning about a revocation window.
 */
@Injectable()
export class ServerKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithServerKey>();
    const header = req.headers.authorization;
    const key =
      typeof header === 'string' && /^Bearer\s+/i.test(header)
        ? header.replace(/^Bearer\s+/i, '')
        : null;
    if (!key) throw unauthorized();
    if (key.startsWith(PUBLIC_SDK_KEY_PREFIX)) {
      throw unauthorized(
        'This route needs a server key (mp_srv_…), not a public SDK key — mint one under Server keys in project settings',
      );
    }
    if (!SERVER_KEY_REGEX.test(key)) throw unauthorized();

    const row = await this.prisma.serverKey.findUnique({
      where: { key },
      select: { projectId: true, canErase: true, revokedAt: true },
    });
    if (!row || row.revokedAt !== null) throw unauthorized();

    req.serverKey = { projectId: row.projectId, canErase: row.canErase };
    return true;
  }
}
