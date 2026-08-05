import { Inject, Injectable } from '@nestjs/common';
import {
  OfferDiscountType,
  OfferType,
  VerificationException,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import type {
  AppleDecodedNotification,
  AppleDecodedRenewalInfo,
  AppleDecodedTransactionInfo,
} from '../../subscriptions/lifecycle/apple-notification-mapper';

export const APPLE_SIGNED_DATA_VERIFIERS = 'APPLE_SIGNED_DATA_VERIFIERS';

/**
 * The subset of Apple's `SignedDataVerifier` this wrapper calls. Real `SignedDataVerifier`
 * instances satisfy this structurally; tests inject plain fakes/mocks instead — no need to mock
 * the `@apple/app-store-server-library` module itself (design brief's escape hatch).
 */
export interface AppleVerifierLike {
  verifyAndDecodeNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload>;
  verifyAndDecodeTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload>;
  verifyAndDecodeRenewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload>;
}

/** Bad/untrusted JWS — x5c chain or ES256 signature failed, or the notification doesn't match
 * any configured bundleId/environment. Maps to the controller's 401 (design §1.1: "On any
 * [verification] failure → 401 ... do not journal"). */
export class AppleSignatureError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppleSignatureError';
  }
}

/** The JWS verified (it IS a real Apple call) but the decoded envelope is missing/malformed
 * relative to what this wrapper needs to assemble an `AppleDecodedNotification`. Maps to the
 * controller's 400. Distinct from `AppleSignatureError` per the design brief: verification
 * failures and parse/shape failures must be separable. */
export class ApplePayloadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApplePayloadError';
  }
}

/**
 * `AppleDecodedNotification` (M4a's pure lifecycle-mapper input, `apple-notification-mapper.ts`)
 * plus the identity/idempotency facts M2b's journal + App-by-bundleId resolution need that the
 * mapper's type has no reason to carry (it never touches JWS/x5c or App rows). A
 * `VerifiedAppleNotification` IS-A `AppleDecodedNotification` (structural typing — the mapper can
 * consume it directly, unmodified), so this satisfies "decoder outputs exactly that type" while
 * still giving M2b what it needs without a second round-trip through the JWS.
 */
export interface VerifiedAppleNotification extends AppleDecodedNotification {
  /** `notificationUUID` — the journal idempotency key (design §1.1/§7: `@@unique([store,
   * storeEventId])`). Always present on a genuine ASSN v2 payload; missing is treated as a
   * payload error (§ assembleNotification). */
  notificationUUID: string;
  /** `data.bundleId` — required by M2b's `App.findFirst({ platform: IOS, bundleId })`. */
  bundleId: string;
  /** `data.environment`, passed through raw (`"Sandbox"` / `"Production"` on a genuine
   * notification) for M2b's App/Environment attribution. Not narrowed to a literal union here —
   * nothing in this wrapper's own contract depends on its exact value beyond presence. */
  environment: string;
  /** `data.appAppleId` — omitted by Apple in the Sandbox environment. */
  appAppleId?: number;
}

/**
 * Wraps Apple's `SignedDataVerifier` (design §1.1): verifies the outer JWS x5c chain to the
 * configured trust anchor(s) + ES256, decodes `responseBodyV2DecodedPayload`, then verifies +
 * decodes the nested `signedTransactionInfo` / `signedRenewalInfo` JWS, and assembles the
 * `VerifiedAppleNotification` shape M4a's mapper (plus M2b's journal) expects.
 *
 * Holds one `AppleVerifierLike` per configured (bundleId × accepted environment) combination
 * (built by `apple-verifier.factory.ts`) so a single deployment can accept notifications for more
 * than one app/environment (design brief: "both are valid; accept either"). `verifyAndDecode`
 * tries each in turn for the *outer* JWS only — once one configuration's identity matches, a
 * nested-JWS failure on that same notification is a real signature problem and is not retried
 * against a different bundleId/environment guess.
 */
@Injectable()
export class AppleNotificationVerifier {
  constructor(@Inject(APPLE_SIGNED_DATA_VERIFIERS) private readonly verifiers: AppleVerifierLike[]) {}

