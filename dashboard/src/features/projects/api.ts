import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  CreatedProject,
  CreatedToken,
  CreateTokenRequest,
  EventSummaryResponse,
  ListProjectMembersResponse,
  ListProjectsResponse,
  ListTokensResponse,
  ProjectMember,
  UpdateProjectMemberRoleRequest,
  UpdateProjectRequest,
  UpdateProjectResponse,
} from '../../lib/api/types';

export const PROJECTS_QUERY_KEY = ['projects'] as const;

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
      apiFetch<ProjectMember>(`/api/v1/projects/${projectId}/members`, {
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
      apiFetch<void>(`/api/v1/projects/${projectId}/members/${userId}`, {
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
