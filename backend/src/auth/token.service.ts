import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { requireAccessSecret, requireAuthConfig, requireMfaSecret } from './auth-config.util';
import { AccessTokenPayload, MfaTokenPayload, PublicUser } from './auth.types';

/**
 * Issues and verifies the two JWT-based token kinds (contracts §11). Access and mfa tokens are
 * signed with two DIFFERENT secrets (JWT_ACCESS_SECRET vs JWT_REFRESH_SECRET, repurposed here as
 * the mfa secret) as well as carrying distinct `purpose` claims — either safeguard alone would
 * stop cross-use, together they make it impossible by construction. The refresh token itself is
 * NOT a JWT (see RefreshTokenService): it's an opaque random value, so no secret is needed to
 * "sign" it.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  signAccessToken(user: PublicUser): string {
    const auth = requireAuthConfig(this.config);
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      purpose: 'access',
    };
    return this.jwt.sign(payload, {
      secret: requireAccessSecret(this.config),
      expiresIn: auth.accessTokenTtl,
    });
  }

  /** Throws if the token is malformed, expired, wrongly signed, or not purpose:'access'. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = this.jwt.verify<AccessTokenPayload>(token, {
      secret: requireAccessSecret(this.config),
    });
    if (payload.purpose !== 'access') {
      throw new Error('token is not an access token');
    }
    return payload;
  }

  signMfaToken(userId: string): string {
    const auth = requireAuthConfig(this.config);
    const payload: MfaTokenPayload = { sub: userId, purpose: 'mfa' };
    return this.jwt.sign(payload, {
      secret: requireMfaSecret(this.config),
      expiresIn: auth.mfaTokenTtl,
    });
  }

  /** Throws if the token is malformed, expired, wrongly signed, or not purpose:'mfa'. */
  verifyMfaToken(token: string): MfaTokenPayload {
    const payload = this.jwt.verify<MfaTokenPayload>(token, {
      secret: requireMfaSecret(this.config),
    });
    if (payload.purpose !== 'mfa') {
      throw new Error('token is not an mfa token');
    }
    return payload;
  }
}
