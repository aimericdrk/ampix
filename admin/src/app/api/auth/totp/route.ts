import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { sessionCookieName, validateSessionToken } from '@/lib/session';
import { verifyTotpLogin } from '@/lib/totp-account';
import { cookies } from 'next/headers';

const schema = z.object({ code: z.string().min(6).max(20) });

/** Second login factor: only endpoint that accepts a TOTP-pending session (v2 design Phase 1). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const env = loadEnv();
  const token = (await cookies()).get(sessionCookieName(env.COOKIE_SECURE))?.value ?? '';
  const auth = await validateSessionToken(prisma, token, new Date(), { allowPending: true });
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!auth.session.totpPendingUntil) return NextResponse.json({ ok: true, already: true });
  const result = await verifyTotpLogin(
    prisma,
    auth.session,
    auth.user,
    parsed.data.code,
    clientIpFrom(req.headers),
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.revoked ? 'too many attempts — sign in again' : 'invalid code' },
      { status: result.revoked ? 401 : 400 },
    );
  }
  return NextResponse.json({ ok: true, via: result.via, mustChangePassword: auth.user.mustChangePassword });
}
