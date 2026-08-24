import { NextResponse } from 'next/server';
import { z } from 'zod';
import { attemptLogin, clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { loadEnv } from '@/lib/env';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { sessionCookie } from '@/lib/session';

const bodySchema = z.object({ email: z.string().min(3).max(320), password: z.string().min(1).max(256) });

/** JSON login (shared logic with the /login page's server action) — also the smoke test's entry. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const env = loadEnv();
  const ip = clientIpFrom(req.headers);
  const ua = req.headers.get('user-agent') ?? '';
  const result = await attemptLogin(prisma, parsed.data.email, parsed.data.password, ip, ua);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
  const res = NextResponse.json({
    ok: true,
    mustChangePassword: result.mustChangePassword,
    totpRequired: result.totpRequired,
  });
  const c = sessionCookie(result.token, env.COOKIE_SECURE);
  res.cookies.set(c.name, c.value, c);
  return res;
}
