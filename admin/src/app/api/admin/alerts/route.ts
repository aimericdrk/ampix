import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const [open, resolved] = await Promise.all([
    prisma.alertEvent.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
    prisma.alertEvent.findMany({ where: { resolvedAt: { not: null } }, orderBy: { openedAt: 'desc' }, take: 50 }),
  ]);
  return NextResponse.json({ open, resolved }, { headers: { 'cache-control': 'no-store' } });
}
