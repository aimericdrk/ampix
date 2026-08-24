import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/client';
import { hashPassword } from './password';
import { changeOwnPassword, createUser, disableUser, generateTempPassword, resetPassword, UserManagementError } from './users';
import { resetEnvCache } from './env';

const actor = { id: 'actor1', ip: '1.2.3.4', currentSessionId: 'sess1' };

function mockDb(over: { user?: unknown; enabledCount?: number } = {}) {
  const db = {
    adminUser: {
      findUnique: vi.fn(async () => over.user ?? null),
      count: vi.fn(async () => over.enabledCount ?? 2),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new1', ...data })),
      update: vi.fn(async () => ({})),
    },
    adminSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    adminRecoveryCode: { deleteMany: vi.fn(async () => ({})) },
    adminAuditEvent: { create: vi.fn(async () => ({})) },
  };
  return db as unknown as PrismaClient & typeof db;
}

beforeEach(() => {
  resetEnvCache();
  process.env.DATABASE_URL = 'postgresql://u:p@h:5432/admin_console';
});

describe('createUser', () => {
  it('creates with a generated temp password and mustChangePassword', async () => {
    const db = mockDb();
    const res = await createUser(db, actor, { email: 'New@Example.com', displayName: 'New Admin' });
    expect(res.tempPassword).toBeTruthy();
    expect(res.tempPassword!.length).toBeGreaterThanOrEqual(12);
    expect(db.adminUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com', mustChangePassword: true }) }),
    );
  });
  it('rejects duplicates, bad emails, and short supplied passwords', async () => {
    await expect(createUser(mockDb({ user: { id: 'x' } }), actor, { email: 'a@b.co', displayName: 'X' })).rejects.toThrow(UserManagementError);
    await expect(createUser(mockDb(), actor, { email: 'not-an-email', displayName: 'X' })).rejects.toThrow(UserManagementError);
    await expect(createUser(mockDb(), actor, { email: 'a@b.co', displayName: 'X', password: 'short' })).rejects.toThrow(/12 characters/);
  });
});

describe('disableUser guards', () => {
  it('refuses self-disable', async () => {
    await expect(disableUser(mockDb(), actor, actor.id)).rejects.toThrow(/own account/);
  });
  it('refuses disabling the last enabled account', async () => {
    const db = mockDb({ user: { id: 't', email: 't@x.co', disabled: false }, enabledCount: 1 });
    await expect(disableUser(db, actor, 't')).rejects.toThrow(/last enabled/);
  });
  it('disables and revokes sessions otherwise', async () => {
    const db = mockDb({ user: { id: 't', email: 't@x.co', disabled: false }, enabledCount: 2 });
    await disableUser(db, actor, 't');
    expect(db.adminUser.update).toHaveBeenCalledWith(expect.objectContaining({ data: { disabled: true } }));
    expect(db.adminSession.updateMany).toHaveBeenCalled();
  });
});

describe('resetPassword / changeOwnPassword', () => {
  it('reset issues a policy-compliant temp password, revokes sessions, forces change', async () => {
    const db = mockDb({ user: { id: 't', email: 't@x.co' } });
    const { tempPassword } = await resetPassword(db, actor, 't');
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(db.adminSession.updateMany).toHaveBeenCalled();
    expect(db.adminUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: true }) }),
    );
  });
  it('change requires the correct current password and revokes other sessions only', async () => {
    const hash = await hashPassword('the old password!');
    const db = mockDb({ user: { id: actor.id, passwordHash: hash } });
    await expect(changeOwnPassword(db, actor, 'wrong old password', 'a new long password')).rejects.toThrow(/incorrect/);
    await changeOwnPassword(db, actor, 'the old password!', 'a new long password');
    expect(db.adminSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: actor.currentSessionId } }) }),
    );
  });
  it('rejects reusing the current password or a too-short one', async () => {
    const hash = await hashPassword('the old password!');
    const db = mockDb({ user: { id: actor.id, passwordHash: hash } });
    await expect(changeOwnPassword(db, actor, 'the old password!', 'the old password!')).rejects.toThrow(/differ/);
    await expect(changeOwnPassword(db, actor, 'the old password!', 'short')).rejects.toThrow(/12 characters/);
  });
});

describe('generateTempPassword', () => {
  it('is unique and policy-compliant', () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(12);
  });
});
