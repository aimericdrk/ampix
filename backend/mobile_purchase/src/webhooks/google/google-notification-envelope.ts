import { z } from 'zod';
import type { GoogleDecodedNotification } from '../../subscriptions/lifecycle/google-notification-mapper';

/** Unparseable Pub/Sub envelope: missing/non-base64/non-JSON `message.data`, or JSON that carries
 * none of the four recognized sub-notification kinds. Maps to the controller's `400` (design
 * §1.2: "Missing message.data / non-base64 / non-JSON / no recognized sub-notification → 400").
 * Distinct from a push-auth failure (`401`) — an envelope error only happens *after* auth passes,
 * so it is a real (if malformed) call from our own Pub/Sub subscription. */
export class GoogleEnvelopeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GoogleEnvelopeError';
  }
}

/** `subscriptionNotification` (design §1.2): `{ notificationType (int), purchaseToken,
 * subscriptionId }`. `version` is Google's own payload-schema version string, unrelated to the
 * outer `DeveloperNotification.version`. */
export interface GoogleSubscriptionNotificationPayload {
  version: string;
  notificationType: number;
  purchaseToken: string;
  subscriptionId: string;
}

/** `voidedPurchaseNotification` (design §1.2): `{ purchaseToken, orderId, productType,
 * refundType }`. `productType`: 1 = subscription, 2 = one-time product. `refundType`: 1 =
 * `FULL_REFUND`, 2 = `QUANTITY_BASED_REFUND`. */
export interface GoogleVoidedPurchaseNotificationPayload {
  purchaseToken: string;
  orderId: string;
  productType: number;
  refundType: number;
}

/** `oneTimeProductNotification` (design §1.2): `{ notificationType (int), purchaseToken, sku }`.
 * `notificationType`: 1 = `ONE_TIME_PRODUCT_PURCHASED`, 2 = `ONE_TIME_PRODUCT_CANCELED`. */
export interface GoogleOneTimeProductNotificationPayload {
  version: string;
  notificationType: number;
  purchaseToken: string;
  sku: string;
}

/** `testNotification` (design §1.2) — RTDN test ping sent from the Play Console's "Send test
 * notification" button; carries no purchase data. */
export interface GoogleTestNotificationPayload {
  version: string;
}

/**
 * The base64-decoded, JSON-parsed Pub/Sub message payload (design §1.2): `{ version, packageName,
 * eventTimeMillis, subscriptionNotification? | oneTimeProductNotification? |
 * voidedPurchaseNotification? | testNotification? }`. Exactly one of the four optional fields is
 * present on any real Google payload; `eventTimeMillis` is a string on the wire (Google encodes
 * the int64 millis as JSON string to avoid precision loss) — callers that need a `number`/`Date`
 * use `toGoogleDecodedNotification` below, which does that conversion.
 */
export interface DeveloperNotification {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: GoogleSubscriptionNotificationPayload;
  oneTimeProductNotification?: GoogleOneTimeProductNotificationPayload;
  voidedPurchaseNotification?: GoogleVoidedPurchaseNotificationPayload;
  testNotification?: GoogleTestNotificationPayload;
}

const subscriptionNotificationSchema = z.object({
  version: z.string(),
  notificationType: z.number(),
  purchaseToken: z.string().min(1),
  subscriptionId: z.string().min(1),
});

const voidedPurchaseNotificationSchema = z.object({
  purchaseToken: z.string().min(1),
  orderId: z.string().min(1),
  productType: z.number(),
  refundType: z.number(),
});

const oneTimeProductNotificationSchema = z.object({
  version: z.string(),
  notificationType: z.number(),
  purchaseToken: z.string().min(1),
  sku: z.string().min(1),
});

const testNotificationSchema = z.object({
  version: z.string(),
});

