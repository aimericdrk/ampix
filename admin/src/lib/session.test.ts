import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeExpiry,
  generateSessionToken,
  hashSessionToken,
  isSessionLive,
  sessionCookie,
  sessionCookieName,
  shouldTouch,
} from './session';
import { resetEnvCache } from './env';

const now = new Date('2026-08-24T12:00:00Z');

beforeEach(() => {
  resetEnvCache();
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/admin_console';
});

describe('session tokens', () => {
  it('generates 256-bit base64url tokens, unique per call', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically with sha256', () => {
    expect(hashSessionToken('abc')).toBe(hashSessionToken('abc'));
    expect(hashSessionToken('abc')).toHaveLength(64);
    expect(hashSessionToken('abc')).not.toContain('abc');
  });
});

describe('expiry', () => {
  it('computes idle and absolute windows', () => {
    const e = computeExpiry(now, 12, 7);
    expect(e.idleExpiresAt.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    expect(e.absoluteExpiresAt.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });

  it('isSessionLive: live before either expiry, dead after idle, absolute, or revocation', () => {
    const base = {
      revokedAt: null,
      idleExpiresAt: new Date(now.getTime() + 1000),
      absoluteExpiresAt: new Date(now.getTime() + 1000),
    };
    expect(isSessionLive(base, now)).toBe(true);
    expect(isSessionLive({ ...base, idleExpiresAt: now }, now)).toBe(false);
    expect(isSessionLive({ ...base, absoluteExpiresAt: now }, now)).toBe(false);
    expect(isSessionLive({ ...base, revokedAt: now }, now)).toBe(false);
  });

  it('shouldTouch only after the 5-minute throttle', () => {
    expect(shouldTouch(new Date(now.getTime() - 4 * 60_000), now)).toBe(false);
    expect(shouldTouch(new Date(now.getTime() - 6 * 60_000), now)).toBe(true);
  });
});

describe('cookie', () => {
  it('uses the __Host- prefix only when secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-admx');
    expect(sessionCookieName(false)).toBe('admx');
  });

  it('serializes set and delete forms', () => {
    const set = sessionCookie('tok', true);
    expect(set).toMatchObject({
      name: '__Host-admx',
      value: 'tok',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(set.maxAge).toBe(7 * 86_400);
    const del = sessionCookie(null, true);
    expect(del.value).toBe('');
    expect(del.maxAge).toBe(0);
  });
});
