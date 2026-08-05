import { ProblemException } from '../../common/problem-details';
import { assertValidAppUserId } from './app-user-id.validator';

/** ProblemException's HttpException#message is a fixed "Problem Exception" string — the actual
 * reason lives on `.problem.detail`, so assert against that instead of Jest's default
 * `toThrow(message)` (which matches `.message`). */
function expectRejected(fn: () => void, detailPattern: RegExp): void {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(ProblemException);
  expect((thrown as ProblemException).problem).toMatchObject({ status: 400, title: 'Invalid app user id' });
  expect((thrown as ProblemException).problem.detail).toMatch(detailPattern);
}

describe('assertValidAppUserId', () => {
  it('accepts an ordinary SDK-generated id', () => {
    expect(() => assertValidAppUserId('user_9f3c2a')).not.toThrow();
    expect(() => assertValidAppUserId('a1b2c3d4-e5f6-4789-9abc-def012345678')).not.toThrow();
  });

  it.each(['', '   '])('rejects empty/whitespace-only id %p', (id) => {
    expectRejected(() => assertValidAppUserId(id), /must not be empty/);
  });

  it.each(['no_user', 'NULL', 'Nil', 'none', '(null)', 'NaN', '[]', 'unidentified'])(
    'rejects the reserved literal %p (case-insensitive)',
    (id) => {
      expectRejected(() => assertValidAppUserId(id), /reserved app user id/);
    },
  );

  it("rejects an id equal to the App's own store identifier", () => {
    expectRejected(
      () => assertValidAppUserId('com.myampix.app', ['com.myampix.app', 'mp_pub_abc123']),
      /store identifier/,
    );
    expectRejected(
      () => assertValidAppUserId('mp_pub_abc123', ['com.myampix.app', 'mp_pub_abc123']),
      /store identifier/,
    );
  });

  it('allows an id that does not collide with any reserved store id', () => {
    expect(() => assertValidAppUserId('real-user-id', ['com.myampix.app', 'mp_pub_abc123'])).not.toThrow();
  });

  it('rejects ids using the reserved "$" sentinel prefix', () => {
    expectRejected(() => assertValidAppUserId('$RCAnonymousID:abc123'), /\$/);
    expectRejected(() => assertValidAppUserId('$rc_monthly'), /\$/);
  });

  it('rejects a zeroed device-identifier sentinel', () => {
    expectRejected(() => assertValidAppUserId('00000000-0000-0000-0000-000000000000'), /device identifier/);
  });

  it('rejects a raw email address', () => {
    expectRejected(() => assertValidAppUserId('someone@example.com'), /email/);
  });

  it('rejects an id over the max length', () => {
    expectRejected(() => assertValidAppUserId('a'.repeat(201)), /<= 200/);
  });

  it('accepts an id at exactly the max length', () => {
    expect(() => assertValidAppUserId('a'.repeat(200))).not.toThrow();
  });

  it('rejects control characters', () => {
    expectRejected(() => assertValidAppUserId('user\x00id'), /control characters/);
    expectRejected(() => assertValidAppUserId('user\nid'), /control characters/);
  });

  it('throws a 400 ProblemException with a structured problem body', () => {
    expectRejected(() => assertValidAppUserId('null'), /reserved app user id/);
  });
});
