import { useParams, useRouter } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
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
      {project && isAdmin && (
        <GeneralSection
          projectId={project.id}
          currentName={project.name}
          currentTimezone={project.timezone}
        />
      )}

      {project && (
        <TokensSection projectId={project.id} ingestToken={project.ingest_token} isAdmin={isAdmin} />
      )}

      <LogLevelSection />

      <DataSection projectId={projectId} project={project} />

      {project && isAdmin && (
        <DangerZoneSection
          projectId={project.id}
          onDeleted={() => router.history.push('/projects')}
        />
      )}
    </PageShell>
  );
}

/** A Copy button that briefly flips to "Copied!" — reused for the ingest token and reveal panels. */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => {});
  };
  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? 'Copied!' : 'Copy'}
    </Button>
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
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>General</CardTitle>
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
        <label htmlFor="project-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label htmlFor="project-timezone" className="mb-1 block text-sm font-medium">
          Timezone
        </label>
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
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>SDK tokens</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div role="group" aria-label="Primary ingest token">
          <p className="mb-2 text-sm text-text-muted">
            Use this token to send events from your app.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-bg px-3 py-2 font-mono text-sm">
              {ingestToken}
            </code>
            <CopyButton value={ingestToken} />
          </div>
        </div>

        {/* Listing/creating/rotating/revoking named tokens is an admin-only mutation surface; the
            list endpoint itself is admin-only server-side, so it is only mounted for admins. Every
            member still sees the primary ingest token above, read-only. */}
        {isAdmin && <ManagedTokens projectId={projectId} />}
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

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="token-label" className="mb-1 block text-sm font-medium">
            Label (optional)
          </label>
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
        <div className="rounded-md border border-border bg-bg p-3">
          <p className="mb-2 text-sm text-text-muted">
            Copy this token now — it won&apos;t be shown again in full.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-sm">{newToken}</code>
            <CopyButton value={newToken} />
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
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Ingest tokens</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 font-medium">
                Label
              </th>
              <th scope="col" className="py-2 font-medium">
                Token
              </th>
              <th scope="col" className="py-2 font-medium">
                Created
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.tokens.map((token) => (
              <tr key={token.id} className="border-b border-border">
                <td className="py-2 pr-2">{token.label}</td>
                <td className="py-2 pr-2">
                  <code className="break-all font-mono text-xs">{token.token}</code>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap text-text-muted">
                  {formatDate(token.created_at)}
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setPendingRotate(token)}>
                      Rotate
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setPendingRevokeId(token.id)}>
                      Revoke
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.tokens.length === 0 && <p className="text-text-muted">No tokens.</p>}

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
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>SDK log level</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-muted">
          <span className="mr-2 rounded bg-bg px-1.5 py-0.5 text-xs font-medium text-text">
            SDK-side
          </span>
          Controls how much the MyAmpix SDK logs in your app. It is set in your app&apos;s config, not
          here — there is no server setting to change.
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {LOG_LEVELS.map((level, index) => (
            <span key={level} className="flex items-center gap-1.5">
              <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-xs">{level}</code>
              {index < LOG_LEVELS.length - 1 && <span aria-hidden="true">·</span>}
            </span>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          Ascending verbosity, left to right. Default is <code className="font-mono">none</code>.
        </p>
        <pre className="overflow-x-auto rounded bg-bg px-3 py-2 font-mono text-xs">
          <code>MyAmpixConfig(logLevel: MyAmpixLogLevel.warn)</code>
        </pre>
      </CardContent>
    </Card>
  );
}

// --- 4) Data ------------------------------------------------------------------

function DataSection({
  projectId,
  project,
}: {
  projectId: string;
  project: { id: string; timezone: string; org_name: string } | undefined;
}) {
  const { data: summary, isPending, error } = useEventSummary(projectId);

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
              <p className="text-3xl font-semibold">{summary.total}</p>
            </div>

            {summary.total === 0 ? (
              <p className="text-text-muted">No events yet — send some from your app</p>
            ) : (
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Events by name</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 font-medium">
                      Event
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.by_event.map((row) => (
                    <tr key={row.event} className="border-b border-border">
                      <td className="py-2">{row.event}</td>
                      <td className="py-2">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {project && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border pt-4 text-sm">
            <dt className="text-text-muted">Organization</dt>
            <dd>{project.org_name}</dd>
            <dt className="text-text-muted">Timezone</dt>
            <dd>{project.timezone}</dd>
            <dt className="text-text-muted">Project ID</dt>
            <dd className="break-all font-mono text-xs">{project.id}</dd>
          </dl>
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
    <Card className="max-w-lg border-danger/50">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-text-muted">
            Deleting a project revokes its tokens. Event data already ingested is kept.
          </p>
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
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}
