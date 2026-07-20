import { useState, type FormEvent } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api/problem';
import { useProjectRole, useProjects } from '../../projects/api';
import {
  useCreateRcEntitlement,
  useDeleteRcEntitlement,
  useRcEntitlements,
  useUpdateRcEntitlement,
  type RcEntitlement,
} from '../catalog-api';

/** Renders an `ApiError`'s problem detail (falling back to its title) so a failed dialog submit
 *  shows the server's actual reason inline and keeps the dialog open (design §4); any other error
 *  keeps a generic fallback. */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

/**
 * MyRevenueCat → Entitlements (design §3.1). The simplest of the three catalog config pages: a flat
 * list of the project's entitlements with admin-gated create/edit/delete. Mirrors RcChartsPage's
 * gating discipline (don't decide "not connected" until `useProjects()` has resolved) and
 * `ProjectMembersSection`'s DataTable + controlled-dialog CRUD pattern.
 */
export function RcEntitlementsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/entitlements' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  // Don't mount the catalog hooks below until `useProjects()` has resolved, or a still-loading
  // flag briefly flashes an empty shell.
  if (!project) {
    return (
      <PageShell
        projectId={projectId}
        title="Entitlements"
        description="The access levels your products grant, and who currently holds them."
        breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Entitlements' }]}
      >
        {null}
      </PageShell>
    );
  }

  return <EntitlementsManager projectId={projectId} />;
}

function EntitlementsManager({ projectId }: { projectId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const [createOpen, setCreateOpen] = useState(false);
  const [createIdentifier, setCreateIdentifier] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [editing, setEditing] = useState<RcEntitlement | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [deleting, setDeleting] = useState<RcEntitlement | null>(null);

  const entitlementsQuery = useRcEntitlements(projectId);
  const createEntitlement = useCreateRcEntitlement(projectId);
  const updateEntitlement = useUpdateRcEntitlement(projectId);
  const deleteEntitlement = useDeleteRcEntitlement(projectId);

  const entitlements = entitlementsQuery.data ?? [];

  const openEdit = (entitlement: RcEntitlement) => {
    updateEntitlement.reset();
    setEditDisplayName(entitlement.displayName);
    setEditing(entitlement);
  };

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    const identifier = createIdentifier.trim();
    const displayName = createDisplayName.trim();
    if (!identifier || !displayName) return;
    createEntitlement.mutate(
      { identifier, displayName },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setCreateIdentifier('');
          setCreateDisplayName('');
        },
      },
    );
  };

  const handleEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const displayName = editDisplayName.trim();
    if (!displayName) return;
    updateEntitlement.mutate({ id: editing.id, displayName }, { onSuccess: () => setEditing(null) });
  };

  const columns: Array<DataTableColumn<RcEntitlement>> = [
    { key: 'identifier', header: 'Identifier', sortable: true },
    { key: 'displayName', header: 'Display name', sortable: true },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (entitlement: RcEntitlement) => (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => openEdit(entitlement)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteEntitlement.reset();
                    setDeleting(entitlement);
                  }}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <PageShell
      projectId={projectId}
      title="Entitlements"
      description="The access levels your products grant, and who currently holds them."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Entitlements' }]}
      actions={
        canManage ? (
          <Button
            onClick={() => {
              createEntitlement.reset();
              setCreateOpen(true);
            }}
          >
            New entitlement
          </Button>
        ) : undefined
      }
    >
      {entitlementsQuery.isPending && <p role="status">Loading entitlements…</p>}
      {entitlementsQuery.isError && (
        <p role="alert" className="text-danger">
          {apiErrorMessage(entitlementsQuery.error, 'Could not load entitlements.')}
        </p>
      )}
      {!entitlementsQuery.isPending &&
        !entitlementsQuery.isError &&
        (entitlements.length > 0 ? (
          <DataTable
            caption="RevenueCat entitlements"
            columns={columns}
            rows={entitlements}
            rowKey={(entitlement) => entitlement.id}
          />
        ) : (
          <EmptyState
            title="No entitlements yet."
            description={
              canManage
                ? 'Create your first entitlement to grant access to your products.'
                : 'No entitlements have been created for this project yet.'
            }
          />
        ))}

      {canManage && (
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              setCreateIdentifier('');
              setCreateDisplayName('');
              createEntitlement.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>New entitlement</DialogTitle>
            <DialogDescription>
              Entitlements are the access levels your products grant.
            </DialogDescription>
            <form onSubmit={handleCreateSubmit} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="new-entitlement-identifier" className="mb-1 block">
                  Identifier
                </Label>
                <Input
                  id="new-entitlement-identifier"
                  value={createIdentifier}
                  onChange={(event) => setCreateIdentifier(event.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="new-entitlement-display-name" className="mb-1 block">
                  Display name
                </Label>
                <Input
                  id="new-entitlement-display-name"
                  value={createDisplayName}
                  onChange={(event) => setCreateDisplayName(event.target.value)}
                  required
                />
              </div>
              {createEntitlement.isError && (
                <p role="alert" className="text-sm text-danger">
                  {apiErrorMessage(createEntitlement.error, 'Could not create entitlement.')}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateIdentifier('');
                    setCreateDisplayName('');
                    createEntitlement.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createEntitlement.isPending}>
                  {createEntitlement.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              updateEntitlement.reset();
            }
          }}
        >
          <DialogContent>
            <DialogTitle>Edit entitlement</DialogTitle>
            <DialogDescription>
              The identifier is immutable once created; only the display name can change.
            </DialogDescription>
            <form onSubmit={handleEditSubmit} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="edit-entitlement-identifier" className="mb-1 block">
                  Identifier
                </Label>
                <Input id="edit-entitlement-identifier" value={editing?.identifier ?? ''} disabled readOnly />
              </div>
              <div>
                <Label htmlFor="edit-entitlement-display-name" className="mb-1 block">
                  Display name
                </Label>
                <Input
                  id="edit-entitlement-display-name"
                  value={editDisplayName}
                  onChange={(event) => setEditDisplayName(event.target.value)}
                  required
                />
              </div>
              {updateEntitlement.isError && (
                <p role="alert" className="text-sm text-danger">
                  {apiErrorMessage(updateEntitlement.error, 'Could not update entitlement.')}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    updateEntitlement.reset();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateEntitlement.isPending}>
                  {updateEntitlement.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <AlertDialog
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(null);
              deleteEntitlement.reset();
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogTitle>Delete this entitlement?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `"${deleting.displayName}" (${deleting.identifier}) will no longer be grantable by any product. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
            {deleteEntitlement.isError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {apiErrorMessage(deleteEntitlement.error, 'Could not delete entitlement.')}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="secondary">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="danger"
                  disabled={deleteEntitlement.isPending}
                  onClick={(event) => {
                    // Prevent Radix's default auto-close so a failed delete keeps the dialog open
                    // with the inline error visible (design §4); we close it manually on success.
                    event.preventDefault();
                    if (!deleting) return;
                    deleteEntitlement.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
                  }}
                >
                  {deleteEntitlement.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageShell>
  );
}
