import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { clientIpFrom } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { sampleTick } from '@/lib/sampler';

/** Manual sampler tick — useful operationally and for the smoke test (v2 design Phase 3). */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const res = await sampleTick();
  await writeAudit(prisma, 'ops.sample', guard.auth.user.id, res, clientIpFrom(req.headers));
  return NextResponse.json(res);
}
