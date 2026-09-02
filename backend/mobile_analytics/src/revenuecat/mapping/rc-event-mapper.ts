import type { ProfileOperation } from '@myampix/contracts';
import { EventRow, toChDateTime64 } from '../../clickhouse/clickhouse.service';
import type { RcWebhookEvent } from '../webhook/rc-webhook.schema';

/** Reserved $rc_* names, module-local literals per codebase convention (see IN_APP_PURCHASE_EVENT). */
const RC_EVENT_NAMES: Record<string, string> = {
  INITIAL_PURCHASE: '$rc_initial_purchase',
  RENEWAL: '$rc_renewal',
  CANCELLATION: '$rc_cancellation',
  UNCANCELLATION: '$rc_uncancellation',
  NON_RENEWING_PURCHASE: '$rc_non_renewing_purchase',
  EXPIRATION: '$rc_expiration',
  BILLING_ISSUE: '$rc_billing_issue',
  PRODUCT_CHANGE: '$rc_product_change',
  SUBSCRIPTION_PAUSED: '$rc_paused',
  TRANSFER: '$rc_transfer',
};

export type RcSubscriptionStatus = 'trial' | 'active' | 'grace' | 'paused' | 'churned';

/** null → no analytics event is written (TEST + unknown/future types are journal-only). */
export function rcEventName(type: string): string | null {
  return Object.prototype.hasOwnProperty.call(RC_EVENT_NAMES, type) ? RC_EVENT_NAMES[type] : null;
}

const DAY_MS = 86_400_000;

/** Monthly-normalized recurring cents; cycle inferred from purchase→expiration span. */
export function computeMrrCents(
  priceCents: number,
  purchasedAtMs?: number,
  expirationAtMs?: number | null,
): number {
  if (purchasedAtMs === undefined || expirationAtMs === undefined || expirationAtMs === null) {
    return priceCents;
  }
  const cycleDays = Math.max(1, Math.round((expirationAtMs - purchasedAtMs) / DAY_MS));
  return Math.round((priceCents * 30) / cycleDays);
}

