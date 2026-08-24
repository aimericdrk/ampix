import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { dockerReport } from '@/lib/docker';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  return NextResponse.json(await dockerReport(), { headers: { 'cache-control': 'no-store' } });
}
