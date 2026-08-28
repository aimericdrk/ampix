import { useState, type ReactNode } from 'react';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useToast } from '../../../../components/ui/toast';
import { ApiError } from '../../../../lib/api/problem';
import { useDeleteProject, usePurgeProjectData } from '../../api';

const PURGE_SCOPES: Array<{
  key: 'analytics' | 'revenuecat' | 'saved';
  label: string;
  hint: string;
}> = [
  {
    key: 'analytics',
    label: 'Analytics events & profiles',
    hint: 'All ingested events, user profiles, and identity data. The project keeps working from zero.',
  },
  {
    key: 'revenuecat',
    label: 'RevenueCat subscription data',
    hint: 'Subscription status and webhook history. The RevenueCat connection itself is kept.',
  },
  {
    key: 'saved',
    label: 'Saved dashboards, cohorts & reports',
    hint: 'Every saved dashboard, cohort, and report for this project.',
  },
];

/** One destructive action, framed as a row: what it does on the left, the button flush right. */
function DangerRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3">
      <div className="max-w-xl">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-text-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** Owner-only destructive block: wipe collected data (the reversible-ish one, listed first), then
 *  delete the project outright. */
export function DangerZonePanel({
  projectId,
  projectName,
  onDeleted,
}: {
  projectId: string;
  projectName: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const deleteProject = useDeleteProject(projectId);

  const [purgeOpen, setPurgeOpen] = useState(false);
  const [scopes, setScopes] = useState({ analytics: false, revenuecat: false, saved: false });
  const [confirmName, setConfirmName] = useState('');
  const purge = usePurgeProjectData(projectId);

  const anyScope = scopes.analytics || scopes.revenuecat || scopes.saved;
  const nameMatches = confirmName.trim() === projectName;

  const resetPurge = () => {
    setScopes({ analytics: false, revenuecat: false, saved: false });
    setConfirmName('');
  };

  const handleDelete = () => {
    deleteProject.mutate(undefined, {
      onSuccess: () => {
        setDialogOpen(false);
        onDeleted();
      },
      onError: (error) => {
        setDialogOpen(false);
        toast({
          title: 'Could not delete project',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        });
      },
    });
  };

  const handlePurge = () => {
    if (!anyScope || !nameMatches) return;
    purge.mutate(
      { scopes },
      {
        onSuccess: (result) => {
          const cleared = PURGE_SCOPES.filter((s) => result.cleared[s.key]).map((s) => s.label);
          setPurgeOpen(false);
          resetPurge();
          toast({ title: 'Data deleted', description: cleared.join(', ') });
        },
        onError: (error) => {
          toast({
            title: 'Could not delete data',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          });
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {/* Delete data sits above Delete project: wiping data is the less-drastic of the two. */}
      <DangerRow
        title="Delete all data"
        description="Permanently delete collected data while keeping the project and its tokens."
      >
        <Dialog
          open={purgeOpen}
          onOpenChange={(open) => {
            setPurgeOpen(open);
            if (!open) resetPurge();
          }}
        >
          <Button variant="danger" onClick={() => setPurgeOpen(true)}>
            Delete all data
          </Button>
          <DialogContent>
            <DialogTitle>Delete all data</DialogTitle>
            <DialogDescription>
              Choose what to permanently erase for this project. This cannot be undone.
            </DialogDescription>
            <div className="mt-4 space-y-3">
              {PURGE_SCOPES.map((scope) => (
                <label key={scope.key} className="flex gap-3">
                  <Checkbox
                    checked={scopes[scope.key]}
                    onCheckedChange={(checked) =>
                      setScopes((prev) => ({ ...prev, [scope.key]: checked === true }))
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">{scope.label}</span>
                    <span className="block text-xs text-text-muted">{scope.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4">
              <Label htmlFor="purge-confirm" className="mb-1 block">
                Type <span className="font-mono">{projectName}</span> to confirm
              </Label>
              <Input
                id="purge-confirm"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPurgeOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={!anyScope || !nameMatches || purge.isPending}
                onClick={handlePurge}
              >
                {purge.isPending ? 'Deleting…' : 'Delete data'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DangerRow>

      <DangerRow
        title="Delete project"
        description="Deleting a project revokes its tokens. Event data already ingested is kept."
      >
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button variant="danger" onClick={() => setDialogOpen(true)}>
            Delete project
          </Button>
          <DialogContent>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This permanently deletes the project and revokes all of its tokens. This cannot be
              undone.
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={deleteProject.isPending} onClick={handleDelete}>
                {deleteProject.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DangerRow>
    </div>
  );
}
