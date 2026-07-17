import { appleNotificationToEvent } from './apple-notification-mapper';
import type { AppleDecodedNotification, AppleDecodedRenewalInfo, AppleDecodedTransactionInfo } from './apple-notification-mapper';

const d = (iso: string): Date => new Date(iso);

/** A fully-populated (non-optional) baseline transaction, so tests can spread + override single
 * fields without TS widening them to `| undefined`. */
function baseTransaction(overrides: Partial<AppleDecodedTransactionInfo> = {}): AppleDecodedTransactionInfo {
  return {
    transactionId: 'txn-1',
    originalTransactionId: 'orig-txn-1',
    productId: 'com.myampix.premium.monthly',
    purchaseDate: d('2026-07-15T00:00:00Z'),
    expiresDate: d('2026-08-15T00:00:00Z'),
    type: 'AUTO_RENEWABLE_SUBSCRIPTION',
    inAppOwnershipType: 'PURCHASED',
    offerType: undefined,
    revocationDate: undefined,
    price: 999,
    currency: 'USD',
    ...overrides,
  };
}

function baseRenewal(overrides: Partial<AppleDecodedRenewalInfo> = {}): AppleDecodedRenewalInfo {
  return {
    autoRenewStatus: 1,
    autoRenewProductId: 'com.myampix.premium.monthly',
    gracePeriodExpiresDate: undefined,
    ...overrides,
  };
}

/** A minimal, fully-populated decoded Apple notification fixture (design §1.1: notification +
 * nested signedTransactionInfo + signedRenewalInfo, already JWS-verified and decoded by M2 — this
 * mapper never touches JWS). Tests override only the fields relevant to each row. */
function fixture(overrides: Partial<AppleDecodedNotification> = {}): AppleDecodedNotification {
  return {
    notificationType: 'SUBSCRIBED',
    subtype: 'INITIAL_BUY',
    signedDate: d('2026-07-15T00:00:00Z'),
    transaction: baseTransaction(),
    renewal: baseRenewal(),
    ...overrides,
  };
}

