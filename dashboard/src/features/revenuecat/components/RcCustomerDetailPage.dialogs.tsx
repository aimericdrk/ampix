import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { fieldLook, Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { cn } from '../../../lib/cn';
import type { RcEntitlement } from '../catalog-api';
import {
  useDeleteCustomer,
  useGrantPromotionalEntitlement,
  useRefundSubscription,
  useRevokePromotionalEntitlement,
  type RcPromotionalDuration,
  type RcPromotionalEntitlement,
} from '../customers-api';

/** Every `PromotionalEntitlement` duration `createPromotionalEntitlementSchema` accepts (design
 *  §1.1) — daily..lifetime, UTC date math on the server. */
const DURATIONS: RcPromotionalDuration[] = [
  'daily',
  'three_day',
  'weekly',
  'monthly',
  'two_month',
  'three_month',
  'six_month',
  'yearly',
  'lifetime',
];

const DURATION_LABELS: Record<RcPromotionalDuration, string> = {
  daily: 'Daily',
  three_day: '3 days',
  weekly: 'Weekly',
  monthly: 'Monthly',
  two_month: '2 months',
  three_month: '3 months',
  six_month: '6 months',
  yearly: 'Yearly',
  lifetime: 'Lifetime',
};

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
 *  shows the server's actual reason inline and keeps the dialog open (design §3); any other error
 *  keeps a generic fallback. Mirrors `RcOfferingsPage.dialogs.tsx`'s helper of the same name. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/** Grant a promotional entitlement (design §1.1/§3). Native `<select>`s for the entitlement and
 *  duration pickers — Radix `Select` hangs jsdom in this test suite, so every RC admin picker in
 *  this codebase uses a plain `<select>` styled with `fieldLook` instead, same convention as
 *  `RcOfferingsPage.dialogs.tsx`'s package-type/product pickers. */
export function GrantEntitlementDialog({
  projectId,
  customerId,
  entitlements,
  open,
  onOpenChange,
}: {
  projectId: string;
  customerId: string;
  entitlements: RcEntitlement[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const grantEntitlement = useGrantPromotionalEntitlement(projectId, customerId);

  const [entitlementId, setEntitlementId] = useState(entitlements[0]?.id ?? '');
  const [duration, setDuration] = useState<RcPromotionalDuration>('monthly');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // `entitlements` loads asynchronously (useRcEntitlements), after the useState initializer above
  // already ran with an empty list — so the native <select> below visually defaults to the first
  // <option> while `entitlementId` stays ''. Sync the two once entitlements are available so a
  // first-open Grant (without touching the select) submits that same first entitlement instead of
  // hitting the "Choose an entitlement." guard.
  useEffect(() => {
    const first = entitlements[0];
    if (!first) return;
    if (entitlementId && entitlements.some((entitlement) => entitlement.id === entitlementId)) return;
    setEntitlementId(first.id);
  }, [entitlements, entitlementId]);

  const reset = () => {
    setEntitlementId(entitlements[0]?.id ?? '');
    setDuration('monthly');
    setNote('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!entitlementId) {
      setError('Choose an entitlement.');
      return;
    }
    grantEntitlement.mutate(
      { entitlementId, duration, note: note.trim() || undefined },
      {
        onSuccess: () => handleOpenChange(false),
        onError: (mutationError) => setError(apiErrorMessage(mutationError, 'Could not grant the entitlement.')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle>Grant promotional entitlement</DialogTitle>
        <DialogDescription>Comp this customer access to an entitlement without a store purchase.</DialogDescription>
        {entitlements.length === 0 ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Create an entitlement first (Entitlements page) — there’s nothing to grant yet.
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <div>
              <Label className="mb-1 block">Entitlement</Label>
              <select
                aria-label="Entitlement"
                className={cn(fieldLook, 'w-full')}
                value={entitlementId}
                onChange={(event) => setEntitlementId(event.target.value)}
              >
                {entitlements.map((entitlement) => (
                  <option key={entitlement.id} value={entitlement.id}>
                    {entitlement.displayName} ({entitlement.identifier})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1 block">Duration</Label>
              <select
                aria-label="Duration"
                className={cn(fieldLook, 'w-full')}
                value={duration}
                onChange={(event) => setDuration(event.target.value as RcPromotionalDuration)}
              >
                {DURATIONS.map((value) => (
                  <option key={value} value={value}>
                    {DURATION_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="grant-note" className="mb-1 block">
                Note (optional)
              </Label>
              <Input id="grant-note" value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={grantEntitlement.isPending}>
                {grantEntitlement.isPending ? 'Granting…' : 'Grant'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Revoke an active promotional grant (design §1.4). Same `AlertDialogAction` + `preventDefault`
 *  pattern as `RcOfferingsPage.dialogs.tsx`'s `DeleteOfferingAlertDialog`/`RemovePackageAlertDialog`:
 *  Radix's default auto-close is suppressed so a failed revoke keeps the dialog open with the
 *  inline error visible, and we close it manually on success. */
export function RevokeGrantAlertDialog({
  projectId,
  customerId,
  grant,
  onClose,
}: {
  projectId: string;
  customerId: string;
  grant: RcPromotionalEntitlement;
  onClose: () => void;
}) {
  const revokeEntitlement = useRevokePromotionalEntitlement(projectId, customerId);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Revoke {grant.entitlementIdentifier}?</AlertDialogTitle>
        <AlertDialogDescription>
          This customer immediately loses this promotionally-granted entitlement. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={revokeEntitlement.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                revokeEntitlement.mutate(grant.id, {
                  onSuccess: () => onClose(),
                  onError: (mutationError) =>
                    setError(apiErrorMessage(mutationError, 'Could not revoke this entitlement.')),
                });
              }}
            >
              {revokeEntitlement.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Refund a Google Play subscription (refund design §2): calls the store-gated refund endpoint
 *  (refund the last payment + revoke access immediately). Same mounted-per-target
 *  `AlertDialogAction` + `preventDefault` pattern as `RevokeGrantAlertDialog`, but outcomes
 *  surface as toasts instead of inline errors — the dialog closes either way, and on success the
 *  hook's detail invalidation re-renders the row as REVOKED. */
export function RefundSubscriptionDialog({
  projectId,
  customerId,
  subscriptionId,
  onClose,
}: {
  projectId: string;
  customerId: string;
  subscriptionId: string;
  onClose: () => void;
}) {
  const refundSubscription = useRefundSubscription(projectId, customerId);
  const { toast } = useToast();

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Refund subscription</AlertDialogTitle>
        <AlertDialogDescription>
          Refund the last payment and revoke this subscription immediately? This can't be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={refundSubscription.isPending}
              onClick={(event) => {
                event.preventDefault();
                refundSubscription.mutate(subscriptionId, {
                  onSuccess: () => {
                    onClose();
                    toast({ title: 'Refund issued' });
                  },
                  onError: (mutationError) => {
                    onClose();
                    toast({
                      title: apiErrorMessage(mutationError, 'Could not refund this subscription.'),
                      variant: 'error',
                    });
                  },
                });
              }}
            >
              {refundSubscription.isPending ? 'Refunding…' : 'Refund'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Delete the customer (design §1.4/§3): removes personal data + subscriptions + promotional
 *  grants; past transactions stay on the revenue ledger, anonymized. Navigates back to the
 *  customers list on success — the same destination `RcCustomersPage`'s row click leads to. */
export function DeleteCustomerAlertDialog({
  projectId,
  customerId,
  onClose,
}: {
  projectId: string;
  customerId: string;
  onClose: () => void;
}) {
  const deleteCustomer = useDeleteCustomer(projectId);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes the customer’s personal data (app user id, store tokens, attributes) and their
          subscriptions and promotional grants. Their past transactions stay on the revenue ledger,
          anonymized. This cannot be undone.
        </AlertDialogDescription>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="danger"
              disabled={deleteCustomer.isPending}
              onClick={(event) => {
                event.preventDefault();
                setError(null);
                deleteCustomer.mutate(customerId, {
                  onSuccess: () => {
                    onClose();
                    void navigate({ to: '/projects/$projectId/rc/customers', params: { projectId } });
                  },
                  onError: (mutationError) =>
                    setError(apiErrorMessage(mutationError, 'Could not delete this customer.')),
                });
              }}
            >
              {deleteCustomer.isPending ? 'Deleting…' : 'Delete customer'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
