import { googleNotificationToEvent } from './google-notification-mapper';
import type { GoogleDecodedNotification, GoogleSubscriptionFacts } from './google-notification-mapper';

const d = (iso: string): Date => new Date(iso);
const EVENT_TIME_MILLIS = d('2026-07-15T00:00:00Z').getTime();

function baseFacts(overrides: Partial<GoogleSubscriptionFacts> = {}): GoogleSubscriptionFacts {
  return {
    productId: 'premium_monthly',
    expiryTime: d('2026-08-15T00:00:00Z'),
    autoRenewing: true,
    isTrial: false,
    isIntro: false,
    gracePeriodExpiryTime: undefined,
    priceMicros: 9_990_000,
    currencyCode: 'USD',
    ...overrides,
  };
}

function subscriptionNotification(
  notificationType: number,
  facts: GoogleSubscriptionFacts | undefined = baseFacts(),
): GoogleDecodedNotification {
  return { kind: 'subscription', notificationType, eventTimeMillis: EVENT_TIME_MILLIS, facts };
}

describe('googleNotificationToEvent — §1.2 table coverage', () => {
  it('1 RECOVERED → BILLING_RECOVERED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(1));
    expect(event.type).toBe('BILLING_RECOVERED');
  });

  it('2 RENEWED → RENEWED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(2));
    expect(event.type).toBe('RENEWED');
    if (event.type !== 'RENEWED') throw new Error('unreachable');
    expect(event.storeProductId).toBe('premium_monthly');
    expect(event.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
  });

  it('3 CANCELED → AUTO_RENEW_DISABLED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(3));
    expect(event.type).toBe('AUTO_RENEW_DISABLED');
  });

  it('4 PURCHASED → INITIAL_PURCHASE (paid)', () => {
    const event = googleNotificationToEvent(subscriptionNotification(4));
    expect(event.type).toBe('INITIAL_PURCHASE');
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('NORMAL');
    expect(event.autoRenewStatus).toBe(true);
  });

  it('4 PURCHASED with isTrial → INITIAL_PURCHASE periodType TRIAL', () => {
    const event = googleNotificationToEvent(subscriptionNotification(4, baseFacts({ isTrial: true })));
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('TRIAL');
  });

  it('4 PURCHASED with isIntro → INITIAL_PURCHASE periodType INTRO', () => {
    const event = googleNotificationToEvent(subscriptionNotification(4, baseFacts({ isIntro: true })));
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('INTRO');
  });

  it('5 ON_HOLD → ENTERED_BILLING_RETRY', () => {
    const event = googleNotificationToEvent(subscriptionNotification(5));
    expect(event.type).toBe('ENTERED_BILLING_RETRY');
  });

  it('6 IN_GRACE_PERIOD → ENTERED_GRACE_PERIOD', () => {
    const event = googleNotificationToEvent(subscriptionNotification(6, baseFacts({ gracePeriodExpiryTime: d('2026-07-22T00:00:00Z') })));
    expect(event.type).toBe('ENTERED_GRACE_PERIOD');
    if (event.type !== 'ENTERED_GRACE_PERIOD') throw new Error('unreachable');
    expect(event.gracePeriodExpiresAt).toEqual(d('2026-07-22T00:00:00Z'));
  });

  it('6 IN_GRACE_PERIOD tolerates a missing gracePeriodExpiryTime, emitting gracePeriodExpiresAt: null rather than throwing (M5)', () => {
    const event = googleNotificationToEvent(subscriptionNotification(6, baseFacts({ gracePeriodExpiryTime: undefined })));
    expect(event.type).toBe('ENTERED_GRACE_PERIOD');
    if (event.type !== 'ENTERED_GRACE_PERIOD') throw new Error('unreachable');
    expect(event.gracePeriodExpiresAt).toBeNull();
  });

  it('7 RESTARTED → AUTO_RENEW_ENABLED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(7));
    expect(event.type).toBe('AUTO_RENEW_ENABLED');
  });

  it('8 PRICE_CHANGE_CONFIRMED → PRICE_CHANGE', () => {
    const event = googleNotificationToEvent(subscriptionNotification(8));
    expect(event.type).toBe('PRICE_CHANGE');
  });

  it('9 DEFERRED → RENEWAL_EXTENDED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(9));
    expect(event.type).toBe('RENEWAL_EXTENDED');
    if (event.type !== 'RENEWAL_EXTENDED') throw new Error('unreachable');
    expect(event.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
  });

  it('10 PAUSED → PAUSED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(10));
    expect(event.type).toBe('PAUSED');
  });

  it('11 PAUSE_SCHEDULE_CHANGED → NO_OP (scheduling metadata, not a SubscriptionState field)', () => {
    const event = googleNotificationToEvent(subscriptionNotification(11));
    expect(event.type).toBe('NO_OP');
  });

  it('12 REVOKED → REVOKED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(12));
    expect(event.type).toBe('REVOKED');
  });

  it('13 EXPIRED → EXPIRED', () => {
    const event = googleNotificationToEvent(subscriptionNotification(13));
    expect(event.type).toBe('EXPIRED');
  });

  it('20 PENDING_PURCHASE_CANCELED → NO_OP (abandoned before any grant existed)', () => {
    // No facts: a default parameter can't distinguish "omitted" from an explicit `undefined`
    // argument, so build the input directly to genuinely exercise the no-facts case.
    const event = googleNotificationToEvent({ kind: 'subscription', notificationType: 20, eventTimeMillis: EVENT_TIME_MILLIS });
    expect(event.type).toBe('NO_OP');
  });

  it('an unrecognized notificationType maps to NO_OP rather than throwing (forward-compatible)', () => {
    const event = googleNotificationToEvent(subscriptionNotification(999));
    expect(event.type).toBe('NO_OP');
  });

  it('voidedPurchaseNotification → REVOKED', () => {
    const event = googleNotificationToEvent({ kind: 'voided', eventTimeMillis: EVENT_TIME_MILLIS, refundType: 1 });
    expect(event.type).toBe('REVOKED');
  });

  it.each([1, 2])('oneTimeProductNotification type %d → ONE_TIME_CHARGE', (notificationType) => {
    const event = googleNotificationToEvent({ kind: 'one_time', eventTimeMillis: EVENT_TIME_MILLIS, notificationType, sku: 'coins_100' });
    expect(event.type).toBe('ONE_TIME_CHARGE');
    if (event.type !== 'ONE_TIME_CHARGE') throw new Error('unreachable');
    expect(event.storeProductId).toBe('coins_100');
  });

  it('testNotification → NO_OP', () => {
    const event = googleNotificationToEvent({ kind: 'test', eventTimeMillis: EVENT_TIME_MILLIS });
    expect(event.type).toBe('NO_OP');
  });

  it('every mapped event carries occurredAt from eventTimeMillis', () => {
    const event = googleNotificationToEvent(subscriptionNotification(13));
    expect(event.occurredAt).toEqual(new Date(EVENT_TIME_MILLIS));
  });

  it('a subscriptionNotification requiring facts throws when facts are absent (authoritative fetch is mandatory — design §1.2)', () => {
    // Build the input directly (not via the `subscriptionNotification` helper) since a default
    // parameter can't distinguish "omitted" from an explicit `undefined` argument.
    const input: GoogleDecodedNotification = { kind: 'subscription', notificationType: 2, eventTimeMillis: EVENT_TIME_MILLIS };
    expect(() => googleNotificationToEvent(input)).toThrow();
  });
});
