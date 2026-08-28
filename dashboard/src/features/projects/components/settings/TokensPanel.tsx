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
import { fieldLook, Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Separator } from '../../../../components/ui/separator';
import { useToast } from '../../../../components/ui/toast';
import { cn } from '../../../../lib/cn';
import { ApiError } from '../../../../lib/api/problem';
import type { EventSource, SdkToken } from '../../../../lib/api/types';
import { useCreateToken, useRevokeToken, useTokens } from '../../api';
import { CodeChip, CopyIconButton, formatDate, SettingRow, SettingRows } from './panel-kit';

/**
 * SDK tokens panel. Every member sees the primary ingest token read-only; the named-token surface
 * below (list, create, rotate, revoke) is admin-only, matching the admin-only list endpoint.
 */
export function TokensPanel({
  projectId,
  ingestToken,
  isAdmin,
}: {
  projectId: string;
  ingestToken: string;
  isAdmin: boolean;
}) {
  return (
    <div className="space-y-5">
      <SettingRows>
        <SettingRow
          role="group"
          aria-label="Primary ingest token"
          label="Primary ingest token"
          hint="The token a fresh SDK install sends events with. It cannot be revoked."
        >
          <CodeChip value={ingestToken} className="max-w-full" />
          <CopyIconButton value={ingestToken} label="ingest token" />
        </SettingRow>
      </SettingRows>

      {isAdmin && (
        <>
          <Separator />
          <ManagedTokens projectId={projectId} />
        </>
      )}
    </div>
  );
}

/** Client vs server, in the token table and on the revealed token. Neutral colours: neither is a
 *  warning state — they are just two kinds of token. */
function SourceBadge({ source }: { source: EventSource }) {
  return (
    <Badge variant={source === 'server' ? 'info' : 'accent'}>
      {source === 'server' ? 'Server' : 'Client'}
    </Badge>
  );
}

