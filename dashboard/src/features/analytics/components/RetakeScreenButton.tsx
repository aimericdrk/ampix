import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { useDeleteScreen } from '../api';

/** The tooltip that explains what deleting does + how to get the image back (§18 debug-only flow). */
const RETAKE_HINT =
  'Deletes this reference image; re-capture it by running a debug build and re-navigating — see HOW-TO-USE §14.';

/**
 * Per-screen "Retake / Delete" control for a reference screenshot (§18). Reference screenshots are a
 * developer debug tool: there's no re-capture button here — the dashboard's job is to DELETE an
 * outdated image (via `DELETE /screens/:screenName`), after which the developer re-captures it by
 * running a debug build (`MyAmpix.instance.retakeScreenshots()`) and re-navigating. Uses an inline
 * two-step confirm so a stray click can't wipe an image, and surfaces success/failure as a toast.
 */
export function RetakeScreenButton({
  projectId,
  screenName,
  onDeleted,
  size = 'sm',
}: {
  projectId: string;
  screenName: string;
  /** Called after a successful delete so the host can clear its selection / refresh derived state. */
  onDeleted?: () => void;
  size?: 'sm' | 'md';
}) {
  const { toast } = useToast();
  const deleteScreen = useDeleteScreen(projectId);
  const [confirming, setConfirming] = useState(false);

  const handleDelete = () => {
    deleteScreen.mutate(
      { screenName },
      {
        onSuccess: () => {
          toast({
            title: 'Screenshot deleted',
            description: `Re-capture "${screenName}" by running a debug build and re-navigating (HOW-TO-USE §14).`,
          });
          setConfirming(false);
          onDeleted?.();
        },
        onError: (error) => {
          toast({
            title: 'Could not delete screenshot',
            description:
              error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          });
          setConfirming(false);
        },
      },
    );
  };

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="secondary"
        size={size}
        title={RETAKE_HINT}
        aria-label={`Retake or delete screenshot for ${screenName}`}
        onClick={() => setConfirming(true)}
      >
        Retake / Delete
      </Button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-text-muted">Delete this reference image?</span>
      <Button
        type="button"
        variant="danger"
        size={size}
        disabled={deleteScreen.isPending}
        onClick={handleDelete}
      >
        {deleteScreen.isPending ? 'Deleting…' : 'Confirm delete'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={size}
        disabled={deleteScreen.isPending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </span>
  );
}
