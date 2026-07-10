import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Input } from '../../../components/ui/input';
import { Reveal } from '../../../components/ui/reveal';
import { SectionGrid } from '../../../components/ui/SectionGrid';
import type { SessionsByDay } from '../../../lib/api/types';
import { ApiError } from '../../../lib/api/problem';
import { formatDurationMs, formatExactNumber } from '../format';
import { useSessionsSummary } from '../api';
import { mergeGlobalFilters, useGlobalFilters } from '../global-filters';
import { PageShell } from '../../../components/layout/PageShell';
import { ChartCard } from './charts/ChartCard';
import { KpiTile } from './charts/KpiTile';

const BY_DAY_COLUMNS: Array<DataTableColumn<SessionsByDay>> = [
  { key: 't', header: 'Day', sortable: true },
  {
    key: 'sessions',
    header: 'Sessions',
    align: 'right',
    sortable: true,
    render: (row) => formatExactNumber(row.sessions),
  },
  {
    key: 'avg_duration_ms',
    header: 'Avg duration',
    align: 'right',
    sortable: true,
    render: (row) => formatDurationMs(row.avg_duration_ms),
  },
];

function defaultDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
};

export function SessionsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/sessions' });
  const [from, setFrom] = useState(() => defaultDate(30));
  const [to, setTo] = useState(() => defaultDate(0));
  // Global Filters Bar (feat-02 §3.4/T2): the sessions KPIs now honor the app-wide global filter.
  const { filters: globalFilters } = useGlobalFilters();
  const { data, isPending, isError, error } = useSessionsSummary(
    projectId,
    from,
    to,
    mergeGlobalFilters([], globalFilters),
  );

  return (
    <PageShell
      projectId={projectId}
      title="Sessions"
      description="Session volume and average duration over the selected range."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Sessions' }]}
    >
      <Reveal index={0}>
        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor="sessions-from" className="mb-1 block text-sm font-medium">
              From
            </label>
            <Input
              id="sessions-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="sessions-to" className="mb-1 block text-sm font-medium">
              To
            </label>
            <Input id="sessions-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Reveal>

      {isPending && (
        <Reveal index={1}>
          <p role="status">Loading session summary…</p>
        </Reveal>
      )}
      {isError && (
        <Reveal index={1}>
          <p role="alert" className="text-danger">
            {error instanceof ApiError ? error.problem.title : 'Failed to load session summary'}
          </p>
        </Reveal>
      )}

      {data && (
        <Reveal index={1} className="flex flex-col gap-6">
          <SectionGrid min={200}>
            <KpiTile label="Total sessions" value={data.sessions} />
            <KpiTile label="Avg duration" value={formatDurationMs(data.avg_duration_ms)} />
          </SectionGrid>

          {data.by_day.length > 0 && (
            <ChartCard title="Sessions by day">
              <div className="flex flex-col gap-6">
                {/* Sessions/day only — avg duration is a different unit and is never combined
                    onto this axis (no dual-axis charts). A single series needs no legend. */}
                <div
                  aria-label="Sessions by day chart"
                  role="img"
                  style={{ width: '100%', height: 260, backgroundColor: 'var(--chart-surface)' }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.by_day} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
                      <XAxis
                        dataKey="t"
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        stroke="var(--border)"
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        stroke="var(--border)"
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelStyle={{ color: 'var(--text-muted)' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="sessions"
                        name="Sessions"
                        stroke="var(--series-1)"
                        strokeWidth={2}
                        dot={{
                          r: 4,
                          fill: 'var(--series-1)',
                          stroke: 'var(--chart-surface)',
                          strokeWidth: 2,
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <DataTable
                  columns={BY_DAY_COLUMNS}
                  rows={data.by_day}
                  caption="Sessions by day"
                  rowKey={(row) => row.t}
                />
              </div>
            </ChartCard>
          )}
        </Reveal>
      )}
    </PageShell>
  );
}
