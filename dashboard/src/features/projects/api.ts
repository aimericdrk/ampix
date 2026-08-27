import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import { purchaseApiFetch } from '../../lib/api/purchase-client';
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  CreatedProject,
  CreatedToken,
  CreateServerKeyRequest,
  CreateTokenRequest,
  EventSummaryResponse,
  ListProjectMembersResponse,
  ListProjectsResponse,
  ListTokensResponse,
  ProjectStatsResponse,
  PurchaseServerKey,
  PurgeProjectDataRequest,
  PurgeProjectDataResponse,
  UpdatedProjectMember,
  UpdateProjectMemberRoleRequest,
  UpdateProjectRequest,
  UpdateProjectResponse,
} from '../../lib/api/types';

export const PROJECTS_QUERY_KEY = ['projects'] as const;

/** Per-project list stats (user count + top country). Loads separately from the project list so
 *  the list renders immediately and the stats fill in. */
export function useProjectStats() {
  return useQuery({
    queryKey: ['projects', 'stats'],
    queryFn: () => apiFetch<ProjectStatsResponse>('/api/v1/projects/stats'),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => apiFetch<ListProjectsResponse>('/api/v1/projects'),
  });
}

/** The caller's role in a given project, once the projects list has loaded — undefined until then. */
export function useProjectRole(projectId: string | undefined) {
  const { data } = useProjects();
  if (!projectId || !data) return undefined;
  return data.projects.find((project) => project.id === projectId)?.role;
}

/** All-time event summary for a project (contracts §12) — no client recomputation, use the totals as-is. */
export function useEventSummary(projectId: string) {
  return useQuery({
    queryKey: ['events-summary', projectId],
    queryFn: () => apiFetch<EventSummaryResponse>(`/api/v1/projects/${projectId}/events/summary`),
  });
}

// --- Tenancy management (contracts §13) ---

export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectRequest) =>
      apiFetch<CreatedProject>(`/api/v1/orgs/${orgId}/projects`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectRequest) =>
      apiFetch<UpdateProjectResponse>(`/api/v1/projects/${projectId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
  });
}

export function useDeleteProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(`/api/v1/projects/${projectId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
    },
  });
}

/**
 * Owner-only, irreversible wipe of the selected data scopes for a project. On success we
 * invalidate every cache the wiped scopes could have populated so the UI reflects the empty
 * state without a reload.
 */
export function usePurgeProjectData(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PurgeProjectDataRequest) =>
      apiFetch<PurgeProjectDataResponse>(`/api/v1/projects/${projectId}/data/purge`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['revenuecat', projectId] });
    },
  });
}

export function useTokens(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'tokens'],
    queryFn: () => apiFetch<ListTokensResponse>(`/api/v1/projects/${projectId}/tokens`),
  });
}

export function useCreateToken(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTokenRequest) =>
      apiFetch<CreatedToken>(`/api/v1/projects/${projectId}/tokens`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tokens'] });
    },
  });
}

export function useRevokeToken(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetch<void>(`/api/v1/projects/${projectId}/tokens/${tokenId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'tokens'] });
    },
  });
}

// --- Purchase-service server keys ---
//
// These live on the mobile_purchase service (its own database, its own guards), so they go out
// through purchaseApiFetch rather than apiFetch. Same project, same settings page, two services
// each holding the credential they verify — no cross-service call sits in a delete path.

export function usePurchaseServerKeys(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'server-keys'],
    queryFn: () => purchaseApiFetch<PurchaseServerKey[]>(`/api/v1/projects/${projectId}/server-keys`),
  });
}

export function useCreatePurchaseServerKey(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServerKeyRequest) =>
      purchaseApiFetch<PurchaseServerKey>(`/api/v1/projects/${projectId}/server-keys`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'server-keys'] });
    },
  });
}

export function useRevokePurchaseServerKey(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      purchaseApiFetch<void>(`/api/v1/projects/${projectId}/server-keys/${keyId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'server-keys'] });
    },
  });
}

// --- Per-project members (per-project-roles) ---

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: ['projects', projectId, 'members'],
    queryFn: () => apiFetch<ListProjectMembersResponse>(`/api/v1/projects/${projectId}/members`),
  });
}

export function useAddProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddProjectMemberRequest) =>
      apiFetch<UpdatedProjectMember>(`/api/v1/projects/${projectId}/members`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members'] });
    },
  });
}

export function useUpdateProjectMemberRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string } & UpdateProjectMemberRoleRequest) =>
      apiFetch<UpdatedProjectMember>(`/api/v1/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members'] });
    },
  });
}

export function useRemoveProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/v1/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'members'] });
    },
  });
}
