import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { LoginForm } from './LoginForm';

export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in to MyAmpix</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
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
