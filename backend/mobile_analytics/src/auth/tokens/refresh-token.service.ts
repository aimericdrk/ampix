import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { requireAuthConfig } from '../services/auth-config.util';

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy — plenty to make guessing infeasible.

export interface RotatedRefreshToken {
  userId: string;
  token: string;
}

/** SHA-256 is fine here (not argon2/bcrypt): the input is a high-entropy random token, not a
 *  human-chosen secret, so there is nothing for a slow hash to protect against offline guessing. */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Opaque refresh tokens (contracts §11): random bytes handed to the client in an httpOnly
 * cookie, with only the SHA-256 hash ever persisted (`refresh_tokens.token_hash`). Rotated on
 * every `/refresh` call — the old row is revoked in the same transaction the new one is created
 * in, so a raced replay of a stolen-but-already-used token cannot resurrect it.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Issues a brand new refresh token for `userId` (signup/login/2fa-verify). */
  async issue(userId: string): Promise<string> {
    const auth = requireAuthConfig(this.config);
    const token = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + auth.refreshTokenTtl * 1000),
      },
    });
    return token;
  }

  /**
   * Validates `rawToken` and, if it's a live (unexpired, unrevoked) token, atomically revokes it
   * and issues a fresh one for the same user. Returns `null` on any invalid/expired/revoked/reused
   * token — the caller should then clear the cookie and respond 401.
   */
  async rotate(rawToken: string): Promise<RotatedRefreshToken | null> {
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });
    if (!existing || existing.revokedAt !== null || existing.expiresAt.getTime() < Date.now()) {
      return null;
    }

    const auth = requireAuthConfig(this.config);
    const newToken = randomBytes(RAW_TOKEN_BYTES).toString('base64url');
    const [revoked] = await this.prisma.$transaction([
      // Guard the revoke on revokedAt: null so a concurrent rotation of the same token can only
      // "win" once — the loser's update touches 0 rows and its newly-created token below is
      // simply an extra live token for the same user rather than a security hole.
      this.prisma.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: hashToken(newToken),
          expiresAt: new Date(Date.now() + auth.refreshTokenTtl * 1000),
        },
      }),
    ]);
    if (revoked.count === 0) {
      return null;
    }
    return { userId: existing.userId, token: newToken };
  }

  /** Revokes `rawToken` if it exists and isn't already revoked (logout). Idempotent/no-op otherwise. */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
