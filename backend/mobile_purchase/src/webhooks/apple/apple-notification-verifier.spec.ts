import { VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import {
  AppleNotificationVerifier,
  AppleSignatureError,
  ApplePayloadError,
  type AppleVerifierLike,
} from './apple-notification-verifier';

const d = (iso: string): number => Date.parse(iso);

function outerPayload(overrides: Record<string, unknown> = {}) {
  return {
    notificationType: 'SUBSCRIBED',
    subtype: 'INITIAL_BUY',
    notificationUUID: 'notification-uuid-1',
    version: '2.0',
    signedDate: d('2026-07-15T00:00:00Z'),
    data: {
      bundleId: 'com.myampix.app',
      environment: 'Sandbox',
      appAppleId: undefined,
      signedTransactionInfo: 'jws.signed.transaction',
      signedRenewalInfo: 'jws.signed.renewal',
    },
    ...overrides,
  };
}

function txnPayload(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'txn-1',
    originalTransactionId: 'orig-txn-1',
    productId: 'com.myampix.premium.monthly',
    type: 'Auto-Renewable Subscription',
    purchaseDate: d('2026-07-15T00:00:00Z'),
    expiresDate: d('2026-08-15T00:00:00Z'),
    inAppOwnershipType: 'PURCHASED',
    appAccountToken: 'app-account-token-uuid',
    offerType: undefined,
    offerDiscountType: undefined,
    revocationDate: undefined,
    price: 9990, // milliunits ($9.99)
    currency: 'USD',
    ...overrides,
  };
}

function renewalPayload(overrides: Record<string, unknown> = {}) {
  return {
    autoRenewStatus: 1,
    autoRenewProductId: 'com.myampix.premium.monthly',
    gracePeriodExpiresDate: undefined,
    offerType: undefined,
    renewalDate: d('2026-08-15T00:00:00Z'),
    ...overrides,
  };
}

function fakeVerifier(overrides: Partial<AppleVerifierLike> = {}): AppleVerifierLike {
  return {
    verifyAndDecodeNotification: jest.fn().mockResolvedValue(outerPayload()),
    verifyAndDecodeTransaction: jest.fn().mockResolvedValue(txnPayload()),
    verifyAndDecodeRenewalInfo: jest.fn().mockResolvedValue(renewalPayload()),
    ...overrides,
  } as AppleVerifierLike;
}

