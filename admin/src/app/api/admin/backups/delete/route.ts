import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActiveApi } from '@/lib/api-guard';
import { clientIpFrom } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { BackupError, deleteBackup } from '@/lib/backups';

export const dynamic = 'force-dynamic';

const schema = z.object({ name: z.string().min(1).max(200) });

/** Permanently removes ONE backup file. Irreversible, so the UI gates it on typing the filename. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
  } catch (e) {
    if (e instanceof CrossOriginError)
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    throw e;
  }
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  try {
    await deleteBackup(parsed.data.name);
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  await writeAudit(
    prisma,
    'backup.delete',
    guard.auth.user.id,
    { name: parsed.data.name },
    clientIpFrom(req.headers),
  );
  return NextResponse.json({ ok: true });
}