const developerNotificationSchema = z
  .object({
    version: z.string(),
    packageName: z.string().min(1, 'packageName is required'),
    // Google encodes this int64 as a decimal string on the wire; require it to be all-digits so a
    // malformed value is rejected at the boundary (400) rather than becoming NaN/Invalid Date once
    // M3b converts it with Number().
    eventTimeMillis: z
      .string()
      .min(1, 'eventTimeMillis is required')
      .regex(/^\d+$/, 'eventTimeMillis must be a numeric string'),
    subscriptionNotification: subscriptionNotificationSchema.optional(),
    oneTimeProductNotification: oneTimeProductNotificationSchema.optional(),
    voidedPurchaseNotification: voidedPurchaseNotificationSchema.optional(),
    testNotification: testNotificationSchema.optional(),
  })
  .refine(
    (n) =>
      Boolean(
        n.subscriptionNotification || n.oneTimeProductNotification || n.voidedPurchaseNotification || n.testNotification,
      ),
    {
      message:
        'no recognized sub-notification (subscriptionNotification / oneTimeProductNotification / voidedPurchaseNotification / testNotification)',
    },
  );

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Base64-decodes Pub/Sub's `message.data` and validates it against the `DeveloperNotification`
 * shape (design §1.2). Throws `GoogleEnvelopeError` (→ controller `400`) for: non-base64 input,
 * non-JSON content after decoding, or JSON missing required fields / carrying none of the four
 * recognized sub-notification kinds. A `testNotification` is a fully valid, recognized shape (design:
 * "A testNotification is valid (→ 200 ...)").
 */
export function decodeDeveloperNotification(base64Data: string): DeveloperNotification {
  if (typeof base64Data !== 'string' || base64Data.length === 0) {
    throw new GoogleEnvelopeError('message.data is required');
  }
  if (!BASE64_RE.test(base64Data)) {
    throw new GoogleEnvelopeError('message.data is not valid base64');
  }

  let decoded: string;
  try {
    decoded = Buffer.from(base64Data, 'base64').toString('utf8');
  } catch (e) {
    throw new GoogleEnvelopeError('message.data is not valid base64', e);
  }

  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch (e) {
    throw new GoogleEnvelopeError('message.data does not decode to valid JSON', e);
  }

  const parsed = developerNotificationSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join('.') || 'body';
    throw new GoogleEnvelopeError(`${path}: ${issue.message}`, parsed.error);
  }

  return parsed.data;
}

/**
 * Maps the raw decoded envelope to M4a's `googleNotificationToEvent` input type
 * (`GoogleDecodedNotification`, `../../subscriptions/lifecycle/google-notification-mapper.ts`) —
 * the real handoff M3a hands M3b: everything except the authoritative-fetch `facts` (M3b's job,
 * design §1.2 "Authoritative state fetch (hard dependency)") is already in exactly the shape the
 * mapper expects, because `facts` is optional at the type level. M3b constructs the final input by
 * spreading this result and adding `facts` once it has called `StoreClient.getSubscriptionV2`.
 *
 * `eventTimeMillis` is converted from Google's wire-format string to the `number` the mapper
 * expects. purchaseToken/subscriptionId/orderId/sku (needed for the authoritative fetch, not for
 * the lifecycle mapping itself) are deliberately NOT carried into this output — M3b reads those
 * straight off the raw `DeveloperNotification` it already has.
 */
export function toGoogleDecodedNotification(notification: DeveloperNotification): GoogleDecodedNotification {
  const eventTimeMillis = Number(notification.eventTimeMillis);

  if (notification.testNotification) {
    return { kind: 'test', eventTimeMillis };
  }
  if (notification.subscriptionNotification) {
    return {
      kind: 'subscription',
      notificationType: notification.subscriptionNotification.notificationType,
      eventTimeMillis,
    };
  }
  if (notification.voidedPurchaseNotification) {
    return {
      kind: 'voided',
      eventTimeMillis,
      refundType: notification.voidedPurchaseNotification.refundType,
    };
  }
  if (notification.oneTimeProductNotification) {
    return {
      kind: 'one_time',
      eventTimeMillis,
      notificationType: notification.oneTimeProductNotification.notificationType,
      sku: notification.oneTimeProductNotification.sku,
    };
  }

  // Unreachable via decodeDeveloperNotification (its schema already requires at least one
  // recognized sub-notification) — guarded here only for callers that construct a
  // DeveloperNotification by hand (e.g. tests).
  throw new GoogleEnvelopeError('no recognized sub-notification');
}
