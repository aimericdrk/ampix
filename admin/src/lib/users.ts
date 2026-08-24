import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/client';
import { writeAudit } from './audit';
import { hashPassword, passwordSchema, verifyPassword } from './password';
import { revokeAllSessions } from './session';

/** User management (design §3.9). Every mutation is audited by the callers' shared helpers here. */

export class UserManagementError extends Error {}

export function generateTempPassword(): string {
  // 16 bytes → 22 base64url chars; comfortably over the 12-char policy.
  return randomBytes(16).toString('base64url');
}

export async function createUser(
  db: PrismaClient,
  actor: { id: string; ip: string },
  input: { email: string; displayName: string; password?: string },
): Promise<{ id: string; email: string; tempPassword: string | null }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserManagementError('invalid email');
  const displayName = input.displayName.trim();
  if (!displayName) throw new UserManagementError('display name is required');
  const supplied = input.password?.length ? input.password : null;
  if (supplied) {
    const parsed = passwordSchema.safeParse(supplied);
    if (!parsed.success) throw new UserManagementError(parsed.error.issues[0]!.message);
  }
  const tempPassword = supplied ? null : generateTempPassword();
  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) throw new UserManagementError('a user with this email already exists');
  const user = await db.adminUser.create({
    data: {
      email,
      displayName,
      passwordHash: await hashPassword(supplied ?? tempPassword!),
      mustChangePassword: true, // every new account rotates its password on first login
      createdById: actor.id,
    },
  });
  await writeAudit(db, 'user.create', actor.id, { email }, actor.ip);
  return { id: user.id, email: user.email, tempPassword };
}

export async function disableUser(
  db: PrismaClient,
  actor: { id: string; ip: string },
  targetId: string,
): Promise<void> {
  if (targetId === actor.id) throw new UserManagementError('you cannot disable your own account');
  const enabledCount = await db.adminUser.count({ where: { disabled: false } });
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  if (!target) throw new UserManagementError('user not found');
  if (!target.disabled && enabledCount <= 1) {
    throw new UserManagementError('the last enabled account cannot be disabled');
  }
  await db.adminUser.update({ where: { id: targetId }, data: { disabled: true } });
  await revokeAllSessions(db, targetId);
  await writeAudit(db, 'user.disable', actor.id, { targetId, email: target.email }, actor.ip);
}

export async function enableUser(
  db: PrismaClient,
  actor: { id: string; ip: string },
  targetId: string,
): Promise<void> {
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  if (!target) throw new UserManagementError('user not found');
  await db.adminUser.update({
    where: { id: targetId },
    data: { disabled: false, lockedUntil: null, failedLoginCount: 0 },
  });
  await writeAudit(db, 'user.enable', actor.id, { targetId, email: target.email }, actor.ip);
}

export async function resetPassword(
  db: PrismaClient,
  actor: { id: string; ip: string },
  targetId: string,
): Promise<{ tempPassword: string }> {
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  if (!target) throw new UserManagementError('user not found');
  const tempPassword = generateTempPassword();
  await db.adminUser.update({
    where: { id: targetId },
    // Also clears TOTP — an admin reset is the lost-authenticator recovery path (v2 design Phase 1).
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      lockedUntil: null,
      failedLoginCount: 0,
      totpSecretEnc: null,
      totpEnabledAt: null,
    },
  });
  await db.adminRecoveryCode.deleteMany({ where: { userId: targetId } });
  await revokeAllSessions(db, targetId);
  await writeAudit(db, 'user.reset_password', actor.id, { targetId, email: target.email, totpCleared: true }, actor.ip);
  return { tempPassword };
}

export async function changeOwnPassword(
  db: PrismaClient,
  actor: { id: string; ip: string; currentSessionId: string },
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const parsed = passwordSchema.safeParse(newPassword);
  if (!parsed.success) throw new UserManagementError(parsed.error.issues[0]!.message);
  const user = await db.adminUser.findUnique({ where: { id: actor.id } });
  if (!user) throw new UserManagementError('user not found');
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new UserManagementError('current password is incorrect');
  }
  if (currentPassword === newPassword) throw new UserManagementError('new password must differ from the current one');
  await db.adminUser.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  // Every OTHER session dies with the old password (design §3.7).
  await revokeAllSessions(db, actor.id, actor.currentSessionId);
  await writeAudit(db, 'password.change', actor.id, {}, actor.ip);
}
