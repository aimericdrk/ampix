import { NextResponse } from 'next/server';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resetPassword } from '@/lib/users';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  return guardedMutation(req, async (auth) => {
    const res = await resetPassword(prisma, { id: auth.user.id, ip: clientIpFrom(req.headers) }, id);
    return NextResponse.json(res);
  });
}
