import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type {
  CreateProjectRequest,
  CreatedProject,
  CreatedToken,
  CreateTokenRequest,
  EventSummaryResponse,
  ListProjectsResponse,
  ListTokensResponse,
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
