'use client';

import type { KubernetesPayload } from '@/app/api/admin/kubernetes/route';
import { Card, Dot, ErrorBanner, fmtAgo, fmtBytes, fmtCores, Table, usePoll } from '@/components/ui';

export default function KubernetesPage() {
  const { data, error } = usePoll<KubernetesPayload>('/api/admin/kubernetes');
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Kubernetes</h1>
        <span className="text-xs text-zinc-500">auto-refresh 10s</span>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      {data && !data.available ? <ErrorBanner text="Not running inside a Kubernetes cluster." /> : null}
      {data?.error ? <ErrorBanner text={data.error} /> : null}
      <Card title="Deployments">
        <Table
          head={['', 'Namespace', 'Name', 'Ready', 'Image']}
          rows={(data?.deployments ?? []).map((d) => [
            <Dot key="s" ok={d.ready >= d.desired && d.desired > 0} />,
            d.namespace,
            <span key="n" className="font-medium">{d.name}</span>,
            `${d.ready}/${d.desired}`,
            <span key="i" className="text-zinc-400">{d.image ?? '—'}</span>,
          ])}
        />
      </Card>
      <Card title="Autoscalers">
        <Table
          head={['Name', 'Target', 'CPU now / target', 'Replicas', 'Range']}
          rows={(data?.hpas ?? []).map((h) => [
            <span key="n" className="font-medium">{h.name}</span>,
            h.target,
            `${h.cpuCurrentPercent ?? '—'}% / ${h.cpuTargetPercent ?? '—'}%`,
            `${h.currentReplicas} → ${h.desiredReplicas}`,
            `${h.minReplicas}–${h.maxReplicas}`,
          ])}
        />
      </Card>
      <Card title="Pods (app namespaces)">
        <Table
          head={['', 'Namespace', 'Name', 'Ready', 'Restarts', 'Age', 'CPU', 'Memory']}
          rows={(data?.pods ?? []).map((p) => [
            <Dot key="s" ok={p.phase === 'Running' || p.phase === 'Succeeded'} />,
            p.namespace,
            <span key="n" className="font-medium">{p.name}</span>,
            p.ready,
            p.restarts,
            fmtAgo(p.startedAt),
            fmtCores(p.cpuUsedCores),
            fmtBytes(p.memUsedBytes),
          ])}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Jobs">
          <Table
            head={['', 'Name', 'Started', 'Completed']}
            rows={(data?.jobs ?? []).map((j) => [
              <Dot key="s" ok={j.succeeded ? true : j.failed ? false : null} />,
              <span key="n" className="font-medium">{j.name}</span>,
              fmtAgo(j.startedAt),
              j.completedAt ? fmtAgo(j.completedAt) : '—',
            ])}
          />
        </Card>
        <Card title="Certificates">
          <Table
            head={['', 'Name', 'DNS', 'Expires']}
            rows={(data?.certificates ?? []).map((c) => [
              <Dot key="s" ok={c.ready} />,
              <span key="n" className="font-medium">{c.name}</span>,
              c.dnsNames.join(', '),
              c.notAfter ? new Date(c.notAfter).toLocaleDateString() : '—',
            ])}
          />
        </Card>
      </div>
      <Card title="Warning events">
        <Table
          head={['When', 'Object', 'Reason', 'Message', '×']}
          rows={(data?.events ?? []).map((e) => [
            fmtAgo(e.at),
            e.object,
            e.reason,
            <span key="m" className="text-zinc-400">{e.message}</span>,
            e.count,
          ])}
        />
      </Card>
    </div>
  );
}
