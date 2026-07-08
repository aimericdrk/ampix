import { Link, useParams } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { AnalysisResult, DashboardSummary } from '../../../lib/api/types';
import { isTileError } from '../../../lib/api/types';
import { useCreateDashboard, useDashboard, useDashboardData, useDashboards } from '../api';
import { PageShell } from '../../../components/layout/PageShell';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import { analysisResultIsEmpty } from './ReportChart';
import { ChartThumbnail, type ChartThumbnailState } from './ChartThumbnail';

export function DashboardsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/dashboards' });
  const dashboards = useDashboards(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const favorites = useFavorites(projectId);

  return (
    <PageShell
      projectId={projectId}
      title="Dashboards"
      description="Pin charts together into shareable boards."
      breadcrumbs={[{ label: 'Saved' }, { label: 'Dashboards' }]}
      actions={
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>New dashboard</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>Creates an empty board you can add report tiles to.</DialogDescription>
            <NewDashboardForm projectId={projectId} onCreated={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      }
    >
      {dashboards.isPending && <p role="status">Loading dashboards…</p>}
      {dashboards.error && (
        <p role="alert" className="text-danger">
          {dashboards.error instanceof ApiError
            ? dashboards.error.problem.title
            : 'Failed to load dashboards'}
        </p>
      )}

      {dashboards.data && dashboards.data.dashboards.length === 0 && (
        <p className="text-text-muted">No dashboards yet.</p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {dashboards.data?.dashboards.map((dashboard) => (
          // The star sits as a sibling overlay, not nested inside the card-wide `Link` (an <a>
          // can't validly contain a <button>) — `relative`/`absolute` positions it top-right
          // without shrinking the Link's clickable area.
          <div key={dashboard.id} className="relative">
            <Link
              to="/projects/$projectId/dashboards/$dashboardId"
              params={{ projectId, dashboardId: dashboard.id }}
              className="block rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Card className="h-full transition-colors hover:border-accent">
                <CardHeader>
                  <CardTitle className="pr-8">{dashboard.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <DashboardCardThumbnail projectId={projectId} dashboard={dashboard} />
                  <p className="text-sm text-text-muted">
                    {dashboard.tile_count} {dashboard.tile_count === 1 ? 'tile' : 'tiles'}
                  </p>
                </CardContent>
              </Card>
            </Link>
            <FavoriteButton
              name={dashboard.name}
              isFavorite={favorites.isFavorite('dashboard', dashboard.id)}
              onToggle={() =>
                favorites.toggle({ type: 'dashboard', id: dashboard.id, name: dashboard.name })
              }
              className="absolute right-2 top-2"
            />
          </div>
        ))}
      </div>
    </PageShell>
  );
}

/**
 * The decorative preview atop a dashboard card. A zero-tile board short-circuits to an "Empty board"
 * thumbnail (no run cost); otherwise it renders the board's FIRST tile (by position) via the shared
 * `LoadedDashboardThumbnail`, which runs the board's tiles and picks that tile's result. The
 * thumbnail is aria-hidden + pointer-events-none, so the whole card stays a single clickable Link.
 */
function DashboardCardThumbnail({
  projectId,
  dashboard,
}: {
  projectId: string;
  dashboard: DashboardSummary;
}) {
  if (dashboard.tile_count === 0) {
    return <ChartThumbnail kind="insights" state="empty" emptyLabel="Empty board" />;
  }
  return <LoadedDashboardThumbnail projectId={projectId} dashboardId={dashboard.id} />;
}

function LoadedDashboardThumbnail({
  projectId,
  dashboardId,
}: {
  projectId: string;
  dashboardId: string;
}) {
  const dashboard = useDashboard(projectId, dashboardId);
  const data = useDashboardData(projectId, dashboardId);

  // The first tile in reading order — its kind comes from the structural board, its result from the
  // run-data payload matched by tile id.
  const firstTile = [...(dashboard.data?.tiles ?? [])].sort((a, b) => a.position - b.position)[0];
  const tileResult = data.data?.tiles.find((t) => t.id === firstTile?.id)?.result;

  let state: ChartThumbnailState;
  let result: AnalysisResult | undefined;
  if (dashboard.isPending || data.isPending) {
    state = 'loading';
  } else if (dashboard.isError || data.isError || !firstTile || !tileResult) {
    state = 'error';
  } else if (isTileError(tileResult)) {
    state = 'error';
  } else if (analysisResultIsEmpty(firstTile.kind, tileResult)) {
    state = 'empty';
  } else {
    state = 'ready';
    result = tileResult;
  }

  return <ChartThumbnail kind={firstTile?.kind ?? 'insights'} result={result} state={state} />;
}

function NewDashboardForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const createDashboard = useCreateDashboard(projectId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createDashboard.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Dashboard created' });
          setName('');
          onCreated();
        },
        onError: (error) =>
          toast({
            title: 'Could not create dashboard',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="new-dashboard-name" className="mb-1 block text-sm font-medium">
          Dashboard name
        </label>
        <Input id="new-dashboard-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={createDashboard.isPending || !name.trim()}>
        {createDashboard.isPending ? 'Creating…' : 'Create dashboard'}
      </Button>
    </form>
  );
}
