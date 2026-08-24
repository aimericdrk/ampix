import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { prisma } from '@/lib/db';
import { bucketSeries, DEFAULT_BUCKETS, type Point } from '@/lib/history';

export const dynamic = 'force-dynamic';

/**
 * Bucketed snapshot history for the charts.
 *   ?prefix=node.&hours=24            — every key under a prefix (comma-separable)
 *   ?keys=k8s.pods.running,...        — exact keys
 * Response: { series: { key: Point[] }, hours } with ~180 averaged buckets per key.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const url = new URL(req.url);
  const hours = Math.min(168, Math.max(1, Number(url.searchParams.get('hours') ?? 24)));
  const prefixes = (url.searchParams.get('prefix') ?? '').split(',').map((p) => p.trim()).filter(Boolean).slice(0, 8);
  const keys = (url.searchParams.get('keys') ?? '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 24);
  if (prefixes.length === 0 && keys.length === 0) prefixes.push('node.');
  const now = Date.now();
  const since = new Date(now - hours * 3600_000);
  const rows = await prisma.metricSnapshot.findMany({
    where: {
      at: { gt: since },
      OR: [
        ...prefixes.map((p) => ({ key: { startsWith: p } })),
        ...(keys.length > 0 ? [{ key: { in: keys } }] : []),
      ],
    },
    orderBy: { at: 'asc' },
    take: 50_000,
  });
  const byKey = new Map<string, Array<{ at: Date; value: number }>>();
  for (const r of rows) {
    const arr = byKey.get(r.key) ?? [];
    arr.push(r);
    byKey.set(r.key, arr);
  }
  const series: Record<string, Point[]> = {};
  for (const [key, arr] of byKey) series[key] = bucketSeries(arr, hours, now, DEFAULT_BUCKETS);
  return NextResponse.json({ series, hours }, { headers: { 'cache-control': 'no-store' } });
}
