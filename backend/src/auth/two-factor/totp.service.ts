import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { REDIS } from '../../redis/redis.module';
import { requireAuthConfig, requireTotpEncKey } from '../services/auth-config.util';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from '../crypto/aes-gcm';

/**
 * otplib's `authenticator` preset defaults — 30 s step, 6 digits, SHA-1 — are exactly RFC 6238 /
 * Google Authenticator's defaults, so nothing here overrides them. `window: 1` accepts a code
 * from one 30 s step before or after "now", absorbing clock drift and the time a user takes to
 * type a code, without materially widening the guessable window (still only 3 valid codes at any
 * instant, each with an effective 1-in-1e6 chance).
 *
 * `authenticator` is a shared, process-wide singleton (otplib's own design) — this module is the
 * only place that touches its `.options`, so there's no risk of another part of the app silently
 * changing verification tolerance out from under it.
 */
authenticator.options = { window: 1 };

/** How long a freshly-generated, not-yet-activated TOTP secret lives in Redis (contracts §11:
 *  "pending", not yet persisted/enabled). Long enough to scan a QR code and type a code back. */
export const PENDING_SECRET_TTL_SECONDS = 10 * 60;

function pendingKey(userId: string): string {
  return `2fa:pending:${userId}`;
}

@Injectable()
export class TotpService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(email: string, secret: string): string {
    const auth = requireAuthConfig(this.config);
    return authenticator.keyuri(email, auth.totpIssuer, secret);
  }

  async qrDataUrl(otpauthUrl: string): Promise<string> {
    return QRCode.toDataURL(otpauthUrl);
  }

  /** Never throws on a malformed secret/code — treats it as "does not match". */
  async verify(code: string, secret: string): Promise<boolean> {
    try {
      return authenticator.verify({ token: code, secret });
    } catch {
      return false;
    }
  }

  /**
   * Stores the not-yet-activated secret in Redis, ENCRYPTED with the same AES-256-GCM helper used
   * for the persisted (post-activation) secret in `users.totp_secret` — at-rest protection must be
   * consistent regardless of whether the secret currently lives in Postgres or in this short-lived
   * Redis staging area, rather than the secret sitting in plaintext for up to
   * `PENDING_SECRET_TTL_SECONDS` just because it hasn't been activated yet.
   */
  async storePending(userId: string, secret: string): Promise<void> {
    const key = decodeEncryptionKey(requireTotpEncKey(this.config));
    const encrypted = encryptSecret(secret, key);
    await this.redis.set(pendingKey(userId), encrypted, 'EX', PENDING_SECRET_TTL_SECONDS);
  }

  /** Inverse of `storePending`: decrypts before returning. `null` if nothing is pending / expired. */
  async getPending(userId: string): Promise<string | null> {
    const stored = await this.redis.get(pendingKey(userId));
    if (!stored) return null;
    const key = decodeEncryptionKey(requireTotpEncKey(this.config));
    return decryptSecret(stored, key);
  }

  async clearPending(userId: string): Promise<void> {
    await this.redis.del(pendingKey(userId));
  }
}
