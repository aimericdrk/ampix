import type { AppConfig } from '../../config/app-config';
import type { GooglePushAuthenticator } from './google-push-authenticator';
import { SharedSecretPushAuthenticator } from './google-push-authenticator';
import { OidcPushAuthenticator } from './google-oidc-authenticator';

export const GOOGLE_PUSH_AUTHENTICATOR = 'GOOGLE_PUSH_AUTHENTICATOR';

/**
 * Picks the active `GooglePushAuthenticator` from `GOOGLE_PUSH_AUTH_MODE` (design §1.2/§6/§10;
 * default `shared_secret`, mirrors `apple-verifier.factory.ts`'s role of turning config into the
 * concrete strategy `GoogleWebhookController` depends on). `oidc` currently always fails closed
 * (`OidcPushAuthenticator` — OIDC: X1) — selecting it today deliberately locks the endpoint, it
 * does not enable a half-built verifier.
 */
export function buildGooglePushAuthenticator(config: AppConfig): GooglePushAuthenticator {
  if (config.googlePushAuthMode === 'oidc') return new OidcPushAuthenticator();
  return new SharedSecretPushAuthenticator(config.googlePubsubSharedSecret);
}
