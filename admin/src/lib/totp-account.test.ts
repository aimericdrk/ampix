import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSession, AdminUser, PrismaClient } from '../../generated/client';
import { encryptSecret } from './crypto';
import { hashPassword } from './password';
import { base32Encode, totp } from './totp';
import {
  disableTotp,
  enableTotp,
  generateRecoveryCode,
  hashRecoveryCode,
  setupTotp,
  verifyTotpLogin,
} from './totp-account';
import { resetEnvCache } from './env';
import { UserManagementError } from './users';

const KEY = Buffer.alloc(32, 3).toString('base64');
const SECRET_RAW = Buffer.from('12345678901234567890', 'ascii');
const SECRET = base32Encode(SECRET_RAW);
const now = new Date('2026-08-24T12:00:00Z');
const nowCode = () => totp(SECRET_RAW, now.getTime() / 1000);

function mockDb(over: { user?: Partial<AdminUser>; recovery?: { id: string } | null } = {}) {
  const db = {
    adminUser: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ totpSecretEnc: encryptSecret(SECRET, KEY), ...over.user })),
    },
    adminRecoveryCode: {
      deleteMany: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => over.recovery ?? null),
      update: vi.fn(async () => ({})),
    },
    adminSession: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    adminAuditEvent: { create: vi.fn(async () => ({})) },
  };
  return db as unknown as PrismaClient & typeof db;
}

function user(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u1',
    email: 'ops@example.com',
    totpSecretEnc: encryptSecret(SECRET, KEY),
    totpEnabledAt: new Date('2026-08-01'),
    passwordHash: 'set-in-test',
    ...over,
  } as AdminUser;
}

function session(over: Partial<AdminSession> = {}): AdminSession {
  return { id: 's1', totpFailedCount: 0, totpPendingUntil: new Date(now.getTime() + 60_000), ...over } as AdminSession;
}

beforeEach(() => {
  resetEnvCache();
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/admin_console';
  process.env.TOTP_ENC_KEY = KEY;
});

describe('setup/enable', () => {
  it('setup refuses when already enabled; enable requires a valid code and issues 10 codes', async () => {
    await expect(setupTotp(mockDb(), user(), '1.1.1.1')).rejects.toThrow(/already enabled/);
    const db = mockDb();
    const res = await enableTotp(db, user({ totpEnabledAt: null }), nowCode(), '1.1.1.1', now);
    expect(res.recoveryCodes).toHaveLength(10);
    expect(db.adminRecoveryCode.createMany).toHaveBeenCalled();
    await expect(enableTotp(mockDb(), user({ totpEnabledAt: null }), '000000', '1.1.1.1', now)).rejects.toThrow(
      UserManagementError,
    );
  });
  it('enrolment is unavailable without TOTP_ENC_KEY', async () => {
    delete process.env.TOTP_ENC_KEY;
    resetEnvCache();
    await expect(setupTotp(mockDb(), user({ totpEnabledAt: null }), '1.1.1.1')).rejects.toThrow(/unavailable/);
  });
});

describe('verifyTotpLogin', () => {
  it('clears pending on a valid code', async () => {
    const db = mockDb();
    const res = await verifyTotpLogin(db, session(), user(), nowCode(), '1.1.1.1', now);
    expect(res).toEqual({ ok: true, via: 'totp' });
    expect(db.adminSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totpPendingUntil: null, totpFailedCount: 0 } }),
    );
  });
  it('accepts an unused recovery code and consumes it', async () => {
    const db = mockDb({ recovery: { id: 'rc1' } });
    const res = await verifyTotpLogin(db, session(), user(), 'aaaaa-bbbbb', '1.1.1.1', now);
    expect(res).toEqual({ ok: true, via: 'recovery' });
    expect(db.adminRecoveryCode.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rc1' } }),
    );
  });
  it('revokes the session on the 5th wrong code', async () => {
    const db = mockDb();
    const res4 = await verifyTotpLogin(db, session({ totpFailedCount: 3 }), user(), '000000', '1.1.1.1', now);
    expect(res4).toEqual({ ok: false, revoked: false });
    const res5 = await verifyTotpLogin(db, session({ totpFailedCount: 4 }), user(), '000000', '1.1.1.1', now);
    expect(res5).toEqual({ ok: false, revoked: true });
    expect(db.adminSession.updateMany).toHaveBeenCalled(); // revokeSession
  });
});

describe('disableTotp', () => {
  it('requires the current password AND a valid code, then wipes secret + codes', async () => {
    const pw = 'a-long-enough-password';
    const u = user({ passwordHash: await hashPassword(pw) });
    const db = mockDb();
    await disableTotp(db, u, pw, nowCode(), '1.1.1.1', now);
    expect(db.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totpSecretEnc: null, totpEnabledAt: null } }),
    );
    await expect(disableTotp(mockDb(), u, 'wrong-password-here', nowCode(), '1.1.1.1', now)).rejects.toThrow(
      /incorrect/,
    );
    await expect(disableTotp(mockDb(), u, pw, '000000', '1.1.1.1', now)).rejects.toThrow(/not valid/);
  });
});

describe('recovery codes', () => {
  it('format + hash normalization (dashes/case-insensitive)', () => {
    const c = generateRecoveryCode();
    expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    expect(hashRecoveryCode('AAAAA-BBBBB')).toBe(hashRecoveryCode('aaaaabbbbb'));
  });
});
