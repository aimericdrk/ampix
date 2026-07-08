import { randomBytes } from 'node:crypto';

/**
 * Generates a fresh ingest token: `mam_` + 32 random lowercase hex characters
 * (contracts §4/§6, matches `@myampix/contracts`' `SDK_TOKEN_REGEX`).
 */
export function generateSdkToken(): string {
  return 'mam_' + randomBytes(16).toString('hex');
}
