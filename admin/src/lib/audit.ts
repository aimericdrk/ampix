import type { Prisma, PrismaClient } from '../../generated/client';

export type AuditAction =
  | 'login.success'
  | 'login.fail'
  | 'login.locked'
  | 'logout'
  | 'logout_all'
  | 'user.create'
  | 'user.disable'
  | 'user.enable'
  | 'user.reset_password'
  | 'password.change'
  | 'session.revoke'
  | 'login.totp'
  | 'login.recovery_code'
  | 'login.totp_locked'
  | 'totp.enable'
  | 'totp.disable'
  | 'ops.restart'
  | 'ops.scale'
  | 'ops.sample';

/** Fire-and-forget-safe audit write — an audit failure must never break the audited action. */
export async function writeAudit(
  db: PrismaClient,
  action: AuditAction,
  actorId: string | null,
  detail: Record<string, unknown>,
  ip: string,
): Promise<void> {
  try {
    await db.adminAuditEvent.create({
      data: { action, actorId, detail: detail as Prisma.InputJsonValue, ip },
    });
  } catch {
    // Swallowed deliberately; the log line below is the fallback trail.
    console.error(`[audit] failed to record ${action}`);
  }
}
