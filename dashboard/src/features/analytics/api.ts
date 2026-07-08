import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiFetchBlob } from '../../lib/api/client';
import type {
  ClickHeatmapQuery,
  ClickHeatmapResponse,
  ScreenPathsQuery,
  ScreenPathsResponse,
  ScreensResponse,
  ApplyTemplateResponse,
  Cohort,
  CohortDefinition,
  CohortPreviewResponse,
  CreateCohortRequest,
  CreateDashboardRequest,
  CreateReportRequest,
  CreateTileRequest,
  Dashboard,
  DashboardDataResponse,
  DashboardTile,
  EngagementResponse,
  FlowsQueryDefinition,
  FlowsResponse,
  FunnelQueryDefinition,
  FunnelResponse,
  HistogramQuery,
  HistogramResponse,
  InsightsFilter,
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
  MetaPropertyValuesResponse,
  AnalysisResult,
  RetentionQueryDefinition,
  RetentionResponse,
  RevenueSummaryResponse,
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

// --- Shared `filters` query-param encoding (feat-02 §3.4/T2) ---

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encodes §14 filters for the metric endpoints' optional `filters` query param — mirrors the
 * backend's `parseFiltersParam` decode exactly: `base64url(JSON.stringify(filters))`. Callers gate
 * on `filters.length > 0` before appending it (an empty array is simply omitted, matching "absent
 * -> unchanged behavior").
 */
export function encodeFiltersParam(filters: InsightsFilter[]): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(filters)));
}

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

/**
 * `GET /meta/property-values` — suggested values for ONE property, feeding the filter-value
 * type-ahead. Gated on a non-empty `property` (the endpoint 400s without one); an optional
 * `event` narrows the suggestions. Cached 5 min to match the backend's Redis TTL.
 */
