import { useParams } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
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

export function OrgSettingsPage() {
  const { orgId } = useParams({ from: '/private/orgs/$orgId/settings' });
  const { data: orgsData } = useOrgs();
  const org = orgsData?.orgs.find((candidate) => candidate.id === orgId);
  const role = useOrgRole(orgId);
  const isAdmin = role === 'admin';

  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{org?.name ?? 'Organization settings'}</h1>
        {role && <p className="text-sm text-text-muted">Your role: {role}</p>}
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <MembersSection orgId={orgId} isAdmin={isAdmin} />
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <InvitationsSection orgId={orgId} />
          </CardContent>
        </Card>
      )}
    </section>
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
        <label htmlFor="org-name" className="mb-1 block text-sm font-medium">
          Name
        </label>
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

  return (
    <>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Organization members</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 font-medium">
              Name
            </th>
            <th scope="col" className="py-2 font-medium">
              Email
            </th>
            <th scope="col" className="py-2 font-medium">
              Role
            </th>
            {isAdmin && (
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data?.members.map((member) => (
            <tr key={member.user.id} className="border-b border-border">
              <td className="py-2">{member.user.name}</td>
              <td className="py-2">{member.user.email}</td>
              <td className="py-2">
                {isAdmin ? (
                  <label>
                    <span className="sr-only">Role for {member.user.name}</span>
                    <select
                      className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
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
                  member.role
                )}
              </td>
              {isAdmin && (
                <td className="py-2 text-right">
                  <Button variant="danger" size="sm" onClick={() => setPendingRemoval(member)}>
                    Remove
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {data?.members.length === 0 && <p className="text-text-muted">No members.</p>}

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
  const [copied, setCopied] = useState(false);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    createInvitation.mutate(
      { role },
      {
        onSuccess: (invitation) => {
          setInviteLink(`${window.location.origin}${invitation.invite_path}`);
          setCopied(false);
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

  const handleCopy = () => {
    if (!inviteLink || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(inviteLink)
      .then(() => setCopied(true))
      .catch(() => {});
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

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <select
            id="invite-role"
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
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
        <div className="rounded-md border border-border bg-bg p-3">
          <p className="mb-2 text-sm text-text-muted">Share this link with the invitee:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all font-mono text-sm">{inviteLink}</code>
            <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
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
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Pending invitations</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 font-medium">
                Role
              </th>
              <th scope="col" className="py-2 font-medium">
                Expires
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.invitations.map((invitation) => (
              <tr key={invitation.id} className="border-b border-border">
                <td className="py-2">{invitation.role}</td>
                <td className="py-2">{new Date(invitation.expires_at).toLocaleDateString()}</td>
                <td className="py-2 text-right">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={revokeInvitation.isPending}
                    onClick={() => handleRevoke(invitation)}
                  >
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.invitations.length === 0 && (
        <p className="text-text-muted">No pending invitations.</p>
      )}
    </div>
  );
}
