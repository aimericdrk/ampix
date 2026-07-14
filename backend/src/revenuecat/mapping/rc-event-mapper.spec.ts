import {
  rcEventName,
  toEventRow,
  deriveStatePatch,
  computeMrrCents,
  profileOpsFor,
} from './rc-event-mapper';
import { rcWebhookBodySchema } from '../webhook/rc-webhook.schema';

const BASE = {
  id: 'evt-uuid-1',
  type: 'INITIAL_PURCHASE',
  app_user_id: 'user-1',
  product_id: 'pro_monthly',
  period_type: 'NORMAL',
  purchased_at_ms: 1_750_000_000_000,
  expiration_at_ms: 1_752_592_000_000, // +30d
  event_timestamp_ms: 1_750_000_001_000,
  store: 'APP_STORE',
  environment: 'PRODUCTION',
  price: 9.99,
  currency: 'USD',
};

describe('rcWebhookBodySchema', () => {
  it('accepts a minimal payload and passes unknown keys through', () => {
    const parsed = rcWebhookBodySchema.parse({ api_version: '1.0', event: { ...BASE, future_field: 1 } });
    expect(parsed.event.id).toBe('evt-uuid-1');
  });
  it('rejects a payload without event.id', () => {
    expect(rcWebhookBodySchema.safeParse({ event: { type: 'RENEWAL', app_user_id: 'u', event_timestamp_ms: 1 } }).success).toBe(false);
  });
});

describe('rcEventName', () => {
  it.each([
    ['INITIAL_PURCHASE', '$rc_initial_purchase'],
    ['RENEWAL', '$rc_renewal'],
    ['CANCELLATION', '$rc_cancellation'],
    ['UNCANCELLATION', '$rc_uncancellation'],
    ['NON_RENEWING_PURCHASE', '$rc_non_renewing_purchase'],
    ['EXPIRATION', '$rc_expiration'],
    ['BILLING_ISSUE', '$rc_billing_issue'],
    ['PRODUCT_CHANGE', '$rc_product_change'],
    ['SUBSCRIPTION_PAUSED', '$rc_paused'],
    ['TRANSFER', '$rc_transfer'],
  ])('%s -> %s', (type, name) => expect(rcEventName(type)).toBe(name));
  it('returns null for TEST and unknown types', () => {
    expect(rcEventName('TEST')).toBeNull();
    expect(rcEventName('SOME_FUTURE_TYPE')).toBeNull();
  });
});

describe('toEventRow', () => {
  it('builds a complete EventRow with $rc_* properties', () => {
    const row = toEventRow('pid-1', 'distinct-1', BASE, 1_750_000_002_000);
    expect(row.project_id).toBe('pid-1');
    expect(row.event).toBe('$rc_initial_purchase');
    expect(row.distinct_id).toBe('distinct-1');
    expect(row.insert_id).toBe('evt-uuid-1');
    expect(row.anon_id).toBe('');
    expect(row.session_id).toBe('');
    expect(row.properties).toMatchObject({
      $rc_event_type: 'INITIAL_PURCHASE',
      $price: 9.99,
      $currency: 'USD',
      $product_id: 'pro_monthly',
      $rc_store: 'APP_STORE',
      $rc_period_type: 'NORMAL',
      $rc_environment: 'PRODUCTION',
    });
    expect(row.screen_width).toBe(0);
    expect(row.sdk_version).toBe('revenuecat-webhook');
  });
});

describe('deriveStatePatch', () => {
  it('INITIAL_PURCHASE NORMAL -> active with price/mrr/spend', () => {
    const p = deriveStatePatch(BASE);
    expect(p.status).toBe('active');
    expect(p.priceCents).toBe(999);
    expect(p.addSpendCents).toBe(999);
    expect(p.mrrCents).toBe(computeMrrCents(999, BASE.purchased_at_ms, BASE.expiration_at_ms));
    expect(p.firstPurchaseAt).toEqual(new Date(BASE.purchased_at_ms));
  });
  it('INITIAL_PURCHASE TRIAL -> trial with zero mrr', () => {
    const p = deriveStatePatch({ ...BASE, period_type: 'TRIAL', price: 0 });
    expect(p.status).toBe('trial');
    expect(p.mrrCents).toBe(0);
    expect(p.addSpendCents).toBe(0);
  });
  it('RENEWAL -> active; CANCELLATION sets cancelledAt only; UNCANCELLATION clears it', () => {
    expect(deriveStatePatch({ ...BASE, type: 'RENEWAL' }).status).toBe('active');
    const c = deriveStatePatch({ ...BASE, type: 'CANCELLATION', price: null });
    expect(c.status).toBeUndefined();
    expect(c.cancelledAt).toEqual(new Date(BASE.event_timestamp_ms));
    const u = deriveStatePatch({ ...BASE, type: 'UNCANCELLATION', price: null });
    expect(u.cancelledAt).toBeNull();
  });
  it('EXPIRATION -> churned with zero mrr; BILLING_ISSUE -> grace; SUBSCRIPTION_PAUSED -> paused', () => {
    const e = deriveStatePatch({ ...BASE, type: 'EXPIRATION', price: null });
    expect(e.status).toBe('churned');
    expect(e.mrrCents).toBe(0);
    expect(deriveStatePatch({ ...BASE, type: 'BILLING_ISSUE', price: null }).status).toBe('grace');
    expect(deriveStatePatch({ ...BASE, type: 'SUBSCRIPTION_PAUSED', price: null }).status).toBe('paused');
  });
  it('PRODUCT_CHANGE updates productId from new_product_id; TRANSFER is a no-op patch', () => {
    expect(deriveStatePatch({ ...BASE, type: 'PRODUCT_CHANGE', new_product_id: 'pro_yearly', price: null }).productId).toBe('pro_yearly');
    expect(deriveStatePatch({ ...BASE, type: 'TRANSFER', price: null })).toEqual({ addSpendCents: 0 });
  });
});

describe('computeMrrCents', () => {
  it('normalizes a 30-day cycle 1:1 and a yearly cycle /12', () => {
    const d = 86_400_000;
    expect(computeMrrCents(999, 0, 30 * d)).toBe(999);
    expect(computeMrrCents(9_999, 0, 365 * d)).toBe(Math.round((9_999 * 30) / 365));
  });
  it('falls back to the raw price when the cycle is unknown', () => {
    expect(computeMrrCents(999, undefined, undefined)).toBe(999);
  });
});

describe('profileOpsFor', () => {
  it('emits one set op with the $rc_* properties', () => {
    const ops = profileOpsFor('distinct-1', {
      status: 'active', productId: 'pro_monthly', store: 'APP_STORE', periodType: 'NORMAL',
      totalSpentCents: 999, firstPurchaseAt: new Date(1_750_000_000_000),
      expiresAt: new Date(1_752_592_000_000), cancelledAt: null,
    }, 1_750_000_002_000);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      distinct_id: 'distinct-1',
      op: 'set',
      timestamp: 1_750_000_002_000,
      properties: {
        $rc_status: 'active',
        $rc_product_id: 'pro_monthly',
        $rc_store: 'APP_STORE',
        $rc_period_type: 'NORMAL',
        $rc_total_spent: 9.99,
        $rc_first_purchase_at: new Date(1_750_000_000_000).toISOString(),
        $rc_expires_at: new Date(1_752_592_000_000).toISOString(),
        $rc_cancelled_at: null,
      },
    });
  });
});
