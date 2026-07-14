import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { isMfaRequired } from '../../../lib/api/types';
import { login } from '../api';
import { firstFieldErrors, validateLogin, type FieldErrors } from '../validation';
import { TwoFactorChallengeForm } from './TwoFactorChallengeForm';

export function LoginForm() {
  const router = useRouter();
  const search = useSearch({ from: '/login' });
  const { toast } = useToast();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // 2FA step-up only — kept in component state, never persisted (contracts §11:
  // mfa_token must not outlive this screen in localStorage/sessionStorage).
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const goToDestination = () => router.history.push(search.redirect ?? '/projects');

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (response) => {
      if (isMfaRequired(response)) {
        setMfaToken(response.mfa_token);
        return;
      }
      goToDestination();
    },
    onError: (error: Error) => {
      // 4xx problems render inline below; unexpected failures get a toast.
      if (!(error instanceof ApiError) || error.problem.status >= 500) {
        toast({
          title: 'Login failed',
          description: 'Something went wrong. Please try again.',
          variant: 'error',
        });
      }
    },
  });

  if (mfaToken) {
    return <TwoFactorChallengeForm mfaToken={mfaToken} onVerified={goToDestination} />;
  }

  const problem =
    mutation.error instanceof ApiError && mutation.error.problem.status < 500
      ? mutation.error.problem
      : null;
  // Server-side per-field messages (problem.errors) render at the fields, like
  // client validation; a problem with no field mapping keeps the title banner.
  const serverFieldErrors = firstFieldErrors(problem?.errors);
  const visibleErrors: FieldErrors = { ...fieldErrors, ...serverFieldErrors };
  const inlineError = problem && Object.keys(serverFieldErrors).length === 0 ? problem.title : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateLogin(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div>
        <Label htmlFor="login-email" className="mb-1 block">
          Email
        </Label>
        <Input
          id="login-email"
          className="h-11"
          type="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(visibleErrors.email)}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
        {visibleErrors.email && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {visibleErrors.email}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="login-password" className="mb-1 block">
          Password
        </Label>
        <Input
          id="login-password"
          className="h-11"
          type="password"
          autoComplete="current-password"
          value={values.password}
          aria-invalid={Boolean(visibleErrors.password)}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
        {visibleErrors.password && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {visibleErrors.password}
          </p>
        )}
      </div>
      {inlineError && (
        <p role="alert" className="text-sm text-danger">
          {inlineError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  );
}