function ManagedTokens({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useTokens(projectId);
  const createToken = useCreateToken(projectId);
  const revokeToken = useRevokeToken(projectId);
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<EventSource>('client');
  // Erasure rights. Kept out of the request unless the token is a server one — the API refuses the
  // pair, and a checkbox that survived a switch back to Client would submit a guaranteed 400.
  const [canErase, setCanErase] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [pendingRotate, setPendingRotate] = useState<SdkToken | null>(null);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createToken.mutate(
      { label: label.trim() || undefined, source, can_erase: source === 'server' && canErase },
      {
        onSuccess: (token) => {
          setNewToken(token.token);
          setLabel('');
          setSource('client');
          setCanErase(false);
        },
        onError: (error) =>
          toast({
            title: 'Could not create token',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  const handleRevoke = (tokenId: string) => {
    revokeToken.mutate(tokenId, {
      onSuccess: () => setPendingRevokeId(null),
      onError: (error) => {
        setPendingRevokeId(null);
        toast({
          title: 'Could not revoke token',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        });
      },
    });
  };

  // Rotate = create a replacement with the SAME label, source AND capability, reveal it once, THEN
  // revoke the old token — create-first so there is never a window without a working token (no
  // dedicated rotate endpoint). Carrying the source over matters: a rotated server token that came
  // back as a client one would silently reclassify everything that backend sends from then on.
  // Carrying can_erase matters for the same reason in the other direction — rotating the token a
  // backend deletes users with must not quietly leave it unable to.
  const handleRotate = (token: SdkToken) => {
    createToken.mutate(
      { label: token.label || undefined, source: token.source, can_erase: token.can_erase },
      {
        onSuccess: (created) => {
          setNewToken(created.token);
          revokeToken.mutate(token.id, {
            onSuccess: () => {
              setPendingRotate(null);
              toast({ title: 'Token rotated' });
            },
            onError: (error) => {
              setPendingRotate(null);
              toast({
                title: 'Token created, but revoking the old one failed',
                description:
                  error instanceof ApiError ? error.problem.title : 'Revoke it manually below.',
                variant: 'error',
              });
            },
          });
        },
        onError: (error) => {
          setPendingRotate(null);
          toast({
            title: 'Could not rotate token',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          });
        },
      },
    );
  };

  const rotating = createToken.isPending || revokeToken.isPending;

  const columns: Array<DataTableColumn<SdkToken>> = [
    { key: 'label', header: 'Label' },
    {
      key: 'source',
      header: 'Source',
      render: (token) => (
        <div className="flex flex-wrap items-center gap-1">
          <SourceBadge source={token.source} />
          {token.can_erase && (
            <Badge variant="danger" title="May erase end-user data">
              Erase
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'token',
      header: 'Token',
      render: (token) => (
        <code className="break-all rounded-lg bg-surface-raised px-2 py-1 font-mono text-xs">
          {token.token}
        </code>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (token) => (
        <span className="whitespace-nowrap text-text-muted">{formatDate(token.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (token) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPendingRotate(token)}>
            Rotate
          </Button>
          <Button variant="danger" size="sm" onClick={() => setPendingRevokeId(token.id)}>
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-raised/40 p-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="token-label" className="mb-1 block">
              Label (optional)
            </Label>
            <Input
              id="token-label"
              value={label}
              placeholder="e.g. iOS app"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="token-source" className="mb-1 block">
              Source
            </Label>
            <select
              id="token-source"
              value={source}
              onChange={(e) => setSource(e.target.value as EventSource)}
              className={cn(fieldLook, 'w-auto')}
            >
              <option value="client">Client (app or browser)</option>
              <option value="server">Server (your backend)</option>
            </select>
          </div>
          <Button type="submit" disabled={createToken.isPending}>
            {createToken.isPending ? 'Creating…' : 'New token'}
          </Button>
        </form>
        {source === 'server' && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <Checkbox
              checked={canErase}
              onCheckedChange={(checked) => setCanErase(checked === true)}
              aria-describedby="token-can-erase-help"
            />
            <span>
              <span className="font-medium">Allow erasing end-user data</span>
              <span id="token-can-erase-help" className="block text-text-muted">
                Lets this token call{' '}
                <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-xs">
                  DELETE /ingest/users/:distinct_id
                </code>{' '}
                for this project. Leave it off for a backend that only sends events.
              </span>
            </span>
          </label>
        )}
      </div>

      <p className="max-w-3xl text-sm text-text-muted">
        Events arrive tagged with the token&apos;s source — filter or break down any report by{' '}
        <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-xs">source</code>. It
        is fixed once the token exists: to change it, create a new token and revoke this one. Only a
        server token can be allowed to erase data: a client token ships inside your app, where
        anyone can read it out.
      </p>

      {newToken && (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <p className="text-sm text-text-muted">
            Copy this token now — it won&apos;t be shown again in full.
          </p>
          <div className="flex items-center gap-2">
            <CodeChip value={newToken} className="flex-1" />
            <CopyIconButton value={newToken} label="new token" />
          </div>
        </div>
      )}

      {isPending && <p className="text-sm text-text-muted">Loading tokens…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load tokens'}
        </p>
      )}

      {data && data.tokens.length > 0 && (
        <DataTable
          caption="Ingest tokens"
          columns={columns}
          rows={data.tokens}
          rowKey={(token) => token.id}
        />
      )}
      {data && data.tokens.length === 0 && <EmptyState title="No tokens." />}

      <Dialog
        open={pendingRevokeId !== null}
        onOpenChange={(open) => !open && setPendingRevokeId(null)}
      >
        <DialogContent>
          <DialogTitle>Revoke token</DialogTitle>
          <DialogDescription>
            Any app using this token will immediately stop being able to send events. This cannot be
            undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingRevokeId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={revokeToken.isPending}
              onClick={() => pendingRevokeId && handleRevoke(pendingRevokeId)}
            >
              {revokeToken.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingRotate !== null} onOpenChange={(open) => !open && setPendingRotate(null)}>
        <DialogContent>
          <DialogTitle>Rotate token</DialogTitle>
          <DialogDescription>
            Rotating creates a new token with the same label and revokes the old one — update your
            app with the new token.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingRotate(null)}>
              Cancel
            </Button>
            <Button disabled={rotating} onClick={() => pendingRotate && handleRotate(pendingRotate)}>
              {rotating ? 'Rotating…' : 'Rotate'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
