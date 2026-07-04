import { Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useCreateOrg, useOrgs } from '../../features/orgs/api';
import { currentOrgStore, useCurrentOrgId } from '../../features/orgs/store';
import { ApiError } from '../../lib/api/problem';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { useToast } from '../ui/toast';

/** Org context switcher + "New organization" action (contracts §13). */
export function OrgSwitcher() {
  const { data, isPending, error } = useOrgs();
  const currentOrgId = useCurrentOrgId();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Keep the selection valid: default to the first org, and re-pick if the
  // persisted id belongs to a different user (or was removed). Keyed only on
  // `data` (not `currentOrgId`) so this doesn't fight an explicit selection
  // (e.g. just-created org) made while this fetch/refetch is still in flight.
  useEffect(() => {
    if (!data) return;
    const stillValid = data.orgs.some((org) => org.id === currentOrgStore.getState());
    if (stillValid) return;
    currentOrgStore.setCurrentOrg(data.orgs[0]?.id ?? null);
  }, [data]);

  if (isPending) return <p className="text-sm text-text-muted">Loading organizations…</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error instanceof ApiError ? error.problem.title : 'Failed to load organizations'}
      </p>
    );
  }

  const orgs = data?.orgs ?? [];

  return (
    <div className="space-y-2">
      <label htmlFor="org-switcher" className="sr-only">
        Organization
      </label>
      <select
        id="org-switcher"
        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
        value={currentOrgId ?? ''}
        onChange={(e) => currentOrgStore.setCurrentOrg(e.target.value || null)}
      >
        {orgs.length === 0 && <option value="">No organizations</option>}
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>

      {currentOrgId && (
        <Link
          to="/orgs/$orgId/settings"
          params={{ orgId: currentOrgId }}
          className="block text-xs text-accent underline"
        >
          Organization settings
        </Link>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" className="w-full">
            New organization
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>You become its admin.</DialogDescription>
          <NewOrgForm onCreated={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewOrgForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const { toast } = useToast();
  const createOrg = useCreateOrg();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    createOrg.mutate(
      { name: name.trim() },
      {
        onSuccess: (org) => {
          currentOrgStore.setCurrentOrg(org.id);
          toast({ title: 'Organization created' });
          setName('');
          onCreated();
        },
      },
    );
  };

  const problem = createOrg.error instanceof ApiError ? createOrg.error.problem : null;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="new-org-name" className="mb-1 block text-sm font-medium">
          Organization name
        </label>
        <Input
          id="new-org-name"
          value={name}
          aria-invalid={Boolean(problem)}
          onChange={(e) => {
            setName(e.target.value);
            createOrg.reset();
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem.title}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={createOrg.isPending || !name.trim()}>
        {createOrg.isPending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