/**
 * ClickHouse's `events.session_id` is a UUID column, and a webhook event has no device session to
 * report. It must still be a PARSEABLE uuid: an empty string is rejected outright
 * (CANNOT_PARSE_UUID) and takes the whole insert down with it, so the row is written with the nil
 * uuid and read back as "no session" (see UsersService's toRecentEvent).
 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function toEventRow(
  projectId: string,
  distinctId: string,
  ev: RcWebhookEvent,
  nowMs: number,
): EventRow {
  const name = rcEventName(ev.type);
  if (name === null) throw new Error(`no analytics event for RC type ${ev.type}`);
  const properties: Record<string, unknown> = {
    $rc_event_type: ev.type,
    $price: ev.price ?? 0,
    $currency: ev.currency ?? '',
    $product_id: ev.product_id ?? '',
    $rc_store: ev.store ?? '',
    $rc_period_type: ev.period_type ?? '',
    $rc_environment: ev.environment ?? '',
  };
  if (ev.cancel_reason) properties.$rc_cancel_reason = ev.cancel_reason;
  if (ev.expiration_reason) properties.$rc_expiration_reason = ev.expiration_reason;
  if (ev.new_product_id) properties.$rc_new_product_id = ev.new_product_id;
  return {
    project_id: projectId,
    insert_id: ev.id,
    event: name,
    distinct_id: distinctId,
    anon_id: '',
    session_id: NIL_UUID,
    timestamp: toChDateTime64(ev.event_timestamp_ms),
    server_timestamp: toChDateTime64(nowMs),
    // A webhook is RevenueCat's server calling ours; the address it came from is theirs, not the
    // end user's, so recording it as the user's IP would be a lie.
    ip: '',
    properties,
    app_version: '',
    app_build: '',
    os: '',
    os_version: '',
    device_model: '',
    device_manufacturer: '',
    locale: '',
    timezone: '',
    screen_width: 0,
    screen_height: 0,
    network: '',
    sdk_version: 'revenuecat-webhook',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
    first_utm_source: '',
    first_utm_campaign: '',
    install_referrer: '',
    // A RevenueCat webhook is server-to-server by construction: no device sent this, RevenueCat's
    // backend did. It carries no ingest token, so the classification is hardcoded rather than read.
    source: 'server',
  };
}

export interface StatePatch {
  status?: RcSubscriptionStatus;
  productId?: string;
  store?: string;
  periodType?: string;
  priceCents?: number;
  currency?: string;
  mrrCents?: number;
  expiresAt?: Date | null;
  cancelledAt?: Date | null;
  firstPurchaseAt?: Date;
  addSpendCents: number;
}

export function deriveStatePatch(ev: RcWebhookEvent): StatePatch {
  const priceCents = Math.round((ev.price ?? 0) * 100);
  const common = {
    productId: ev.product_id ?? undefined,
    store: ev.store ?? undefined,
    periodType: ev.period_type ?? undefined,
    currency: ev.currency ?? undefined,
    expiresAt: ev.expiration_at_ms != null ? new Date(ev.expiration_at_ms) : undefined,
  };
  switch (ev.type) {
    case 'INITIAL_PURCHASE': {
      const trial = ev.period_type === 'TRIAL';
      return {
        ...common,
        status: trial ? 'trial' : 'active',
        priceCents,
        mrrCents: trial ? 0 : computeMrrCents(priceCents, ev.purchased_at_ms, ev.expiration_at_ms),
        addSpendCents: priceCents,
        firstPurchaseAt: new Date(ev.purchased_at_ms ?? ev.event_timestamp_ms),
      };
    }
    case 'RENEWAL':
      return {
        ...common,
        status: 'active',
        priceCents,
        mrrCents: computeMrrCents(priceCents, ev.purchased_at_ms, ev.expiration_at_ms),
        addSpendCents: priceCents,
        cancelledAt: null,
      };
    case 'NON_RENEWING_PURCHASE':
      return { ...common, addSpendCents: priceCents };
    case 'CANCELLATION':
      return { ...common, cancelledAt: new Date(ev.event_timestamp_ms), addSpendCents: 0 };
    case 'UNCANCELLATION':
      return { ...common, cancelledAt: null, addSpendCents: 0 };
    case 'EXPIRATION':
      return { ...common, status: 'churned', mrrCents: 0, addSpendCents: 0 };
    case 'BILLING_ISSUE':
      return { ...common, status: 'grace', addSpendCents: 0 };
    case 'SUBSCRIPTION_PAUSED':
      return { ...common, status: 'paused', mrrCents: 0, addSpendCents: 0 };
    case 'PRODUCT_CHANGE':
      return { ...common, productId: ev.new_product_id ?? ev.product_id ?? undefined, addSpendCents: 0 };
    default:
      // TRANSFER + unknown: journal/event only, no state change.
      return { addSpendCents: 0 };
  }
}

export interface ProfileSnapshot {
  status: string;
  productId: string | null;
  store: string | null;
  periodType: string | null;
  totalSpentCents: number;
  firstPurchaseAt: Date | null;
  expiresAt: Date | null;
  cancelledAt: Date | null;
}

/** The $rc_* profile properties — the "filter everywhere" engine (spec §4.5). */
export function profileOpsFor(
  distinctId: string,
  state: ProfileSnapshot,
  nowMs: number,
): ProfileOperation[] {
  return [
    {
      distinct_id: distinctId,
      op: 'set',
      timestamp: nowMs,
      properties: {
        $rc_status: state.status,
        $rc_product_id: state.productId ?? '',
        $rc_store: state.store ?? '',
        $rc_period_type: state.periodType ?? '',
        $rc_total_spent: state.totalSpentCents / 100,
        $rc_first_purchase_at: state.firstPurchaseAt ? state.firstPurchaseAt.toISOString() : null,
        $rc_expires_at: state.expiresAt ? state.expiresAt.toISOString() : null,
        $rc_cancelled_at: state.cancelledAt ? state.cancelledAt.toISOString() : null,
      },
    },
  ];
}
