// Mirrors dashboard/src/lib/api/types.ts's SubscriptionsSummaryResponse and the mobile_analytics
// RC-mirror shape (backend/mobile_analytics/src/revenuecat/metrics/rc-summary.service.ts)
// field-for-field, snake_case verbatim, so RcOverviewPage's existing KPI/chart rendering is
// unchanged when it repoints from the mirror onto this endpoint.

export interface SubscriptionsByDay {
  t: string;
  new_subscriptions: number;
  churned: number;
  revenue: number;
}

export interface SubscriptionsByProduct {
  product_id: string;
  active: number;
  mrr_cents: number;
}

export interface SubscriptionsByStore {
  store: string;
  active: number;
}

export interface ChurnReasonCount {
  reason: string;
  count: number;
}

export interface SubscriptionRecentEvent {
  insert_id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  product_id: string;
  price: number;
}

/** `GET /api/v1/projects/:projectId/metrics/summary` response (RC Overview repoint, design §1.1). */
export interface SubscriptionsSummaryResponse {
  mrr_cents: number;
  active: number;
  in_trial: number;
  grace: number;
  new_subscriptions: number;
  churned: number;
  trials_started: number;
  trials_converted: number;
  by_day: SubscriptionsByDay[];
  by_product: SubscriptionsByProduct[];
  by_store: SubscriptionsByStore[];
  churn_reasons: ChurnReasonCount[];
  recent_events: SubscriptionRecentEvent[];
}