describe('appleNotificationToEvent — §1.1 table coverage', () => {
  it('SUBSCRIBED/INITIAL_BUY → INITIAL_PURCHASE (paid, no offer)', () => {
    const event = appleNotificationToEvent(fixture());
    expect(event.type).toBe('INITIAL_PURCHASE');
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('NORMAL');
    expect(event.storeProductId).toBe('com.myampix.premium.monthly');
    expect(event.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
    expect(event.autoRenewStatus).toBe(true);
  });

  it('SUBSCRIBED/INITIAL_BUY with offerType FREE_TRIAL → INITIAL_PURCHASE periodType TRIAL', () => {
    const event = appleNotificationToEvent(fixture({ transaction: baseTransaction({ offerType: 'FREE_TRIAL' }) }));
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('TRIAL');
  });

  it('SUBSCRIBED/INITIAL_BUY with offerType INTRODUCTORY → INITIAL_PURCHASE periodType INTRO', () => {
    const event = appleNotificationToEvent(fixture({ transaction: baseTransaction({ offerType: 'INTRODUCTORY' }) }));
    if (event.type !== 'INITIAL_PURCHASE') throw new Error('unreachable');
    expect(event.periodType).toBe('INTRO');
  });

  it('SUBSCRIBED/RESUBSCRIBE → INITIAL_PURCHASE', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'SUBSCRIBED', subtype: 'RESUBSCRIBE' }));
    expect(event.type).toBe('INITIAL_PURCHASE');
  });

  it('DID_RENEW (no subtype) → RENEWED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_RENEW', subtype: undefined }));
    expect(event.type).toBe('RENEWED');
    if (event.type !== 'RENEWED') throw new Error('unreachable');
    expect(event.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
  });

  it('DID_RENEW/BILLING_RECOVERY → BILLING_RECOVERED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_RENEW', subtype: 'BILLING_RECOVERY' }));
    expect(event.type).toBe('BILLING_RECOVERED');
  });

  it('DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED → AUTO_RENEW_DISABLED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_DISABLED' }));
    expect(event.type).toBe('AUTO_RENEW_DISABLED');
  });

  it('DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_ENABLED → AUTO_RENEW_ENABLED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'AUTO_RENEW_ENABLED' }));
    expect(event.type).toBe('AUTO_RENEW_ENABLED');
  });

  it('DID_CHANGE_RENEWAL_STATUS with an unrecognized subtype → NO_OP, not a throw (M3, forward-compatible)', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: 'SOMETHING_APPLE_ADDS_LATER' }));
    expect(event.type).toBe('NO_OP');
  });

  it('DID_CHANGE_RENEWAL_STATUS with a missing subtype → NO_OP, not a throw (M3)', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_CHANGE_RENEWAL_STATUS', subtype: undefined }));
    expect(event.type).toBe('NO_OP');
  });

  it('DID_CHANGE_RENEWAL_PREF/UPGRADE → PRODUCT_CHANGE_IMMEDIATE', () => {
    const event = appleNotificationToEvent(
      fixture({ notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'UPGRADE', transaction: baseTransaction({ productId: 'com.myampix.premium.annual' }) }),
    );
    expect(event.type).toBe('PRODUCT_CHANGE_IMMEDIATE');
    if (event.type !== 'PRODUCT_CHANGE_IMMEDIATE') throw new Error('unreachable');
    expect(event.storeProductId).toBe('com.myampix.premium.annual');
  });

  it('DID_CHANGE_RENEWAL_PREF/DOWNGRADE → PRODUCT_CHANGE_SCHEDULED', () => {
    const event = appleNotificationToEvent(
      fixture({ notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'DOWNGRADE', renewal: baseRenewal({ autoRenewProductId: 'com.myampix.premium.basic' }) }),
    );
    expect(event.type).toBe('PRODUCT_CHANGE_SCHEDULED');
    if (event.type !== 'PRODUCT_CHANGE_SCHEDULED') throw new Error('unreachable');
    expect(event.autoRenewProductId).toBe('com.myampix.premium.basic');
  });

  it('DID_CHANGE_RENEWAL_PREF with an unrecognized subtype → NO_OP, not a throw (M3, forward-compatible)', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_CHANGE_RENEWAL_PREF', subtype: 'SOMETHING_APPLE_ADDS_LATER' }));
    expect(event.type).toBe('NO_OP');
  });

  it('DID_FAIL_TO_RENEW/GRACE_PERIOD → ENTERED_GRACE_PERIOD', () => {
    const event = appleNotificationToEvent(
      fixture({ notificationType: 'DID_FAIL_TO_RENEW', subtype: 'GRACE_PERIOD', renewal: baseRenewal({ gracePeriodExpiresDate: d('2026-07-22T00:00:00Z') }) }),
    );
    expect(event.type).toBe('ENTERED_GRACE_PERIOD');
    if (event.type !== 'ENTERED_GRACE_PERIOD') throw new Error('unreachable');
    expect(event.gracePeriodExpiresAt).toEqual(d('2026-07-22T00:00:00Z'));
  });

  it('DID_FAIL_TO_RENEW (no subtype, no grace) → ENTERED_BILLING_RETRY', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'DID_FAIL_TO_RENEW', subtype: undefined }));
    expect(event.type).toBe('ENTERED_BILLING_RETRY');
  });

  it('GRACE_PERIOD_EXPIRED → GRACE_PERIOD_EXPIRED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'GRACE_PERIOD_EXPIRED', subtype: undefined }));
    expect(event.type).toBe('GRACE_PERIOD_EXPIRED');
  });

  it.each(['VOLUNTARY', 'BILLING_RETRY', 'PRICE_INCREASE', 'PRODUCT_NOT_FOR_SALE'])('EXPIRED/%s → EXPIRED', (subtype) => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'EXPIRED', subtype }));
    expect(event.type).toBe('EXPIRED');
  });

  it('OFFER_REDEEMED → OFFER_REDEEMED', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'OFFER_REDEEMED', subtype: undefined }));
    expect(event.type).toBe('OFFER_REDEEMED');
  });

  it.each(['PENDING', 'ACCEPTED'])('PRICE_INCREASE/%s → PRICE_CHANGE', (subtype) => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'PRICE_INCREASE', subtype }));
    expect(event.type).toBe('PRICE_CHANGE');
  });

  it.each(['RENEWAL_EXTENDED', 'RENEWAL_EXTENSION'])('%s → RENEWAL_EXTENDED', (notificationType) => {
    const event = appleNotificationToEvent(fixture({ notificationType, subtype: undefined }));
    expect(event.type).toBe('RENEWAL_EXTENDED');
    if (event.type !== 'RENEWAL_EXTENDED') throw new Error('unreachable');
    expect(event.expiresAt).toEqual(d('2026-08-15T00:00:00Z'));
  });

  it('REFUND → REVOKED, using revocationDate when present', () => {
    const event = appleNotificationToEvent(
      fixture({ notificationType: 'REFUND', subtype: undefined, transaction: baseTransaction({ revocationDate: d('2026-07-14T00:00:00Z') }) }),
    );
    expect(event.type).toBe('REVOKED');
    if (event.type !== 'REVOKED') throw new Error('unreachable');
    expect(event.revokedAt).toEqual(d('2026-07-14T00:00:00Z'));
  });

  it('REVOKE → REVOKED (Family Sharing access pulled)', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'REVOKE', subtype: undefined }));
    expect(event.type).toBe('REVOKED');
  });

  it('REFUND_REVERSED → REFUND_REVERSED, carrying authoritative expiresAt + autoRenewStatus from the notification (C1 — not from any prior snapshot)', () => {
    const event = appleNotificationToEvent(
      fixture({
        notificationType: 'REFUND_REVERSED',
        subtype: undefined,
        transaction: baseTransaction({ expiresDate: d('2026-09-01T00:00:00Z') }),
        renewal: baseRenewal({ autoRenewStatus: 1 }),
      }),
    );
    expect(event.type).toBe('REFUND_REVERSED');
    if (event.type !== 'REFUND_REVERSED') throw new Error('unreachable');
    expect(event.expiresAt).toEqual(d('2026-09-01T00:00:00Z'));
    expect(event.autoRenewStatus).toBe(true);
  });

  it('REFUND_REVERSED maps autoRenewStatus 0 to false', () => {
    const event = appleNotificationToEvent(
      fixture({ notificationType: 'REFUND_REVERSED', subtype: undefined, renewal: baseRenewal({ autoRenewStatus: 0 }) }),
    );
    if (event.type !== 'REFUND_REVERSED') throw new Error('unreachable');
    expect(event.autoRenewStatus).toBe(false);
  });

  it('REFUND_REVERSED defaults expiresAt to null rather than throwing when transaction info is absent', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'REFUND_REVERSED', subtype: undefined, transaction: undefined }));
    if (event.type !== 'REFUND_REVERSED') throw new Error('unreachable');
    expect(event.expiresAt).toBeNull();
  });

  it.each(['REFUND_DECLINED', 'CONSUMPTION_REQUEST', 'TEST'])('%s → NO_OP', (notificationType) => {
    const event = appleNotificationToEvent(fixture({ notificationType, subtype: undefined }));
    expect(event.type).toBe('NO_OP');
  });

  it('ONE_TIME_CHARGE → ONE_TIME_CHARGE', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'ONE_TIME_CHARGE', subtype: undefined, transaction: baseTransaction({ type: 'CONSUMABLE' }) }));
    expect(event.type).toBe('ONE_TIME_CHARGE');
  });

  it('an unrecognized notificationType maps to NO_OP rather than throwing (forward-compatible)', () => {
    const event = appleNotificationToEvent(fixture({ notificationType: 'SOMETHING_APPLE_ADDS_LATER', subtype: undefined }));
    expect(event.type).toBe('NO_OP');
  });

  it('every mapped event carries occurredAt from signedDate', () => {
    const event = appleNotificationToEvent(fixture({ signedDate: d('2026-07-16T12:34:56Z') }));
    expect(event.occurredAt).toEqual(d('2026-07-16T12:34:56Z'));
  });
});
