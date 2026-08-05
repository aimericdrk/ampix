import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM cipher for the encrypted-at-rest `App.storeCredentials` blob.
 *
 * A stored credential is a single self-describing string: `base64(iv).base64(tag).base64(ciphertext)`
 * (dot-joined), so one column round-trips without a separate IV/tag column. The 12-byte IV is random
 * per encryption; the 16-byte GCM auth tag makes any tamper fail closed.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SEGMENTS = 3;

/**
 * Thrown when the encryption key is the wrong length, or a blob fails to decrypt — a GCM auth-tag
 * mismatch (tamper / wrong key) or a structurally malformed blob. Callers (E3 service, E5 store
 * client) map this to a fail-closed store-credential path, never to a leaked plaintext.
 */
export class StoreCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreCipherError';
  }
}

/** Decode the base64 key and enforce the exact AES-256 length. */
function decodeKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new StoreCipherError(
      `Store credentials key must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt `plaintext` → `base64(iv).base64(tag).base64(ciphertext)`. */
export function encryptStoreCredentials(plaintext: string, keyB64: string): string {
  const key = decodeKey(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Decrypt a `base64(iv).base64(tag).base64(ciphertext)` blob. Any failure is a StoreCipherError. */
export function decryptStoreCredentials(blob: string, keyB64: string): string {
  const key = decodeKey(keyB64);

  const parts = blob.split('.');
  if (parts.length !== SEGMENTS) {
    throw new StoreCipherError('Malformed store credentials blob: expected iv.tag.ciphertext');
  }

  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  if (iv.length !== IV_BYTES) {
    throw new StoreCipherError('Malformed store credentials blob: bad IV length');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new StoreCipherError('Failed to decrypt store credentials (tampered or wrong key)');
  }
}