describe('AppleNotificationVerifier', () => {
  it('verifies and decodes a full notification into the exact shape the M4a mapper needs', async () => {
    const verifier = new AppleNotificationVerifier([fakeVerifier()]);

    const decoded = await verifier.verifyAndDecode('signed-payload');

    expect(decoded).toEqual({
      notificationType: 'SUBSCRIBED',
      subtype: 'INITIAL_BUY',
      notificationUUID: 'notification-uuid-1',
      signedDate: new Date('2026-07-15T00:00:00Z'),
      bundleId: 'com.myampix.app',
      environment: 'Sandbox',
      appAppleId: undefined,
      transaction: {
        transactionId: 'txn-1',
        originalTransactionId: 'orig-txn-1',
        productId: 'com.myampix.premium.monthly',
        purchaseDate: new Date('2026-07-15T00:00:00Z'),
        expiresDate: new Date('2026-08-15T00:00:00Z'),
        type: 'Auto-Renewable Subscription',
        inAppOwnershipType: 'PURCHASED',
        offerType: undefined,
        revocationDate: undefined,
        price: 999, // 9990 milliunits -> 999 cents
        currency: 'USD',
        appAccountToken: 'app-account-token-uuid',
      },
      renewal: {
        autoRenewStatus: 1,
        autoRenewProductId: 'com.myampix.premium.monthly',
        gracePeriodExpiresDate: undefined,
      },
    });
  });

  it('omits transaction/renewal when signedTransactionInfo/signedRenewalInfo are absent (e.g. a TEST notification)', async () => {
    const av = fakeVerifier({
      verifyAndDecodeNotification: jest.fn().mockResolvedValue(
        outerPayload({
          notificationType: 'TEST',
          subtype: undefined,
          data: { bundleId: 'com.myampix.app', environment: 'Sandbox' },
        }),
      ),
    });
    const verifier = new AppleNotificationVerifier([av]);

    const decoded = await verifier.verifyAndDecode('signed-payload');

    expect(decoded.notificationType).toBe('TEST');
    expect(decoded.transaction).toBeUndefined();
    expect(decoded.renewal).toBeUndefined();
    expect(av.verifyAndDecodeTransaction).not.toHaveBeenCalled();
    expect(av.verifyAndDecodeRenewalInfo).not.toHaveBeenCalled();
  });

  describe('offerType normalization (feeds appleNotificationToEvent.periodTypeFromOfferType)', () => {
    it.each([
      [{ offerDiscountType: 'FREE_TRIAL' }, 'FREE_TRIAL'],
      [{ offerType: 1, offerDiscountType: undefined }, 'INTRODUCTORY'], // OfferType.INTRODUCTORY_OFFER
      [{ offerType: 2, offerDiscountType: undefined }, 'PROMOTIONAL'], // OfferType.PROMOTIONAL_OFFER
      [{ offerType: 3, offerDiscountType: undefined }, 'OFFER_CODE'], // OfferType.OFFER_CODE
      [{ offerType: 4, offerDiscountType: undefined }, 'WIN_BACK'], // OfferType.WIN_BACK_OFFER
      [{ offerType: undefined, offerDiscountType: undefined }, undefined],
    ])('%j -> %s', async (overrides, expected) => {
      const av = fakeVerifier({ verifyAndDecodeTransaction: jest.fn().mockResolvedValue(txnPayload(overrides)) });
      const decoded = await new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload');
      expect(decoded.transaction?.offerType).toBe(expected);
    });
  });

  it('throws AppleSignatureError when the outer JWS fails verification', async () => {
    const av = fakeVerifier({
      verifyAndDecodeNotification: jest.fn().mockRejectedValue(new VerificationException(VerificationStatus.VERIFICATION_FAILURE)),
    });
    const verifier = new AppleNotificationVerifier([av]);

    await expect(verifier.verifyAndDecode('bad-signature')).rejects.toBeInstanceOf(AppleSignatureError);
  });

  it('tries the next configured bundleId/environment when one rejects with a VerificationException', async () => {
    const rejecting = fakeVerifier({
      verifyAndDecodeNotification: jest.fn().mockRejectedValue(new VerificationException(VerificationStatus.INVALID_APP_IDENTIFIER)),
    });
    const accepting = fakeVerifier();
    const verifier = new AppleNotificationVerifier([rejecting, accepting]);

    const decoded = await verifier.verifyAndDecode('signed-payload');

    expect(decoded.notificationType).toBe('SUBSCRIBED');
    expect(rejecting.verifyAndDecodeNotification).toHaveBeenCalledTimes(1);
    expect(accepting.verifyAndDecodeNotification).toHaveBeenCalledTimes(1);
  });

  it('throws AppleSignatureError (not retried against another verifier) when the outer JWS matched but the nested signedTransactionInfo fails verification', async () => {
    const matchingButBadTxn = fakeVerifier({
      verifyAndDecodeTransaction: jest.fn().mockRejectedValue(new VerificationException(VerificationStatus.VERIFICATION_FAILURE)),
    });
    const otherConfigured = fakeVerifier();
    const verifier = new AppleNotificationVerifier([matchingButBadTxn, otherConfigured]);

    await expect(verifier.verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(AppleSignatureError);
    expect(otherConfigured.verifyAndDecodeNotification).not.toHaveBeenCalled();
  });

  it('throws AppleSignatureError when zero verifiers are configured (no trust anchor)', async () => {
    const verifier = new AppleNotificationVerifier([]);
    await expect(verifier.verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(AppleSignatureError);
  });

  it('throws ApplePayloadError when the decoded outer payload is missing notificationType', async () => {
    const av = fakeVerifier({
      verifyAndDecodeNotification: jest.fn().mockResolvedValue(outerPayload({ notificationType: undefined })),
    });
    await expect(new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(ApplePayloadError);
  });

  it('throws ApplePayloadError when data.bundleId is missing', async () => {
    const av = fakeVerifier({
      verifyAndDecodeNotification: jest.fn().mockResolvedValue(outerPayload({ data: { environment: 'Sandbox' } })),
    });
    await expect(new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(ApplePayloadError);
  });

  it('throws ApplePayloadError when the decoded transaction is missing productId/purchaseDate', async () => {
    const av = fakeVerifier({ verifyAndDecodeTransaction: jest.fn().mockResolvedValue(txnPayload({ productId: undefined })) });
    await expect(new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(ApplePayloadError);
  });

  it('throws ApplePayloadError when the decoded transaction is missing transactionId/originalTransactionId', async () => {
    const av = fakeVerifier({ verifyAndDecodeTransaction: jest.fn().mockResolvedValue(txnPayload({ transactionId: undefined })) });
    await expect(new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload')).rejects.toBeInstanceOf(ApplePayloadError);
  });

  it('passes through appAccountToken (M2b customer self-attribution) when present, and omits it when absent', async () => {
    const withToken = await new AppleNotificationVerifier([fakeVerifier()]).verifyAndDecode('signed-payload');
    expect(withToken.transaction?.appAccountToken).toBe('app-account-token-uuid');

    const withoutToken = fakeVerifier({
      verifyAndDecodeTransaction: jest.fn().mockResolvedValue(txnPayload({ appAccountToken: undefined })),
    });
    const decoded = await new AppleNotificationVerifier([withoutToken]).verifyAndDecode('signed-payload');
    expect(decoded.transaction?.appAccountToken).toBeUndefined();
  });

  it('passes through the raw 0/1 autoRenewStatus and gracePeriodExpiresDate for the reducer/mapper', async () => {
    const av = fakeVerifier({
      verifyAndDecodeRenewalInfo: jest
        .fn()
        .mockResolvedValue(renewalPayload({ autoRenewStatus: 0, gracePeriodExpiresDate: d('2026-08-20T00:00:00Z') })),
    });
    const decoded = await new AppleNotificationVerifier([av]).verifyAndDecode('signed-payload');
    expect(decoded.renewal).toEqual({
      autoRenewStatus: 0,
      autoRenewProductId: 'com.myampix.premium.monthly',
      gracePeriodExpiresDate: new Date('2026-08-20T00:00:00Z'),
    });
  });
});
