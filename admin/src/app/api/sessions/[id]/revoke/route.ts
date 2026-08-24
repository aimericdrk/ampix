import { NextResponse } from 'next/server';
import { guardedMutation } from '@/app/api/_helpers';
import { clientIpFrom } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { revokeSession } from '@/lib/session';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  return guardedMutation(req, async (auth) => {
    // Only the owner's sessions can be revoked from /account.
    const target = await prisma.adminSession.findUnique({ where: { id } });
    if (!target || target.userId !== auth.user.id) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    await revokeSession(prisma, id);
    await writeAudit(prisma, 'session.revoke', auth.user.id, { sessionId: id }, clientIpFrom(req.headers));
    return NextResponse.json({ ok: true });
  });
}