  async verifyAndDecode(signedPayload: string): Promise<VerifiedAppleNotification> {
    if (this.verifiers.length === 0) {
      throw new AppleSignatureError('no Apple trust-anchor verifiers configured (missing root cert / bundleId config)');
    }

    let lastVerificationError: unknown;
    for (const verifier of this.verifiers) {
      let outer: ResponseBodyV2DecodedPayload;
      try {
        outer = await verifier.verifyAndDecodeNotification(signedPayload);
      } catch (e) {
        if (e instanceof VerificationException) {
          lastVerificationError = e;
          continue; // try the next configured bundleId/environment combination
        }
        throw e; // unexpected — do not mask as a signature failure
      }
      // This verifier's bundleId/environment matched — any failure from here on is specific to
      // this notification, not a "wrong guess"; do not fall through to another verifier.
      return this.assembleNotification(verifier, outer);
    }

    throw new AppleSignatureError(
      'Apple notification signature verification failed for all configured bundleId/environment combinations',
      lastVerificationError,
    );
  }

  /**
   * M5b: verifies+decodes a BARE StoreKit2 transaction JWS — `POST /v1/receipts`'s `fetch_token`,
   * not a wrapping ASSN v2 notification (no `signedPayload` envelope, no `notificationUUID`, no
   * `signedRenewalInfo`). `SignedDataVerifier.verifyAndDecodeTransaction` already performs the
   * exact same x5c-chain + ES256 + bundleId/environment verification whether the transaction JWS
   * arrives nested inside a notification (`assembleNotification` above) or standalone from a
   * device/App Store Server API — so this reuses the identical per-verifier call and the identical
   * multi-verifier retry loop as `verifyAndDecode`, just without an outer notification to unwrap.
   * Same fail-closed contract: no configured verifiers, or a signature/identity mismatch against
   * every configured verifier, throws `AppleSignatureError` (→ the receipts controller's 402 — the
   * store rejected this receipt). A shape defect on an otherwise-genuinely-signed transaction
   * throws `ApplePayloadError` and is NOT retried against another verifier (mirrors
   * `assembleNotification`'s "this verifier's identity matched — any failure from here on is
   * specific to this notification" rule).
   */
  async verifyAndDecodeTransactionJws(signedTransactionInfo: string): Promise<AppleDecodedTransactionInfo> {
    if (this.verifiers.length === 0) {
      throw new AppleSignatureError('no Apple trust-anchor verifiers configured (missing root cert / bundleId config)');
    }

    let lastVerificationError: unknown;
    for (const verifier of this.verifiers) {
      let decoded: JWSTransactionDecodedPayload;
      try {
        decoded = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      } catch (e) {
        if (e instanceof VerificationException) {
          lastVerificationError = e;
          continue; // try the next configured bundleId/environment combination
        }
        throw e; // unexpected — do not mask as a signature failure
      }
      return toDecodedTransaction(decoded); // may throw ApplePayloadError — a real Apple call, not a wrong-guess retry
    }

    throw new AppleSignatureError(
      'Apple transaction JWS signature verification failed for all configured bundleId/environment combinations',
      lastVerificationError,
    );
  }

  private async assembleNotification(
    verifier: AppleVerifierLike,
    outer: ResponseBodyV2DecodedPayload,
  ): Promise<VerifiedAppleNotification> {
    const data = outer.data;
    if (!outer.notificationType || outer.signedDate === undefined || !outer.notificationUUID) {
      throw new ApplePayloadError(
        'decoded Apple notification missing required field(s): notificationType/signedDate/notificationUUID',
      );
    }
    if (!data?.bundleId || !data.environment) {
      throw new ApplePayloadError('decoded Apple notification missing required field(s): data.bundleId/data.environment');
    }

    const transaction = data.signedTransactionInfo
      ? toDecodedTransaction(await this.verifyNestedJws('signedTransactionInfo', () => verifier.verifyAndDecodeTransaction(data.signedTransactionInfo!)))
      : undefined;

    const renewal = data.signedRenewalInfo
      ? toDecodedRenewal(await this.verifyNestedJws('signedRenewalInfo', () => verifier.verifyAndDecodeRenewalInfo(data.signedRenewalInfo!)))
      : undefined;

    return {
      notificationType: outer.notificationType,
      subtype: outer.subtype,
      notificationUUID: outer.notificationUUID,
      signedDate: new Date(outer.signedDate),
      bundleId: data.bundleId,
      environment: data.environment,
      appAppleId: data.appAppleId,
      transaction,
      renewal,
    };
  }

