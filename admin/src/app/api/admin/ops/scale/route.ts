import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActiveApi } from '@/lib/api-guard';
import { clientIpFrom } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { OpsError, scaleDeployment } from '@/lib/ops';

const schema = z.object({ deployment: z.string().min(1).max(120), replicas: z.number() });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  try {
    await scaleDeployment(parsed.data.deployment, parsed.data.replicas);
  } catch (e) {
    if (e instanceof OpsError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  await writeAudit(
    prisma,
    'ops.scale',
    guard.auth.user.id,
    { deployment: parsed.data.deployment, replicas: parsed.data.replicas },
    clientIpFrom(req.headers),
  );
  return NextResponse.json({ ok: true });
}
