'use client';

import { useState } from 'react';
import { ErrorBanner } from '@/components/ui';
import { seriesFor, singleSeries, TimeSeriesChart, useHistory } from '@/components/timeseries';

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
] as const;

const QUERY_PREFIXES = [
  'node.',
  'deploy.replicas/',
  'hpa.replicas/',
  'k8s.',
  'svc.latency.ms/',
  'ds.pg.',
  'ds.ch.',
  'ds.redis.',
  'docker.',
].join(',');

export default function MetricsPage() {
  const [hours, setHours] = useState<number>(24);
  const { data, error } = useHistory(
    `prefix=${encodeURIComponent(QUERY_PREFIXES)}&hours=${hours}`,
    60_000,
  );

  const section = (label: string): React.ReactElement => (
    <h2 className="col-span-full mt-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
      {label}
    </h2>
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Metrics</h1>
        {/* one filter row, above the charts — it scopes every chart on the page */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setHours(r.hours)}
              className={`rounded-md px-3 py-1 text-sm ${hours === r.hours ? 'bg-zinc-100 font-medium text-zinc-950' : 'text-zinc-400 hover:text-white'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>
      {error ? <ErrorBanner text={`Failed to load: ${error}`} /> : null}
      <div className={`grid gap-4 lg:grid-cols-2 ${data ? '' : 'opacity-60'}`}>
        {section('Node')}
        <TimeSeriesChart
          title="CPU usage"
          unit="%"
          yMax={100}
          hours={hours}
          series={seriesFor(data, 'node.cpu.pct/')}
        />
        <TimeSeriesChart
          title="Memory usage"
          unit="%"
          yMax={100}
          hours={hours}
          series={seriesFor(data, 'node.mem.pct/')}
        />
        <TimeSeriesChart
          title="Disk usage"
          unit="%"
          yMax={100}
          hours={hours}
          series={seriesFor(data, 'node.fs.pct/')}
        />
        <TimeSeriesChart
          title="CPU cores in use"
          unit="cores"
          hours={hours}
          series={seriesFor(data, 'node.cpu.cores/')}
        />
        <TimeSeriesChart
          title="Memory in use"
          unit="B"
          hours={hours}
          series={seriesFor(data, 'node.mem.bytes/')}
        />
        <TimeSeriesChart
          title="Disk in use"
          unit="B"
          hours={hours}
          series={seriesFor(data, 'node.fs.bytes/')}
        />

        {section('Kubernetes')}
        <TimeSeriesChart
          title="Pod instances"
          unit=""
          hours={hours}
          series={[
            ...singleSeries(data, 'k8s.pods.running', 'running'),
            ...singleSeries(data, 'k8s.pods.total', 'total'),
          ]}
        />
        <TimeSeriesChart
          title="Container restarts (total)"
          unit=""
          hours={hours}
          series={singleSeries(data, 'k8s.restarts.total', 'restarts')}
        />
        <TimeSeriesChart
          title="Ready replicas per deployment"
          unit=""
          hours={hours}
          series={seriesFor(data, 'deploy.replicas/')}
        />
        <TimeSeriesChart
          title="HPA replicas"
          unit=""
          hours={hours}
          series={seriesFor(data, 'hpa.replicas/')}
        />

        {section('Services')}
        <TimeSeriesChart
          title="Health-check latency"
          unit="ms"
          hours={hours}
          series={seriesFor(data, 'svc.latency.ms/')}
        />
        <TimeSeriesChart
          title="Docker containers running (host)"
          unit=""
          hours={hours}
          series={singleSeries(data, 'docker.containers.running', 'containers')}
        />

        {section('Datastores')}
        <TimeSeriesChart
          title="Postgres database size"
          unit="B"
          hours={hours}
          series={seriesFor(data, 'ds.pg.size.bytes/')}
        />
        <TimeSeriesChart
          title="Postgres connections"
          unit=""
          hours={hours}
          series={seriesFor(data, 'ds.pg.conn/')}
        />
        <TimeSeriesChart
          title="Redis memory"
          unit="B"
          hours={hours}
          series={singleSeries(data, 'ds.redis.mem.bytes', 'used memory')}
        />
        <TimeSeriesChart
          title="Redis keys"
          unit=""
          hours={hours}
          series={singleSeries(data, 'ds.redis.keys', 'keys')}
        />
        <TimeSeriesChart
          title="ClickHouse disk used"
          unit="B"
          hours={hours}
          series={singleSeries(data, 'ds.ch.disk.bytes', 'disk used')}
        />
      </div>
      <p className="text-xs text-zinc-600">
        Sampled every SAMPLE_INTERVAL_MINUTES (default 5 min), kept 7 days. Values are bucket
        averages.
      </p>
    </div>
  );
}
