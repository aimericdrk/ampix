import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/client';
import {
  ATTEMPT_WINDOW_MS,
  attemptLogin,
  clientIpFrom,
  GENERIC_LOGIN_ERROR,
  MAX_FAILS_PER_EMAIL,
} from './auth';
import { hashPassword } from './password';
import { resetEnvCache } from './env';

const now = new Date('2026-08-24T12:00:00Z');
const GOOD_PASSWORD = 'correct horse battery staple';
let goodHash: string;

/** Minimal mock Prisma covering the tables attemptLogin touches (TDD London style). */
function mockDb(over: { user?: unknown; failsEmail?: number; failsIp?: number }) {
  const db = {
    adminLoginAttempt: {
      count: vi.fn(async ({ where }: { where: { email?: string } }) =>
        where.email !== undefined ? (over.failsEmail ?? 0) : (over.failsIp ?? 0),
      ),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    adminUser: {
      findUnique: vi.fn(async () => over.user ?? null),
      update: vi.fn(async () => ({})),
    },
    adminSession: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 's1', ...data })),
    },
    adminAuditEvent: { create: vi.fn(async () => ({})) },
  };
  return db as unknown as PrismaClient & typeof db;
}

function user(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'ops@example.com',
    passwordHash: goodHash,
    disabled: false,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    ...over,
  };
}

beforeEach(async () => {
  resetEnvCache();
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/admin_console';
  goodHash ??= await hashPassword(GOOD_PASSWORD);
});

describe('attemptLogin', () => {
  it('succeeds with valid credentials: resets counters, records attempt, creates session', async () => {
    const db = mockDb({ user: user() });
    const res = await attemptLogin(db, 'Ops@Example.com', GOOD_PASSWORD, '1.2.3.4', 'ua', now);
    expect(res.ok).toBe(true);
    expect(db.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { failedLoginCount: 0, lockedUntil: null } }),
    );
    expect(db.adminSession.create).toHaveBeenCalled();
  });

  it('fails generically for unknown user, wrong password, disabled, and locked accounts', async () => {
    for (const setup of [
      mockDb({}),
      mockDb({ user: user() }),
      mockDb({ user: user({ disabled: true }) }),
      mockDb({ user: user({ lockedUntil: new Date(now.getTime() + 60_000) }) }),
    ]) {
      const res = await attemptLogin(setup, 'ops@example.com', 'wrong password value', '1.2.3.4', 'ua', now);
      expect(res).toEqual({ ok: false, error: GENERIC_LOGIN_ERROR });
      expect(setup.adminSession.create).not.toHaveBeenCalled();
    }
  });

  it('correct password still fails while the account lock is active', async () => {
    const db = mockDb({ user: user({ lockedUntil: new Date(now.getTime() + 60_000) }) });
    const res = await attemptLogin(db, 'ops@example.com', GOOD_PASSWORD, '1.2.3.4', 'ua', now);
    expect(res.ok).toBe(false);
  });

  it('refuses before verifying once the email window is exhausted', async () => {
    const db = mockDb({ user: user(), failsEmail: MAX_FAILS_PER_EMAIL });
    const res = await attemptLogin(db, 'ops@example.com', GOOD_PASSWORD, '1.2.3.4', 'ua', now);
    expect(res.ok).toBe(false);
    expect(db.adminUser.findUnique).not.toHaveBeenCalled();
  });

  it('refuses when the IP window is exhausted, regardless of email', async () => {
    const db = mockDb({ user: user(), failsIp: 10 });
    const res = await attemptLogin(db, 'other@example.com', GOOD_PASSWORD, '9.9.9.9', 'ua', now);
    expect(res.ok).toBe(false);
  });

  it('locks the account on the 5th failure in the window', async () => {
    const db = mockDb({ user: user(), failsEmail: MAX_FAILS_PER_EMAIL - 1 });
    await attemptLogin(db, 'ops@example.com', 'wrong password value', '1.2.3.4', 'ua', now);
    expect(db.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lockedUntil: new Date(now.getTime() + ATTEMPT_WINDOW_MS) }),
      }),
    );
  });
});

describe('clientIpFrom', () => {
  it('takes the first X-Forwarded-For hop, falls back to x-real-ip then unknown', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});
