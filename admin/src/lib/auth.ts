import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { PrismaClient } from '../../generated/client';
import { writeAudit } from './audit';
import { loadEnv } from './env';
import { DUMMY_HASH_PROMISE, verifyPassword } from './password';
import {
  createSession,
  sessionCookieName,
  validateSessionToken,
  type ValidatedSession,
} from './session';
import { prisma } from './db';

/** Brute-force windows (design §3.2). */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 10;
/** One generic message for every failure mode — no user/lock oracle. */
export const GENERIC_LOGIN_ERROR = 'Invalid credentials, or the account is temporarily locked.';

export type LoginResult =
  | { ok: true; token: string; mustChangePassword: boolean }
  | { ok: false; error: string };

/**
 * The complete login decision (design §3.1–§3.2). Pure of HTTP concerns so it is unit-testable:
 * callers pass the Prisma client, already-extracted ip/userAgent, and (in tests) a clock.
 */
export async function attemptLogin(
  db: PrismaClient,
  emailRaw: string,
  password: string,
  ip: string,
  userAgent: string,
  now = new Date(),
): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS);

  const [failsForEmail, failsForIp] = await Promise.all([
    db.adminLoginAttempt.count({ where: { email, success: false, at: { gt: windowStart } } }),
    db.adminLoginAttempt.count({ where: { ip, success: false, at: { gt: windowStart } } }),
  ]);

  const recordFail = async (reason: string): Promise<void> => {
    await db.adminLoginAttempt.create({ data: { email, ip, success: false } });
    await writeAudit(db, 'login.fail', null, { email, reason }, ip);
  };

  if (failsForIp >= MAX_FAILS_PER_IP || failsForEmail >= MAX_FAILS_PER_EMAIL) {
    await writeAudit(db, 'login.locked', null, { email, failsForEmail, failsForIp }, ip);
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  const user = await db.adminUser.findUnique({ where: { email } });

  // Timing equalizer: verify against a real argon2 hash even when the user is unknown.
  const passwordOk = await verifyPassword(user?.passwordHash ?? (await DUMMY_HASH_PROMISE), password);

  if (!user || user.disabled || (user.lockedUntil && user.lockedUntil > now) || !passwordOk) {
    await recordFail(!user ? 'unknown_user' : user.disabled ? 'disabled' : !passwordOk ? 'bad_password' : 'locked');
    // The 5th failure in the window locks the account explicitly.
    if (user && !user.disabled && failsForEmail + 1 >= MAX_FAILS_PER_EMAIL) {
      await db.adminUser.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(now.getTime() + LOCKOUT_MS), failedLoginCount: { increment: 1 } },
      });
      await writeAudit(db, 'login.locked', null, { email }, ip);
    }
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  await db.adminUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await db.adminLoginAttempt.create({ data: { email, ip, success: true } });
  // Opportunistic hygiene: drop attempt rows older than 24 h.
  await db.adminLoginAttempt.deleteMany({
    where: { at: { lt: new Date(now.getTime() - 24 * 3600_000) } },
  });
  const { token } = await createSession(db, user.id, ip, userAgent, now);
  await writeAudit(db, 'login.success', user.id, { email }, ip);
  return { ok: true, token, mustChangePassword: user.mustChangePassword };
}

/** First X-Forwarded-For hop (set by the ingress) or a placeholder. */
export function clientIpFrom(h: Headers): string {
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim().slice(0, 64);
  return h.get('x-real-ip')?.slice(0, 64) ?? 'unknown';
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h as unknown as Headers), userAgent: h.get('user-agent') ?? '' };
}

/** Reads the session cookie and resolves it to a live session, or null. */
export async function getCurrentSession(): Promise<ValidatedSession> {
  const env = loadEnv();
  const jar = await cookies();
  const token = jar.get(sessionCookieName(env.COOKIE_SECURE))?.value;
  if (!token) return null;
  return validateSessionToken(prisma, token);
}

/** Page guard: redirects to /login when unauthenticated. */
export async function requireSession(): Promise<NonNullable<ValidatedSession>> {
  const s = await getCurrentSession();
  if (!s) redirect('/login');
  return s;
}

/** API guard: returns null (callers respond 401) when unauthenticated. */
export async function requireSessionApi(): Promise<ValidatedSession> {
  return getCurrentSession();
}
