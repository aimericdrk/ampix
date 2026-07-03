import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { login } from '../api';
import { validateLogin, type FieldErrors } from '../validation';

export function LoginForm() {
  const router = useRouter();
  const search = useSearch({ from: '/login' });
  const { toast } = useToast();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      router.history.push(search.redirect ?? '/projects');
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

  const inlineError =
    mutation.error instanceof ApiError && mutation.error.problem.status < 500
      ? mutation.error.problem.title
      : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validateLogin(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="login-email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          value={values.email}
          aria-invalid={Boolean(fieldErrors.email)}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
        {fieldErrors.email && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="login-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          aria-invalid={Boolean(fieldErrors.password)}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
        {fieldErrors.password && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.password}
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
