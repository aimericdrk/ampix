import { Link } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Globe, Users, type LucideIcon } from 'lucide-react';
import type { ProjectRole } from '../../../lib/api/types';
import { Badge, type BadgeProps } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
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
import { toIso3, iso3Name } from '../../analytics/geo/country-codes';
import { useCreateProject, useProjects, useProjectStats } from '../api';

/** Your role in a project → badge colour, so the most privileged rows read at a glance. */
const ROLE_VARIANT: Record<ProjectRole, BadgeProps['variant']> = {
  owner: 'accent',
  admin: 'info',
  analyst: 'default',
  viewer: 'outline',
};

/** Friendly country label from a raw `country` super-property value ('US' → 'United States…'). */
function countryLabel(raw: string): string {
  const iso3 = toIso3(raw);
  return iso3 ? iso3Name(iso3) : raw;
}

/** A headline metric on a project row: an accent-tinted icon, the value, and a micro-label. */
function StatCell({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-base font-semibold tabular-nums">{value}</div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const { data, isPending, error } = useProjects();
  const stats = useProjectStats();
  const statByProject = new Map((stats.data?.stats ?? []).map((s) => [s.project_id, s]));
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
      {/* One project per full-width row, with enough detail to tell them apart. */}
      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <Link
            key={project.id}
            to="/projects/$projectId/home"
            params={{ projectId: project.id }}
            className="block rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Card className="transition-colors hover:border-accent">
              <CardContent className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
                {/* Identity: name + your access, then the id and where/when it lives. */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-lg font-semibold">{project.name}</span>
                    <Badge variant={ROLE_VARIANT[project.role]} className="capitalize">
                      {project.role}
                    </Badge>
                    {project.integrations?.revenuecat && (
                      <Badge variant="success">RevenueCat</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 truncate font-mono text-xs text-text-muted">{project.id}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                    <span>{project.org_name}</span>
                    <span aria-hidden>·</span>
                    <span>{project.timezone}</span>
                  </div>
                </div>

                {/* Headline metrics. */}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  <StatCell
                    icon={Users}
                    label="Users"
                    value={
                      stats.isPending
                        ? '…'
                        : (statByProject.get(project.id)?.user_count ?? 0).toLocaleString()
                    }
                  />
                  <StatCell
                    icon={Globe}
                    label="Top country"
                    value={
                      stats.isPending
                        ? '…'
                        : (() => {
                            const top = statByProject.get(project.id)?.top_country;
                            return top ? countryLabel(top) : '—';
                          })()
                    }
                  />
                </div>
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
