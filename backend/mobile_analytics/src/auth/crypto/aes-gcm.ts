import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { decodeAuthKeyBytes } from '../../config/app-config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV, the size GCM is designed and optimized for.

/** Decodes TOTP_ENC_KEY (hex-64 or base64, already validated to be 32 bytes at boot by
 *  app-config's loadConfig) via the exact same decoder app-config uses, so the two never drift. */
export function decodeEncryptionKey(raw: string): Buffer {
  const key = decodeAuthKeyBytes(raw);
  if (!key || key.length !== 32) {
    throw new Error('TOTP_ENC_KEY must decode to exactly 32 bytes (64 hex chars or base64)');
  }
  return key;
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `key`, returning `iv.tag.ciphertext` (each
 * base64url, dot-separated) — the format persisted in `users.totp_secret`. A fresh random IV is
 * generated per call; GCM's authentication tag detects any tampering with the stored value.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((buf) => buf.toString('base64url')).join('.');
}

/** Inverse of `encryptSecret`. Throws if the payload is malformed or the auth tag doesn't match. */
export function decryptSecret(payload: string, key: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('malformed encrypted TOTP secret: expected "iv.tag.ciphertext"');
  }
  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
