import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type { EventSummaryResponse, ListProjectsResponse } from '../../lib/api/types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
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
