import { assertValidAppUserId } from './app-user-id.validator';

describe('assertValidAppUserId', () => {
  it('accepts a normal id', () => {
    expect(() => assertValidAppUserId('user_12345')).not.toThrow();
  });

  it.each(['no_user', 'null', 'NULL', 'none', 'nil', '(null)', 'nan', 'unidentified', 'unknown', 'undefined', '', '   '])(
    'rejects reserved/blank id %p',
    (id) => {
      expect(() => assertValidAppUserId(id)).toThrow();
    },
  );

  it('rejects an email-shaped id (PII)', () => {
    expect(() => assertValidAppUserId('a@b.com')).toThrow();
  });

  it('rejects an id equal to a project store identifier', () => {
    expect(() => assertValidAppUserId('com.acme.app', ['com.acme.app'])).toThrow();
  });

  it('rejects an over-length id', () => {
    expect(() => assertValidAppUserId('x'.repeat(1501))).toThrow();
  });
});
