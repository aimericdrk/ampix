import { createHash, randomBytes } from 'node:crypto';
import type { AdminSession, AdminUser, PrismaClient } from '../../generated/client';
import { writeAudit } from './audit';
import { decryptSecret, encryptSecret } from './crypto';
import { loadEnv } from './env';
import { verifyPassword } from './password';
import { revokeSession } from './session';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';
import { UserManagementError } from './users';

/** TOTP enrolment / login verification (v2 design Phase 1). */

export const TOTP_MAX_FAILS = 5;
export const RECOVERY_CODE_COUNT = 10;

export function totpAvailable(): boolean {
  return Boolean(loadEnv().TOTP_ENC_KEY);
}

function requireKey(): string {
  const key = loadEnv().TOTP_ENC_KEY;
  if (!key) throw new UserManagementError('two-factor is unavailable: TOTP_ENC_KEY is not configured');
  return key;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/-/g, '').toLowerCase()).digest('hex');
}

export function generateRecoveryCode(): string {
  const hex = randomBytes(5).toString('hex'); // 10 chars ≈ 40 bits — plenty for 10 single-use codes
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
}

/** Step 1: store an (encrypted) candidate secret; 2FA is NOT active until `enableTotp` verifies a code. */
export async function setupTotp(
  db: PrismaClient,
  user: AdminUser,
  ip: string,
): Promise<{ secret: string; otpauth: string }> {
  if (user.totpEnabledAt) throw new UserManagementError('two-factor is already enabled');
  const key = requireKey();
  const secret = generateTotpSecret();
  await db.adminUser.update({
    where: { id: user.id },
    data: { totpSecretEnc: encryptSecret(secret, key), totpEnabledAt: null },
  });
  void ip;
  return { secret, otpauth: otpauthUri(secret, user.email) };
}

/** Step 2: a valid code proves the authenticator has the secret → activate + issue recovery codes. */
export async function enableTotp(
  db: PrismaClient,
  user: AdminUser,
  code: string,
  ip: string,
  now = new Date(),
): Promise<{ recoveryCodes: string[] }> {
  if (user.totpEnabledAt) throw new UserManagementError('two-factor is already enabled');
  const key = requireKey();
  const fresh = await db.adminUser.findUnique({ where: { id: user.id } });
  const secret = fresh?.totpSecretEnc ? decryptSecret(fresh.totpSecretEnc, key) : null;
  if (!secret) throw new UserManagementError('no pending two-factor setup — start again');
  if (!verifyTotp(secret, code, now.getTime() / 1000)) {
    throw new UserManagementError('that code is not valid — check your authenticator app');
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await db.adminRecoveryCode.deleteMany({ where: { userId: user.id } });
  await db.adminRecoveryCode.createMany({
    data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })),
  });
  await db.adminUser.update({ where: { id: user.id }, data: { totpEnabledAt: now } });
  await writeAudit(db, 'totp.enable', user.id, {}, ip);
  return { recoveryCodes: codes };
}

export async function disableTotp(
  db: PrismaClient,
  user: AdminUser,
  currentPassword: string,
  code: string,
  ip: string,
  now = new Date(),
): Promise<void> {
  if (!user.totpEnabledAt) throw new UserManagementError('two-factor is not enabled');
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new UserManagementError('current password is incorrect');
  }
  const ok = await checkTotpOrRecovery(db, user, code, now);
  if (!ok) throw new UserManagementError('that code is not valid');
  await db.adminUser.update({
    where: { id: user.id },
    data: { totpSecretEnc: null, totpEnabledAt: null },
  });
  await db.adminRecoveryCode.deleteMany({ where: { userId: user.id } });
  await writeAudit(db, 'totp.disable', user.id, {}, ip);
}

/** Accepts a live TOTP code or an unused recovery code (which it consumes). */
async function checkTotpOrRecovery(
  db: PrismaClient,
  user: AdminUser,
  code: string,
  now: Date,
): Promise<'totp' | 'recovery' | false> {
  const key = requireKey();
  const secret = user.totpSecretEnc ? decryptSecret(user.totpSecretEnc, key) : null;
  if (secret && verifyTotp(secret, code, now.getTime() / 1000)) return 'totp';
  const rc = await db.adminRecoveryCode.findFirst({
    where: { userId: user.id, usedAt: null, codeHash: hashRecoveryCode(code) },
  });
  if (rc) {
    await db.adminRecoveryCode.update({ where: { id: rc.id }, data: { usedAt: now } });
    return 'recovery';
  }
  return false;
}

export type TotpLoginResult = { ok: true; via: 'totp' | 'recovery' } | { ok: false; revoked: boolean };

/** Second login factor on a TOTP-pending session; 5 wrong codes revoke it (v2 design Phase 1). */
export async function verifyTotpLogin(
  db: PrismaClient,
  session: AdminSession,
  user: AdminUser,
  code: string,
  ip: string,
  now = new Date(),
): Promise<TotpLoginResult> {
  const via = await checkTotpOrRecovery(db, user, code, now);
  if (via) {
    await db.adminSession.update({
      where: { id: session.id },
      data: { totpPendingUntil: null, totpFailedCount: 0 },
    });
    await writeAudit(db, via === 'totp' ? 'login.totp' : 'login.recovery_code', user.id, {}, ip);
    return { ok: true, via };
  }
  const fails = session.totpFailedCount + 1;
  if (fails >= TOTP_MAX_FAILS) {
    await revokeSession(db, session.id);
    await writeAudit(db, 'login.totp_locked', user.id, { fails }, ip);
    return { ok: false, revoked: true };
  }
  await db.adminSession.update({ where: { id: session.id }, data: { totpFailedCount: fails } });
  return { ok: false, revoked: false };
}
