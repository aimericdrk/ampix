import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProblemException } from '../common/problem-details';
import type { RequestWithServerKey } from './server-key.guard';

/**
 * Requires the authenticated server key to carry the erasure capability, replacing the global
 * ERASURE_API_KEY that used to gate DELETE /v1/subscribers/:appUserId. That key was one secret for
 * the whole deployment — it could not be handed to a project's backend without handing over
 * erasure rights everywhere, so it could never be shown in the dashboard. The capability lives on
 * the key row instead, granted when the key is minted and never inferable from the request.
 *
 * 403, not 401: the key authenticated fine, it simply isn't allowed to delete. The mirror of the
 * analytics service's ErasureCapabilityGuard — same decision, taken locally in each service.
 */
@Injectable()
export class ErasureCapabilityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestWithServerKey>();
    // Unreachable through the controller (ServerKeyGuard sets this or throws), but this guard is
    // the last thing between a request and an irreversible delete: it never assumes.
    if (!req.serverKey) {
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing, invalid, or revoked server key',
      });
    }
    if (!req.serverKey.canErase) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail:
          'This server key does not carry the erasure capability — create one with can_erase in project settings',
      });
    }
    return true;
  }
}
