import { timingSafeEqual } from 'node:crypto';

/**
 * The bits of a Pub/Sub push request `GooglePushAuthenticator` needs to make an auth decision —
 * kept as a plain data object (not `Request`) so both authenticators stay framework-agnostic and
 * unit-testable without a NestJS execution context.
 */
export interface GooglePushAuthContext {
  /** The `?token=...` query parameter on the push endpoint URL (shared-secret mode). */
  queryToken?: string;
  /** The raw `Authorization` header value, e.g. `"Bearer <jwt>"` (OIDC mode). */
  authorizationHeader?: string;
}

/**
 * Strategy seam for Google Pub/Sub push authentication (design §1.2/§6/§10): the two supported
 * modes — shared-secret (implemented now) and OIDC (deferred to X1, see `google-oidc-authenticator.ts`)
 * — both satisfy this one interface so `GoogleWebhookController` never branches on which mode is
 * active; only `google-push-auth.factory.ts` does, at wiring time.
 *
 * Fail-closed by contract: `authenticate` returning `false` (or throwing) must always result in a
 * `401` and no journal entry — never a silent pass-through.
 */
export interface GooglePushAuthenticator {
  authenticate(context: GooglePushAuthContext): boolean | Promise<boolean>;
}

/**
 * Shared-secret push auth (design §1.2 "Shared-secret fallback", §10: "acceptable for early
 * sandbox"): a high-entropy token configured via `GOOGLE_PUBSUB_SHARED_SECRET` and placed in the
 * push subscription's endpoint URL (`POST /webhooks/google?token=...`), compared constant-time —
 * the same `timingSafeEqual` pattern as the RC mirror's `RcWebhookGuard`
 * (`backend/mobile_analytics/src/revenuecat/webhook/rc-webhook.guard.ts`).
 *
 * Deliberately fails closed when `sharedSecret` is unset/empty: there is no dev default that would
 * let an unconfigured deploy silently accept every push (design brief's non-negotiable — "no dev
 * default that would fail open").
 */
export class SharedSecretPushAuthenticator implements GooglePushAuthenticator {
  constructor(private readonly sharedSecret: string | undefined) {}

  authenticate(context: GooglePushAuthContext): boolean {
    if (!this.sharedSecret) return false;

    const provided = context.queryToken;
    if (typeof provided !== 'string' || provided.length === 0) return false;

    const a = Buffer.from(provided);
    const b = Buffer.from(this.sharedSecret);
    // timingSafeEqual throws on mismatched lengths — compare lengths first, and note that leaking
    // a length mismatch via early return is the same trade-off `RcWebhookGuard` already makes.
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
