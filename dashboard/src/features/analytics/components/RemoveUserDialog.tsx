import { useState } from 'react';
import { EyeOff, Trash2, TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { useEraseUser, useHideUser } from '../api';

/** Typed to confirm the irreversible option — the same guard the project data purge uses. */
const CONFIRM_WORD = 'DELETE';

/**
 * "Remove this user" — the one place the two very different meanings of deleting a user are put in
 * front of the operator instead of one being chosen for them:
 *
 *  - **Hide** is reversible bookkeeping. The user leaves the users list, the live feed and the
 *    attribution readout; their events stay on disk and keep counting in every chart. This is what
 *    you want for a test account or a staff device cluttering the audience.
 *  - **Delete permanently** is the GDPR erase. Every event, profile row and identity mapping goes,
 *    across all of this person's linked ids, and it cannot be undone — so it is gated behind typing
 *    the confirm word rather than behind a second button that a fast double-click could sail past.
 *
 * Both are admin+ on the server; a non-admin's click comes back as a 403 and is surfaced as such
 * rather than failing silently.
 */
export function RemoveUserDialog({
  projectId,
  distinctId,
  displayName,
  open,
  onOpenChange,
  onRemoved,
}: {
  projectId: string;
  distinctId: string;
  /** What to call this user in the copy — their name or email, falling back to the id. */
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after either action succeeds, so a profile modal above this can close itself. */
  onRemoved?: (mode: 'hide' | 'erase') => void;
}) {
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState('');
  const hideUser = useHideUser(projectId);
  const eraseUser = useEraseUser(projectId);

  const busy = hideUser.isPending || eraseUser.isPending;

  const close = () => {
    setConfirmText('');
    onOpenChange(false);
  };

  const reportError = (error: unknown, fallback: string) => {
    toast({
      title: error instanceof ApiError ? error.problem.title : fallback,
      description: error instanceof ApiError ? error.problem.detail : undefined,
      variant: 'error',
    });
  };

  const handleHide = () => {
    hideUser.mutate(distinctId, {
      onSuccess: () => {
        toast({
          title: 'User hidden',
          description: `${displayName} no longer appears in the users list. Their events are kept.`,
        });
        close();
        onRemoved?.('hide');
      },
      onError: (error) => reportError(error, 'Failed to hide user'),
    });
  };

  const handleErase = () => {
    eraseUser.mutate(distinctId, {
      onSuccess: (result) => {
        const idCount = result.ids.length;
        toast({
          title: 'User deleted',
          description: `Erased every event for ${displayName}${
            idCount > 1 ? ` across ${idCount} linked ids` : ''
          }.`,
        });
        close();
        onRemoved?.('erase');
      },
      onError: (error) => reportError(error, 'Failed to delete user'),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogTitle>Remove {displayName}?</AlertDialogTitle>
        <AlertDialogDescription>
          Two different things are called "deleting a user". Pick the one you mean.
        </AlertDialogDescription>

        <div className="mt-5 flex flex-col gap-4">
          <section className="rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <EyeOff className="size-4 text-text-muted" aria-hidden />
              Hide from the users list
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              Reversible. They stop appearing in Users, Live and Attribution. Every event is kept,
              so your charts, funnels and retention are unchanged.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={busy}
              onClick={handleHide}
            >
              {hideUser.isPending ? 'Hiding…' : 'Hide user'}
            </Button>
          </section>

          <section className="rounded-xl border border-danger/40 bg-danger-soft/40 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
              <Trash2 className="size-4" aria-hidden />
              Delete permanently
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              Erases every event, their profile and their subscription records — across all of this
              person's linked ids. Your historical charts will change. This cannot be undone.
            </p>
            <label
              htmlFor="remove-user-confirm"
              className="mt-3 block text-xs font-medium text-text-muted"
            >
              Type {CONFIRM_WORD} to confirm
            </label>
            <Input
              id="remove-user-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              className="mt-1"
            />
            <Button
              type="button"
              variant="danger"
              className="mt-3"
              disabled={busy || confirmText !== CONFIRM_WORD}
              onClick={handleErase}
            >
              {eraseUser.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </section>

          <p className="flex items-start gap-2 text-xs text-text-muted">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Both actions require the admin role on this project.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
