import { NextResponse } from 'next/server';
import { requireSessionApi } from './auth';
import type { ValidatedSession } from './session';

/**
 * Guard for data endpoints: 401 without a live session, 403 while a forced password change is
 * pending (design §3.7 — no monitoring data before the seeded password is rotated).
 */
export async function requireActiveApi(): Promise<
  { ok: true; auth: NonNullable<ValidatedSession> } | { ok: false; res: NextResponse }
> {
  const auth = await requireSessionApi();
  if (!auth) return { ok: false, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (auth.user.mustChangePassword) {
    return { ok: false, res: NextResponse.json({ error: 'password change required' }, { status: 403 }) };
  }
  return { ok: true, auth };
}
