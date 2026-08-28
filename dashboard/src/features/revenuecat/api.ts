import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client';
import { encodeFiltersParam } from '../analytics/api';
import { PROJECTS_QUERY_KEY, useProjects } from '../projects/api';
import type {
  InsightsFilter,
  JourneyAnalysisResponse,
  JourneyOutcome,
  JourneyResponse,
  RcIntegrationStatus,
  RcJournalResponse,
  RcReplayResponse,
  RcResyncResponse,
  SubscriptionAttributionResponse,
  SubscriptionsSummaryResponse,
  UpsertRcIntegrationRequest,
  UserSubscriptionResponse,
} from '../../lib/api/types';

/** spec §4.7 — RevenueCat integration management + subscription metrics. */
export const rcBase = (projectId: string) => `/api/v1/projects/${projectId}/integrations/revenuecat`;
const metricsBase = (projectId: string) => `/api/v1/projects/${projectId}/metrics`;

const rcKey = (projectId: string) => ['revenuecat', projectId] as const;

/** Invalidates the RC namespace plus `['projects']` — the gating flag lives on the projects list. */
function invalidateRc(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: rcKey(projectId) });
  void queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY });
}

export function useRcStatus(projectId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...rcKey(projectId), 'status'],
    queryFn: () => apiFetch<RcIntegrationStatus>(rcBase(projectId)),
    enabled: opts.enabled ?? true,
  });
}

export function useUpsertRcIntegration(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertRcIntegrationRequest) =>
      apiFetch<RcIntegrationStatus>(rcBase(projectId), { method: 'PUT', body }),
    onSuccess: () => invalidateRc(queryClient, projectId),
  });
}

export function useDisconnectRc(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>(rcBase(projectId), { method: 'DELETE' }),
    onSuccess: () => invalidateRc(queryClient, projectId),
  });
}

export function useRcReplay(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<RcReplayResponse>(`${rcBase(projectId)}/replay`, { method: 'POST' }),
    // Journal counts/backfill status only — the connected/gating flag doesn't change, so unlike
    // upsert/disconnect this does NOT invalidate ['projects'].
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rcKey(projectId) });
    },
  });
}

export function useRcResync(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<RcResyncResponse>(`${rcBase(projectId)}/resync`, { method: 'POST' }),
    // See useRcReplay: backfill status only, no gating-flag change.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rcKey(projectId) });
    },
  });
}

export function useRcJournal(
  projectId: string,
  status?: string,
  opts: { enabled?: boolean } = {},
) {
  const statusParam = status ? `?status=${encodeURIComponent(status)}` : '';
  return useQuery({
    queryKey: [...rcKey(projectId), 'journal', status ?? null],
    queryFn: () => apiFetch<RcJournalResponse>(`${rcBase(projectId)}/events${statusParam}`),
    enabled: opts.enabled ?? true,
  });
}

/**
 * `GET /metrics/subscriptions` — auto-loads once both bounds of the range are set (mirrors
 * `useRevenue`). `filters` (feat-02 §3.4/T2) is optional; see `useSessionsSummary`.
 */
export function useSubscriptionsSummary(
  projectId: string,
  from: string,
  to: string,
  filters: InsightsFilter[] = [],
) {
  const filtersParam = filters.length > 0 ? `&filters=${encodeFiltersParam(filters)}` : '';
  return useQuery({
    queryKey: [...rcKey(projectId), 'summary', from, to, JSON.stringify(filters)],
    queryFn: () =>
      apiFetch<SubscriptionsSummaryResponse>(
        `${metricsBase(projectId)}/subscriptions?from=${from}&to=${to}${filtersParam}`,
      ),
    enabled: from.length > 0 && to.length > 0,
  });
}

export function useSubscriptionAttribution(projectId: string, from: string, to: string) {
  return useQuery({
    queryKey: [...rcKey(projectId), 'attribution', from, to],
    queryFn: () =>
      apiFetch<SubscriptionAttributionResponse>(
        `${metricsBase(projectId)}/subscriptions/attribution?from=${from}&to=${to}`,
      ),
    enabled: from.length > 0 && to.length > 0,
  });
}

/** The knobs the Journey page exposes; the server clamps both, so the UI never has to. */
export interface JourneyParams {
  outcome: JourneyOutcome;
  from: string;
  to: string;
  windowDays: number;
  pathSteps: number;
}

function journeyQuery({ outcome, from, to, windowDays, pathSteps }: JourneyParams): string {
  return `outcome=${outcome}&from=${from}&to=${to}&window_days=${windowDays}&path_steps=${pathSteps}`;
}

/**
 * MyRevenueCat → Journey: what users did in the run-up to subscribing or being refunded, against a
 * control cohort that did neither. Ignores the global filter bar on purpose — the cohort IS the
 * filter, and layering the app-wide filters on top would redefine "the control" on every page load.
 */
export function useSubscriptionJourney(projectId: string, params: JourneyParams) {
  return useQuery({
    queryKey: [...rcKey(projectId), 'journey', params],
    queryFn: () =>
      apiFetch<JourneyResponse>(
        `${metricsBase(projectId)}/subscriptions/journey?${journeyQuery(params)}`,
      ),
    enabled: params.from.length > 0 && params.to.length > 0,
  });
}

/**
 * Hands the same report to the model and returns its findings WITH the report they were drawn from.
 * A mutation rather than a query: it spends an AI call, so it must fire only when someone asks for
 * it, never on a re-render or a window focus.
 */
export function useAnalyzeSubscriptionJourney(projectId: string) {
  return useMutation({
    mutationFn: (params: JourneyParams) =>
      apiFetch<JourneyAnalysisResponse>(
        `${metricsBase(projectId)}/subscriptions/journey/analyze?${journeyQuery(params)}`,
        { method: 'POST' },
      ),
  });
}

export function useUserSubscription(projectId: string, distinctId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...rcKey(projectId), 'user', distinctId],
    queryFn: () =>
      apiFetch<UserSubscriptionResponse>(
        `${rcBase(projectId)}/users/${encodeURIComponent(distinctId)}`,
      ),
    enabled: enabled && distinctId.length > 0,
  });
}

export function useRefreshUserSubscription(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (distinctId: string) =>
      apiFetch<UserSubscriptionResponse>(
        `${rcBase(projectId)}/users/${encodeURIComponent(distinctId)}/refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...rcKey(projectId), 'user'] });
    },
  });
}

/** Whether the project has RevenueCat connected — reads the gating flag off the projects list
 *  (`useProjects`), defaulting to `false` for projects predating the integration or when `projectId`
 *  is not (yet) known. */
export function useRcEnabled(projectId?: string): boolean {
  const { data } = useProjects();
  if (!projectId) return false;
  return data?.projects.find((p) => p.id === projectId)?.integrations?.revenuecat ?? false;
}
