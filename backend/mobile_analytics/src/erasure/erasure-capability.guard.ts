import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProblemException } from '../common/problem-details';
import type { IngestRequest } from '../ingestion/ingest-auth';

/**
 * Authorizes end-user erasure from the token itself, replacing the old global ERASURE_API_KEY.
 * That key was one shared secret for the whole deployment: handing it to a project's backend
 * handed them erasure rights everywhere, so it could not be given out per project or per user.
 * The two conditions below both come from the token row (SdkTokenGuard, which runs first) and
 * never from the request, so a caller can't ask for the rights it doesn't have:
 *
 *  - `source === 'server'` — a client token ships inside the app and is extractable, so it must
 *    never authorize a destructive delete, whatever capability someone tried to grant it.
 *  - `canErase` — opt-in per token, so a backend that only relays events can hold a server token
 *    that deletes nothing.
 *
 * Failing either is 403, not 401: the token authenticated fine, it just isn't allowed here. The
 * detail says which half is missing so the caller mints the right token instead of hunting for a
 * bad credential.
 */
@Injectable()
export class ErasureCapabilityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const auth = req.ingestAuth;
    // Unreachable through the controller (SdkTokenGuard sets this or throws) — but this guard is
    // the last thing between a request and an irreversible delete, so it never assumes.
    if (!auth) {
      throw new ProblemException({
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing, invalid, or revoked SDK token',
      });
    }
    if (auth.source !== 'server') {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail: 'Erasure requires a server token; this is a client token',
      });
    }
    if (!auth.canErase) {
      throw new ProblemException({
        status: 403,
        title: 'Forbidden',
        detail:
          'This server token does not carry the erasure capability — create one with can_erase in project settings',
      });
    }
    return true;
  }
}
