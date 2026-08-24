import { NextResponse } from 'next/server';
import { requireActiveApi } from '@/lib/api-guard';
import {
  kubeAvailable,
  kubeGet,
  mapCertificates,
  mapDeployments,
  mapHpas,
  mapJobs,
  mapPods,
  mapWarningEvents,
  type CertificateView,
  type DeploymentView,
  type EventView,
  type HpaView,
  type JobView,
  type PodView,
} from '@/lib/kube';

export const dynamic = 'force-dynamic';

export interface KubernetesPayload {
  available: boolean;
  error?: string;
  deployments: DeploymentView[];
  pods: PodView[];
  hpas: HpaView[];
  jobs: JobView[];
  events: EventView[];
  certificates: CertificateView[];
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveApi();
  if (!guard.ok) return guard.res;
  const payload: KubernetesPayload = {
    available: kubeAvailable(),
    deployments: [],
    pods: [],
    hpas: [],
    jobs: [],
    events: [],
    certificates: [],
  };
  if (!payload.available) return NextResponse.json(payload);
  try {
    const [deps, pods, podMetrics, hpas, jobs, events, certs] = await Promise.all([
      kubeGet<Parameters<typeof mapDeployments>[0]>('/apis/apps/v1/deployments'),
      kubeGet<Parameters<typeof mapPods>[0]>('/api/v1/pods'),
      kubeGet<NonNullable<Parameters<typeof mapPods>[1]>>('/apis/metrics.k8s.io/v1beta1/pods').catch(() => null),
      kubeGet<Parameters<typeof mapHpas>[0]>('/apis/autoscaling/v2/horizontalpodautoscalers'),
      kubeGet<Parameters<typeof mapJobs>[0]>('/apis/batch/v1/jobs'),
      kubeGet<Parameters<typeof mapWarningEvents>[0]>('/api/v1/events?limit=200'),
      // cert-manager may not be installed (kind smoke test) — 404 tolerated.
      kubeGet<Parameters<typeof mapCertificates>[0]>('/apis/cert-manager.io/v1/certificates').catch(() => ({ items: [] })),
    ]);
    payload.deployments = mapDeployments(deps);
    payload.pods = mapPods(pods, podMetrics).filter((p) => !p.namespace.startsWith('kube-'));
    payload.hpas = mapHpas(hpas);
    payload.jobs = mapJobs(jobs);
    payload.events = mapWarningEvents(events);
    payload.certificates = mapCertificates(certs);
  } catch (e) {
    payload.error = e instanceof Error ? e.message : 'kubernetes unreachable';
  }
  return NextResponse.json(payload, { headers: { 'cache-control': 'no-store' } });
}
