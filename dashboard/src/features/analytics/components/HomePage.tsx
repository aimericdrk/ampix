import { Link, useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useEventSummary } from '../../projects/api';
import { useDashboards, useReports, useSessionsSummary } from '../api';
import { defaultDate } from './builder-controls';
import { StatTile } from './charts/StatTile';
import { CompositionPieChart, type PieSlice } from './charts/CompositionPieChart';
import { MermaidDiagram } from './charts/MermaidDiagram';
import { formatDurationMs } from '../format';
import { colorForIndex } from '../palette';

const WORKFLOW_DIAGRAM = `flowchart LR
  A[Collect events] --> B[Explore &amp; analyze]
  B --> C[Save reports]
  C --> D[Build dashboards]
  D --> E[Share &amp; decide]`;

/** The friendly project overview — the calm landing spot: headline metrics, quick actions, and the
 * things you most recently made. Everything is derived from endpoints that already exist. */
export function HomePage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/home' });
  const summary = useEventSummary(projectId);
  const sessions = useSessionsSummary(projectId, defaultDate(30), defaultDate(0));
  const reports = useReports(projectId);
  const dashboards = useDashboards(projectId);

  const totalEvents = summary.data?.total ?? 0;
  const byEvent = summary.data?.by_event ?? [];
  const sessionsByDay = sessions.data?.by_day ?? [];

  const eventSlices: PieSlice[] = byEvent
    .slice(0, 8)
    .map((row) => ({ key: row.event, label: row.event, value: row.count }));
  const sliceColor = new Map(eventSlices.map((s, i) => [s.key, colorForIndex(i)]));

  return (
    <PageShell
      projectId={projectId}
      title="Home"
      description="A quick pulse on your project — key numbers, recent work, and where to go next."
    >
      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total events" value={totalEvents} hint="All time" />
        <StatTile label="Active event types" value={byEvent.length} hint="Distinct event names" />
        <StatTile
          label="Sessions (30d)"
          value={sessions.data?.sessions ?? 0}
          spark={sessionsByDay.map((d) => d.sessions)}
        />
        <StatTile
          label="Avg. session"
          value={formatDurationMs(sessions.data?.avg_duration_ms ?? 0)}
          spark={sessionsByDay.map((d) => d.avg_duration_ms)}
        />
      </div>

      {/* Quick create */}
      <Card>
        <CardHeader>
          <CardTitle>Quick create</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link to="/projects/$projectId/insights" params={{ projectId }}>
            <Button>New report</Button>
          </Link>
          <Link to="/projects/$projectId/cohorts" params={{ projectId }}>
            <Button variant="secondary">New cohort</Button>
          </Link>
          <Link to="/projects/$projectId/dashboards" params={{ projectId }}>
            <Button variant="secondary">New dashboard</Button>
          </Link>
          <Link to="/projects/$projectId/templates" params={{ projectId }}>
            <Button variant="secondary">Apply a template</Button>
          </Link>
        </CardContent>
      </Card>

      {totalEvents === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No events yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-muted">
            Send your first events using this project&apos;s ingest token, then your metrics will
            appear here.{' '}
            <Link to="/projects/$projectId" params={{ projectId }} className="text-accent underline">
              View ingest token
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Events by type</CardTitle>
            </CardHeader>
            <CardContent>
              <CompositionPieChart
                slices={eventSlices}
                colorFor={(key) => sliceColor.get(key) ?? 'var(--series-1)'}
                ariaLabel="Events by type composition"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How MyAmpMix works</CardTitle>
            </CardHeader>
            <CardContent>
              <MermaidDiagram chart={WORKFLOW_DIAGRAM} ariaLabel="Analytics workflow diagram" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recent work */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentList
          title="Recent reports"
          emptyText="No saved reports yet — build one in Insights."
          items={(reports.data?.reports ?? []).slice(0, 5).map((r) => ({
            id: r.id,
            name: r.name,
            to: '/projects/$projectId/reports/$reportId',
            params: { projectId, reportId: r.id },
          }))}
          seeAllTo="/projects/$projectId/reports"
          projectId={projectId}
        />
        <RecentList
          title="Recent dashboards"
          emptyText="No dashboards yet — create one to pin your charts."
          items={(dashboards.data?.dashboards ?? []).slice(0, 5).map((d) => ({
            id: d.id,
            name: d.name,
            to: '/projects/$projectId/dashboards/$dashboardId',
            params: { projectId, dashboardId: d.id },
          }))}
          seeAllTo="/projects/$projectId/dashboards"
          projectId={projectId}
        />
      </div>
    </PageShell>
  );
}

interface RecentItem {
  id: string;
  name: string;
  to: string;
  params: Record<string, string>;
}

function RecentList({
  title,
  emptyText,
  items,
  seeAllTo,
  projectId,
}: {
  title: string;
  emptyText: string;
  items: RecentItem[];
  seeAllTo: string;
  projectId: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link to={seeAllTo} params={{ projectId }} className="text-xs text-accent underline">
          See all
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{emptyText}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                <Link
                  to={item.to}
                  params={item.params}
                  className="text-sm text-text hover:text-accent hover:underline"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
