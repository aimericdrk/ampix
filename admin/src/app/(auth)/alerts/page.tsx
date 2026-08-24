'use client';

import { Card, Dot, ErrorBanner, fmtAgo, Table, usePoll } from '@/components/ui';

interface AlertRow {
  id: string;
  kind: string;
  key: string;
  message: string;
  lastValue: number;
  openedAt: string;
  resolvedAt: string | null;
}

export default function AlertsPage() {
  const { data, error } = usePoll<{ open: AlertRow[]; resolved: AlertRow[] }>('/api/admin/alerts', 15_000);
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Alerts</h1>
        <span className="text-xs text-zinc-500">
          rules: CPU&gt;90% · mem&gt;90% · disk&gt;85% · datastore/service down · deployment degraded · cert&lt;14d
        </span>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      <Card title={`Open (${data?.open.length ?? 0})`}>
        <Table
          head={['', 'Since', 'Kind', 'Message']}
          rows={(data?.open ?? []).map((a) => [
            <Dot key="s" ok={false} />,
            fmtAgo(a.openedAt),
            a.kind,
            <span key="m" className="font-medium">{a.message}</span>,
          ])}
        />
      </Card>
      <Card title="Recently resolved">
        <Table
          head={['', 'Opened', 'Resolved', 'Kind', 'Message']}
          rows={(data?.resolved ?? []).map((a) => [
            <Dot key="s" ok={true} />,
            fmtAgo(a.openedAt),
            a.resolvedAt ? fmtAgo(a.resolvedAt) : '—',
            a.kind,
            <span key="m" className="text-zinc-400">{a.message}</span>,
          ])}
        />
      </Card>
    </div>
  );
}
