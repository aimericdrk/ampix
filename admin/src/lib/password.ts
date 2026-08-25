import argon2 from 'argon2';
import { z } from 'zod';

/** Password policy (design §3.7): length is the only hard rule — length beats composition theatre. */
export const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(256, 'password must be at most 256 characters');

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP-recommended argon2id baseline
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash → treat as mismatch, never throw into the login path
  }
}

/**
 * A real argon2 hash of a throwaway value. verifyPassword() runs against this when the user does
 * not exist so response timing does not reveal which emails have accounts (design §3.1).
 */
export const DUMMY_HASH_PROMISE: Promise<string> = hashPassword('timing-equalizer-dummy-value');
