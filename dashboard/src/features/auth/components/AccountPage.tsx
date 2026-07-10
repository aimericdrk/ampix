import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Reveal } from '../../../components/ui/reveal';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import { changePassword, getMe, ME_QUERY_KEY, updateName } from '../api';

export function AccountPage() {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: getMe });

  return (
    <section className="flex max-w-lg flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold">Account</h1>

      {query.isPending && (
        <div role="status" className="space-y-4">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-danger">
          {query.error instanceof ApiError ? query.error.problem.title : 'Failed to load account'}
        </p>
      )}

      {query.data && (
        <>
          <Reveal index={0}>
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <NameForm currentName={query.data.user.name} email={query.data.user.email} />
              </CardContent>
            </Card>
          </Reveal>

          <Reveal index={1}>
            <Card>
              <CardHeader>
                <CardTitle>Password</CardTitle>
              </CardHeader>
              <CardContent>
                <PasswordForm />
              </CardContent>
            </Card>
          </Reveal>
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
        <Label htmlFor="account-name" className="mb-1 block">
          Display name
        </Label>
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
        <Label htmlFor="current-password" className="mb-1 block">
          Current password
        </Label>
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
        <Label htmlFor="new-password" className="mb-1 block">
          New password
        </Label>
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
