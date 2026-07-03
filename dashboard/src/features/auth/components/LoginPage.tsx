import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';

export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in to MyAmpMix</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-muted">Login form coming in the next task.</p>
          <p className="mt-4 text-sm text-text-muted">
            No account?{' '}
            <Link to="/signup" className="text-accent underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
