import { useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Inbox } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Banner } from '../../../components/ui/banner';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { IconButton } from '../../../components/ui/icon-button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Reveal } from '../../../components/ui/reveal';
import { Separator } from '../../../components/ui/separator';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { SdkToken } from '../../../lib/api/types';
import { useOrgRole } from '../../orgs/api';
import {
  useCreateToken,
  useDeleteProject,
  useEventSummary,
  useProjects,
  useRevokeToken,
  useTokens,
  useUpdateProject,
} from '../api';

/**
 * Project settings screen (sidebar "Project settings" → /projects/$projectId).
 * Organized into clearly titled sections: General, SDK tokens, SDK log level, Data, Danger zone.
 * Read-only info (ingest token, data, facts) is visible to every member; mutations (rename, token
 * create/rotate/revoke, delete) are gated behind the caller's admin role in the owning org.
 */
export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId' });
  const router = useRouter();
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const role = useOrgRole(project?.org_id);
  const isAdmin = role === 'admin';

  return (
    <PageShell
      title={project?.name ?? 'Project'}
      description="Project settings"
      breadcrumbs={[
        { label: 'Projects', to: '/projects' },
        { label: project?.name ?? 'Project' },
      ]}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {project && isAdmin && (
          <Reveal index={0}>
            <GeneralSection
              projectId={project.id}
              currentName={project.name}
              currentTimezone={project.timezone}
            />
          </Reveal>
        )}

        <Reveal index={1}>
          <LogLevelSection />
        </Reveal>

        {project && (
          <Reveal index={2} className="lg:col-span-2">
            <TokensSection
              projectId={project.id}
              ingestToken={project.ingest_token}
              isAdmin={isAdmin}
            />
          </Reveal>
        )}

        <Reveal index={3} className="lg:col-span-2">
          <DataSection projectId={projectId} project={project} />
        </Reveal>

        {project && isAdmin && (
          <Reveal index={4} className="lg:col-span-2">
            <DangerZoneSection
              projectId={project.id}
              onDeleted={() => router.history.push('/projects')}
            />
          </Reveal>
        )}
      </div>
    </PageShell>
  );
}

/** A Copy icon-button that briefly flips to a check mark — reused for token/key blocks. */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
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

// --- 1) General ---------------------------------------------------------------

function GeneralSection({
  projectId,
  currentName,
  currentTimezone,
}: {
  projectId: string;
  currentName: string;
  currentTimezone: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Rename the project or change its timezone.</CardDescription>
      </CardHeader>
      <CardContent>
        <RenameProjectForm
          projectId={projectId}
          currentName={currentName}
          currentTimezone={currentTimezone}
        />
      </CardContent>
    </Card>
  );
}

