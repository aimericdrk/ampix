import { Link } from '@tanstack/react-router';
import { useSignupEnabled } from '../useSignupEnabled';
import { GlowCard } from '../../../components/ui/glow-card';
import { LoginForm } from './LoginForm';

export function LoginPage() {
  const signupEnabled = useSignupEnabled();
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 size-96 -translate-x-1/3 -translate-y-1/3 rounded-full bg-gradient-brand opacity-[0.07] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-0 size-96 translate-x-1/3 translate-y-1/3 rounded-full bg-gradient-brand opacity-[0.07] blur-3xl"
      />
      <div className="relative flex w-full max-w-2xl flex-col items-center gap-6">
        <span className="text-gradient-brand font-display text-2xl font-bold">MyAmpix</span>
        <GlowCard outerClassName="w-full" className="w-full p-10 sm:p-12">
          <h1 className="mb-8 text-center font-display text-2xl font-semibold">
            Log in to MyAmpix
          </h1>
          <LoginForm />
          {signupEnabled !== false ? (
            <p className="mt-4 text-center text-sm text-text-muted">
              No account?{' '}
              <Link to="/signup" className="text-text-muted hover:text-accent transition-colors">
                Sign up
              </Link>
            </p>
          ) : null}
        </GlowCard>
      </div>
    </main>
  );
}
