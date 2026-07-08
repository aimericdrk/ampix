import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { SignupForm } from './SignupForm';

export function SignupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your MyAmpix account</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm />
          <p className="mt-4 text-sm text-text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
