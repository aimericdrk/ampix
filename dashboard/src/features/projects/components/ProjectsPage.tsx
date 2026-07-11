import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { useOrgRole } from '../../orgs/api';
import { useCurrentOrgId } from '../../orgs/store';
import { ApiError } from '../../../lib/api/problem';
import { useCreateProject, useProjects } from '../api';

export function ProjectsPage() {
  const { data, isPending, error } = useProjects();
  const currentOrgId = useCurrentOrgId();
  const role = useOrgRole(currentOrgId ?? undefined);
  const canCreate = role === 'admin' || role === 'owner';
  const [dialogOpen, setDialogOpen] = useState(false);

  // `GET /projects` returns every project across ALL the user's orgs (each
  // tagged with `org_id`); scope the list to the selected org so switching
  // organizations actually changes what's shown. Before an org is resolved
  // (transient null) show everything rather than an empty grid.
  const projects = (data?.projects ?? []).filter(
    (project) => currentOrgId === null || project.org_id === currentOrgId,
  );

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        {currentOrgId && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                disabled={!canCreate}
                title={canCreate ? undefined : 'Only organization admins can create projects'}
              >
                New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>Creates a project with a fresh ingest token.</DialogDescription>
              <NewProjectForm orgId={currentOrgId} onCreated={() => setDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>
      {isPending && <p role="status">Loading projects…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load projects'}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {projects.map((project) => (
          <Link
            key={project.id}
            to="/projects/$projectId"
            params={{ projectId: project.id }}
            className="rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Card className="h-full transition-colors hover:border-accent">
              <CardHeader>
                <CardTitle>{project.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-muted">Timezone: {project.timezone}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {data && projects.length === 0 && (
        <p className="text-text-muted">No projects in this organization yet.</p>
      )}
    </section>
  );
}

function NewProjectForm({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const createProject = useCreateProject(orgId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createProject.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          toast({ title: 'Project created' });
          setName('');
          onCreated();
        },
        onError: (error) =>
          toast({
            title: 'Could not create project',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  const problem = createProject.error instanceof ApiError ? createProject.error.problem : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="new-project-name" className="mb-1 block text-sm font-medium">
          Project name
        </label>
        <Input
          id="new-project-name"
          value={name}
          aria-invalid={Boolean(problem)}
          onChange={(e) => {
            setName(e.target.value);
            createProject.reset();
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem.title}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={createProject.isPending || !name.trim()}>
        {createProject.isPending ? 'Creating…' : 'Create project'}
      </Button>
    </form>
  );
}
