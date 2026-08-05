import { googleNotificationToEvent } from '../../subscriptions/lifecycle/google-notification-mapper';
import {
  GoogleEnvelopeError,
  decodeDeveloperNotification,
  toGoogleDecodedNotification,
  type DeveloperNotification,
} from './google-notification-envelope';

function toBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

const subscriptionEnvelope: DeveloperNotification = {
  version: '1.0',
  packageName: 'com.myampix.app',
  eventTimeMillis: '1721030400000',
  subscriptionNotification: {
    version: '1.0',
    notificationType: 4, // PURCHASED
    purchaseToken: 'token-abc',
    subscriptionId: 'gold-monthly',
  },
};

const voidedEnvelope: DeveloperNotification = {
  version: '1.0',
  packageName: 'com.myampix.app',
  eventTimeMillis: '1721030400000',
  voidedPurchaseNotification: {
    purchaseToken: 'token-abc',
    orderId: 'GPA.1234-5678',
    productType: 1,
    refundType: 1,
  },
};

const oneTimeEnvelope: DeveloperNotification = {
  version: '1.0',
  packageName: 'com.myampix.app',
  eventTimeMillis: '1721030400000',
  oneTimeProductNotification: {
    version: '1.0',
    notificationType: 1, // ONE_TIME_PRODUCT_PURCHASED
    purchaseToken: 'token-xyz',
    sku: 'coins_500',
  },
};

const testEnvelope: DeveloperNotification = {
  version: '1.0',
  packageName: 'com.myampix.app',
  eventTimeMillis: '1721030400000',
  testNotification: { version: '1.0' },
};

describe('decodeDeveloperNotification', () => {
  it('decodes a valid base64 subscriptionNotification envelope', () => {
    expect(decodeDeveloperNotification(toBase64(subscriptionEnvelope))).toEqual(subscriptionEnvelope);
  });

  it('decodes a valid base64 voidedPurchaseNotification envelope', () => {
    expect(decodeDeveloperNotification(toBase64(voidedEnvelope))).toEqual(voidedEnvelope);
  });

  it('decodes a valid base64 oneTimeProductNotification envelope', () => {
    expect(decodeDeveloperNotification(toBase64(oneTimeEnvelope))).toEqual(oneTimeEnvelope);
  });

  it('decodes a valid base64 testNotification envelope', () => {
    expect(decodeDeveloperNotification(toBase64(testEnvelope))).toEqual(testEnvelope);
  });

  it('throws GoogleEnvelopeError when message.data is empty', () => {
    expect(() => decodeDeveloperNotification('')).toThrow(GoogleEnvelopeError);
  });

  it('throws GoogleEnvelopeError on non-base64 input', () => {
    expect(() => decodeDeveloperNotification('not base64!! $$ %%')).toThrow(GoogleEnvelopeError);
  });

  it('throws GoogleEnvelopeError when the decoded content is not valid JSON', () => {
    const notJson = Buffer.from('this is not json', 'utf8').toString('base64');

    expect(() => decodeDeveloperNotification(notJson)).toThrow(GoogleEnvelopeError);
  });

  it('throws GoogleEnvelopeError when required top-level fields are missing', () => {
    const missingPackageName = toBase64({ version: '1.0', eventTimeMillis: '123', testNotification: { version: '1.0' } });

    expect(() => decodeDeveloperNotification(missingPackageName)).toThrow(GoogleEnvelopeError);
  });

  it('throws GoogleEnvelopeError when no recognized sub-notification is present', () => {
    const noSubNotification = toBase64({
      version: '1.0',
      packageName: 'com.myampix.app',
      eventTimeMillis: '1721030400000',
    });

    expect(() => decodeDeveloperNotification(noSubNotification)).toThrow(GoogleEnvelopeError);
  });
});

describe('toGoogleDecodedNotification (the M3a -> M3b -> M4a handoff)', () => {
  it('maps a subscriptionNotification to the "subscription" kind M4a expects', () => {
    const decoded = toGoogleDecodedNotification(subscriptionEnvelope);

    expect(decoded).toEqual({ kind: 'subscription', notificationType: 4, eventTimeMillis: 1721030400000 });
  });

  it('maps a voidedPurchaseNotification to the "voided" kind M4a expects', () => {
    const decoded = toGoogleDecodedNotification(voidedEnvelope);

    expect(decoded).toEqual({ kind: 'voided', eventTimeMillis: 1721030400000, refundType: 1 });
  });

  it('maps a oneTimeProductNotification to the "one_time" kind M4a expects', () => {
    const decoded = toGoogleDecodedNotification(oneTimeEnvelope);

    expect(decoded).toEqual({ kind: 'one_time', eventTimeMillis: 1721030400000, notificationType: 1, sku: 'coins_500' });
  });

  it('maps a testNotification to the "test" kind M4a expects', () => {
    const decoded = toGoogleDecodedNotification(testEnvelope);

    expect(decoded).toEqual({ kind: 'test', eventTimeMillis: 1721030400000 });
  });

  it('is a real, type-checking handoff: the mapped output feeds googleNotificationToEvent directly', () => {
    // "voided" and "test" need no facts at all, so these two prove the M3a output type-checks and
    // behaves as googleNotificationToEvent's input with ZERO further transformation.
    const voidedEvent = googleNotificationToEvent(toGoogleDecodedNotification(voidedEnvelope));
    expect(voidedEvent).toMatchObject({ type: 'REVOKED', occurredAt: new Date(1721030400000) });

    const testEvent = googleNotificationToEvent(toGoogleDecodedNotification(testEnvelope));
    expect(testEvent).toMatchObject({ type: 'NO_OP', reason: 'testNotification' });

    const oneTimeEvent = googleNotificationToEvent(toGoogleDecodedNotification(oneTimeEnvelope));
    expect(oneTimeEvent).toMatchObject({ type: 'ONE_TIME_CHARGE', storeProductId: 'coins_500' });
  });

  it('a subscription notification needing facts (e.g. PURCHASED) type-checks as M4a input and only fails at the documented "missing facts" guard — not a shape mismatch', () => {
    const mapped = toGoogleDecodedNotification(subscriptionEnvelope);

    // M3a never attaches `facts` (that's M3b's job, post authoritative-fetch) — proving the
    // mapper's own "facts are required for PURCHASED" business rule fires, not a TypeScript/shape
    // error, confirms the handoff type lines up exactly with what M4a declared it needs.
    expect(() => googleNotificationToEvent(mapped)).toThrow(/requires the authoritative subscriptionsv2\.get\(\)/);

    // M3b's real flow: spread the M3a output and add the fetched facts.
    const withFacts = {
      ...mapped,
      facts: { productId: 'gold-monthly', expiryTime: new Date('2026-08-15T00:00:00Z'), autoRenewing: true },
    };
    expect(googleNotificationToEvent(withFacts)).toMatchObject({ type: 'INITIAL_PURCHASE', storeProductId: 'gold-monthly' });
  });
});
