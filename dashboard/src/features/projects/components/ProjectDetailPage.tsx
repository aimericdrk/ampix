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

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId' });
  const router = useRouter();
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { data: summary, isPending, error } = useEventSummary(projectId);
  const role = useOrgRole(project?.org_id);
  const isAdmin = role === 'admin';

  return (
    <PageShell
      title={project?.name ?? 'Project'}
      description={project?.org_name}
      breadcrumbs={[
        { label: 'Projects', to: '/projects' },
        { label: project?.name ?? 'Project' },
      ]}
    >
      {project && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Ingest token</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-text-muted">
              Use this token to send events from your app.
            </p>
            <code className="block break-all rounded bg-bg px-3 py-2 font-mono text-sm">
              {project.ingest_token}
            </code>
          </CardContent>
        </Card>
      )}

      {isPending && <p role="status">Loading event summary…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load event summary'}
        </p>
      )}

      {summary && (
        <>
          <Card className="max-w-xs">
            <CardHeader>
              <CardTitle>Total events</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{summary.total}</p>
            </CardContent>
          </Card>

          {summary.total === 0 ? (
            <p className="text-text-muted">No events yet — send some from your app</p>
          ) : (
            <table className="w-full max-w-lg border-collapse text-left text-sm">
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
        </>
      )}

      {project && isAdmin && (
        <SettingsArea
          projectId={project.id}
          currentName={project.name}
          currentTimezone={project.timezone}
          onDeleted={() => router.history.push('/projects')}
        />
      )}
    </PageShell>
  );
}

function SettingsArea({
  projectId,
  currentName,
  currentTimezone,
  onDeleted,
}: {
  projectId: string;
  currentName: string;
  currentTimezone: string;
  onDeleted: () => void;
}) {
  return (
    <section className="flex flex-col gap-6 border-t border-border pt-6">
      <h2 className="text-xl font-semibold">Settings</h2>
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

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Tokens</CardTitle>
        </CardHeader>
        <CardContent>
          <TokensSection projectId={projectId} />
        </CardContent>
      </Card>

      <Card className="max-w-lg border-danger/50">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <DeleteProjectSection projectId={projectId} onDeleted={onDeleted} />
        </CardContent>
      </Card>
    </section>
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

function TokensSection({ projectId }: { projectId: string }) {
  const { data, isPending, error } = useTokens(projectId);
  const createToken = useCreateToken(projectId);
  const revokeToken = useRevokeToken(projectId);
  const { toast } = useToast();
  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createToken.mutate(
      { label: label.trim() || undefined },
      {
        onSuccess: (token) => {
          setNewToken(token.token);
          setCopied(false);
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

  const handleCopy = () => {
    if (!newToken || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(newToken)
      .then(() => setCopied(true))
      .catch(() => {});
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
            <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {isPending && <p role="status">Loading tokens…</p>}
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
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.tokens.map((token) => (
              <tr key={token.id} className="border-b border-border">
                <td className="py-2">{token.label}</td>
                <td className="py-2">
                  <code className="break-all font-mono text-xs">{token.token}</code>
                </td>
                <td className="py-2 text-right">
                  <Button variant="danger" size="sm" onClick={() => setPendingRevokeId(token.id)}>
                    Revoke
                  </Button>
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
    </div>
  );
}

function DeleteProjectSection({
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
    <div className="flex items-center justify-between">
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
  );
}
