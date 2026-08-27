import { randomBytes } from 'node:crypto';

/** Public SDK key (safe to ship in a client): `mp_pub_` + 16 random bytes hex. */
export function generatePublicSdkKey(): string {
  return `mp_pub_${randomBytes(16).toString('hex')}`;
}

/** Server key (never leaves the customer's backend): `mp_srv_` + 16 random bytes hex. */
export function generateServerKey(): string {
  return `mp_srv_${randomBytes(16).toString('hex')}`;
}
