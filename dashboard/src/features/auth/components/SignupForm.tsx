import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { signup } from '../api';
import { firstFieldErrors, validateSignup, type FieldErrors } from '../validation';

export function SignupForm() {
  const router = useRouter();
  const search = useSearch({ from: '/signup' });
  const { toast } = useToast();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: () => {
      // Invite-accept (contracts §13) sends unauthenticated visitors here with
      // ?redirect=/invite/<token>; everyone else lands on /projects as before.
      router.history.push(search.redirect ?? '/projects');
    },
    onError: (error: Error) => {
      if (!(error instanceof ApiError) || error.problem.status >= 500) {
        toast({
          title: 'Signup failed',
          description: 'Something went wrong. Please try again.',
          variant: 'error',
        });
      }
    },
  });

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
    const errors = validateSignup(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="signup-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <Input
          id="signup-name"
          autoComplete="name"
          value={values.name}
          aria-invalid={Boolean(visibleErrors.name)}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
        {visibleErrors.name && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {visibleErrors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="signup-email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input
          id="signup-email"
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
        <label htmlFor="signup-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
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
        {mutation.isPending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
