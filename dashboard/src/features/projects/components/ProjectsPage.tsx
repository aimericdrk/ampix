import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import { useProjects } from '../api';

export function ProjectsPage() {
  const { data, isPending, error } = useProjects();

  return (
    <section>
      <h1 className="mb-6 text-2xl font-semibold">Projects</h1>
      {isPending && <p role="status">Loading projects…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load projects'}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {data?.projects.map((project) => (
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
      {data && data.projects.length === 0 && <p className="text-text-muted">No projects yet.</p>}
    </section>
  );
}
