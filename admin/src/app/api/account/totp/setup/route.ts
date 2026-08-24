import { NextResponse } from 'next/server';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setupTotp } from '@/lib/totp-account';

export async function POST(req: Request): Promise<NextResponse> {
  return guardedMutation(req, async (auth) => {
    const res = await setupTotp(prisma, auth.user, clientIpFrom(req.headers));
    return NextResponse.json(res);
  });
}
