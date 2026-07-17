import { OidcPushAuthenticator } from './google-oidc-authenticator';

describe('OidcPushAuthenticator', () => {
  it('OIDC: X1 — fails closed even for a request that looks well-formed', () => {
    const authenticator = new OidcPushAuthenticator();

    expect(
      authenticator.authenticate({ authorizationHeader: 'Bearer some.jwt.token' }),
    ).toBe(false);
  });

  it('fails closed with no Authorization header too', () => {
    const authenticator = new OidcPushAuthenticator();

    expect(authenticator.authenticate({})).toBe(false);
  });
});
