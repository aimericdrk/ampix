import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createUser } from '@/lib/users';

const createSchema = z.object({
  email: z.string().min(3).max(320),
  displayName: z.string().min(1).max(120),
  password: z.string().max(256).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  return guardedMutation(req, async (auth) => {
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
    const res = await createUser(
      prisma,
      { id: auth.user.id, ip: clientIpFrom(req.headers) },
      parsed.data,
    );
    return NextResponse.json(res, { status: 201 });
  });
}
