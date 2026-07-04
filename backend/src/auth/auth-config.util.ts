import { AppConfig } from '../config/app-config';

export type AuthConfig = NonNullable<AppConfig['auth']>;

/**
 * `AppConfig.auth` is typed optional only so pre-existing `AppConfig` fixtures outside this
 * module's scope keep compiling without every hand-built one needing an update — `loadConfig()`
 * (config/app-config.ts) ALWAYS populates it. Every auth service reads it through this helper so
 * that guarantee is asserted in exactly one place instead of sprinkling `config.auth!` everywhere.
 */
export function requireAuthConfig(config: AppConfig): AuthConfig {
  const auth = config.auth;
  if (!auth) {
    throw new Error(
      'AppConfig.auth is missing — loadConfig() should always populate it; this indicates a bug, not a runtime input error',
    );
  }
  return auth;
}

/** JWT_ACCESS_SECRET, asserted present (config validation requires it outside NODE_ENV=test). */
export function requireAccessSecret(config: AppConfig): string {
  if (!config.jwtAccessSecret) {
    throw new Error('JWT_ACCESS_SECRET is required to sign/verify access tokens');
  }
  return config.jwtAccessSecret;
}

/**
 * JWT_REFRESH_SECRET, repurposed as the mfa_token signing secret. Access and mfa tokens are
 * signed with two different secrets (not just a `purpose` claim) so a bug in purpose-checking
 * can never make one type of token interchangeable with the other — verification with the
 * wrong secret fails at the signature check, before any claim is even read.
 */
export function requireMfaSecret(config: AppConfig): string {
  if (!config.jwtRefreshSecret) {
    throw new Error('JWT_REFRESH_SECRET is required to sign/verify mfa tokens');
  }
  return config.jwtRefreshSecret;
}

/** TOTP_ENC_KEY, asserted present (config validation requires it outside NODE_ENV=test). */
export function requireTotpEncKey(config: AppConfig): string {
  const auth = requireAuthConfig(config);
  if (!auth.totpEncKey) {
    throw new Error('TOTP_ENC_KEY is required to encrypt/decrypt TOTP secrets');
  }
  return auth.totpEncKey;
}
