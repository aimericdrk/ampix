import { describe, expect, it } from 'vitest';
import { rcBase } from './api';
import {
  RC_STATUS_FIXTURE,
  SUBSCRIPTIONS_SUMMARY_FIXTURE,
  SUBSCRIPTION_ATTRIBUTION_FIXTURE,
  USER_SUBSCRIPTION_FIXTURE,
} from '../../test/msw/handlers';

describe('revenuecat api paths', () => {
  it('builds project-scoped integration paths', () => {
    expect(rcBase('p1')).toBe('/api/v1/projects/p1/integrations/revenuecat');
  });
});

// Fixture-shape guards (the real coverage): these fail fast on backend/dashboard drift, since the
// fixtures below are typed against the field-for-field mirrored response interfaces.
describe('revenuecat fixtures satisfy the declared types', () => {
  it('RC_STATUS_FIXTURE has the full counts breakdown', () => {
    expect(RC_STATUS_FIXTURE.counts).toHaveProperty('processed');
    expect(RC_STATUS_FIXTURE.counts).toHaveProperty('failed');
    expect(RC_STATUS_FIXTURE.counts).toHaveProperty('unlinked');
    expect(RC_STATUS_FIXTURE.counts).toHaveProperty('skipped');
    expect(RC_STATUS_FIXTURE.webhook_secret).toBe('rcwh_test_secret_abc123');
    expect(RC_STATUS_FIXTURE.api_key_masked).toMatch(/1234$/);
  });

  it('SUBSCRIPTIONS_SUMMARY_FIXTURE has non-zero realistic breakdowns', () => {
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.mrr_cents).toBe(4995);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.active).toBe(5);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.in_trial).toBe(2);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.by_day).toBeInstanceOf(Array);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.by_day.length).toBeGreaterThan(0);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.by_product.length).toBeGreaterThan(0);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.by_store.length).toBeGreaterThan(0);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.churn_reasons.length).toBeGreaterThan(0);
    expect(SUBSCRIPTIONS_SUMMARY_FIXTURE.recent_events.length).toBeGreaterThan(0);
  });

  it('SUBSCRIPTION_ATTRIBUTION_FIXTURE has a screen_view driver, a Paywall screen, and a trial funnel', () => {
    expect(
      SUBSCRIPTION_ATTRIBUTION_FIXTURE.drivers.some((d) => d.event === '$screen_view'),
    ).toBe(true);
    expect(
      SUBSCRIPTION_ATTRIBUTION_FIXTURE.screens.some((s) => s.screen_name === 'Paywall'),
    ).toBe(true);
    expect(SUBSCRIPTION_ATTRIBUTION_FIXTURE.time_to_convert.length).toBeGreaterThan(0);
    expect(SUBSCRIPTION_ATTRIBUTION_FIXTURE.trial_funnel).toEqual({ trials: 10, converted: 4 });
  });

  it('USER_SUBSCRIPTION_FIXTURE is an active subscription with an rc_customer_url', () => {
    expect(USER_SUBSCRIPTION_FIXTURE.status).toBe('active');
    expect(USER_SUBSCRIPTION_FIXTURE.rc_customer_url).not.toBeNull();
  });
});
