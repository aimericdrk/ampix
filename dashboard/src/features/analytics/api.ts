import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type {
  FlowsQueryDefinition,
  FlowsResponse,
  FunnelQueryDefinition,
  FunnelResponse,
  InsightsQueryDefinition,
  InsightsResponse,
  ListUsersResponse,
  LiveEventsResponse,
  MetaEventsResponse,
  MetaPropertiesResponse,
  RetentionQueryDefinition,
  RetentionResponse,
  SessionsSummaryResponse,
  UserProfileResponse,
} from '../../lib/api/types';

const base = (projectId: string) => `/api/v1/projects/${projectId}`;

// --- Metadata (autocomplete for the insights builder) ---

export function useMetaEvents(projectId: string) {
  return useQuery({
    queryKey: ['analytics', projectId, 'meta-events'],
    queryFn: () => apiFetch<MetaEventsResponse>(`${base(projectId)}/meta/events`),
  });
}

export function useMetaProperties(projectId: string) {
  return useQuery({
    queryKey: ['analytics', projectId, 'meta-properties'],
    queryFn: () => apiFetch<MetaPropertiesResponse>(`${base(projectId)}/meta/properties`),
  });
}

// --- Insights query engine (contracts §14) ---

export function useRunInsights(projectId: string) {
  return useMutation({
    mutationFn: (query: InsightsQueryDefinition) =>
      apiFetch<InsightsResponse>(`${base(projectId)}/query/insights`, {
        method: 'POST',
        body: query,
      }),
  });
}

// --- Advanced analysis query engine (contracts §15) ---

export function useRunFunnels(projectId: string) {
  return useMutation({
    mutationFn: (query: FunnelQueryDefinition) =>
      apiFetch<FunnelResponse>(`${base(projectId)}/query/funnels`, {
        method: 'POST',
        body: query,
      }),
  });
}

export function useRunRetention(projectId: string) {
  return useMutation({
    mutationFn: (query: RetentionQueryDefinition) =>
      apiFetch<RetentionResponse>(`${base(projectId)}/query/retention`, {
        method: 'POST',
        body: query,
      }),
  });
}

export function useRunFlows(projectId: string) {
  return useMutation({
    mutationFn: (query: FlowsQueryDefinition) =>
      apiFetch<FlowsResponse>(`${base(projectId)}/query/flows`, {
        method: 'POST',
        body: query,
      }),
  });
}

// --- Live event feed ---

const LIVE_EVENTS_PAGE_SIZE = 25;

export function useLiveEvents(projectId: string) {
  return useInfiniteQuery({
    queryKey: ['analytics', projectId, 'live-events'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const before = pageParam ? `&before=${encodeURIComponent(pageParam)}` : '';
      return apiFetch<LiveEventsResponse>(
        `${base(projectId)}/events/live?limit=${LIVE_EVENTS_PAGE_SIZE}${before}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    // Polls for newest events; TanStack Query refetches every already-fetched page in sequence,
    // which also keeps "loaded older" pages consistent.
    refetchInterval: 5000,
  });
}

// --- Users explorer ---

const USERS_PAGE_SIZE = 20;

export function useUsersList(projectId: string, search: string) {
  return useInfiniteQuery({
    queryKey: ['analytics', projectId, 'users', search],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return apiFetch<ListUsersResponse>(
        `${base(projectId)}/users?search=${encodeURIComponent(search)}&limit=${USERS_PAGE_SIZE}${cursor}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useUserProfile(projectId: string, distinctId: string) {
  return useQuery({
    queryKey: ['analytics', projectId, 'user', distinctId],
    queryFn: () =>
      apiFetch<UserProfileResponse>(`${base(projectId)}/users/${encodeURIComponent(distinctId)}`),
  });
}

// --- Sessions ---

export function useSessionsSummary(projectId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['analytics', projectId, 'sessions-summary', from, to],
    queryFn: () =>
      apiFetch<SessionsSummaryResponse>(
        `${base(projectId)}/sessions/summary?from=${from}&to=${to}`,
      ),
  });
}
