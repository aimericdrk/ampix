import { Logger } from '@nestjs/common';
import type { GooglePushAuthContext, GooglePushAuthenticator } from './google-push-authenticator';

/**
 * OIDC: X1 — deferred, same "seam not the asset" pattern M2a used for the Apple Root CA – G3 trust
 * anchor (see `../apple/apple-root-certs.ts` / `../apple/certs/README.md`). Real verification
 * (design §1.2 "OIDC (preferred)") needs to:
 *   1. fetch and cache Google's JWKS,
 *   2. verify the Pub/Sub-issued JWT's signature from the `Authorization: Bearer <jwt>` header,
 *   3. check `aud` equals our configured push audience and `email` equals the configured push
 *      service account.
 * That needs `google-auth-library` (intentionally NOT added as a dependency by M3a) and is only
 * reachable once this service is deployed behind public HTTPS that Pub/Sub can call — the X1
 * deploy gate (design §8/§10). Building it now would be untestable dead code.
 *
 * Until X1 lands, this authenticator fails closed unconditionally — it never authenticates a
 * request, even a well-formed one — so a premature `GOOGLE_PUSH_AUTH_MODE=oidc` can never
 * accidentally admit traffic. `google-push-auth.factory.ts` only wires this in when that mode is
 * explicitly configured; the default (`shared_secret`) never touches this class.
 */
export class OidcPushAuthenticator implements GooglePushAuthenticator {
  private readonly logger = new Logger(OidcPushAuthenticator.name);

  authenticate(_context: GooglePushAuthContext): boolean {
    // OIDC: X1 — no google-auth-library JWKS verification yet; fail closed, always.
    this.logger.warn(
      'GOOGLE_PUSH_AUTH_MODE=oidc is configured but OIDC verification is not implemented until X1 ' +
        '(deploy gate) — rejecting all Google push requests. See design doc §1.2/§10.',
    );
    return false;
  }
}
