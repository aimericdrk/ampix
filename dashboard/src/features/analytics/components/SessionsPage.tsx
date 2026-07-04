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
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api/problem';
import { formatDurationMs, formatExactNumber } from '../format';
import { useSessionsSummary } from '../api';
import { ProjectAnalyticsNav } from './ProjectAnalyticsNav';

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
  const { data, isPending, isError, error } = useSessionsSummary(projectId, from, to);

  return (
    <section className="flex flex-col gap-6">
      <ProjectAnalyticsNav projectId={projectId} />
      <h1 className="text-2xl font-semibold">Sessions</h1>

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

      {isPending && <p role="status">Loading session summary…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load session summary'}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">
                  Total sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{formatExactNumber(data.sessions)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">Avg duration</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{formatDurationMs(data.avg_duration_ms)}</p>
              </CardContent>
            </Card>
          </div>

          {data.by_day.length > 0 && (
            <>
              {/* Sessions/day only — avg duration is a different unit and is never combined onto
                  this axis (no dual-axis charts). A single series needs no legend. */}
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

              <table className="w-full max-w-lg border-collapse text-left text-sm">
                <caption className="sr-only">Sessions by day</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 font-medium">
                      Day
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Sessions
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Avg duration
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_day.map((day) => (
                    <tr key={day.t} className="border-b border-border">
                      <td className="py-2">{day.t}</td>
                      <td className="py-2">{formatExactNumber(day.sessions)}</td>
                      <td className="py-2">{formatDurationMs(day.avg_duration_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
}
