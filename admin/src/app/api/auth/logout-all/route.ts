import { NextResponse } from 'next/server';
import { requestMeta, requireSessionApi } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { revokeAllSessions, sessionCookie } from '@/lib/session';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const env = loadEnv();
  const s = await requireSessionApi();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const count = await revokeAllSessions(prisma, s.user.id);
  const { ip } = await requestMeta();
  await writeAudit(prisma, 'logout_all', s.user.id, { revoked: count }, ip);
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  const c = sessionCookie(null, env.COOKIE_SECURE);
  res.cookies.set(c.name, c.value, c);
  return res;
}
