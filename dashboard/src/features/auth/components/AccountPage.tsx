import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { changePassword, getMe, ME_QUERY_KEY, updateName } from '../api';

export function AccountPage() {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: getMe });

  return (
    <section className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Account</h1>

      {query.isPending && <p role="status">Loading…</p>}
      {query.error && (
        <p role="alert" className="text-danger">
          {query.error instanceof ApiError ? query.error.problem.title : 'Failed to load account'}
        </p>
      )}

      {query.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <NameForm currentName={query.data.user.name} email={query.data.user.email} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function NameForm({ currentName, email }: { currentName: string; email: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);

  // Keep the field in sync if the query refetches with a different value.
  useEffect(() => setName(currentName), [currentName]);

  const mutation = useMutation({
    mutationFn: () => updateName({ name: name.trim() }),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_QUERY_KEY, (previous: unknown) =>
        previous && typeof previous === 'object' ? { ...previous, user } : previous,
      );
      toast({ title: 'Name updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update name',
        description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <span className="mb-1 block text-sm font-medium">Email</span>
        <p className="text-sm text-text-muted">{email}</p>
      </div>
      <div>
        <label htmlFor="account-name" className="mb-1 block text-sm font-medium">
          Display name
        </label>
        <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button type="submit" disabled={mutation.isPending || !name.trim()}>
        {mutation.isPending ? 'Saving…' : 'Save name'}
      </Button>
    </form>
  );
}

function PasswordForm() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      toast({ title: 'Password updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update password',
        description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
        variant: 'error',
      });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.reset();
    if (newPassword.length < 8) {
      setValidationError('New password must be at least 8 characters');
      return;
    }
    setValidationError(null);
    mutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="current-password" className="mb-1 block text-sm font-medium">
          Current password
        </label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            mutation.reset();
          }}
        />
      </div>
      <div>
        <label htmlFor="new-password" className="mb-1 block text-sm font-medium">
          New password
        </label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(validationError)}
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setValidationError(null);
            mutation.reset();
          }}
        />
      </div>
      {validationError && (
        <p role="alert" className="text-sm text-danger">
          {validationError}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending || !currentPassword || !newPassword}>
        {mutation.isPending ? 'Updating…' : 'Change password'}
      </Button>
    </form>
  );
}
