import { useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge, type BadgeProps } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { fieldLook, Input } from '../../../components/ui/input';
import { IconButton } from '../../../components/ui/icon-button';
import { Label } from '../../../components/ui/label';
import { Reveal } from '../../../components/ui/reveal';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import { ORG_ROLES, type Invitation, type OrgMember, type OrgRole } from '../../../lib/api/types';
import {
  useCreateInvitation,
  useInvitations,
  useMembers,
  useOrgRole,
  useOrgs,
  useRemoveMember,
  useRenameOrg,
  useRevokeInvitation,
  useUpdateMemberRole,
} from '../api';

/** Role → Badge variant, roughly by privilege level (admin highest, viewer lowest). */
function roleBadgeVariant(role: OrgRole): BadgeProps['variant'] {
  if (role === 'admin') return 'accent';
  if (role === 'analyst') return 'info';
  return 'default';
}

/** A Copy icon-button that briefly flips to a check mark — reused for the invite link. */
function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <IconButton
      variant="secondary"
      size="sm"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={handleCopy}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </IconButton>
  );
}

export function OrgSettingsPage() {
  const { orgId } = useParams({ from: '/private/orgs/$orgId/settings' });
  const { data: orgsData } = useOrgs();
  const org = orgsData?.orgs.find((candidate) => candidate.id === orgId);
  const role = useOrgRole(orgId);
  const isAdmin = role === 'admin';

  return (
    <PageShell
      title={org?.name ?? 'Organization settings'}
      description={role ? `Your role: ${role}` : undefined}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal index={0}>
          <Card>
            <CardHeader>
              <CardTitle>Organization name</CardTitle>
            </CardHeader>
            <CardContent>
              {org ? (
                <RenameOrgForm orgId={orgId} currentName={org.name} disabled={!isAdmin} />
              ) : (
                <p role="status">Loading…</p>
              )}
            </CardContent>
          </Card>
        </Reveal>

        <Reveal index={1} className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              <MembersSection orgId={orgId} isAdmin={isAdmin} />
            </CardContent>
          </Card>
        </Reveal>

        {isAdmin && (
          <Reveal index={2} className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Invitations</CardTitle>
              </CardHeader>
              <CardContent>
                <InvitationsSection orgId={orgId} />
              </CardContent>
            </Card>
          </Reveal>
        )}
      </div>
    </PageShell>
  );
}

