import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { makeAuthTestConfig as baseConfig } from './test-support/config.fixture';

const USER = { id: '018f6b2e-0000-7000-8000-000000000001', email: 'a@b.com', name: 'A' };

describe('TokenService', () => {
  it('signs and verifies an access token, round-tripping the user identity', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const token = tokens.signAccessToken(USER);
    const payload = tokens.verifyAccessToken(token);
    expect(payload).toMatchObject({
      sub: USER.id,
      email: USER.email,
      name: USER.name,
      purpose: 'access',
    });
  });

  it('signs and verifies an mfa token carrying only the user id', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const token = tokens.signMfaToken(USER.id);
    const payload = tokens.verifyMfaToken(token);
    expect(payload).toEqual({
      sub: USER.id,
      purpose: 'mfa',
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
  });

  it('purpose isolation: an access token is rejected by verifyMfaToken', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const accessToken = tokens.signAccessToken(USER);
    expect(() => tokens.verifyMfaToken(accessToken)).toThrow();
  });

  it('purpose isolation: an mfa token is rejected by verifyAccessToken', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const mfaToken = tokens.signMfaToken(USER.id);
    expect(() => tokens.verifyAccessToken(mfaToken)).toThrow();
  });

  it('secret isolation: access and mfa tokens are signed with different secrets, so cross-verifying fails even ignoring purpose', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const jwt = new JwtService();
    const accessToken = tokens.signAccessToken(USER);
    // Verifying the access token with the mfa secret must fail at signature check.
    expect(() => jwt.verify(accessToken, { secret: baseConfig().jwtRefreshSecret })).toThrow();
  });

  it('rejects a token signed with a wrong access secret', () => {
    const tokens = new TokenService(new JwtService(), baseConfig());
    const otherTokens = new TokenService(
      new JwtService(),
      baseConfig({ jwtAccessSecret: 'totally-different-secret-value' }),
    );
    const token = otherTokens.signAccessToken(USER);
    expect(() => tokens.verifyAccessToken(token)).toThrow();
  });

  it('rejects an expired access token', () => {
    const config = baseConfig();
    config.auth!.accessTokenTtl = -1; // already expired the instant it's issued
    const tokens = new TokenService(new JwtService(), config);
    const token = tokens.signAccessToken(USER);
    expect(() => tokens.verifyAccessToken(token)).toThrow();
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    const tokens = new TokenService(new JwtService(), baseConfig({ jwtAccessSecret: undefined }));
    expect(() => tokens.signAccessToken(USER)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET (mfa secret) is missing', () => {
    const tokens = new TokenService(new JwtService(), baseConfig({ jwtRefreshSecret: undefined }));
    expect(() => tokens.signMfaToken(USER.id)).toThrow(/JWT_REFRESH_SECRET/);
  });
});
