import { useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import { Badge, type BadgeProps } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../components/ui/dialog';
import { EmptyState } from '../../../components/ui/empty-state';
import { fieldLook } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Separator } from '../../../components/ui/separator';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import { PROJECT_ROLES, type ProjectMember, type ProjectRole } from '../../../lib/api/types';
import { useMembers } from '../../orgs/api';
import { useAuth } from '../../auth/store';
import {
  useAddProjectMember,
  useProjectMembers,
  useProjectRole,
  useRemoveProjectMember,
  useUpdateProjectMemberRole,
} from '../api';

/** Role → Badge variant, roughly by privilege level (owner highest, viewer lowest). */
function roleBadgeVariant(role: ProjectRole): BadgeProps['variant'] {
  if (role === 'owner') return 'accent';
  if (role === 'admin') return 'info';
  if (role === 'analyst') return 'default';
  return 'outline';
}

/**
 * Project members section (mirrors OrgSettingsPage's MembersSection). Management is gated on the
 * caller's project role: owner/admin get the full editing surface, analyst/viewer get a read-only
 * list — the section itself is always visible so every member can see who has access.
 *
 * Body only: the titled card around it is the settings page's `SettingsLayout` panel.
 */
export function ProjectMembersSection({ projectId, orgId }: { projectId: string; orgId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';

  return <MembersList projectId={projectId} orgId={orgId} canManage={canManage} isOwner={isOwner} />;
}

function MembersList({
  projectId,
  orgId,
  canManage,
  isOwner,
}: {
  projectId: string;
  orgId: string;
  canManage: boolean;
  isOwner: boolean;
}) {
  const { data, isPending, error } = useProjectMembers(projectId);
  const { user } = useAuth();
  const currentUserId = user?.id;
  const { toast } = useToast();
  const updateRole = useUpdateProjectMemberRole(projectId);
  const removeMember = useRemoveProjectMember(projectId);
  const [pendingRemoval, setPendingRemoval] = useState<ProjectMember | null>(null);

  if (isPending) return <p role="status">Loading members…</p>;
  if (error) {
    return (
      <p role="alert" className="text-danger">
        {error instanceof ApiError ? error.problem.title : 'Failed to load members'}
      </p>
    );
  }

  const members = data?.members ?? [];
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const handleRoleChange = (member: ProjectMember, role: ProjectRole) => {
    updateRole.mutate(
      { userId: member.user.id, role },
      {
        onError: (mutationError) => {
          const problem = mutationError instanceof ApiError ? mutationError.problem : null;
          toast({
            title:
              problem?.status === 409
                ? "Can't change the last owner's role"
                : 'Could not update role',
            description: problem?.title,
            variant: 'error',
          });
        },
      },
    );
  };

  const handleRemove = (member: ProjectMember) => {
    removeMember.mutate(member.user.id, {
      onSuccess: () => setPendingRemoval(null),
      onError: (mutationError) => {
        const problem = mutationError instanceof ApiError ? mutationError.problem : null;
        setPendingRemoval(null);
        toast({
          title: problem?.status === 409 ? "Can't remove the last owner" : 'Could not remove member',
          description: problem?.title,
          variant: 'error',
        });
      },
    });
  };

  const columns: Array<DataTableColumn<ProjectMember>> = [
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
      render: (member) => {
        const isSelf = member.user.id === currentUserId;
        // Admins can't set/alter the owner role — an owner row is always a read-only badge to them.
        // Nobody may change their OWN role either (the backend returns 403), so the current user's
        // row is always a read-only badge too.
        if (!canManage || isSelf || (member.role === 'owner' && !isOwner)) {
          return <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>;
        }
        const isLastOwner = member.role === 'owner' && ownerCount <= 1;
        const options = isOwner ? PROJECT_ROLES : PROJECT_ROLES.filter((r) => r !== 'owner');
        return (
          <label>
            <span className="sr-only">Role for {member.user.name}</span>
            <select
              className={cn(fieldLook, 'h-8 w-auto px-2 text-sm')}
              value={member.role}
              disabled={isLastOwner || updateRole.isPending}
              onChange={(e) => handleRoleChange(member, e.target.value as ProjectRole)}
            >
              {options.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        );
      },
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (member: ProjectMember) => {
              // Admins can't remove an owner at all — no button for that row.
              if (member.role === 'owner' && !isOwner) return null;
              const isLastOwner = member.role === 'owner' && ownerCount <= 1;
              return (
                <div className="flex justify-end">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={isLastOwner}
                    onClick={() => setPendingRemoval(member)}
                  >
                    Remove
                  </Button>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {members.length > 0 ? (
        <DataTable
          caption="Project members"
          columns={columns}
          rows={members}
          rowKey={(member) => member.user.id}
        />
      ) : (
        <EmptyState icon={Users} title="No members yet." />
      )}

      {canManage && (
        <>
          <Separator />
          <AddMemberForm
            projectId={projectId}
            orgId={orgId}
            isOwner={isOwner}
            existingMemberIds={new Set(members.map((m) => m.user.id))}
          />
        </>
      )}

      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <DialogContent>
          <DialogTitle>Remove member</DialogTitle>
          <DialogDescription>
            Remove {pendingRemoval?.user.name} ({pendingRemoval?.user.email}) from this project?
            They will lose access immediately.
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
    </div>
  );
}

function AddMemberForm({
  projectId,
  orgId,
  isOwner,
  existingMemberIds,
}: {
  projectId: string;
  orgId: string;
  isOwner: boolean;
  existingMemberIds: Set<string>;
}) {
  const { data: orgMembers } = useMembers(orgId);
  const addMember = useAddProjectMember(projectId);
  const { toast } = useToast();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectRole>('analyst');

  const candidates = (orgMembers?.members ?? []).filter((m) => !existingMemberIds.has(m.user.id));
  const availableRoles = isOwner ? PROJECT_ROLES : PROJECT_ROLES.filter((r) => r !== 'owner');
  const selectedUserId = userId && candidates.some((c) => c.user.id === userId) ? userId : (candidates[0]?.user.id ?? '');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUserId) return;
    addMember.mutate(
      { userId: selectedUserId, role },
      {
        onSuccess: () => {
          toast({ title: 'Member added' });
          setUserId('');
        },
        onError: (error) =>
          toast({
            title: 'Could not add member',
            description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
            variant: 'error',
          }),
      },
    );
  };

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        All organization members are already on this project.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1">
        <Label htmlFor="add-member-user" className="mb-1 block">
          Member
        </Label>
        <select
          id="add-member-user"
          className={cn(fieldLook, 'h-9 w-full px-2 text-sm')}
          value={selectedUserId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {candidates.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.name} ({m.user.email})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="add-member-role" className="mb-1 block">
          Role
        </Label>
        <select
          id="add-member-role"
          className={cn(fieldLook, 'h-9 w-auto px-2 text-sm')}
          value={role}
          onChange={(e) => setRole(e.target.value as ProjectRole)}
        >
          {availableRoles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={addMember.isPending || !selectedUserId}>
        {addMember.isPending ? 'Adding…' : 'Add member'}
      </Button>
    </form>
  );
}
