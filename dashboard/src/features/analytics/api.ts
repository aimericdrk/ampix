import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import type {
  ApplyTemplateResponse,
  Cohort,
  CohortPreviewResponse,
  CreateCohortRequest,
  CreateDashboardRequest,
  CreateReportRequest,
  CreateTileRequest,
  Dashboard,
  DashboardDataResponse,
  DashboardTile,
  FlowsQueryDefinition,
  FlowsResponse,
  FunnelQueryDefinition,
  FunnelResponse,
  InsightsQueryDefinition,
  InsightsResponse,
  ListCohortsResponse,
  ListDashboardsResponse,
  ListReportsResponse,
  ListTemplatesResponse,
  ListUsersResponse,
  LiveEventsResponse,
  MetaEventsResponse,
  MetaPropertiesResponse,
  AnalysisResult,
  RetentionQueryDefinition,
  RetentionResponse,
  RunReportRequest,
  SavedReport,
  SessionsSummaryResponse,
  TemplateId,
  UpdateCohortRequest,
  UpdateDashboardRequest,
  UpdateLayoutRequest,
  UpdateReportRequest,
  UpdateTileRequest,
  DashboardSummary,
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

// --- Cohorts (contracts §16) ---

const cohortsKey = (projectId: string) => ['analytics', projectId, 'cohorts'] as const;

export function useCohorts(projectId: string) {
  return useQuery({
    queryKey: cohortsKey(projectId),
    queryFn: () => apiFetch<ListCohortsResponse>(`${base(projectId)}/cohorts`),
  });
}

export function useCohort(projectId: string, cohortId: string) {
  return useQuery({
    queryKey: [...cohortsKey(projectId), cohortId],
    queryFn: () => apiFetch<Cohort>(`${base(projectId)}/cohorts/${cohortId}`),
  });
}

/** Runs a saved cohort (`GET /cohorts/:id/preview`); only fires once a cohort id exists. */
export function useCohortPreview(projectId: string, cohortId: string | null) {
  return useQuery({
    queryKey: [...cohortsKey(projectId), cohortId, 'preview'],
    queryFn: () =>
      apiFetch<CohortPreviewResponse>(`${base(projectId)}/cohorts/${cohortId}/preview`),
    enabled: cohortId !== null,
  });
}

export function useCreateCohort(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCohortRequest) =>
      apiFetch<Cohort>(`${base(projectId)}/cohorts`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cohortsKey(projectId) });
    },
  });
}

export function useUpdateCohort(projectId: string, cohortId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCohortRequest) =>
      apiFetch<Cohort>(`${base(projectId)}/cohorts/${cohortId}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cohortsKey(projectId) });
    },
  });
}

export function useDeleteCohort(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cohortId: string) =>
      apiFetch<void>(`${base(projectId)}/cohorts/${cohortId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cohortsKey(projectId) });
    },
  });
}

// --- Saved reports (contracts §16) ---

const reportsKey = (projectId: string) => ['analytics', projectId, 'reports'] as const;

export function useReports(projectId: string, kind?: string) {
  return useQuery({
    queryKey: [...reportsKey(projectId), kind ?? 'all'],
    queryFn: () => {
      const query = kind ? `?kind=${encodeURIComponent(kind)}` : '';
      return apiFetch<ListReportsResponse>(`${base(projectId)}/reports${query}`);
    },
  });
}

export function useReport(projectId: string, reportId: string) {
  return useQuery({
    queryKey: [...reportsKey(projectId), reportId],
    queryFn: () => apiFetch<SavedReport>(`${base(projectId)}/reports/${reportId}`),
  });
}

export function useCreateReport(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportRequest) =>
      apiFetch<SavedReport>(`${base(projectId)}/reports`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportsKey(projectId) });
    },
  });
}

export function useUpdateReport(projectId: string, reportId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateReportRequest) =>
      apiFetch<SavedReport>(`${base(projectId)}/reports/${reportId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportsKey(projectId) });
    },
  });
}

export function useDeleteReport(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) =>
      apiFetch<void>(`${base(projectId)}/reports/${reportId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reportsKey(projectId) });
    },
  });
}

