import { applyLifecycleEvent } from './subscription-lifecycle-reducer';
import type { InitialPurchaseEvent, SubscriptionLifecycleEvent, SubscriptionState } from './subscription-lifecycle.types';

const d = (iso: string): Date => new Date(iso);

/** A fully-populated ACTIVE state to use as the "current" fixture for transition tests, so each
 * test only needs to override the fields relevant to the transition under test. */
function activeState(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: 'ACTIVE',
    expiresAt: d('2026-08-01T00:00:00Z'),
    autoRenewStatus: true,
    autoRenewProductId: null,
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    gracePeriodExpiresAt: null,
    refundedAt: null,
    periodType: 'NORMAL',
    lastEventAt: d('2026-07-01T00:00:00Z'),
    storeProductId: 'com.myampix.premium.monthly',
    purchasedAt: d('2026-07-01T00:00:00Z'),
    originalPurchasedAt: d('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('applyLifecycleEvent — initial purchase (current === null)', () => {
  it('creates a TRIAL state from a trial INITIAL_PURCHASE', () => {
    const event: InitialPurchaseEvent = {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-07-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      periodType: 'TRIAL',
      purchasedAt: d('2026-07-01T00:00:00Z'),
      expiresAt: d('2026-07-08T00:00:00Z'),
      autoRenewStatus: true,
    };
    const result = applyLifecycleEvent(null, event);
    expect(result.status).toBe('TRIAL');
    expect(result.periodType).toBe('TRIAL');
    expect(result.expiresAt).toEqual(d('2026-07-08T00:00:00Z'));
    expect(result.autoRenewStatus).toBe(true);
    expect(result.lastEventAt).toEqual(d('2026-07-01T00:00:00Z'));
    expect(result.originalPurchasedAt).toEqual(d('2026-07-01T00:00:00Z')); // defaults to purchasedAt
    expect(result.unsubscribeDetectedAt).toBeNull();
    expect(result.refundedAt).toBeNull();
  });

  it('creates an INTRO state from an introductory-offer INITIAL_PURCHASE', () => {
    const result = applyLifecycleEvent(null, {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-07-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.annual',
      periodType: 'INTRO',
      purchasedAt: d('2026-07-01T00:00:00Z'),
      expiresAt: d('2026-08-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('INTRO');
    expect(result.periodType).toBe('INTRO');
  });

  it('creates an ACTIVE state from a straight paid INITIAL_PURCHASE (no trial/intro)', () => {
    const result = applyLifecycleEvent(null, {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-07-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      periodType: 'NORMAL',
      purchasedAt: d('2026-07-01T00:00:00Z'),
      expiresAt: d('2026-08-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.periodType).toBe('NORMAL');
  });

  it('respects an explicit originalPurchasedAt distinct from purchasedAt (e.g. a resubscribe)', () => {
    const result = applyLifecycleEvent(null, {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-07-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      periodType: 'NORMAL',
      purchasedAt: d('2026-07-01T00:00:00Z'),
      originalPurchasedAt: d('2025-01-01T00:00:00Z'),
      expiresAt: d('2026-08-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.originalPurchasedAt).toEqual(d('2025-01-01T00:00:00Z'));
  });

  it('throws for a state-bearing event with no current state (nothing to update, and nothing to originate from) — a caller/identity-resolution defect (I2)', () => {
    expect(() => applyLifecycleEvent(null, { type: 'RENEWED', occurredAt: d('2026-07-01T00:00:00Z'), storeProductId: 'x', expiresAt: d('2026-08-01T00:00:00Z') })).toThrow();
    expect(() => applyLifecycleEvent(null, { type: 'AUTO_RENEW_DISABLED', occurredAt: d('2026-07-01T00:00:00Z') })).toThrow();
  });

  it('returns null (not a throw) for a no-effect event with no current state (I2) — still no subscription, not an error', () => {
    expect(applyLifecycleEvent(null, { type: 'NO_OP', occurredAt: d('2026-07-01T00:00:00Z') })).toBeNull();
    expect(applyLifecycleEvent(null, { type: 'PRICE_CHANGE', occurredAt: d('2026-07-01T00:00:00Z') })).toBeNull();
    expect(applyLifecycleEvent(null, { type: 'ONE_TIME_CHARGE', occurredAt: d('2026-07-01T00:00:00Z') })).toBeNull();
  });
});

describe('applyLifecycleEvent — ordering guard (design §7)', () => {
  it('ignores an event strictly older than lastEventAt, returning current completely unchanged', () => {
    const current = activeState({ lastEventAt: d('2026-07-10T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_DISABLED',
      occurredAt: d('2026-07-09T23:59:59Z'), // older
    });
    expect(result).toEqual(current);
    expect(result.status).toBe('ACTIVE'); // the disable did NOT apply
  });

  it('applies an event whose occurredAt exactly equals lastEventAt (not "strictly older")', () => {
    const current = activeState({ lastEventAt: d('2026-07-10T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_DISABLED',
      occurredAt: d('2026-07-10T00:00:00Z'),
    });
    expect(result.status).toBe('CANCELLED');
  });

  it('applies a newer event normally and bumps lastEventAt', () => {
    const current = activeState({ lastEventAt: d('2026-07-10T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_DISABLED',
      occurredAt: d('2026-07-11T00:00:00Z'),
    });
    expect(result.lastEventAt).toEqual(d('2026-07-11T00:00:00Z'));
  });
});

describe('applyLifecycleEvent — renewal / billing recovery', () => {
  it('RENEWED converts a TRIAL into ACTIVE and extends expiresAt (design §4 trial → active)', () => {
    const current = activeState({ status: 'TRIAL', periodType: 'TRIAL', expiresAt: d('2026-07-08T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'RENEWED',
      occurredAt: d('2026-07-08T00:05:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      expiresAt: d('2026-08-08T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.periodType).toBe('NORMAL');
    expect(result.expiresAt).toEqual(d('2026-08-08T00:00:00Z'));
  });

  it('RENEWED clears any pending billing issue / grace period fields', () => {
    const current = activeState({
      status: 'GRACE_PERIOD',
      billingIssueDetectedAt: d('2026-07-01T00:00:00Z'),
      gracePeriodExpiresAt: d('2026-07-15T00:00:00Z'),
    });
    const result = applyLifecycleEvent(current, {
      type: 'RENEWED',
      occurredAt: d('2026-07-10T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      expiresAt: d('2026-08-10T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.billingIssueDetectedAt).toBeNull();
    expect(result.gracePeriodExpiresAt).toBeNull();
  });

  it('BILLING_RECOVERED returns to ACTIVE and clears billing-issue fields', () => {
    const current = activeState({
      status: 'BILLING_RETRY',
      billingIssueDetectedAt: d('2026-07-01T00:00:00Z'),
    });
    const result = applyLifecycleEvent(current, {
      type: 'BILLING_RECOVERED',
      occurredAt: d('2026-07-12T00:00:00Z'),
      expiresAt: d('2026-08-12T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.billingIssueDetectedAt).toBeNull();
    expect(result.gracePeriodExpiresAt).toBeNull();
    expect(result.expiresAt).toEqual(d('2026-08-12T00:00:00Z'));
  });
});

describe('applyLifecycleEvent — cancellation stays entitled (RC-fidelity check)', () => {
  it('AUTO_RENEW_DISABLED sets CANCELLED + unsubscribeDetectedAt but leaves expiresAt (still entitled) untouched', () => {
    const current = activeState({ expiresAt: d('2026-08-01T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_DISABLED',
      occurredAt: d('2026-07-15T00:00:00Z'),
    });
    expect(result.status).toBe('CANCELLED');
    expect(result.autoRenewStatus).toBe(false);
    expect(result.unsubscribeDetectedAt).toEqual(d('2026-07-15T00:00:00Z'));
    // still entitled until expiry — the design's compute-on-read isActive() would read this as active:
    expect(result.expiresAt).toEqual(d('2026-08-01T00:00:00Z'));
  });

  it('AUTO_RENEW_ENABLED clears the cancellation and returns to ACTIVE', () => {
    const current = activeState({
      status: 'CANCELLED',
      autoRenewStatus: false,
      unsubscribeDetectedAt: d('2026-07-15T00:00:00Z'),
    });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_ENABLED',
      occurredAt: d('2026-07-20T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.autoRenewStatus).toBe(true);
    expect(result.unsubscribeDetectedAt).toBeNull();
  });
});

describe('applyLifecycleEvent — product change (upgrade / downgrade)', () => {
  it('PRODUCT_CHANGE_IMMEDIATE (upgrade) switches product now and clears any pending downgrade', () => {
    const current = activeState({ autoRenewProductId: 'com.myampix.premium.annual.pending' });
    const result = applyLifecycleEvent(current, {
      type: 'PRODUCT_CHANGE_IMMEDIATE',
      occurredAt: d('2026-07-15T00:00:00Z'),
      storeProductId: 'com.myampix.premium.annual',
      purchasedAt: d('2026-07-15T00:00:00Z'),
      expiresAt: d('2027-07-15T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.storeProductId).toBe('com.myampix.premium.annual');
    expect(result.purchasedAt).toEqual(d('2026-07-15T00:00:00Z'));
    expect(result.expiresAt).toEqual(d('2027-07-15T00:00:00Z'));
    expect(result.periodType).toBe('NORMAL');
    expect(result.autoRenewProductId).toBeNull();
  });

  it('PRODUCT_CHANGE_SCHEDULED (downgrade) only records the pending product, no immediate effect', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'PRODUCT_CHANGE_SCHEDULED',
      occurredAt: d('2026-07-15T00:00:00Z'),
      autoRenewProductId: 'com.myampix.premium.basic',
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.storeProductId).toBe(current.storeProductId); // unchanged until next renewal
    expect(result.autoRenewProductId).toBe('com.myampix.premium.basic');
  });
});

describe('applyLifecycleEvent — grace period / billing retry', () => {
  it('ENTERED_GRACE_PERIOD is still entitled: GRACE_PERIOD + billingIssueDetectedAt + gracePeriodExpiresAt', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'ENTERED_GRACE_PERIOD',
      occurredAt: d('2026-07-15T00:00:00Z'),
      gracePeriodExpiresAt: d('2026-07-22T00:00:00Z'),
    });
    expect(result.status).toBe('GRACE_PERIOD');
    expect(result.billingIssueDetectedAt).toEqual(d('2026-07-15T00:00:00Z'));
    expect(result.gracePeriodExpiresAt).toEqual(d('2026-07-22T00:00:00Z'));
  });

  it('ENTERED_BILLING_RETRY (no grace) is NOT entitled: BILLING_RETRY + billingIssueDetectedAt, no grace date', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'ENTERED_BILLING_RETRY',
      occurredAt: d('2026-07-15T00:00:00Z'),
    });
    expect(result.status).toBe('BILLING_RETRY');
    expect(result.billingIssueDetectedAt).toEqual(d('2026-07-15T00:00:00Z'));
    expect(result.gracePeriodExpiresAt).toBeNull();
  });

  it('GRACE_PERIOD_EXPIRED moves from GRACE_PERIOD to BILLING_RETRY (access now off, store still retrying)', () => {
    const current = activeState({
      status: 'GRACE_PERIOD',
      billingIssueDetectedAt: d('2026-07-15T00:00:00Z'),
      gracePeriodExpiresAt: d('2026-07-22T00:00:00Z'),
    });
    const result = applyLifecycleEvent(current, {
      type: 'GRACE_PERIOD_EXPIRED',
      occurredAt: d('2026-07-22T00:00:01Z'),
    });
    expect(result.status).toBe('BILLING_RETRY');
  });
});

describe('applyLifecycleEvent — pause / resume (Google-only)', () => {
  it('PAUSED sets PAUSED, not entitled, but keeps willRenew intent true', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'PAUSED',
      occurredAt: d('2026-07-15T00:00:00Z'),
    });
    expect(result.status).toBe('PAUSED');
    expect(result.autoRenewStatus).toBe(true);
  });

  it('RESUMED returns a PAUSED subscription to ACTIVE', () => {
    const current = activeState({ status: 'PAUSED' });
    const result = applyLifecycleEvent(current, {
      type: 'RESUMED',
      occurredAt: d('2026-07-20T00:00:00Z'),
      expiresAt: d('2026-08-20T00:00:00Z'),
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.expiresAt).toEqual(d('2026-08-20T00:00:00Z'));
  });
});

describe('applyLifecycleEvent — expiry', () => {
  it('EXPIRED sets the terminal EXPIRED status', () => {
    const current = activeState({ status: 'BILLING_RETRY' });
    const result = applyLifecycleEvent(current, { type: 'EXPIRED', occurredAt: d('2026-08-01T00:00:00Z') });
    expect(result.status).toBe('EXPIRED');
  });
});

describe('applyLifecycleEvent — refund / revoke / reversal', () => {
  it('REVOKED is an immediate loss of access regardless of prior status', () => {
    const current = activeState({ status: 'GRACE_PERIOD' });
    const result = applyLifecycleEvent(current, {
      type: 'REVOKED',
      occurredAt: d('2026-07-16T00:00:00Z'),
    });
    expect(result.status).toBe('REVOKED');
    expect(result.refundedAt).toEqual(d('2026-07-16T00:00:00Z'));
  });

  it('REVOKED uses an explicit revokedAt over occurredAt when both are given', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'REVOKED',
      occurredAt: d('2026-07-16T00:00:00Z'),
      revokedAt: d('2026-07-14T00:00:00Z'),
    });
    expect(result.refundedAt).toEqual(d('2026-07-14T00:00:00Z'));
  });

  it('REFUND_REVERSED restores a REVOKED subscription reloaded from the DB (no in-memory snapshot — C1) to ACTIVE when still auto-renewing and not yet expired', () => {
    // The DB-reload shape M2/M3 actually hand the reducer in production: load the CURRENT
    // Subscription row (status REVOKED, no snapshot field — it was never a Prisma column), then
    // apply a separately-delivered REFUND_REVERSED webhook. This is a fresh literal, built with no
    // relation to any prior in-process revoke call — proving restoration doesn't depend on one.
    const revoked: SubscriptionState = activeState({
      status: 'REVOKED',
      refundedAt: d('2026-07-16T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
      autoRenewStatus: true,
      lastEventAt: d('2026-07-16T00:00:00Z'),
    });
    const result = applyLifecycleEvent(revoked, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-07-18T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.expiresAt).toEqual(d('2026-09-01T00:00:00Z'));
    expect(result.autoRenewStatus).toBe(true);
    expect(result.refundedAt).toBeNull();
    expect(result.billingIssueDetectedAt).toBeNull();
    expect(result.gracePeriodExpiresAt).toBeNull();
    expect(result.lastEventAt).toEqual(d('2026-07-18T00:00:00Z'));
  });

  it('REFUND_REVERSED restores a reloaded REVOKED subscription to CANCELLED when auto-renew is off but not yet expired (entitled until expiry, not renewing)', () => {
    const revoked: SubscriptionState = activeState({
      status: 'REVOKED',
      refundedAt: d('2026-07-16T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
      autoRenewStatus: false,
      lastEventAt: d('2026-07-16T00:00:00Z'),
    });
    const result = applyLifecycleEvent(revoked, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-07-18T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
      autoRenewStatus: false,
    });
    expect(result.status).toBe('CANCELLED');
    expect(result.autoRenewStatus).toBe(false);
    expect(result.expiresAt).toEqual(d('2026-09-01T00:00:00Z'));
    expect(result.refundedAt).toBeNull();
  });

  it('REFUND_REVERSED restores a reloaded REVOKED subscription to EXPIRED when the authoritative expiresAt is already at/before the reversal event time', () => {
    const revoked: SubscriptionState = activeState({
      status: 'REVOKED',
      refundedAt: d('2026-07-16T00:00:00Z'),
      expiresAt: d('2026-07-17T00:00:00Z'),
      autoRenewStatus: true,
      lastEventAt: d('2026-07-16T00:00:00Z'),
    });
    const result = applyLifecycleEvent(revoked, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-07-18T00:00:00Z'), // after expiresAt
      expiresAt: d('2026-07-17T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('EXPIRED');
    expect(result.refundedAt).toBeNull();
  });

  it('REFUND_REVERSED recompute uses event.occurredAt as the reference time, never a wall clock', () => {
    const revoked: SubscriptionState = activeState({
      status: 'REVOKED',
      refundedAt: d('2020-01-01T00:00:00Z'),
      expiresAt: d('2020-02-01T00:00:00Z'), // long expired by any real "now"
      autoRenewStatus: true,
      lastEventAt: d('2020-01-01T00:00:00Z'),
    });
    const result = applyLifecycleEvent(revoked, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2020-01-15T00:00:00Z'), // still before expiresAt AT THE TIME OF THIS EVENT
      expiresAt: d('2020-02-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('ACTIVE');
  });

  it('REFUND_REVERSED restores an in-process revoke→reverse using the event\'s own authoritative fields, not a snapshot of what preceded the revoke', () => {
    const current = activeState({
      status: 'CANCELLED',
      autoRenewStatus: false,
      unsubscribeDetectedAt: d('2026-07-01T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
    });
    const revoked = applyLifecycleEvent(current, { type: 'REVOKED', occurredAt: d('2026-07-16T00:00:00Z') });
    expect(revoked.status).toBe('REVOKED');

    const reversed = applyLifecycleEvent(revoked, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-07-18T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
      autoRenewStatus: false, // matches what was true pre-revoke, but supplied by the event, not read back from it
    });
    expect(reversed.status).toBe('CANCELLED'); // recomputed (autoRenewStatus false, not yet expired), not replayed from a snapshot
    expect(reversed.autoRenewStatus).toBe(false);
    expect(reversed.expiresAt).toEqual(d('2026-09-01T00:00:00Z'));
    expect(reversed.refundedAt).toBeNull();
    expect(reversed.lastEventAt).toEqual(d('2026-07-18T00:00:00Z'));
    // Fields the recompute doesn't touch are carried through from `current` (still REVOKED at
    // that point) untouched, as an ordinary spread — not restored from any snapshot.
    expect(reversed.unsubscribeDetectedAt).toEqual(d('2026-07-01T00:00:00Z'));
  });

  it('REFUND_REVERSED on a non-revoked subscription is a no-op (bumps lastEventAt only, nothing to restore)', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-07-20T00:00:00Z'),
      expiresAt: current.expiresAt,
      autoRenewStatus: current.autoRenewStatus,
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.lastEventAt).toEqual(d('2026-07-20T00:00:00Z'));
  });
});

describe('applyLifecycleEvent — extension / price / offer / one-time / no-op', () => {
  it('RENEWAL_EXTENDED extends expiresAt only, no status change', () => {
    const current = activeState({ status: 'GRACE_PERIOD' });
    const result = applyLifecycleEvent(current, {
      type: 'RENEWAL_EXTENDED',
      occurredAt: d('2026-07-15T00:00:00Z'),
      expiresAt: d('2026-09-01T00:00:00Z'),
    });
    expect(result.status).toBe('GRACE_PERIOD');
    expect(result.expiresAt).toEqual(d('2026-09-01T00:00:00Z'));
  });

  it('PRICE_CHANGE has no field effect at all — not even lastEventAt (I1)', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, { type: 'PRICE_CHANGE', occurredAt: d('2026-07-15T00:00:00Z') });
    expect(result).toEqual(current);
    expect(result.lastEventAt).toEqual(current.lastEventAt);
  });

  it('OFFER_REDEEMED updates periodType/product/expiresAt', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, {
      type: 'OFFER_REDEEMED',
      occurredAt: d('2026-07-15T00:00:00Z'),
      storeProductId: 'com.myampix.premium.winback',
      periodType: 'PROMO',
      expiresAt: d('2026-08-15T00:00:00Z'),
    });
    expect(result.periodType).toBe('PROMO');
    expect(result.storeProductId).toBe('com.myampix.premium.winback');
    expect(result.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
  });

  it('ONE_TIME_CHARGE is a no-op on Subscription state (Transaction-only per design §2/§4) — not even lastEventAt (I1)', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, { type: 'ONE_TIME_CHARGE', occurredAt: d('2026-07-15T00:00:00Z') });
    expect(result).toEqual(current);
    expect(result.lastEventAt).toEqual(current.lastEventAt);
  });

  it('NO_OP leaves every field, including lastEventAt, completely untouched (I1)', () => {
    const current = activeState();
    const result = applyLifecycleEvent(current, { type: 'NO_OP', occurredAt: d('2026-07-15T00:00:00Z'), reason: 'TEST ping' });
    expect(result).toEqual(current);
    expect(result.lastEventAt).toEqual(current.lastEventAt);
  });
});

describe('applyLifecycleEvent — no-effect events never advance the ordering high-water mark (I1)', () => {
  it("a later out-of-order PRICE_CHANGE no longer masks an earlier real transition delivered afterward (the reviewer's breaking sequence)", () => {
    // Real-world out-of-order delivery: PRICE_INCREASE/PENDING @07-12 arrives BEFORE
    // AUTO_RENEW_DISABLED @07-10. Before the fix, PRICE_CHANGE (a no-op) still bumped
    // lastEventAt to 07-12, so the older-but-not-yet-applied AUTO_RENEW_DISABLED @07-10 would
    // then be silently dropped by the ordering guard — the cancellation is lost and the SDK is
    // told the subscription will still renew.
    let state: SubscriptionState = activeState({ lastEventAt: d('2026-07-01T00:00:00Z') });

    state = applyLifecycleEvent(state, { type: 'PRICE_CHANGE', occurredAt: d('2026-07-12T00:00:00Z') });
    expect(state.lastEventAt).toEqual(d('2026-07-01T00:00:00Z')); // NOT advanced to 07-12

    state = applyLifecycleEvent(state, { type: 'AUTO_RENEW_DISABLED', occurredAt: d('2026-07-10T00:00:00Z') });
    expect(state.status).toBe('CANCELLED');
    expect(state.autoRenewStatus).toBe(false);
    expect(state.lastEventAt).toEqual(d('2026-07-10T00:00:00Z'));
  });

  it('NO_OP / PRICE_CHANGE / ONE_TIME_CHARGE also leave a terminal (EXPIRED) subscription\'s lastEventAt untouched', () => {
    const current = activeState({ status: 'EXPIRED', lastEventAt: d('2026-08-01T00:00:00Z') });
    for (const event of [
      { type: 'NO_OP' as const, occurredAt: d('2026-08-05T00:00:00Z') },
      { type: 'PRICE_CHANGE' as const, occurredAt: d('2026-08-05T00:00:00Z') },
      { type: 'ONE_TIME_CHARGE' as const, occurredAt: d('2026-08-05T00:00:00Z') },
    ]) {
      const result = applyLifecycleEvent(current, event);
      expect(result).toEqual(current);
    }
  });
});

describe('applyLifecycleEvent — terminal-state discipline', () => {
  it('an EXPIRED subscription ignores further transitions other than a fresh purchase', () => {
    const current = activeState({ status: 'EXPIRED', lastEventAt: d('2026-08-01T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'RENEWED',
      occurredAt: d('2026-08-05T00:00:00Z'),
      storeProductId: current.storeProductId,
      expiresAt: d('2026-09-05T00:00:00Z'),
    });
    expect(result.status).toBe('EXPIRED');
    expect(result.expiresAt).toEqual(current.expiresAt); // untouched
    expect(result.lastEventAt).toEqual(d('2026-08-05T00:00:00Z')); // still bumped (seen, no effect)
  });

  it('an EXPIRED subscription ignores REFUND_REVERSED (nothing to reverse) — EXPIRED only exits via a fresh purchase, unlike REVOKED', () => {
    const current = activeState({ status: 'EXPIRED', lastEventAt: d('2026-08-01T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'REFUND_REVERSED',
      occurredAt: d('2026-08-05T00:00:00Z'),
      expiresAt: current.expiresAt,
      autoRenewStatus: current.autoRenewStatus,
    });
    expect(result.status).toBe('EXPIRED');
  });

  it('a fresh INITIAL_PURCHASE moves an EXPIRED subscription out of the terminal state', () => {
    const current = activeState({ status: 'EXPIRED', lastEventAt: d('2026-08-01T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-09-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      periodType: 'NORMAL',
      purchasedAt: d('2026-09-01T00:00:00Z'),
      expiresAt: d('2026-10-01T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('ACTIVE');
    expect(result.unsubscribeDetectedAt).toBeNull();
  });

  it('a REVOKED subscription ignores further transitions other than a fresh purchase or REFUND_REVERSED', () => {
    const current = activeState({ status: 'REVOKED', refundedAt: d('2026-07-16T00:00:00Z'), lastEventAt: d('2026-07-16T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'AUTO_RENEW_ENABLED',
      occurredAt: d('2026-07-17T00:00:00Z'),
    });
    expect(result.status).toBe('REVOKED');
    expect(result.lastEventAt).toEqual(d('2026-07-17T00:00:00Z'));
  });

  it('a fresh INITIAL_PURCHASE moves a REVOKED subscription out of the terminal state', () => {
    const current = activeState({ status: 'REVOKED', refundedAt: d('2026-07-16T00:00:00Z') });
    const result = applyLifecycleEvent(current, {
      type: 'INITIAL_PURCHASE',
      occurredAt: d('2026-08-01T00:00:00Z'),
      storeProductId: 'com.myampix.premium.monthly',
      periodType: 'TRIAL',
      purchasedAt: d('2026-08-01T00:00:00Z'),
      expiresAt: d('2026-08-08T00:00:00Z'),
      autoRenewStatus: true,
    });
    expect(result.status).toBe('TRIAL');
    expect(result.refundedAt).toBeNull();
  });
});
