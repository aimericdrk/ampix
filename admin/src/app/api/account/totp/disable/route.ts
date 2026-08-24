import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { disableTotp } from '@/lib/totp-account';

const schema = z.object({ currentPassword: z.string().min(1).max(256), code: z.string().min(6).max(20) });

export async function POST(req: Request): Promise<NextResponse> {
  return guardedMutation(req, async (auth) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
    await disableTotp(prisma, auth.user, parsed.data.currentPassword, parsed.data.code, clientIpFrom(req.headers));
    return NextResponse.json({ ok: true });
  });
}
