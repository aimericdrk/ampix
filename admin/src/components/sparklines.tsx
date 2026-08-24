'use client';

import { seriesFor, TimeSeriesChart, useHistory } from '@/components/timeseries';
import Link from 'next/link';

/** Overview: 24 h node charts (full axes + hover), linking to the Metrics page for everything else. */
export function NodeSparklines() {
  const { data } = useHistory('prefix=node.&hours=24', 60_000);
  const cpu = seriesFor(data, 'node.cpu.pct/');
  if (cpu.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Last 24 h</h2>
        <Link href="/metrics" className="text-xs text-zinc-400 hover:text-white hover:underline">
          All metrics →
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <TimeSeriesChart title="CPU" unit="%" yMax={100} hours={24} height={170} series={cpu} />
        <TimeSeriesChart
          title="Memory"
          unit="%"
          yMax={100}
          hours={24}
          height={170}
          series={seriesFor(data, 'node.mem.pct/')}
        />
        <TimeSeriesChart
          title="Disk"
          unit="%"
          yMax={100}
          hours={24}
          height={170}
          series={seriesFor(data, 'node.fs.pct/')}
        />
      </div>
    </section>
  );
}