export function useMetaPropertyValues(projectId: string, property: string, event?: string) {
  const trimmed = property.trim();
  return useQuery({
    queryKey: ['analytics', projectId, 'meta-property-values', trimmed, event ?? null],
    queryFn: () => {
      const eventParam = event ? `&event=${encodeURIComponent(event)}` : '';
      return apiFetch<MetaPropertyValuesResponse>(
        `${base(projectId)}/meta/property-values?property=${encodeURIComponent(trimmed)}${eventParam}`,
      );
    },
    enabled: trimmed.length > 0,
    staleTime: 5 * 60 * 1000,
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

/**
 * Query-style counterpart of {@link useRunInsights} for pages that should auto-load a result on
 * view (e.g. Home's KPI row) rather than wait for an explicit "Run" action. Same endpoint/body;
 * `queryKey` includes the serialized `definition` so distinct queries cache independently.
 */
export function useInsightsQuery(
  projectId: string,
  definition: InsightsQueryDefinition,
  enabled = true,
) {
  return useQuery({
    queryKey: ['analytics', projectId, 'insights-query', JSON.stringify(definition)],
    queryFn: () =>
      apiFetch<InsightsResponse>(`${base(projectId)}/query/insights`, {
        method: 'POST',
        body: definition,
      }),
    enabled,
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

// --- Distribution histograms (feat-09 §3.1) ---

/**
 * `POST /query/histogram` (feat-09) — buckets a numeric event property into an adaptive histogram
 * plus summary stats. Query-style like {@link useInsightsQuery}: auto-loads whenever `query`
 * changes and `enabled` (gate on a chosen event + property, e.g. the Distributions custom mode).
 */
export function useHistogram(projectId: string, query: HistogramQuery, enabled = true) {
  return useQuery({
    queryKey: ['analytics', projectId, 'histogram', JSON.stringify(query)],
    queryFn: () =>
      apiFetch<HistogramResponse>(`${base(projectId)}/query/histogram`, {
        method: 'POST',
        body: query,
      }),
    enabled,
  });
}

// --- Screens, user-path map & click heatmap (contracts §18/§19) ---

const screensKey = (projectId: string) => ['analytics', projectId, 'screens'] as const;

/** §18 `GET /screens` — the captured-screen catalog powering the path-map thumbnails + heatmap picker. */
export function useScreens(projectId: string) {
  return useQuery({
    queryKey: screensKey(projectId),
    queryFn: () => apiFetch<ScreensResponse>(`${base(projectId)}/screens`),
  });
}

/**
 * §18 `DELETE /screens/:screenName?app_version=<optional>` (analyst+) — deletes a screen's stored
 * reference image + metadata (all versions, or a single one when `appVersion` is given) → 204. This is
 * the dashboard side of "Retake": delete the outdated image here, then the developer re-captures it by
 * running a debug build (`retakeScreenshots()`) and re-navigating. Invalidates the screens catalog so
 * the deleted screen drops out of the picker / path-map.
 */
export function useDeleteScreen(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ screenName, appVersion }: { screenName: string; appVersion?: string }) => {
      const query = appVersion ? `?app_version=${encodeURIComponent(appVersion)}` : '';
      return apiFetch<void>(
        `${base(projectId)}/screens/${encodeURIComponent(screenName)}${query}`,
        { method: 'DELETE' },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: screensKey(projectId) });
      // A same-session retake reuses the screen name, so also drop any cached image blobs for this
      // project — the content hash changes, but this guarantees an immediate refetch after a delete.
      void queryClient.invalidateQueries({
        queryKey: ['analytics', projectId, 'screen-image'],
      });
    },
  });
}

/**
 * §18 `GET /screens/:screenName/image` as a Blob — the endpoint is membership-gated, so a bare
 * `<img src>` (which can't send the bearer token) would 401. We fetch the bytes through the authed
 * transport; the consuming component turns the blob into an object URL. `enabled` gates the request
 * until a real screen is chosen.
 *
 * `cacheKey` is the screen's latest `image_hash`: it is folded into BOTH the query key AND the request
 * URL (`?hash=…`) so the blob is content-addressed. A new capture ⇒ new hash ⇒ new key + new URL ⇒ a
 * guaranteed fresh fetch (and a browser-cache miss), which is what makes `staleTime: Infinity` correct.
 * When no hash is known yet the bare `/image` is fetched (the backend serves the newest capture).
 */
export function useScreenImageBlob(
  projectId: string,
  screenName: string,
  enabled = true,
  cacheKey?: string,
) {
  return useQuery({
    queryKey: ['analytics', projectId, 'screen-image', screenName, cacheKey ?? null],
    queryFn: () => {
      const query = cacheKey ? `?hash=${encodeURIComponent(cacheKey)}` : '';
      return apiFetchBlob(
        `${base(projectId)}/screens/${encodeURIComponent(screenName)}/image${query}`,
      );
    },
    enabled: enabled && screenName.length > 0,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** §19 `POST /query/screen-paths` — the user-path-map data source (Sankey-shaped, nodes = screens). */
export function useRunScreenPaths(projectId: string) {
  return useMutation({
    mutationFn: (query: ScreenPathsQuery) =>
      apiFetch<ScreenPathsResponse>(`${base(projectId)}/query/screen-paths`, {
        method: 'POST',
        body: query,
      }),
  });
}

/** §19 `POST /query/click-heatmap` — bucketed tap counts to overlay on a screen's screenshot. */
export function useRunClickHeatmap(projectId: string) {
  return useMutation({
    mutationFn: (query: ClickHeatmapQuery) =>
      apiFetch<ClickHeatmapResponse>(`${base(projectId)}/query/click-heatmap`, {
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

/**
 * `GET /sessions/summary`. `filters` (feat-02 §3.4/T2 — pass the merged global + local filters,
 * e.g. `mergeGlobalFilters([], globalFilters)`) is optional; when non-empty it's appended as an
 * encoded `filters` query param and folded into the cache key so a filter change re-fetches.
 */
export function useSessionsSummary(
  projectId: string,
  from: string,
  to: string,
  filters: InsightsFilter[] = [],
) {
  const filtersParam = filters.length > 0 ? `&filters=${encodeFiltersParam(filters)}` : '';
  return useQuery({
    queryKey: ['analytics', projectId, 'sessions-summary', from, to, JSON.stringify(filters)],
    queryFn: () =>
      apiFetch<SessionsSummaryResponse>(
        `${base(projectId)}/sessions/summary?from=${from}&to=${to}${filtersParam}`,
      ),
  });
}

// --- Revenue (contracts §19: in-app purchase revenue, ARPPU, by-product) ---

/**
 * `GET /metrics/revenue` — auto-loads once both bounds of the range are set (mirrors
 * `useEngagement`). `filters` (feat-02 §3.4/T2) is optional; see {@link useSessionsSummary}.
 */
export function useRevenue(
  projectId: string,
  from: string,
  to: string,
  filters: InsightsFilter[] = [],
) {
  const filtersParam = filters.length > 0 ? `&filters=${encodeFiltersParam(filters)}` : '';
  return useQuery({
    queryKey: ['analytics', projectId, 'revenue', from, to, JSON.stringify(filters)],
    queryFn: () =>
      apiFetch<RevenueSummaryResponse>(
        `${base(projectId)}/metrics/revenue?from=${from}&to=${to}${filtersParam}`,
      ),
    enabled: from.length > 0 && to.length > 0,
  });
}

// --- Engagement (contracts §19: DAU/WAU/MAU, stickiness, new-vs-returning) ---

/**
 * `GET /metrics/engagement` — auto-loads once both bounds of the range are set. `filters` (feat-02
 * §3.4/T2) is optional; see {@link useSessionsSummary}.
 */
export function useEngagement(
  projectId: string,
  from: string,
  to: string,
  interval: string,
  filters: InsightsFilter[] = [],
) {
  const filtersParam = filters.length > 0 ? `&filters=${encodeFiltersParam(filters)}` : '';
  return useQuery({
    queryKey: ['analytics', projectId, 'engagement', from, to, interval, JSON.stringify(filters)],
    queryFn: () =>
      apiFetch<EngagementResponse>(
        `${base(projectId)}/metrics/engagement?from=${from}&to=${to}&interval=${interval}${filtersParam}`,
      ),
    enabled: from.length > 0 && to.length > 0,
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

/** `GET /cohorts/:id` — the cohort incl. its stored `definition`; gated until a real id is passed. */
export function useCohort(projectId: string, cohortId: string) {
  return useQuery({
    queryKey: [...cohortsKey(projectId), cohortId],
    queryFn: () => apiFetch<Cohort>(`${base(projectId)}/cohorts/${cohortId}`),
    enabled: cohortId.length > 0,
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

/**
 * Live cohort preview from an in-progress definition (`POST /cohorts/preview`) — no save required.
 * Mirrors the Explore run-mutations: the builder POSTs its current definition and gets back
 * `{ count, sample }`, so the audience size updates as the analyst picks events / conditions.
 */
export function usePreviewCohortDefinition(projectId: string) {
  return useMutation({
    mutationFn: (definition: CohortDefinition) =>
      apiFetch<CohortPreviewResponse>(`${base(projectId)}/cohorts/preview`, {
        method: 'POST',
        body: definition,
      }),
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

/**
 * Auto-running report preview for list thumbnails (`POST /reports/:id/run` with no overrides).
 * A query (not the `useRunReport` mutation) so each card's thumbnail loads + caches on mount without
 * an explicit trigger. Cached 5 min; never retried so a failing preview settles to `isError` fast.
 */
export function useReportPreview(projectId: string, reportId: string) {
  return useQuery({
    queryKey: [...reportsKey(projectId), reportId, 'preview'],
    queryFn: () =>
      apiFetch<AnalysisResult>(`${base(projectId)}/reports/${reportId}/run`, {
        method: 'POST',
        body: {},
      }),
    staleTime: 5 * 60 * 1000,
    retry: false,
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

/**
 * `enabled` (default `true`) additionally gates on a non-empty `dashboardId` — callers that only
 * learn the target id once the user picks one (e.g. `AddToDashboardButton`) can pass `false` until
 * a real id exists, avoiding a request for an empty path segment.
 */
export function useDashboard(projectId: string, dashboardId: string, enabled = true) {
  return useQuery({
    queryKey: [...dashboardsKey(projectId), dashboardId],
    queryFn: () => apiFetch<Dashboard>(`${base(projectId)}/dashboards/${dashboardId}`),
    enabled: enabled && dashboardId.length > 0,
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
