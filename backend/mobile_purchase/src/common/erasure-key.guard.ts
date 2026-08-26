import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ProblemException } from './problem-details';

/**
 * Constant-time string comparison. Both sides are hashed first so inputs of different lengths
 * still compare in constant time (timingSafeEqual throws on length mismatch, and the length
 * itself must not leak).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Second factor for the subscriber-erasure endpoint: requires the `X-Erasure-Key` header to match
 * ERASURE_API_KEY. PublicApiKeyGuard only scopes the request to a project — the public SDK key
 * ships inside the mobile app and is extractable, so it must never authorize destructive deletes
 * on its own. Unset ERASURE_API_KEY disables erasure entirely (403) — fail closed, never open.
 */
@Injectable()
export class ErasureKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.erasureApiKey;
    if (!configured) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: 'Subscriber erasure is disabled (ERASURE_API_KEY is not configured)',
      });
    }
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const provided = req.headers['x-erasure-key'];
    if (typeof provided !== 'string' || !constantTimeEquals(provided, configured)) {
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing or invalid X-Erasure-Key header',
      });
    }
    return true;
  }
}
