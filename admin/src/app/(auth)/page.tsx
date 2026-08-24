'use client';

import type { StatusPayload } from '@/app/api/admin/status/route';
import { Card, Dot, ErrorBanner, fmtAgo, fmtBytes, fmtCores, Meter, usePoll } from '@/components/ui';

export default function OverviewPage() {
  const { data, error } = usePoll<StatusPayload>('/api/admin/status');
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Overview</h1>
        <span className="text-xs text-zinc-500">auto-refresh 10s{data ? ` · ${data.kube.version ?? ''}` : ''}</span>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.nodes ?? []).map((n) => (
          <Card key={n.name} title={`Node · ${n.name}`}>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <Dot ok={n.ready} />
              <span>{n.ready ? 'Ready' : 'NotReady'}</span>
              <span className="text-zinc-500">· {n.osImage} · {n.kubeletVersion}</span>
              <span className="ml-auto text-zinc-500">up {fmtAgo(n.bootedAt)}</span>
            </div>
            <div className="space-y-3">
              <Meter used={n.cpuUsedCores} total={n.cpuCapacityCores} label={`CPU ${fmtCores(n.cpuUsedCores)} / ${fmtCores(n.cpuCapacityCores)}`} />
              <Meter used={n.memUsedBytes} total={n.memCapacityBytes} label={`Memory ${fmtBytes(n.memUsedBytes)} / ${fmtBytes(n.memCapacityBytes)}`} />
              <Meter used={n.fsUsedBytes} total={n.fsCapacityBytes} label={`Disk ${fmtBytes(n.fsUsedBytes)} / ${fmtBytes(n.fsCapacityBytes)}`} />
            </div>
          </Card>
        ))}
        {data && data.nodes.length === 0 ? (
          <Card title="Nodes">
            <p className="text-sm text-zinc-500">
              {data.kube.available ? (data.kube.error ?? 'No nodes visible.') : 'Not running inside a Kubernetes cluster.'}
            </p>
          </Card>
        ) : null}
        <Card title="Services">
          <div className="space-y-3">
            {(data?.services ?? []).map((s) => (
              <div key={s.name} className="flex items-center gap-3 text-sm">
                <Dot ok={s.ok} />
                <span className="font-medium">{s.name}</span>
                <span className="text-zinc-500">{s.ok ? 'ready' : (s.error ?? `HTTP ${s.status}`)}</span>
                <span className="ml-auto flex gap-2 text-xs text-zinc-400">
                  {Object.entries(s.checks ?? {}).map(([k, v]) => (
                    <span key={k} className="flex items-center gap-1">
                      <Dot ok={v} /> {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {data && data.services.length === 0 ? (
              <p className="text-sm text-zinc-500">No service probes configured.</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