/** Executes a stored report's definition (`POST /reports/:id/run`) with optional overrides. */
export function useRunReport(projectId: string, reportId: string) {
  return useMutation({
    mutationFn: (input: RunReportRequest) =>
      apiFetch<AnalysisResult>(`${base(projectId)}/reports/${reportId}/run`, {
        method: 'POST',
        body: input,
      }),
  });
}

// --- Custom dashboards (contracts §16) ---

const dashboardsKey = (projectId: string) => ['analytics', projectId, 'dashboards'] as const;

export function useDashboards(projectId: string) {
  return useQuery({
    queryKey: dashboardsKey(projectId),
    queryFn: () => apiFetch<ListDashboardsResponse>(`${base(projectId)}/dashboards`),
  });
}

export function useDashboard(projectId: string, dashboardId: string) {
  return useQuery({
    queryKey: [...dashboardsKey(projectId), dashboardId],
    queryFn: () => apiFetch<Dashboard>(`${base(projectId)}/dashboards/${dashboardId}`),
  });
}

/** Runs every tile's definition; one tile failing surfaces as `{ error }`, never a whole-board failure. */
export function useDashboardData(projectId: string, dashboardId: string) {
  return useQuery({
    queryKey: [...dashboardsKey(projectId), dashboardId, 'data'],
    queryFn: () =>
      apiFetch<DashboardDataResponse>(`${base(projectId)}/dashboards/${dashboardId}/data`),
  });
}

export function useCreateDashboard(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDashboardRequest) =>
      apiFetch<DashboardSummary>(`${base(projectId)}/dashboards`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsKey(projectId) });
    },
  });
}

export function useUpdateDashboard(projectId: string, dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDashboardRequest) =>
      apiFetch<DashboardSummary>(`${base(projectId)}/dashboards/${dashboardId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsKey(projectId) });
    },
  });
}

export function useDeleteDashboard(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dashboardId: string) =>
      apiFetch<void>(`${base(projectId)}/dashboards/${dashboardId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsKey(projectId) });
    },
  });
}

/** Invalidate both the structural dashboard and its run data after a tile mutation. */
function invalidateDashboard(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  dashboardId: string,
) {
  void queryClient.invalidateQueries({ queryKey: [...dashboardsKey(projectId), dashboardId] });
}

export function useCreateTile(projectId: string, dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTileRequest) =>
      apiFetch<DashboardTile>(`${base(projectId)}/dashboards/${dashboardId}/tiles`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateDashboard(queryClient, projectId, dashboardId),
  });
}

export function useUpdateTile(projectId: string, dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tileId, patch }: { tileId: string; patch: UpdateTileRequest }) =>
      apiFetch<DashboardTile>(`${base(projectId)}/dashboards/${dashboardId}/tiles/${tileId}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: () => invalidateDashboard(queryClient, projectId, dashboardId),
  });
}

export function useDeleteTile(projectId: string, dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tileId: string) =>
      apiFetch<void>(`${base(projectId)}/dashboards/${dashboardId}/tiles/${tileId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateDashboard(queryClient, projectId, dashboardId),
  });
}

// --- Templates gallery (contracts §19) ---

/** The fixed template catalog (`GET /api/v1/templates`) — auth-only, shared across projects. */
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<ListTemplatesResponse>('/api/v1/templates'),
  });
}

/**
 * Applies a template (`POST /projects/:projectId/templates/:templateId/apply`) — the server
 * materializes the bundle as real cohorts/reports/a dashboard and returns the new dashboard id.
 * Invalidates the dashboards + reports + cohorts caches so the newly created rows show up.
 */
export function useApplyTemplate(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: TemplateId) =>
      apiFetch<ApplyTemplateResponse>(
        `${base(projectId)}/templates/${templateId}/apply`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardsKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: reportsKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: cohortsKey(projectId) });
    },
  });
}

/** Batch-saves the 12-col grid after a drag / discrete resize (`PATCH /dashboards/:id/layout`). */
export function useSaveLayout(projectId: string, dashboardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLayoutRequest) =>
      apiFetch<Dashboard>(`${base(projectId)}/dashboards/${dashboardId}/layout`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => invalidateDashboard(queryClient, projectId, dashboardId),
  });
}
