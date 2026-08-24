'use client';

import type { DockerReport } from '@/lib/docker';
import { Card, Dot, ErrorBanner, fmtBytes, Table, usePoll } from '@/components/ui';

export default function DockerPage() {
  const { data, error } = usePoll<DockerReport>('/api/admin/docker', 15_000);
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Docker (host)</h1>
        <span className="text-xs text-zinc-500">auto-refresh 15s</span>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      {data && !data.available ? (
        <ErrorBanner text={`Docker socket unavailable: ${data.reason ?? 'not mounted'} — enable admin.dockerSock in the chart values.`} />
      ) : null}
      <Card title="Containers">
        <Table
          head={['', 'Name', 'Image', 'Status', 'CPU %', 'Memory']}
          rows={(data?.containers ?? []).map((c) => [
            <Dot key="s" ok={c.state === 'running'} />,
            <span key="n" className="font-medium">{c.name}</span>,
            <span key="i" className="text-zinc-400">{c.image}</span>,
            c.status,
            c.cpuPercent === null ? '—' : c.cpuPercent.toFixed(1),
            c.memUsedBytes === null ? '—' : `${fmtBytes(c.memUsedBytes)} / ${fmtBytes(c.memLimitBytes)}`,
          ])}
        />
      </Card>
    </div>
  );
}
