import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { signup } from '../api';
import { validateSignup, type FieldErrors } from '../validation';

export function SignupForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: signup,
    onSuccess: () => {
      router.history.push('/projects');
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

  const inlineError =
    mutation.error instanceof ApiError && mutation.error.problem.status < 500
      ? mutation.error.problem.title
      : null;

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
          aria-invalid={Boolean(fieldErrors.name)}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
        {fieldErrors.name && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {fieldErrors.name}
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
        <label htmlFor="signup-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
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
        {mutation.isPending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
