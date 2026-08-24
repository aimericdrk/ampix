import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import { loadEnv } from '@/lib/env';
import { kubeAvailable, kubeGet, mapNodes, type NodeView } from '@/lib/kube';
import { probeService, type ServiceHealth } from '@/lib/datastores';

export const dynamic = 'force-dynamic';

export interface StatusPayload {
  now: string;
  kube: { available: boolean; version?: string; error?: string };
  nodes: NodeView[];
  services: ServiceHealth[];
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const env = loadEnv();

  const payload: StatusPayload = {
    now: new Date().toISOString(),
    kube: { available: kubeAvailable() },
    nodes: [],
    services: [],
  };

  if (kubeAvailable()) {
    try {
      const [version, nodes, metrics] = await Promise.all([
        kubeGet<{ gitVersion: string }>('/version'),
        kubeGet<Parameters<typeof mapNodes>[0]>('/api/v1/nodes'),
        kubeGet<NonNullable<Parameters<typeof mapNodes>[1]>>('/apis/metrics.k8s.io/v1beta1/nodes').catch(() => null),
      ]);
      const summaries: Record<string, Parameters<typeof mapNodes>[2][string]> = {};
      await Promise.all(
        nodes.items.map(async (n) => {
          summaries[n.metadata.name] = await kubeGet<NonNullable<Parameters<typeof mapNodes>[2][string]>>(
            `/api/v1/nodes/${n.metadata.name}/proxy/stats/summary`,
          ).catch(() => null);
        }),
      );
      payload.kube.version = version.gitVersion;
      payload.nodes = mapNodes(nodes, metrics, summaries);
    } catch (e) {
      payload.kube.error = e instanceof Error ? e.message : 'kubernetes unreachable';
    }
  }

  payload.services = (
    await Promise.all([
      probeService('mobile-analytics', env.ANALYTICS_INTERNAL_URL),
      probeService('mobile-purchase', env.PURCHASE_INTERNAL_URL),
    ])
  ).filter((s): s is ServiceHealth => s !== null);

  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
}
