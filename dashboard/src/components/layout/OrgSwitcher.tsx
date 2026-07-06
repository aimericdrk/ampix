import { useEffect, useState, type FormEvent } from 'react';
import { useCreateOrg, useOrgs } from '../../features/orgs/api';
import { currentOrgStore, useCurrentOrgId } from '../../features/orgs/store';
import { ApiError } from '../../lib/api/problem';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Menu, MENU_ITEM_CLASS, MenuCheck } from '../ui/menu';
import { useToast } from '../ui/toast';

/** Workspace (org) switcher — a dropdown that lists the caller's orgs and opens
 * the "New organization" dialog from the top of the menu (contracts §13). */
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
  const currentOrg = orgs.find((org) => org.id === currentOrgId);

  return (
    <>
      <Menu
        label="Switch workspace"
        trigger={
          <span className="flex flex-col">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              Workspace
            </span>
            <span className="truncate text-sm font-medium text-text">
              {currentOrg?.name ?? 'Select workspace'}
            </span>
          </span>
        }
      >
        {({ close }) => (
          <>
            <button
              type="button"
              role="menuitem"
              className={cn(MENU_ITEM_CLASS, 'font-medium text-accent')}
              onClick={() => {
                close();
                setDialogOpen(true);
              }}
            >
              <span aria-hidden className="text-base leading-none">
                +
              </span>
              New organization
            </button>

            <div className="my-1 border-t border-border" role="separator" />

            {orgs.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-text-muted">No organizations</p>
            )}
            {orgs.map((org) => {
              const active = org.id === currentOrgId;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="menuitem"
                  aria-current={active ? 'true' : undefined}
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    currentOrgStore.setCurrentOrg(org.id);
                    close();
                  }}
                >
                  <MenuCheck hidden={!active} />
                  <span className={active ? 'truncate font-medium' : 'truncate'}>{org.name}</span>
                </button>
              );
            })}
          </>
        )}
      </Menu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>New organization</DialogTitle>
          <DialogDescription>You become its admin.</DialogDescription>
          <NewOrgForm onCreated={() => setDialogOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
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
