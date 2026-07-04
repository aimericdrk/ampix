import type { Response } from 'express';
import {
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from './cookies';
import { makeAuthTestConfig } from './test-support/config.fixture';

function fakeResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

describe('refresh cookie helpers', () => {
  it('sets the refresh cookie with httpOnly/lax/path and a maxAge derived from refreshTokenTtl', () => {
    const res = fakeResponse();
    const auth = makeAuthTestConfig().auth!;
    setRefreshCookie(res, 'raw-token-value', auth);

    expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'raw-token-value', {
      httpOnly: true,
      sameSite: 'lax',
      secure: auth.cookieSecure,
      domain: auth.cookieDomain,
      path: REFRESH_COOKIE_PATH,
      maxAge: auth.refreshTokenTtl * 1000,
    });
  });

  it('honors cookieSecure/cookieDomain from config', () => {
    const res = fakeResponse();
    const auth = {
      ...makeAuthTestConfig().auth!,
      cookieSecure: true,
      cookieDomain: '.myampmix.com',
    };
    setRefreshCookie(res, 'token', auth);

    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'token',
      expect.objectContaining({ secure: true, domain: '.myampmix.com' }),
    );
  });

  it('clears the refresh cookie with matching options (no maxAge)', () => {
    const res = fakeResponse();
    const auth = makeAuthTestConfig().auth!;
    clearRefreshCookie(res, auth);

    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: auth.cookieSecure,
      domain: auth.cookieDomain,
      path: REFRESH_COOKIE_PATH,
    });
  });
});
