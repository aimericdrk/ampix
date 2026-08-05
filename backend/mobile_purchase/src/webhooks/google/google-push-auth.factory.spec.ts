import type { AppConfig } from '../../config/app-config';
import { buildGooglePushAuthenticator } from './google-push-auth.factory';
import { SharedSecretPushAuthenticator } from './google-push-authenticator';
import { OidcPushAuthenticator } from './google-oidc-authenticator';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 8090,
    databaseUrl: 'postgresql://x',
    logLevel: 'silent',
    analyticsInternalUrl: 'http://analytics.internal:8088',
    ...overrides,
  };
}

describe('buildGooglePushAuthenticator', () => {
  it('defaults to SharedSecretPushAuthenticator when GOOGLE_PUSH_AUTH_MODE is unset', () => {
    const authenticator = buildGooglePushAuthenticator(makeConfig());

    expect(authenticator).toBeInstanceOf(SharedSecretPushAuthenticator);
  });

  it('builds SharedSecretPushAuthenticator for mode "shared_secret"', () => {
    const authenticator = buildGooglePushAuthenticator(
      makeConfig({ googlePushAuthMode: 'shared_secret', googlePubsubSharedSecret: 'shh' }),
    );

    expect(authenticator).toBeInstanceOf(SharedSecretPushAuthenticator);
    expect(authenticator.authenticate({ queryToken: 'shh' })).toBe(true);
  });

  it('builds OidcPushAuthenticator (deferred, fail-closed) for mode "oidc"', () => {
    const authenticator = buildGooglePushAuthenticator(makeConfig({ googlePushAuthMode: 'oidc' }));

    expect(authenticator).toBeInstanceOf(OidcPushAuthenticator);
    expect(authenticator.authenticate({ authorizationHeader: 'Bearer x' })).toBe(false);
  });
});
