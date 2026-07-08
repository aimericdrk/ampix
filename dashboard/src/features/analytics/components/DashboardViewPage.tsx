import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
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
import type { AnalysisResult, CreateTileRequest, LayoutTile } from '../../../lib/api/types';
import {
  useCreateTile,
  useDashboard,
  useDashboardData,
  useDeleteTile,
  useReports,
  useSaveLayout,
} from '../api';
import { DashboardGrid, packLayout, type GridTile } from './DashboardGrid';
import { PageShell } from '../../../components/layout/PageShell';
import { useRecents } from '../../favorites/recents';

const DEFAULT_TILE_W = 6;
const DEFAULT_TILE_H = 2;

export function DashboardViewPage() {
  const { projectId, dashboardId } = useParams({
    from: '/private/projects/$projectId/dashboards/$dashboardId',
  });
  const { toast } = useToast();
  const dashboard = useDashboard(projectId, dashboardId);
  const data = useDashboardData(projectId, dashboardId);
  const saveLayout = useSaveLayout(projectId, dashboardId);
  const deleteTile = useDeleteTile(projectId, dashboardId);
  const recents = useRecents(projectId);
  const recordRecent = recents.record;

  const [layout, setLayout] = useState<GridTile[]>([]);
  const [dirty, setDirty] = useState(false);

  const dashboardName = dashboard.data?.name;
  // Record this visit in Recents (feat-13 §3) once the dashboard's name is known.
  useEffect(() => {
    if (!dashboardName) return;
    recordRecent({ type: 'dashboard', id: dashboardId, name: dashboardName });
  }, [dashboardId, dashboardName, recordRecent]);

  const serverTiles = dashboard.data?.tiles;
  // Re-sync the working layout from the server only when tile membership changes (initial load,
  // add, remove) — keyed on the tile-id signature so a local reorder/resize is never clobbered.
  const signature = useMemo(
    () =>
      (serverTiles ?? [])
        .map((t) => t.id)
        .sort()
        .join(','),
    [serverTiles],
  );
  useEffect(() => {
    const tiles = serverTiles ?? [];
    const ordered = [...tiles].sort((a, b) => a.position - b.position);
    setLayout(ordered.map((t) => ({ id: t.id, title: t.title, kind: t.kind, w: t.w, h: t.h })));
    setDirty(false);
    // Keyed on `signature` (the sorted tile-id set) only, so a resync happens on tile membership
    // changes (initial load / add / remove) but never clobbers an in-progress local reorder/resize.
  }, [signature]);

  const results = useMemo(() => {
    const map = new Map<string, AnalysisResult | { error: string }>();
    for (const tile of data.data?.tiles ?? []) map.set(tile.id, tile.result);
    return map;
  }, [data.data]);

  const handleReorder = (from: number, to: number) => {
    setLayout((current) => {
      if (from === to || from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      return next;
    });
    setDirty(true);
  };

  const handleResize = (id: string, size: { w?: number; h?: number }) => {
    setLayout((current) =>
      current.map((tile) =>
        tile.id === id ? { ...tile, w: size.w ?? tile.w, h: size.h ?? tile.h } : tile,
      ),
    );
    setDirty(true);
  };

  const handleRemove = (id: string) => {
    deleteTile.mutate(id, {
      onError: (error) =>
        toast({
          title: 'Could not remove tile',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  const handleSaveLayout = () => {
    const tiles: LayoutTile[] = packLayout(layout);
    saveLayout.mutate(
      { tiles },
      {
        onSuccess: () => {
          setDirty(false);
          toast({ title: 'Layout saved' });
        },
        onError: (error) =>
          toast({
            title: 'Could not save layout',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <PageShell
      projectId={projectId}
      title={dashboard.data?.name ?? 'Dashboard'}
      breadcrumbs={[
        { label: 'Dashboards', to: '/projects/$projectId/dashboards', params: { projectId } },
        { label: dashboard.data?.name ?? 'Dashboard' },
      ]}
      actions={
        <>
          <AddTileDialog projectId={projectId} dashboardId={dashboardId} layout={layout} />
          <Button onClick={handleSaveLayout} disabled={!dirty || saveLayout.isPending}>
            {saveLayout.isPending ? 'Saving…' : 'Save layout'}
          </Button>
        </>
      }
    >
      {dashboard.isPending && <p role="status">Loading dashboard…</p>}
      {dashboard.error && (
        <p role="alert" className="text-danger">
          {dashboard.error instanceof ApiError
            ? dashboard.error.problem.title
            : 'Failed to load dashboard'}
        </p>
      )}

      {dashboard.data && (
        <DashboardGrid
          tiles={layout}
          results={results}
          loading={data.isPending}
          onReorder={handleReorder}
          onResize={handleResize}
          onRemove={handleRemove}
        />
      )}
    </PageShell>
  );
}

function AddTileDialog({
  projectId,
  dashboardId,
  layout,
}: {
  projectId: string;
  dashboardId: string;
  layout: GridTile[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Add tile</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add tile from report</DialogTitle>
        <DialogDescription>Pick a saved report to render as a tile on this board.</DialogDescription>
        <AddTileForm
          projectId={projectId}
          dashboardId={dashboardId}
          layout={layout}
          onAdded={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddTileForm({
  projectId,
  dashboardId,
  layout,
  onAdded,
}: {
  projectId: string;
  dashboardId: string;
  layout: GridTile[];
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const reports = useReports(projectId);
  const createTile = useCreateTile(projectId, dashboardId);
  const [reportId, setReportId] = useState('');
  const [title, setTitle] = useState('');

  const reportList = reports.data?.reports ?? [];
  const selectedReport = reportList.find((r) => r.id === reportId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedReport) return;
    // Append the new tile below the current grid (x=0 on a fresh row keeps 12-col bounds valid).
    const positioned = packLayout(layout);
    const nextY = positioned.reduce((max, p) => Math.max(max, p.y + p.h), 0);
    const body: CreateTileRequest = {
      title: title.trim() || selectedReport.name,
      kind: selectedReport.kind,
      saved_report_id: selectedReport.id,
      x: 0,
      y: nextY,
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    };
    createTile.mutate(body, {
      onSuccess: () => {
        toast({ title: 'Tile added' });
        setReportId('');
        setTitle('');
        onAdded();
      },
      onError: (error) =>
        toast({
          title: 'Could not add tile',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="add-tile-report" className="mb-1 block text-sm font-medium">
          Report
        </label>
        <select
          id="add-tile-report"
          value={reportId}
          onChange={(e) => setReportId(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">Select a report…</option>
          {reportList.map((report) => (
            <option key={report.id} value={report.id}>
              {report.name}
            </option>
          ))}
        </select>
        {reports.data && reportList.length === 0 && (
          <p className="mt-1 text-xs text-text-muted">
            No saved reports yet — save one from an analysis view first.
          </p>
        )}
      </div>
      <div>
        <label htmlFor="add-tile-title" className="mb-1 block text-sm font-medium">
          Tile title (optional)
        </label>
        <Input
          id="add-tile-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={selectedReport?.name ?? 'Defaults to the report name'}
        />
      </div>
      <Button type="submit" className="w-full" disabled={!selectedReport || createTile.isPending}>
        {createTile.isPending ? 'Adding…' : 'Add tile'}
      </Button>
    </form>
  );
}
