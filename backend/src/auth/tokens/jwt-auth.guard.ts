import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ProblemException } from '../../common/problem-details';
import { TokenService } from './token.service';
import type { AuthRequest } from '../auth.types';

function unauthorized(): ProblemException {
  return new ProblemException({
    status: 401,
    title: 'Unauthorized',
    detail: 'Missing or invalid access token',
  });
}

/**
 * Guards access-token-protected routes (/me, /2fa/setup, /2fa/activate, /2fa/disable).
 * Verifies `Authorization: Bearer <jwt>` against JWT_ACCESS_SECRET AND requires purpose:'access'
 * — an mfa_token is signed with a different secret entirely (see TokenService), so it is
 * rejected here at the signature-verification step, before the purpose check even runs.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : undefined;
    if (!token) {
      throw unauthorized();
    }
    try {
      const payload = this.tokens.verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      return true;
    } catch {
      throw unauthorized();
    }
  }
}
