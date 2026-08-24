import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { changeOwnPassword } from '@/lib/users';

const schema = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

export async function POST(req: Request): Promise<NextResponse> {
  return guardedMutation(req, async (auth) => {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
    await changeOwnPassword(
      prisma,
      { id: auth.user.id, ip: clientIpFrom(req.headers), currentSessionId: auth.session.id },
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return NextResponse.json({ ok: true });
  });
}
