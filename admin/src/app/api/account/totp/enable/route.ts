import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enableTotp } from '@/lib/totp-account';

const schema = z.object({ code: z.string().min(6).max(10) });

export async function POST(req: Request): Promise<NextResponse> {
  return guardedMutation(req, async (auth) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
    const res = await enableTotp(prisma, auth.user, parsed.data.code, clientIpFrom(req.headers));
    return NextResponse.json(res);
  });
}
