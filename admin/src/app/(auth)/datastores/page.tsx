'use client';

import type { DatastoresPayload } from '@/app/api/admin/datastores/route';
import { Card, Dot, ErrorBanner, fmtBytes, Table, usePoll } from '@/components/ui';

function PgCard({ title, r }: { title: string; r: DatastoresPayload['adminPostgres'] }) {
  if (!r) return null;
  return (
    <Card title={title}>
      <div className="flex items-center gap-2 text-sm">
        <Dot ok={r.ok} />
        <span>{r.ok ? 'up' : (r.error ?? 'down')}</span>
      </div>
      {r.ok ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-xs text-zinc-500">Size</dt><dd>{fmtBytes(r.databaseSizeBytes)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Connections</dt><dd>{r.connections}</dd></div>
          <div><dt className="text-xs text-zinc-500">Version</dt><dd className="truncate">{r.version}</dd></div>
        </dl>
      ) : null}
    </Card>
  );
}

export default function DatastoresPage() {
  const { data, error } = usePoll<DatastoresPayload>('/api/admin/datastores', 15_000);
  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Datastores</h1>
        <span className="text-xs text-zinc-500">auto-refresh 15s</span>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <PgCard title="Postgres · admin_console" r={data?.adminPostgres ?? null} />
        <PgCard title="Postgres · analytics (myampix)" r={data?.analyticsPostgres ?? null} />
        <PgCard title="Postgres · mobile_purchase" r={data?.purchasePostgres ?? null} />
        {data?.redis ? (
          <Card title="Redis">
            <div className="flex items-center gap-2 text-sm">
              <Dot ok={data.redis.ok} />
              <span>{data.redis.ok ? `up · v${data.redis.version}` : (data.redis.error ?? 'down')}</span>
            </div>
            {data.redis.ok ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-zinc-500">Memory</dt><dd>{fmtBytes(data.redis.usedMemoryBytes)}</dd></div>
                <div><dt className="text-xs text-zinc-500">Keys</dt><dd>{data.redis.keys}</dd></div>
              </dl>
            ) : null}
          </Card>
        ) : null}
        {data?.clickhouse ? (
          <Card title="ClickHouse">
            <div className="flex items-center gap-2 text-sm">
              <Dot ok={data.clickhouse.ok} />
              <span>{data.clickhouse.ok ? `up · v${data.clickhouse.version}` : (data.clickhouse.error ?? 'down')}</span>
            </div>
            {data.clickhouse.ok ? (
              <>
                <p className="mt-2 text-sm text-zinc-400">
                  Disk {fmtBytes(data.clickhouse.diskUsedBytes)} / {fmtBytes(data.clickhouse.diskTotalBytes)}
                </p>
                <div className="mt-2">
                  <Table
                    head={['Table', 'Size', 'Rows']}
                    rows={(data.clickhouse.topTables ?? []).map((t) => [
                      <span key="t" className="font-medium">{t.table}</span>,
                      fmtBytes(t.bytes),
                      t.rows.toLocaleString(),
                    ])}
                  />
                </div>
              </>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
