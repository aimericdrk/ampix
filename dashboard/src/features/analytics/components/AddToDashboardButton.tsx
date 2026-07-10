import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { fieldLook, Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type { AnalysisDefinition, CreateTileRequest, ReportKind } from '../../../lib/api/types';
import { useCreateDashboard, useCreateTile, useDashboard, useDashboards } from '../api';

const NEW_DASHBOARD_VALUE = '__new__';

// Appended tiles are a fixed, generous size — the target board reflows on open, so a sensible
// default is enough (spec §3: "no need to choose a tile size on add" is a later-phase concern).
const TILE_W = 6;
const TILE_H = 4;

/** Either a reference to a saved report, or a fully inline analysis definition. */
export type AddToDashboardDraft = { kind: ReportKind; title: string } & (
  | { savedReportId: string }
  | { inlineDefinition: AnalysisDefinition }
);

export interface AddToDashboardButtonProps {
  projectId: string;
  draft: AddToDashboardDraft;
  /** Disables the trigger (e.g. the analysis isn't runnable yet) — `disabledHint` explains why. */
  disabled?: boolean;
  disabledHint?: string;
}

/**
 * "Add to dashboard" — from any chart or saved report, pick a dashboard (or create one inline) and
 * the current analysis becomes a tile there in one click (feat-14). Reuses the §16 tile API
 * (`useCreateTile`); the tile always appends below the target board's existing tiles.
 */
export function AddToDashboardButton({
  projectId,
  draft,
  disabled,
  disabledHint,
}: AddToDashboardButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          title={disabled ? disabledHint : undefined}
        >
          Add to dashboard
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add to dashboard</DialogTitle>
        <DialogDescription>
          Pick a dashboard — or create a new one — and this becomes a tile there.
        </DialogDescription>
        <AddToDashboardForm projectId={projectId} draft={draft} onAdded={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddToDashboardForm({
  projectId,
  draft,
  onAdded,
}: {
  projectId: string;
  draft: AddToDashboardDraft;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const dashboards = useDashboards(projectId);
  const createDashboard = useCreateDashboard(projectId);

  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [dashboardId, setDashboardId] = useState('');
  const [dashboardName, setDashboardName] = useState('');
  const [newDashboardName, setNewDashboardName] = useState('');
  const [title, setTitle] = useState(draft.title);
  // Set once a brand-new dashboard's id is known, so the deferred-add effect below fires exactly
  // once `createTile` has re-bound to it (see the effect's comment).
  const [pendingAdd, setPendingAdd] = useState(false);

  // Only fetched for an already-existing target — a freshly created dashboard is known to be empty.
  const targetDashboard = useDashboard(projectId, dashboardId, mode === 'existing');
  const createTile = useCreateTile(projectId, dashboardId);

  const dashboardList = dashboards.data?.dashboards ?? [];

  const submitTile = (tiles: { x: number; y: number; w: number; h: number }[], name: string) => {
    // Append at the bottom of the target board: y = max(existing tile y+h), or 0 for an empty board.
    const y = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
    const body: CreateTileRequest = {
      title: title.trim() || draft.title,
      kind: draft.kind,
      ...('savedReportId' in draft
        ? { saved_report_id: draft.savedReportId }
        : { inline_definition: draft.inlineDefinition }),
      x: 0,
      y,
      w: TILE_W,
      h: TILE_H,
    };
    createTile.mutate(body, {
      onSuccess: () => {
        toast({ title: `Added to ${name}` });
        onAdded();
      },
      onError: (error) =>
        toast({
          title: 'Could not add to dashboard',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  // `createTile` is bound to `dashboardId` at render time, so right after creating a new dashboard
  // we can't call `.mutate` synchronously with the freshly-minted id (this render's closure still
  // points at the old, empty id). Instead we stash the id + flip `pendingAdd`; once the next render
  // has re-bound `createTile` to the new id, this effect fires the deferred add exactly once.
  useEffect(() => {
    if (!pendingAdd || !dashboardId) return;
    setPendingAdd(false);
    submitTile([], dashboardName);
    // submitTile/dashboardName intentionally omitted: this must run exactly once per pending add,
    // keyed only on the id landing — re-including them would risk a second dispatch on any
    // unrelated re-render while pendingAdd briefly stays true.
  }, [pendingAdd, dashboardId]);

  const handleDashboardChange = (value: string) => {
    if (value === NEW_DASHBOARD_VALUE) {
      setMode('new');
      setDashboardId('');
      setDashboardName('');
      return;
    }
    setMode('existing');
    setDashboardId(value);
    setDashboardName(dashboardList.find((d) => d.id === value)?.name ?? '');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'new') {
      const name = newDashboardName.trim();
      if (!name) return;
      createDashboard.mutate(
        { name },
        {
          onSuccess: (created) => {
            setDashboardName(created.name);
            setDashboardId(created.id);
            setPendingAdd(true);
          },
          onError: (error) =>
            toast({
              title: 'Could not create dashboard',
              description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
              variant: 'error',
            }),
        },
      );
      return;
    }
    if (!dashboardId) return;
    submitTile(targetDashboard.data?.tiles ?? [], dashboardName);
  };

  const isBusy = createDashboard.isPending || createTile.isPending || pendingAdd;
  const canSubmit = mode === 'new' ? newDashboardName.trim().length > 0 : dashboardId.length > 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="add-to-dashboard-picker" className="mb-1 block text-sm font-medium">
          Dashboard
        </label>
        <select
          id="add-to-dashboard-picker"
          value={mode === 'new' ? NEW_DASHBOARD_VALUE : dashboardId}
          onChange={(e) => handleDashboardChange(e.target.value)}
          className={cn(fieldLook, 'w-full')}
        >
          <option value="">Select a dashboard…</option>
          {dashboardList.map((dashboard) => (
            <option key={dashboard.id} value={dashboard.id}>
              {dashboard.name}
            </option>
          ))}
          <option value={NEW_DASHBOARD_VALUE}>＋ New dashboard</option>
        </select>
      </div>

      {mode === 'new' && (
        <div>
          <label htmlFor="add-to-dashboard-new-name" className="mb-1 block text-sm font-medium">
            New dashboard name
          </label>
          <Input
            id="add-to-dashboard-new-name"
            value={newDashboardName}
            onChange={(e) => setNewDashboardName(e.target.value)}
            placeholder="e.g. Growth overview"
          />
        </div>
      )}

      <div>
        <label htmlFor="add-to-dashboard-title" className="mb-1 block text-sm font-medium">
          Tile title
        </label>
        <Input
          id="add-to-dashboard-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={draft.title}
        />
      </div>

      <Button type="submit" className="w-full" disabled={!canSubmit || isBusy}>
        {isBusy ? 'Adding…' : 'Add'}
      </Button>
    </form>
  );
}
