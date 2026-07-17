import { z } from 'zod';

/**
 * `POST /v1/receipts` body (design §5). `app_user_id` itself is validated more strictly by
 * `assertValidAppUserId` downstream (§3's reserved-id/shape rules, incl. the `<=200`-char bound) —
 * this schema only bounds it loosely for DoS-headroom at the parse boundary, same rationale as the
 * webhook controllers' own body caps.
 */
export const submitReceiptBodySchema = z.object({
  app_user_id: z.string().min(1, 'app_user_id is required').max(1000, 'app_user_id too large'),
  platform: z.enum(['APP_STORE', 'PLAY_STORE']),
  // Apple: a signed StoreKit2 transaction JWS (compact serialization, typically a few KB). Google:
  // a purchaseToken (short). Bounded generously, matching the Apple webhook controller's
  // signedPayload cap.
  fetch_token: z.string().min(1, 'fetch_token is required').max(100_000, 'fetch_token too large'),
  product_id: z.string().min(1).max(256).optional(),
  // Attribution only — design §5 lists it as optional. NOT currently persisted: the committed
  // Transaction model (schema.prisma) has no column for it yet (a pre-existing design-doc/schema
  // gap, not introduced here); accepted for API-contract compatibility and flagged in the M5b
  // report rather than silently added mid-migration.
  presented_offering_identifier: z.string().min(1).max(256).optional(),
});

export type SubmitReceiptInput = z.infer<typeof submitReceiptBodySchema>;
