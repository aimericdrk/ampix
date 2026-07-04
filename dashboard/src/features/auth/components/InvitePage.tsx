import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useRouter } from '@tanstack/react-router';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import { ORGS_QUERY_KEY, acceptInvitation, getInvitationPreview } from '../../orgs/api';
import { currentOrgStore } from '../../orgs/store';
import { useAuth } from '../store';

export function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  const { status } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const redirectTarget = `/invite/${token}`;

  const query = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => getInvitationPreview(token),
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: (result) => {
      currentOrgStore.setCurrentOrg(result.org_id);
      // The org list may already be cached from a prior AppLayout mount (browser back/forward);
      // make sure the org switcher reflects the newly-accepted membership either way.
      void queryClient.invalidateQueries({ queryKey: ORGS_QUERY_KEY });
      router.history.push('/projects');
    },
  });

  const problem = query.error instanceof ApiError ? query.error.problem : null;
  const acceptProblem =
    acceptMutation.error instanceof ApiError ? acceptMutation.error.problem : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isPending && <p role="status">Loading invitation…</p>}

          {problem?.status === 404 && (
            <p role="alert" className="text-sm text-danger">
              This invitation link is invalid or does not exist.
            </p>
          )}
          {problem?.status === 410 && (
            <p role="alert" className="text-sm text-danger">
              This invitation has expired or has already been used. Ask an organization admin for a
              new one.
            </p>
          )}
          {problem && problem.status !== 404 && problem.status !== 410 && (
            <p role="alert" className="text-sm text-danger">
              {problem.title}
            </p>
          )}

          {query.data && (
            <>
              <p className="text-sm">
                You&apos;ve been invited to <strong>{query.data.org_name}</strong> as{' '}
                <strong>{query.data.role}</strong>.
              </p>

              {status === 'authenticated' && (
                <>
                  <Button
                    className="w-full"
                    disabled={acceptMutation.isPending}
                    onClick={() => acceptMutation.mutate()}
                  >
                    {acceptMutation.isPending ? 'Accepting…' : 'Accept invitation'}
                  </Button>
                  {acceptProblem && (
                    <p role="alert" className="text-sm text-danger">
                      {acceptProblem.status === 410
                        ? 'This invitation has expired or has already been used.'
                        : acceptProblem.title}
                    </p>
                  )}
                </>
              )}

              {status !== 'authenticated' && (
                <div className="space-y-2">
                  <p className="text-sm text-text-muted">
                    Log in or create an account to accept this invitation.
                  </p>
                  <Link
                    to="/login"
                    search={{ redirect: redirectTarget }}
                    className="block w-full rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-accent-fg hover:opacity-90"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/signup"
                    search={{ redirect: redirectTarget }}
                    className="block w-full rounded-md border border-border bg-surface px-4 py-2 text-center text-sm font-medium hover:bg-bg"
                  >
                    Sign up
                  </Link>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
