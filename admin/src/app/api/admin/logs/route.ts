import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { clampTail, fetchDockerLogs, fetchK8sLogs, LogAccessError } from '@/lib/logs';
import { KubeError } from '@/lib/kube';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/logs?type=k8s&pod=…&container=…&tail=500&since=3600&previous=1
 * GET /api/admin/logs?type=docker&id=…&tail=500&since=3600
 * Read-only; sources are validated against live listings inside the lib.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const q = new URL(req.url).searchParams;
  const tail = clampTail(q.get('tail'));
  const since = Number(q.get('since'));
  const sinceSeconds = Number.isFinite(since) && since > 0 ? Math.min(since, 7 * 86_400) : undefined;
  try {
    if (q.get('type') === 'docker') {
      const id = q.get('id') ?? '';
      const lines = await fetchDockerLogs({ id, tail, sinceSeconds });
      return NextResponse.json({ lines }, { headers: { 'cache-control': 'no-store' } });
    }
    const pod = q.get('pod') ?? '';
    const lines = await fetchK8sLogs({
      pod,
      container: q.get('container') ?? undefined,
      tail,
      sinceSeconds,
      previous: q.get('previous') === '1',
    });
    return NextResponse.json({ lines }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof LogAccessError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof KubeError) {
      // `previous=true` on a never-restarted container is a 400 from the API server — surface it readably.
      return NextResponse.json({ error: e.message }, { status: e.status >= 400 ? e.status : 502 });
    }
    throw e;
  }
}
