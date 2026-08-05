import { useQuery } from '@tanstack/react-query';
import { purchaseApiFetch } from '../../lib/api/purchase-client';
import type { SubscriptionsSummaryResponse } from '../../lib/api/types';

/** Bucket granularity for the purchase-service time series (spec §1.1 common query params). */
export type RcGranularity = 'day' | 'week' | 'month';

export interface RcRevenuePoint {
  bucket: string;
  amountCents: number;
}
export interface RcCurrencyTotal {
  currency: string;
  totalCents: number;
}
/** `GET /metrics/revenue` (spec §1.1) — exact revenue from the transaction ledger. */
export interface RcRevenueResponse {
  currency: string | null;
  totalCents: number;
  series: RcRevenuePoint[];
  byCurrency: RcCurrencyTotal[];
}

export interface RcMrrPoint {
  bucket: string;
  mrrCents: number;
}
/** `GET /metrics/mrr` (spec §1.1) — current MRR + window-approximated series. */
export interface RcMrrResponse {
  currency: string | null;
  mrrCents: number;
  series: RcMrrPoint[];
  unattributedActiveCount: number;
  approximate: true;
}

export interface RcActiveSubscriptionsPoint {
  bucket: string;
  count: number;
}
/** `GET /metrics/active-subscriptions` (spec §1.1) — current count + window-approximated series. */
export interface RcActiveSubscriptionsResponse {
  current: number;
  series: RcActiveSubscriptionsPoint[];
  approximate: true;
}

/** One movement category's sign-carrying cents (gains `>= 0`, losses `<= 0`). */
export interface RcMrrMovementBucket {
  bucket: string;
  new_cents: number;
  reactivation_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churn_cents: number;
  net_cents: number;
}
export interface RcMrrMovementTotals {
  new_cents: number;
  reactivation_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churn_cents: number;
  net_cents: number;
}
/** `GET /metrics/mrr-movement` — per-bucket MRR movement decomposition + per-category totals. */
export interface RcMrrMovementResponse {
  currency: string | null;
  buckets: RcMrrMovementBucket[];
  totals: RcMrrMovementTotals;
  approximate: true;
}

type RcMetric = 'revenue' | 'mrr' | 'mrr-movement' | 'active-subscriptions' | 'summary';

interface RcMetricOptions {
  /** Force-disable the query (e.g. RC not connected). Defaults to enabled once the range is set. */
  enabled?: boolean;
}

const purchaseMetricsBase = (projectId: string) => `/api/v1/projects/${projectId}/metrics`;

/** Query key shared by all three metrics — keyed by project, metric, range, and granularity, so a
 *  range/granularity change refetches rather than serving another window's cache. */
export function rcMetricsKey(
  projectId: string,
  metric: RcMetric,
  from: string,
  to: string,
  granularity: RcGranularity,
) {
  return ['rc-purchase-metrics', projectId, metric, from, to, granularity] as const;
}

function metricsUrl(
  projectId: string,
  metric: RcMetric,
  from: string,
  to: string,
  granularity: RcGranularity,
): string {
  return `${purchaseMetricsBase(projectId)}/${metric}?from=${from}&to=${to}&granularity=${granularity}`;
}

/** `/metrics/summary` (spec §1.1) has no `granularity` query param — unlike revenue/mrr/active-subscriptions. */
function summaryUrl(projectId: string, from: string, to: string): string {
  return `${purchaseMetricsBase(projectId)}/summary?from=${from}&to=${to}`;
}

/** Auto-loads once both range bounds are set (mirrors `useSubscriptionsSummary`); `opts.enabled`
 *  can additionally suppress it (mirrors `useRcStatus`). */
function isEnabled(from: string, to: string, opts: RcMetricOptions): boolean {
  return (opts.enabled ?? true) && from.length > 0 && to.length > 0;
}

export function useRcRevenue(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'revenue', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcRevenueResponse>(metricsUrl(projectId, 'revenue', from, to, granularity)),
    enabled: isEnabled(from, to, opts),
  });
}

export function useRcMrr(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'mrr', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcMrrResponse>(metricsUrl(projectId, 'mrr', from, to, granularity)),
    enabled: isEnabled(from, to, opts),
  });
}

export function useRcActiveSubscriptions(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'active-subscriptions', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcActiveSubscriptionsResponse>(
        metricsUrl(projectId, 'active-subscriptions', from, to, granularity),
      ),
    enabled: isEnabled(from, to, opts),
  });
}

/**
 * `GET /metrics/mrr-movement` — the Overview page's MRR Movement chart. Per-bucket decomposition of
 * the change in MRR into new / reactivation / expansion / contraction / churn (+ net). Auto-loads
 * once both range bounds are set, exactly like the other granularity-bearing metrics.
 */
export function useRcMrrMovement(
  projectId: string,
  from: string,
  to: string,
  granularity: RcGranularity,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'mrr-movement', from, to, granularity),
    queryFn: () =>
      purchaseApiFetch<RcMrrMovementResponse>(
        metricsUrl(projectId, 'mrr-movement', from, to, granularity),
      ),
    enabled: isEnabled(from, to, opts),
  });
}

/**
 * `GET /metrics/summary` (spec §1.1/§2) — the Overview page's subscription summary. Returns the
 * exact `SubscriptionsSummaryResponse` shape (`lib/api/types.ts`) so `RcOverviewPage` renders it
 * unchanged. Auto-loads once both range bounds are set (mirrors the other three metrics); the
 * URL carries no `granularity`, but the query key still pins it to `'day'` so `rcMetricsKey`'s
 * shape stays uniform across every purchase-metrics hook.
 */
export function useRcSummary(
  projectId: string,
  from: string,
  to: string,
  opts: RcMetricOptions = {},
) {
  return useQuery({
    queryKey: rcMetricsKey(projectId, 'summary', from, to, 'day'),
    queryFn: () => purchaseApiFetch<SubscriptionsSummaryResponse>(summaryUrl(projectId, from, to)),
    enabled: isEnabled(from, to, opts),
  });
}
