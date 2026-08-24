import { createHash, randomBytes } from 'node:crypto';
import type { AdminSession, AdminUser, PrismaClient } from '../../generated/client';
import { loadEnv } from './env';

/**
 * Server-side sessions (design §3.3–§3.5). The cookie holds a 256-bit random token; the database
 * holds only sha256(token). Idle expiry slides (write-throttled), absolute expiry never moves.
 */

export const SESSION_COOKIE_SECURE = '__Host-admx';
export const SESSION_COOKIE_DEV = 'admx';
/** lastSeenAt writes are throttled: touch only when older than this. */
export const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface SessionExpiry {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export function computeExpiry(
  now: Date,
  idleHours: number,
  absoluteDays: number,
): SessionExpiry {
  return {
    idleExpiresAt: new Date(now.getTime() + idleHours * 3600_000),
    absoluteExpiresAt: new Date(now.getTime() + absoluteDays * 86_400_000),
  };
}

/** Pure validity check — the unit-testable heart of validateSessionToken. */
export function isSessionLive(
  s: Pick<AdminSession, 'revokedAt' | 'idleExpiresAt' | 'absoluteExpiresAt'>,
  now: Date,
): boolean {
  if (s.revokedAt) return false;
  if (s.idleExpiresAt.getTime() <= now.getTime()) return false;
  if (s.absoluteExpiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** True while the session still owes a TOTP code (v2 Phase 1). */
export function isTotpPending(s: Pick<AdminSession, 'totpPendingUntil'>, now: Date): boolean {
  return s.totpPendingUntil !== null && s.totpPendingUntil.getTime() > now.getTime();
}

/** A pending marker that outlived its 5-minute window is a dead session, not a live one. */
export function isTotpExpired(s: Pick<AdminSession, 'totpPendingUntil'>, now: Date): boolean {
  return s.totpPendingUntil !== null && s.totpPendingUntil.getTime() <= now.getTime();
}

/** True when lastSeenAt is stale enough that a touch write is warranted. */
export function shouldTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() > TOUCH_THROTTLE_MS;
}

export interface CreatedSession {
  token: string;
  session: AdminSession;
}

export async function createSession(
  db: PrismaClient,
  userId: string,
  ip: string,
  userAgent: string,
  now = new Date(),
): Promise<CreatedSession> {
  const env = loadEnv();
  const token = generateSessionToken();
  const { idleExpiresAt, absoluteExpiresAt } = computeExpiry(
    now,
    env.SESSION_IDLE_HOURS,
    env.SESSION_ABSOLUTE_DAYS,
  );
  const session = await db.adminSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      ip,
      userAgent: userAgent.slice(0, 512),
      idleExpiresAt,
      absoluteExpiresAt,
    },
  });
  return { token, session };
}

export type ValidatedSession = { session: AdminSession; user: AdminUser } | null;

/**
 * Resolves a cookie token to a live session + enabled user, sliding the idle expiry (throttled).
 * Returns null for unknown, revoked, expired, or disabled-user sessions.
 */
export async function validateSessionToken(
  db: PrismaClient,
  token: string,
  now = new Date(),
  opts: { allowPending?: boolean } = {},
): Promise<ValidatedSession> {
  if (!token) return null;
  const env = loadEnv();
  const found = await db.adminSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!found) return null;
  if (!isSessionLive(found, now)) return null;
  if (found.user.disabled) return null;
  if (isTotpExpired(found, now)) return null;
  if (isTotpPending(found, now) && !opts.allowPending) return null;
  let session: AdminSession = found;
  if (shouldTouch(found.lastSeenAt, now)) {
    session = await db.adminSession.update({
      where: { id: found.id },
      data: {
        lastSeenAt: now,
        // Idle expiry slides but never past the absolute ceiling.
        idleExpiresAt: new Date(
          Math.min(
            now.getTime() + env.SESSION_IDLE_HOURS * 3600_000,
            found.absoluteExpiresAt.getTime(),
          ),
        ),
      },
    });
  }
  const { user, ...rest } = found;
  void rest;
  return { session, user };
}

export async function revokeSession(db: PrismaClient, sessionId: string): Promise<void> {
  await db.adminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes all of a user's sessions, optionally sparing one (e.g. the current one). */
export async function revokeAllSessions(
  db: PrismaClient,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const res = await db.adminSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}

/** Attributes for the session cookie (set) or its deletion (value '', maxAge 0). */
export function sessionCookie(token: string | null, secure: boolean): CookieAttributes {
  const env = loadEnv();
  return {
    name: sessionCookieName(secure),
    value: token ?? '',
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: token ? env.SESSION_ABSOLUTE_DAYS * 86_400 : 0,
  };
}
