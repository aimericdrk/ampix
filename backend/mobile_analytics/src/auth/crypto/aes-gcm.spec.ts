import { randomBytes } from 'node:crypto';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from './aes-gcm';

describe('AES-256-GCM TOTP secret encryption', () => {
  const hexKey = randomBytes(32).toString('hex');
  const base64Key = randomBytes(32).toString('base64');

  it('decodes a 64-char hex key to 32 bytes', () => {
    const key = decodeEncryptionKey(hexKey);
    expect(key).toHaveLength(32);
    expect(key).toEqual(Buffer.from(hexKey, 'hex'));
  });

  it('decodes a base64 key to 32 bytes', () => {
    const key = decodeEncryptionKey(base64Key);
    expect(key).toHaveLength(32);
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    expect(() => decodeEncryptionKey('a'.repeat(32))).toThrow(/32 bytes/);
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const key = decodeEncryptionKey(hexKey);
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(plaintext, key);
    expect(encrypted.split('.')).toHaveLength(3);
    expect(decryptSecret(encrypted, key)).toBe(plaintext);
  });

  it('produces a different ciphertext on each call (random IV) but both decrypt correctly', () => {
    const key = decodeEncryptionKey(hexKey);
    const a = encryptSecret('same-secret', key);
    const b = encryptSecret('same-secret', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('same-secret');
    expect(decryptSecret(b, key)).toBe('same-secret');
  });

  it('fails to decrypt with the wrong key', () => {
    const key = decodeEncryptionKey(hexKey);
    const otherKey = decodeEncryptionKey(randomBytes(32).toString('hex'));
    const encrypted = encryptSecret('secret', key);
    expect(() => decryptSecret(encrypted, otherKey)).toThrow();
  });

  it('detects tampering with the ciphertext (auth tag mismatch)', () => {
    const key = decodeEncryptionKey(hexKey);
    const encrypted = encryptSecret('secret', key);
    const [iv, tag, ciphertext] = encrypted.split('.');
    const tampered = Buffer.from(ciphertext, 'base64url');
    tampered[0] ^= 0xff;
    const corrupted = [iv, tag, tampered.toString('base64url')].join('.');
    expect(() => decryptSecret(corrupted, key)).toThrow();
  });

  it('rejects a malformed payload (wrong number of parts)', () => {
    const key = decodeEncryptionKey(hexKey);
    expect(() => decryptSecret('not.enough', key)).toThrow(/malformed/);
    expect(() => decryptSecret('a.b.c.d', key)).toThrow(/malformed/);
  });
});
