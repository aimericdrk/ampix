import { useParams } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">
            Invitation acceptance ships with the Auth &amp; Tenancy milestone. Your invite token{' '}
            <code className="rounded bg-bg px-1">{token}</code> was recognised — check back soon.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
