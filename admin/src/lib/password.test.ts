import { describe, expect, it } from 'vitest';
import { DUMMY_HASH_PROMISE, hashPassword, passwordSchema, verifyPassword } from './password';

describe('passwordSchema', () => {
  it('rejects under 12 chars and over 256', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(257)).success).toBe(false);
  });
});

describe('argon2 hashing', () => {
  it('hashes as argon2id and verifies roundtrip', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password entirely')).toBe(false);
  });

  it('treats malformed hashes as mismatch instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever-password')).toBe(false);
  });

  it('exposes a real dummy hash for timing equalization', async () => {
    expect(await DUMMY_HASH_PROMISE).toMatch(/^\$argon2id\$/);
  });
});
