import { randomBytes } from 'node:crypto';

import {
  StoreCipherError,
  decryptStoreCredentials,
  encryptStoreCredentials,
} from './store-credentials-cipher';

const KEY_B64 = randomBytes(32).toString('base64');

describe('store-credentials-cipher', () => {
  it('round-trips plaintext through encrypt → decrypt and never leaks it', () => {
    const plaintext = JSON.stringify({
      kind: 'google_play',
      serviceAccountJson: '{"type":"service_account","client_email":"x@y.iam"}',
    });

    const blob = encryptStoreCredentials(plaintext, KEY_B64);

    expect(blob).not.toContain(plaintext);
    expect(blob.split('.')).toHaveLength(3);
    expect(decryptStoreCredentials(blob, KEY_B64)).toBe(plaintext);
  });

  it('uses a fresh IV per call so identical plaintext yields distinct blobs', () => {
    const first = encryptStoreCredentials('secret', KEY_B64);
    const second = encryptStoreCredentials('secret', KEY_B64);

    expect(first).not.toBe(second);
    expect(decryptStoreCredentials(first, KEY_B64)).toBe('secret');
    expect(decryptStoreCredentials(second, KEY_B64)).toBe('secret');
  });

  it('throws StoreCipherError when the key does not decode to 32 bytes (encrypt)', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => encryptStoreCredentials('secret', shortKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when the key does not decode to 32 bytes (decrypt)', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const shortKey = randomBytes(16).toString('base64');
    expect(() => decryptStoreCredentials(blob, shortKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when decrypting with a different valid 32-byte key', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const otherKey = randomBytes(32).toString('base64');
    expect(() => decryptStoreCredentials(blob, otherKey)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError when the ciphertext is tampered', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const [iv, tag, ciphertext] = blob.split('.');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    const tampered = [iv, tag, bytes.toString('base64')].join('.');

    expect(() => decryptStoreCredentials(tampered, KEY_B64)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError on a malformed blob (wrong segment count)', () => {
    expect(() => decryptStoreCredentials('not-a-valid-blob', KEY_B64)).toThrow(StoreCipherError);
  });

  it('throws StoreCipherError on a blob whose IV segment is the wrong length', () => {
    const blob = encryptStoreCredentials('secret', KEY_B64);
    const [, tag, ciphertext] = blob.split('.');
    const badIv = [randomBytes(8).toString('base64'), tag, ciphertext].join('.');

    expect(() => decryptStoreCredentials(badIv, KEY_B64)).toThrow(StoreCipherError);
  });
});
