import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type {
  AcceptInvitationResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  CreateOrgRequest,
  CreateOrgResponse,
  InvitationPreview,
  ListInvitationsResponse,
  ListMembersResponse,
  ListOrgsResponse,
  RenameOrgRequest,
  RenameOrgResponse,
  UpdateMemberRoleRequest,
} from '../../lib/api/types';

export const ORGS_QUERY_KEY = ['orgs'] as const;

export function useOrgs() {
  return useQuery({
    queryKey: ORGS_QUERY_KEY,
    queryFn: () => apiFetch<ListOrgsResponse>('/api/v1/orgs'),
  });
}

/** The caller's role in a given org, once the orgs list has loaded — undefined until then. */
export function useOrgRole(orgId: string | undefined) {
  const { data } = useOrgs();
  if (!orgId || !data) return undefined;
  return data.orgs.find((org) => org.id === orgId)?.role;
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrgRequest) =>
      apiFetch<CreateOrgResponse>('/api/v1/orgs', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORGS_QUERY_KEY });
    },
  });
}

export function useRenameOrg(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RenameOrgRequest) =>
      apiFetch<RenameOrgResponse>(`/api/v1/orgs/${orgId}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORGS_QUERY_KEY });
    },
  });
}

export function useMembers(orgId: string) {
  return useQuery({
    queryKey: ['orgs', orgId, 'members'],
    queryFn: () => apiFetch<ListMembersResponse>(`/api/v1/orgs/${orgId}/members`),
  });
}

export function useUpdateMemberRole(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string } & UpdateMemberRoleRequest) =>
      apiFetch<void>(`/api/v1/orgs/${orgId}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'members'] });
    },
  });
}

export function useRemoveMember(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/v1/orgs/${orgId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'members'] });
    },
  });
}

export function useInvitations(orgId: string) {
  return useQuery({
    queryKey: ['orgs', orgId, 'invitations'],
    queryFn: () => apiFetch<ListInvitationsResponse>(`/api/v1/orgs/${orgId}/invitations`),
  });
}

export function useCreateInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationRequest) =>
      apiFetch<CreateInvitationResponse>(`/api/v1/orgs/${orgId}/invitations`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'invitations'] });
    },
  });
}

export function useRevokeInvitation(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<void>(`/api/v1/orgs/${orgId}/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'invitations'] });
    },
  });
}

// --- Public invite-accept flow (contracts §13) ---

/** `GET /invitations/:token` — public, no auth required. 404 unknown, 410 expired/accepted. */
export function getInvitationPreview(token: string): Promise<InvitationPreview> {
  return apiFetch<InvitationPreview>(`/api/v1/invitations/${token}`);
}

/** `POST /invitations/:token/accept` — requires auth. Idempotent if already a member. */
export function acceptInvitation(token: string): Promise<AcceptInvitationResponse> {
  return apiFetch<AcceptInvitationResponse>(`/api/v1/invitations/${token}/accept`, {
    method: 'POST',
  });
}