function RenameProjectForm({
  projectId,
  currentName,
  currentTimezone,
}: {
  projectId: string;
  currentName: string;
  currentTimezone: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(currentName);
  const [timezone, setTimezone] = useState(currentTimezone);
  useEffect(() => setName(currentName), [currentName]);
  useEffect(() => setTimezone(currentTimezone), [currentTimezone]);
  const mutation = useUpdateProject(projectId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate(
      { name: name.trim(), timezone: timezone.trim() || undefined },
      {
        onSuccess: () => toast({ title: 'Project updated' }),
        onError: (error) =>
          toast({
            title: 'Could not update project',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <Label htmlFor="project-name" className="mb-1 block">
          Name
        </Label>
        <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="project-timezone" className="mb-1 block">
          Timezone
        </Label>
        <Input
          id="project-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={mutation.isPending || !name.trim()}>
        {mutation.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}

// --- 2) SDK tokens ------------------------------------------------------------

function TokensSection({
  projectId,
  ingestToken,
  isAdmin,
}: {
  projectId: string;
  ingestToken: string;
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SDK tokens</CardTitle>
        <CardDescription>Use these tokens to send events from your app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="group"
          aria-label="Primary ingest token"
          className="flex flex-wrap items-center justify-between gap-4"
        >
          <span className="text-sm font-medium">Primary ingest token</span>
          <div className="flex items-center gap-2">
            <code className="max-w-full break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
              {ingestToken}
            </code>
            <CopyIconButton value={ingestToken} label="ingest token" />
          </div>
        </div>

        {/* Listing/creating/rotating/revoking named tokens is an admin-only mutation surface; the
            list endpoint itself is admin-only server-side, so it is only mounted for admins. Every
            member still sees the primary ingest token above, read-only. */}
        {isAdmin && (
          <>
            <Separator />
            <ManagedTokens projectId={projectId} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ManagedTokens({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useTokens(projectId);
  const createToken = useCreateToken(projectId);
  const revokeToken = useRevokeToken(projectId);
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [pendingRotate, setPendingRotate] = useState<SdkToken | null>(null);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createToken.mutate(
      { label: label.trim() || undefined },
      {
        onSuccess: (token) => {
          setNewToken(token.token);
          setLabel('');
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

  // Rotate = create a replacement with the SAME label, reveal it once, THEN revoke the old token —
  // create-first so there is never a window without a working token (no dedicated rotate endpoint).
  const handleRotate = (token: SdkToken) => {
    createToken.mutate(
      { label: token.label || undefined },
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
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex-1">
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
        <Button type="submit" disabled={createToken.isPending}>
          {createToken.isPending ? 'Creating…' : 'New token'}
        </Button>
      </form>

      {newToken && (
        <div className="space-y-2 rounded-lg border border-border bg-bg p-3">
          <p className="text-sm text-text-muted">
            Copy this token now — it won&apos;t be shown again in full.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
              {newToken}
            </code>
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

// --- 3) SDK log level ---------------------------------------------------------

const LOG_LEVELS = ['none', 'error', 'warn', 'info', 'debug'] as const;

/** Read-only guidance: the log level is an SDK-side config, not a server setting. */
function LogLevelSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SDK log level</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-muted">
          <Badge variant="outline" className="mr-2 align-middle">
            SDK-side
          </Badge>
          Controls how much the MyAmpix SDK logs in your app. It is set in your app&apos;s config, not
          here — there is no server setting to change.
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {LOG_LEVELS.map((level, index) => (
            <span key={level} className="flex items-center gap-1.5">
              <code className="rounded-lg bg-surface-raised px-1.5 py-0.5 font-mono text-xs">
                {level}
              </code>
              {index < LOG_LEVELS.length - 1 && <span aria-hidden="true">·</span>}
            </span>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Ascending verbosity, left to right. Default is <code className="font-mono">none</code>.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
          <code>MyAmpixConfig(logLevel: MyAmpixLogLevel.warn)</code>
        </pre>
      </CardContent>
    </Card>
  );
}

// --- 4) Data ------------------------------------------------------------------

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-text-muted">{value}</span>
    </div>
  );
}

function DataSection({
  projectId,
  project,
}: {
  projectId: string;
  project: { id: string; timezone: string; org_name: string } | undefined;
}) {
  const { data: summary, isPending, error } = useEventSummary(projectId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>Event volume and project facts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPending && <p role="status">Loading event summary…</p>}
        {error && (
          <p role="alert" className="text-danger">
            {error instanceof ApiError ? error.problem.title : 'Failed to load event summary'}
          </p>
        )}

        {summary && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-text-muted">Total events</p>
              <p className="font-display text-3xl font-semibold tabular-nums">{summary.total}</p>
            </div>

            {summary.total === 0 ? (
              <EmptyState icon={Inbox} title="No events yet — send some from your app" />
            ) : (
              <DataTable
                caption="Events by name"
                columns={[
                  { key: 'event', header: 'Event', sortable: true },
                  { key: 'count', header: 'Count', align: 'right', sortable: true },
                ]}
                rows={summary.by_event}
                rowKey={(row) => row.event}
              />
            )}
          </div>
        )}

        {project && (
          <div className="space-y-3">
            <Separator />
            <FactRow label="Organization" value={project.org_name} />
            <Separator />
            <FactRow label="Timezone" value={project.timezone} />
            <Separator />
            <FactRow
              label="Project ID"
              value={<code className="font-mono text-xs">{project.id}</code>}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- 5) Danger zone -----------------------------------------------------------

function DangerZoneSection({
  projectId,
  onDeleted,
}: {
  projectId: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const deleteProject = useDeleteProject(projectId);

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

  return (
    <Card className="border-danger/40">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Permanently-visible framing, not a transient alert — role="note" avoids colliding
            with real role="alert" fetch errors elsewhere on the page. */}
        <Banner variant="danger" role="note">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p>Deleting a project revokes its tokens. Event data already ingested is kept.</p>
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
          </div>
        </Banner>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}
