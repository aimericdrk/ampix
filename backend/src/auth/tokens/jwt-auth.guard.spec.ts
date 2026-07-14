import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { ProblemException } from '../../common/problem-details';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';
import { makeAuthTestConfig } from '../test-support/config.fixture';

const USER = { id: '018f6b2e-0000-7000-8000-000000000001', email: 'a@b.com', name: 'A' };

function ctxFor(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  function makeGuard() {
    const tokens = new TokenService(new JwtService(), makeAuthTestConfig());
    const guard = new JwtAuthGuard(tokens);
    return { guard, tokens };
  }

  it('rejects a missing Authorization header', () => {
    const { guard } = makeGuard();
    const { ctx } = ctxFor({});
    expect(() => guard.canActivate(ctx)).toThrow(ProblemException);
  });

  it('rejects a header without the Bearer scheme', () => {
    const { guard } = makeGuard();
    const { ctx } = ctxFor({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(() => guard.canActivate(ctx)).toThrow(ProblemException);
  });

  it('accepts a valid access token and sets req.user', () => {
    const { guard, tokens } = makeGuard();
    const token = tokens.signAccessToken(USER);
    const { ctx, req } = ctxFor({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user).toEqual(USER);
  });

  it('rejects an mfa_token even though it is a validly-signed JWT (wrong purpose + wrong secret)', () => {
    const { guard, tokens } = makeGuard();
    const mfaToken = tokens.signMfaToken(USER.id);
    const { ctx } = ctxFor({ authorization: `Bearer ${mfaToken}` });

    expect(() => guard.canActivate(ctx)).toThrow(ProblemException);
  });

  it('rejects a malformed token', () => {
    const { guard } = makeGuard();
    const { ctx } = ctxFor({ authorization: 'Bearer not-a-jwt' });
    expect(() => guard.canActivate(ctx)).toThrow(ProblemException);
  });

  it('rejects an expired access token', () => {
    const expiredConfig = makeAuthTestConfig();
    expiredConfig.auth!.accessTokenTtl = -1;
    const tokens = new TokenService(new JwtService(), expiredConfig);
    const guard = new JwtAuthGuard(tokens);
    const token = tokens.signAccessToken(USER);
    const { ctx } = ctxFor({ authorization: `Bearer ${token}` });

    expect(() => guard.canActivate(ctx)).toThrow(ProblemException);
  });
});
