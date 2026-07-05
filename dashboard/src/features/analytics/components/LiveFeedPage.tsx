import { useParams } from '@tanstack/react-router';
import { Button } from '../../../components/ui/button';
import { ApiError } from '../../../lib/api/problem';
import { useLiveEvents } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

export function LiveFeedPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/live' });
  const { data, isPending, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLiveEvents(projectId);

  const events = data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <PageShell
      projectId={projectId}
      title="Live"
      description="Watch events arrive in near real time as your app sends them."
      breadcrumbs={[{ label: 'Audience' }, { label: 'Live' }]}
    >
      {isPending && <p role="status">Loading live events…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load live events'}
        </p>
      )}

      {!isPending && !isError && events.length === 0 && (
        <p className="text-text-muted">No events yet.</p>
      )}

      {events.length > 0 && (
        <>
          <table className="w-full max-w-4xl border-collapse text-left text-sm">
            <caption className="sr-only">Live events, newest first</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 font-medium">
                  Event
                </th>
                <th scope="col" className="py-2 font-medium">
                  User
                </th>
                <th scope="col" className="py-2 font-medium">
                  Time
                </th>
                <th scope="col" className="py-2 font-medium">
                  OS
                </th>
                <th scope="col" className="py-2 font-medium">
                  App version
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.insert_id} className="border-b border-border">
                  <td className="py-2 font-medium">{event.event}</td>
                  <td className="py-2">{event.distinct_id}</td>
                  <td className="py-2">{new Date(event.timestamp).toLocaleString()}</td>
                  <td className="py-2">{event.os}</td>
                  <td className="py-2">{event.app_version}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load older'}
            </Button>
          )}
        </>
      )}
    </PageShell>
  );
}
