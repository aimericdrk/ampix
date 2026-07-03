import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type { ListProjectsResponse } from '../../lib/api/types';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<ListProjectsResponse>('/api/v1/projects'),
  });
}
