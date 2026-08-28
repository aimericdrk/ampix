import { useState, type FormEvent } from 'react';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { DataTable, type DataTableColumn } from '../../../../components/ui/DataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useToast } from '../../../../components/ui/toast';
import { ApiError } from '../../../../lib/api/problem';
import type { PurchaseServerKey } from '../../../../lib/api/types';
import {
  useCreatePurchaseServerKey,
  usePurchaseServerKeys,
  useRevokePurchaseServerKey,
} from '../../api';
import { CopyIconButton, formatDate } from './panel-kit';

/**
 * Server keys for the purchase service — the credential a project's own backend uses to call
 * `DELETE /v1/subscribers/:app_user_id`. It is deliberately NOT the public SDK key the app ships
 * with, and deliberately NOT the analytics SDK token: the two services keep separate databases and
 * each verifies its own callers, so neither has to trust the other (or a shared secret) to
 * authorize a delete. Admin-only, like the analytics token list.
 */
export function ServerKeysPanel({ projectId }: { projectId: string }) {
  const { data, isPending, error } = usePurchaseServerKeys(projectId);
  const createKey = useCreatePurchaseServerKey(projectId);
  const revokeKey = useRevokePurchaseServerKey(projectId);
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [canErase, setCanErase] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createKey.mutate(
      { label: label.trim() || undefined, can_erase: canErase },
      {
        onSuccess: () => {
          setLabel('');
          setCanErase(false);
        },
        onError: (error) =>
          toast({
            title: 'Could not create server key',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  const handleRevoke = (keyId: string) => {
    revokeKey.mutate(keyId, {
      onSuccess: () => setPendingRevokeId(null),
      onError: (error) => {
        setPendingRevokeId(null);
        toast({
          title: 'Could not revoke server key',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        });
      },
    });
  };

  const columns: Array<DataTableColumn<PurchaseServerKey>> = [
    { key: 'label', header: 'Label' },
    {
      key: 'can_erase',
      header: 'Rights',
      render: (key) =>
        key.can_erase ? (
          <Badge variant="danger" title="May erase subscriber data">
            Erase
          </Badge>
        ) : (
          <Badge variant="default">Read only</Badge>
        ),
    },
    {
      key: 'key',
      header: 'Key',
      render: (key) => (
        <div className="flex items-center gap-2">
          <code className="break-all rounded-lg bg-surface-raised px-2 py-1 font-mono text-xs">
            {key.key}
          </code>
          <CopyIconButton value={key.key} label="server key" />
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (key) => (
        <span className="whitespace-nowrap text-text-muted">{formatDate(key.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (key) => (
        <Button variant="danger" size="sm" onClick={() => setPendingRevokeId(key.id)}>
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-raised/40 p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="server-key-label" className="mb-1 block">
              Key label (optional)
            </Label>
            <Input
              id="server-key-label"
              value={label}
              placeholder="e.g. account deletion job"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={createKey.isPending}>
            {createKey.isPending ? 'Creating…' : 'New server key'}
          </Button>
        </form>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <Checkbox
            checked={canErase}
            onCheckedChange={(checked) => setCanErase(checked === true)}
            aria-describedby="server-key-can-erase-help"
          />
          <span>
            <span className="font-medium">Allow erasing subscriber data</span>
            <span id="server-key-can-erase-help" className="block text-text-muted">
              Lets this key call{' '}
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-xs">
                DELETE /v1/subscribers/:app_user_id
              </code>{' '}
              for this project. Leave it off for a backend that only reads.
            </span>
          </span>
        </label>
      </div>

      {isPending && <p className="text-sm text-text-muted">Loading server keys…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load server keys'}
        </p>
      )}

      {data && data.length > 0 && (
        <DataTable caption="Server keys" columns={columns} rows={data} rowKey={(key) => key.id} />
      )}
      {data && data.length === 0 && <EmptyState title="No server keys." />}

      <Dialog
        open={pendingRevokeId !== null}
        onOpenChange={(open) => !open && setPendingRevokeId(null)}
      >
        <DialogContent>
          <DialogTitle>Revoke server key</DialogTitle>
          <DialogDescription>
            Any backend using this key will immediately stop being able to call the purchase API.
            This cannot be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingRevokeId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={revokeKey.isPending}
              onClick={() => pendingRevokeId && handleRevoke(pendingRevokeId)}
            >
              {revokeKey.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
