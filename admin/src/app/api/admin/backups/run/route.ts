import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { clientIpFrom } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { assertSameOrigin, CrossOriginError } from '@/lib/origin';
import { BackupError, requestBackupRun } from '@/lib/backups';

export const dynamic = 'force-dynamic';

/**
 * Requests an out-of-schedule backup. This only drops the marker file the host's systemd .path unit
 * watches — the dump itself runs from the same script the nightly timer uses, so there is exactly
 * one backup implementation. Returns immediately; the page polls for the result.
 */
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
  try {
    await requestBackupRun(guard.auth.user.email);
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  await writeAudit(prisma, 'backup.run', guard.auth.user.id, {}, clientIpFrom(req.headers));
  return NextResponse.json({ ok: true });
}
