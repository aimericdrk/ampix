import { randomBytes } from 'node:crypto';

/** Public SDK key (safe to ship in a client): `mrc_pub_` + 16 random bytes hex. */
export function generatePublicSdkKey(): string {
  return `mrc_pub_${randomBytes(16).toString('hex')}`;
}
