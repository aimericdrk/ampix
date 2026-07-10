import { Link } from '@tanstack/react-router';
import { GlowCard } from '../../../components/ui/glow-card';
import { SignupForm } from './SignupForm';

export function SignupPage() {
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
      <div className="relative flex flex-col items-center gap-6">
        <span className="text-gradient-brand font-display text-2xl font-bold">MyAmpix</span>
        <GlowCard outerClassName="w-full max-w-sm" className="w-full p-8">
          <h1 className="mb-6 text-center font-display text-lg font-semibold">
            Create your MyAmpix account
          </h1>
          <SignupForm />
          <p className="mt-4 text-center text-sm text-text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-text-muted hover:text-accent transition-colors">
              Log in
            </Link>
          </p>
        </GlowCard>
      </div>
    </main>
  );
}
