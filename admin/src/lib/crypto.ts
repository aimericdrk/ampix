import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM at-rest encryption for TOTP secrets (v2 design Phase 1). The key comes from the
 * TOTP_ENC_KEY secret env — 32 bytes encoded as base64 or 64 hex chars, mirroring the analytics
 * backend's convention. Ciphertext layout: base64( iv(12) | tag(16) | data ).
 */
const HEX_64 = /^[0-9a-fA-F]{64}$/;
const BASE64_CHARS = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes a 32-byte key from hex or base64; null when the value is not a valid 32-byte key. */
export function decodeKeyBytes(raw: string): Buffer | null {
  if (HEX_64.test(raw)) return Buffer.from(raw, 'hex');
  if (BASE64_CHARS.test(raw)) {
    const buf = Buffer.from(raw, 'base64');
    // Round-trip: Buffer.from(_, 'base64') silently ignores garbage instead of throwing.
    if (buf.toString('base64').replace(/=+$/, '') === raw.replace(/=+$/, '') && buf.length === 32) {
      return buf;
    }
  }
  return null;
}

export class CryptoKeyError extends Error {}

function keyFrom(raw: string): Buffer {
  const key = decodeKeyBytes(raw);
  if (!key) throw new CryptoKeyError('TOTP_ENC_KEY must decode to exactly 32 bytes (base64 or 64 hex chars)');
  return key;
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  const key = keyFrom(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/** Returns null on any tampering/wrong-key/format problem — callers treat null as "unavailable". */
export function decryptSecret(ciphertext: string, rawKey: string): string | null {
  try {
    const key = keyFrom(rawKey);
    const buf = Buffer.from(ciphertext, 'base64');
    if (buf.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch (e) {
    if (e instanceof CryptoKeyError) throw e;
    return null;
  }
}
