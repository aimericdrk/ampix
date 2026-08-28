import { useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { IconButton } from '../../../components/ui/icon-button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Separator } from '../../../components/ui/separator';
import { Switch } from '../../../components/ui/switch';
import { useToast } from '../../../components/ui/toast';
import { getRuntimeConfig } from '../../../lib/config';
import { ApiError } from '../../../lib/api/problem';
import type { RcIntegrationStatus } from '../../../lib/api/types';
import {
  useDisconnectRc,
  useRcJournal,
  useRcReplay,
  useRcResync,
  useRcStatus,
  useUpsertRcIntegration,
} from '../../revenuecat/api';

/** A Copy icon-button that briefly flips to a check mark — mirrors ProjectDetailPage's. */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = () => {
    if (!navigator.clipboard) {
      toast({ title: 'Copy not available' });
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast({ title: `Copied ${label}` });
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <IconButton
      variant="secondary"
      size="sm"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={handleCopy}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </IconButton>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Project settings body for the optional RevenueCat integration (spec §4.7). Disconnected shows
 *  the connect form; connected shows the webhook URL/secret, health counters, and journal/backfill
 *  controls. Rendered only for project admins (gated in ProjectDetailPage), inside that page's
 *  `SettingsLayout` panel — which supplies the title, description and `rc-integration-card` id. */
export function IntegrationsSection({ projectId }: { projectId: string }) {
  const { data: status, isPending, isError, error } = useRcStatus(projectId);

  return (
    <>
      {isPending && <p className="text-sm text-text-muted">Loading…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load RevenueCat status'}
        </p>
      )}
      {status &&
        (status.connected ? (
          <ConnectedPanel projectId={projectId} status={status} />
        ) : (
          <ConnectForm projectId={projectId} status={status} />
        ))}
    </>
  );
}

function ConnectForm({
  projectId,
  status,
}: {
  projectId: string;
  status: RcIntegrationStatus;
}) {
  const upsert = useUpsertRcIntegration(projectId);
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [rcProjectId, setRcProjectId] = useState('');
  const webhookUrl = `${getRuntimeConfig().apiBaseUrl}${status.webhook_path}`;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim() || !rcProjectId.trim()) return;
    upsert.mutate(
      { api_key: apiKey.trim(), rc_project_id: rcProjectId.trim() },
      {
        onSuccess: () => toast({ title: 'RevenueCat connected' }),
        onError: (error) =>
          toast({
            title: 'Could not connect RevenueCat',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-muted/40 p-3">
        <p className="text-sm font-medium">Webhook endpoint</p>
        <p className="mb-2 text-xs text-text-muted">
          Add this URL as a webhook in your RevenueCat project. We generate the authorization
          secret when you connect below.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono text-xs">
            {webhookUrl}
          </code>
          <CopyIconButton value={webhookUrl} label="webhook URL" />
        </div>
      </div>
      <div>
        <Label htmlFor="rc-api-key" className="mb-1 block">
          Secret API key
        </Label>
        <Input
          id="rc-api-key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk_..."
        />
      </div>
      <div>
        <Label htmlFor="rc-project-id" className="mb-1 block">
          RC project ID
        </Label>
        <Input
          id="rc-project-id"
          value={rcProjectId}
          onChange={(e) => setRcProjectId(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={upsert.isPending || !apiKey.trim() || !rcProjectId.trim()}>
        {upsert.isPending ? 'Connecting…' : 'Connect'}
      </Button>
    </form>
  );
}

function ConnectedPanel({
  projectId,
  status,
}: {
  projectId: string;
  status: RcIntegrationStatus;
}) {
  const upsert = useUpsertRcIntegration(projectId);
  const disconnect = useDisconnectRc(projectId);
  const replay = useRcReplay(projectId);
  const resync = useRcResync(projectId);
  const { data: journal } = useRcJournal(projectId, 'failed', { enabled: status.connected });
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const apiBaseUrl = getRuntimeConfig().apiBaseUrl;
  const webhookUrl = `${apiBaseUrl}${status.webhook_path}`;

  const handleSandboxToggle = (next: boolean) => {
    upsert.mutate(
      { sandbox_mode: next },
      {
        onError: (error) =>
          toast({
            title: 'Could not update sandbox mode',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  const handleReplay = () => {
    replay.mutate(undefined, {
      onSuccess: (result) =>
        toast({ title: `Replayed ${result.replayed} events`, description: `${result.remaining} remaining` }),
      onError: (error) =>
        toast({
          title: 'Could not replay events',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  const handleResync = () => {
    resync.mutate(undefined, {
      onSuccess: () => toast({ title: 'Re-sync started' }),
      onError: (error) =>
        toast({
          title: 'Could not start re-sync',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setDialogOpen(false);
        toast({ title: 'RevenueCat disconnected' });
      },
      onError: (error) => {
        setDialogOpen(false);
        toast({
          title: 'Could not disconnect RevenueCat',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        });
      },
    });
  };

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Webhook URL"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <span className="text-sm font-medium">Webhook URL</span>
        <div className="flex items-center gap-2">
          <code className="max-w-full break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
            {webhookUrl}
          </code>
          <CopyIconButton value={webhookUrl} label="webhook URL" />
        </div>
      </div>

      <div
        role="group"
        aria-label="Webhook secret"
        className="flex flex-wrap items-center justify-between gap-4"
      >
        <span className="text-sm font-medium">Webhook secret</span>
        <div className="flex items-center gap-2">
          <code className="max-w-full break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
            {status.webhook_secret}
          </code>
          <CopyIconButton value={status.webhook_secret} label="webhook secret" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">API key</span>
        <code className="rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
          {status.api_key_masked ?? '—'}
        </code>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="rc-sandbox-mode" className="text-sm font-medium">
          Sandbox mode
        </Label>
        <Switch
          id="rc-sandbox-mode"
          checked={status.sandbox_mode}
          disabled={upsert.isPending}
          onCheckedChange={handleSandboxToggle}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="success">{status.counts.processed} processed</Badge>
          <Badge variant="danger">{status.counts.failed} failed</Badge>
          <Badge variant="warning">{status.counts.unlinked} unlinked</Badge>
          <Badge variant="default">{status.counts.skipped} skipped</Badge>
        </div>
        <p className="text-sm text-text-muted">
          Last webhook:{' '}
          {status.last_webhook_at ? formatDate(status.last_webhook_at) : 'never'}
        </p>
        <p className="text-sm text-text-muted">
          Backfill status: {status.backfill_status ?? 'not started'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={replay.isPending} onClick={handleReplay}>
          {replay.isPending ? 'Replaying…' : 'Replay failed events'}
        </Button>
        <Button variant="secondary" disabled={resync.isPending} onClick={handleResync}>
          {resync.isPending ? 'Starting…' : 'Re-sync'}
        </Button>
      </div>

      {journal && journal.events.length > 0 && (
        <div className="space-y-2">
          <Separator />
          <p className="text-sm font-medium">Latest failed events</p>
          <ul className="space-y-1">
            {journal.events.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-4 text-sm">
                <span className="text-text-muted">
                  {entry.event_type} · {formatDate(entry.received_at)}
                </span>
                <span className="text-text-muted">{entry.error ?? entry.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Separator />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <Button variant="danger" onClick={() => setDialogOpen(true)}>
          Disconnect
        </Button>
        <DialogContent>
          <DialogTitle>Disconnect RevenueCat</DialogTitle>
          <DialogDescription>
            Historical subscription data is kept; the webhook stops being accepted.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={disconnect.isPending} onClick={handleDisconnect}>
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
