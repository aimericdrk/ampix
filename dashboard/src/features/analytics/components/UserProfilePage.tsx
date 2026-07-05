import { useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import { formatExactNumber } from '../format';
import { useUserProfile } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

export function UserProfilePage() {
  const { projectId, distinctId } = useParams({
    from: '/private/projects/$projectId/users/$distinctId',
  });
  const { data, isPending, isError, error } = useUserProfile(projectId, distinctId);

  return (
    <PageShell
      projectId={projectId}
      title={distinctId}
      breadcrumbs={[
        { label: 'Users', to: '/projects/$projectId/users', params: { projectId } },
        { label: distinctId },
      ]}
    >
      {isPending && <p role="status">Loading user profile…</p>}
      {isError && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load user profile'}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">First seen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">
                  {new Date(data.first_seen).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">Last seen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">
                  {new Date(data.last_seen).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-text-muted">Event count</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-semibold">{formatExactNumber(data.event_count)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Profile properties</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(data.profile).length === 0 ? (
                <p className="text-text-muted">No profile properties.</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {Object.entries(data.profile).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="font-medium text-text-muted">{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recent_events.length === 0 ? (
                <p className="text-text-muted">No recent events.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {data.recent_events.map((event) => (
                    <li
                      key={event.insert_id}
                      className="flex justify-between gap-4 border-b border-border pb-2"
                    >
                      <span className="font-medium">{event.event}</span>
                      <span className="text-text-muted">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