function RenameOrgForm({
  orgId,
  currentName,
  disabled,
}: {
  orgId: string;
  currentName: string;
  disabled: boolean;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(currentName);
  useEffect(() => setName(currentName), [currentName]);
  const mutation = useRenameOrg(orgId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || disabled) return;
    mutation.mutate(
      { name: name.trim() },
      {
        onSuccess: () => toast({ title: 'Organization renamed' }),
        onError: (error) =>
          toast({
            title: 'Could not rename organization',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex items-end gap-2">
      <div className="flex-1">
        <Label htmlFor="org-name" className="mb-1 block">
          Name
        </Label>
        <Input
          id="org-name"
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={disabled || mutation.isPending || !name.trim()}>
        {mutation.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

function MembersSection({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const { data, isPending, error } = useMembers(orgId);
  const { toast } = useToast();
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);
  const [pendingRemoval, setPendingRemoval] = useState<OrgMember | null>(null);

  if (isPending) return <p role="status">Loading members…</p>;
  if (error) {
    return (
      <p role="alert" className="text-danger">
        {error instanceof ApiError ? error.problem.title : 'Failed to load members'}
      </p>
    );
  }

  const handleRoleChange = (member: OrgMember, role: OrgRole) => {
    updateRole.mutate(
      { userId: member.user.id, role },
      {
        onError: (mutationError) => {
          const problem = mutationError instanceof ApiError ? mutationError.problem : null;
          toast({
            title:
              problem?.status === 409
                ? "Can't change the last admin's role"
                : 'Could not update role',
            description: problem?.title,
            variant: 'error',
          });
        },
      },
    );
  };

  const handleRemove = (member: OrgMember) => {
    removeMember.mutate(member.user.id, {
      onSuccess: () => setPendingRemoval(null),
      onError: (mutationError) => {
        const problem = mutationError instanceof ApiError ? mutationError.problem : null;
        setPendingRemoval(null);
        toast({
          title:
            problem?.status === 409 ? "Can't remove the last admin" : 'Could not remove member',
          description: problem?.title,
          variant: 'error',
        });
      },
    });
  };

  const columns: Array<DataTableColumn<OrgMember>> = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: (member) => member.user.name,
      render: (member) => member.user.name,
    },
    { key: 'email', header: 'Email', render: (member) => member.user.email },
    {
      key: 'role',
      header: 'Role',
      render: (member) =>
        isAdmin ? (
          <label>
            <span className="sr-only">Role for {member.user.name}</span>
            <select
              className={cn(fieldLook, 'h-8 w-auto px-2 text-sm')}
              value={member.role}
              onChange={(e) => handleRoleChange(member, e.target.value as OrgRole)}
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
        ),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (member: OrgMember) => (
              <div className="flex justify-end">
                <Button variant="danger" size="sm" onClick={() => setPendingRemoval(member)}>
                  Remove
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      {data && data.members.length > 0 && (
        <DataTable
          caption="Organization members"
          columns={columns}
          rows={data.members}
          rowKey={(member) => member.user.id}
        />
      )}
      {data?.members.length === 0 && <EmptyState title="No members." />}

      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <DialogContent>
          <DialogTitle>Remove member</DialogTitle>
          <DialogDescription>
            Remove {pendingRemoval?.user.name} ({pendingRemoval?.user.email}) from this
            organization? They will lose access immediately.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={removeMember.isPending}
              onClick={() => pendingRemoval && handleRemove(pendingRemoval)}
            >
              {removeMember.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvitationsSection({ orgId }: { orgId: string }) {
  const { data, isPending, error } = useInvitations(orgId);
  const createInvitation = useCreateInvitation(orgId);
  const revokeInvitation = useRevokeInvitation(orgId);
  const { toast } = useToast();
  const [role, setRole] = useState<OrgRole>('analyst');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createInvitation.mutate(
      { role },
      {
        onSuccess: (invitation) => {
          setInviteLink(`${window.location.origin}${invitation.invite_path}`);
        },
        onError: (mutationError) => {
          toast({
            title: 'Could not create invitation',
            description:
              mutationError instanceof ApiError ? mutationError.problem.title : undefined,
            variant: 'error',
          });
        },
      },
    );
  };

  const handleRevoke = (invitation: Invitation) => {
    revokeInvitation.mutate(invitation.id, {
      onError: (mutationError) => {
        toast({
          title: 'Could not revoke invitation',
          description: mutationError instanceof ApiError ? mutationError.problem.title : undefined,
          variant: 'error',
        });
      },
    });
  };

  const columns: Array<DataTableColumn<Invitation>> = [
    {
      key: 'role',
      header: 'Role',
      render: (invitation) => <Badge variant={roleBadgeVariant(invitation.role)}>{invitation.role}</Badge>,
    },
    {
      key: 'expires_at',
      header: 'Expires',
      sortable: true,
      render: (invitation) => new Date(invitation.expires_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (invitation) => (
        <div className="flex justify-end">
          <Button
            variant="danger"
            size="sm"
            disabled={revokeInvitation.isPending}
            onClick={() => handleRevoke(invitation)}
          >
            Revoke
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div>
          <Label htmlFor="invite-role" className="mb-1 block">
            Role
          </Label>
          <select
            id="invite-role"
            className={cn(fieldLook, 'h-9 w-auto px-2 text-sm')}
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={createInvitation.isPending}>
          {createInvitation.isPending ? 'Creating…' : 'Create invite link'}
        </Button>
      </form>

      {inviteLink && (
        <div className="space-y-2 rounded-lg border border-border bg-bg p-3">
          <p className="text-sm text-text-muted">Share this link with the invitee:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs">
              {inviteLink}
            </code>
            <CopyIconButton value={inviteLink} label="invite link" />
          </div>
        </div>
      )}

      {isPending && <p role="status">Loading invitations…</p>}
      {error && (
        <p role="alert" className="text-danger">
          {error instanceof ApiError ? error.problem.title : 'Failed to load invitations'}
        </p>
      )}

      {data && data.invitations.length > 0 && (
        <DataTable
          caption="Pending invitations"
          columns={columns}
          rows={data.invitations}
          rowKey={(invitation) => invitation.id}
        />
      )}
      {data && data.invitations.length === 0 && <EmptyState title="No pending invitations." />}
    </div>
  );
}
