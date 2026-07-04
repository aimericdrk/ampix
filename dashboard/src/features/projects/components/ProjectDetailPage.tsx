import { Link, useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import { useEventSummary, useProjects } from '../api';

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);
  const { data: summary, isPending, error } = useEventSummary(projectId);

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link to="/projects" className="text-sm text-accent underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{project?.name ?? 'Project'}</h1>
        {project && <p className="text-sm text-text-muted">{project.org_name}</p>}
      </div>

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
    </section>
  );
}
