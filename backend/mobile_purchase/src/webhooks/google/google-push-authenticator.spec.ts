import { SharedSecretPushAuthenticator } from './google-push-authenticator';

describe('SharedSecretPushAuthenticator', () => {
  it('authenticates when the query token matches the configured secret', () => {
    const authenticator = new SharedSecretPushAuthenticator('correct-horse-battery-staple');

    expect(authenticator.authenticate({ queryToken: 'correct-horse-battery-staple' })).toBe(true);
  });

  it('rejects a wrong token', () => {
    const authenticator = new SharedSecretPushAuthenticator('correct-horse-battery-staple');

    expect(authenticator.authenticate({ queryToken: 'wrong-token' })).toBe(false);
  });

  it('rejects a missing token', () => {
    const authenticator = new SharedSecretPushAuthenticator('correct-horse-battery-staple');

    expect(authenticator.authenticate({})).toBe(false);
  });

  it('rejects an empty-string token', () => {
    const authenticator = new SharedSecretPushAuthenticator('correct-horse-battery-staple');

    expect(authenticator.authenticate({ queryToken: '' })).toBe(false);
  });

  it('rejects a token whose length differs from the secret (would otherwise throw inside timingSafeEqual)', () => {
    const authenticator = new SharedSecretPushAuthenticator('short');

    expect(authenticator.authenticate({ queryToken: 'a-much-longer-token-value' })).toBe(false);
  });

  it('fails closed when GOOGLE_PUBSUB_SHARED_SECRET is unset — never a fail-open default', () => {
    const authenticator = new SharedSecretPushAuthenticator(undefined);

    expect(authenticator.authenticate({ queryToken: 'anything' })).toBe(false);
    expect(authenticator.authenticate({ queryToken: '' })).toBe(false);
  });

  it('fails closed when the configured secret is an empty string', () => {
    const authenticator = new SharedSecretPushAuthenticator('');

    expect(authenticator.authenticate({ queryToken: '' })).toBe(false);
  });

  it('uses a constant-time comparison (does not short-circuit on the first differing byte)', () => {
    // We can't directly observe timing in a unit test, but we can pin down the *contract*:
    // two same-length strings that differ only in their last byte are still correctly rejected,
    // which would trivially still pass with a naive === compare — this test exists as a
    // documentation/regression guard that the compare path is exercised, not a timing assertion.
    const secret = 'x'.repeat(32);
    const almostRight = 'x'.repeat(31) + 'y';
    const authenticator = new SharedSecretPushAuthenticator(secret);

    expect(authenticator.authenticate({ queryToken: almostRight })).toBe(false);
  });
});