  private async verifyNestedJws<T>(field: string, decode: () => Promise<T>): Promise<T> {
    try {
      return await decode();
    } catch (e) {
      if (e instanceof VerificationException) {
        throw new AppleSignatureError(`nested ${field} failed JWS verification`, e);
      }
      throw e;
    }
  }
}

/** Apple's `price` is documented as "in milliunits" (e.g. $9.99 → 9990); the M4a mapper /
 * downstream `Transaction.priceCents` column (design §2) both expect cents. M2 owns this
 * conversion — see the M2a report for why this is a deliberate normalization, not a pass-through,
 * and the concern this raises for anything that re-derives price from the raw JWS directly. */
function applyPriceMilliunitsToCents(milliunits: number): number {
  return Math.round(milliunits / 10);
}

/** Apple's numeric `offerType` (1-4) plus `offerDiscountType` normalized to the string constants
 * `appleNotificationToEvent`'s `periodTypeFromOfferType` already expects ('FREE_TRIAL' /
 * 'INTRODUCTORY' drive TRIAL/INTRO; anything else — including undefined — is a normal paid
 * purchase). Apple has no single field that says "free trial" directly: that signal is
 * `offerDiscountType === FREE_TRIAL`, distinct from (and taking precedence over) `offerType`. */
function normalizeOfferType(
  offerType: OfferType | number | undefined,
  offerDiscountType: OfferDiscountType | string | undefined,
): string | undefined {
  if (offerDiscountType === OfferDiscountType.FREE_TRIAL) return 'FREE_TRIAL';
  switch (offerType) {
    case OfferType.INTRODUCTORY_OFFER:
      return 'INTRODUCTORY';
    case OfferType.PROMOTIONAL_OFFER:
      return 'PROMOTIONAL';
    case OfferType.OFFER_CODE:
      return 'OFFER_CODE';
    case OfferType.WIN_BACK_OFFER:
      return 'WIN_BACK';
    default:
      return undefined;
  }
}

function toOptionalDate(millis: number | undefined): Date | undefined {
  return millis === undefined ? undefined : new Date(millis);
}

function toDecodedTransaction(t: JWSTransactionDecodedPayload): AppleDecodedTransactionInfo {
  if (!t.productId || t.purchaseDate === undefined) {
    throw new ApplePayloadError('decoded Apple transaction missing required field(s): productId/purchaseDate');
  }
  // M2b needs the two identity fields (Transaction/Subscription idempotency keys — design §2/§7);
  // every genuine Apple transaction carries both, so their absence is a payload-shape defect, same
  // treatment as the productId/purchaseDate check above — not a signature-verification concern.
  if (!t.transactionId || !t.originalTransactionId) {
    throw new ApplePayloadError('decoded Apple transaction missing required field(s): transactionId/originalTransactionId');
  }
  return {
    transactionId: t.transactionId,
    originalTransactionId: t.originalTransactionId,
    productId: t.productId,
    purchaseDate: new Date(t.purchaseDate),
    expiresDate: toOptionalDate(t.expiresDate),
    type: t.type,
    inAppOwnershipType:
      t.inAppOwnershipType === 'PURCHASED' || t.inAppOwnershipType === 'FAMILY_SHARED' ? t.inAppOwnershipType : undefined,
    offerType: normalizeOfferType(t.offerType, t.offerDiscountType),
    revocationDate: toOptionalDate(t.revocationDate),
    price: t.price === undefined ? undefined : applyPriceMilliunitsToCents(t.price),
    currency: t.currency,
    appAccountToken: t.appAccountToken,
    environment: t.environment,
  };
}

function toDecodedRenewal(r: JWSRenewalInfoDecodedPayload): AppleDecodedRenewalInfo {
  return {
    autoRenewStatus: r.autoRenewStatus === 0 || r.autoRenewStatus === 1 ? r.autoRenewStatus : undefined,
    autoRenewProductId: r.autoRenewProductId,
    gracePeriodExpiresDate: toOptionalDate(r.gracePeriodExpiresDate),
  };
}
