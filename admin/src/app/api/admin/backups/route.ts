import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { backupReport } from '@/lib/backups';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  return NextResponse.json(await backupReport(), { headers: { 'cache-control': 'no-store' } });
}
