import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { startTestStack, TestStack } from './helpers/stack';

const REFRESH_COOKIE_NAME = 'mam_refresh';

function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

/** Extracts "name=value" for `name` from a response's Set-Cookie header(s), or undefined. */
function extractCookie(res: SupertestResponse, name: string): string | undefined {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = setCookie?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0];
}

async function signup(stack: TestStack, email: string, password = 'password123') {
  return request(stack.app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({ email, password, name: 'Test User' })
    .expect(200);
}

describe('Auth & TOTP 2FA (e2e, contracts §11)', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startTestStack({
      JWT_ACCESS_SECRET: 'e2e-access-secret-value-e2e-access',
      JWT_REFRESH_SECRET: 'e2e-refresh-secret-value-e2e-refresh',
      TOTP_ENC_KEY: randomBytes(32).toString('hex'),
    });
  }, 120_000);

  afterAll(async () => {
    await stack.stop();
  });

  describe('signup -> login (no 2FA) -> /me', () => {
    const email = uniqueEmail();

    it('signup creates the account, returns a session, and sets the refresh cookie', async () => {
      const res = await signup(stack, email);
      expect(res.body).toMatchObject({ user: { email, name: 'Test User' } });
      expect(res.body.access_token).toEqual(expect.any(String));
      expect(extractCookie(res, REFRESH_COOKIE_NAME)).toBeDefined();
    });

    it('signup on a duplicate email returns 409', async () => {
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: 'password123', name: 'Another' })
        .expect(409)
        .expect('Content-Type', /application\/problem\+json/);
    });

    it('login with correct credentials returns a session (no mfa_required)', async () => {
      const res = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      expect(res.body).toMatchObject({ user: { email } });
      expect(res.body.mfa_required).toBeUndefined();
    });

    it('login with a wrong password returns 401', async () => {
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401)
        .expect('Content-Type', /application\/problem\+json/);
    });

    it('/me returns the user and two_factor_enabled: false', async () => {
      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);

      const res = await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);
      expect(res.body).toMatchObject({ user: { email }, two_factor_enabled: false });
    });

    it('/me without an access token returns 401', async () => {
      await request(stack.app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });
  });

  describe('enabling 2FA: setup -> activate -> recovery codes', () => {
    const email = uniqueEmail();
    let accessToken: string;

    beforeAll(async () => {
      const res = await signup(stack, email);
      accessToken = res.body.access_token;
    });

    it('setup returns a pending secret + otpauth_url + QR data URI', async () => {
      const res = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.secret).toEqual(expect.any(String));
      expect(res.body.otpauth_url).toMatch(/^otpauth:\/\/totp\//);
      expect(res.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
    });

    it('activate with a wrong code is rejected (401) and does not enable 2FA', async () => {
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/activate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '000000' })
        .expect(401);

      const me = await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.two_factor_enabled).toBe(false);
    });

    it('activate with a valid TOTP code enables 2FA and returns 10 recovery codes', async () => {
      const setup = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const code = authenticator.generate(setup.body.secret);

      const activate = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/activate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code })
        .expect(200);

      expect(activate.body.recovery_codes).toHaveLength(10);
      expect(new Set(activate.body.recovery_codes).size).toBe(10);

      const me = await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.two_factor_enabled).toBe(true);
    });
  });

  describe('login with 2FA enabled -> mfa_required -> verify -> session', () => {
    const email = uniqueEmail();
    let totpSecret: string;
    let recoveryCodes: string[];

    beforeAll(async () => {
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const setup = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      totpSecret = setup.body.secret;

      const activate = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/activate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: authenticator.generate(totpSecret) })
        .expect(200);
      recoveryCodes = activate.body.recovery_codes;
    });

    it('login returns mfa_required with an mfa_token, no access token or refresh cookie', async () => {
      const res = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);

      expect(res.body).toEqual({ mfa_required: true, mfa_token: expect.any(String) });
      expect(extractCookie(res, REFRESH_COOKIE_NAME)).toBeUndefined();
    });

    it('verify with a valid TOTP code issues a session; /me reports 2FA enabled', async () => {
      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);

      const verify = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: login.body.mfa_token, code: authenticator.generate(totpSecret) })
        .expect(200);

      expect(verify.body).toMatchObject({ user: { email } });
      expect(extractCookie(verify, REFRESH_COOKIE_NAME)).toBeDefined();

      const me = await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${verify.body.access_token}`)
        .expect(200);
      expect(me.body.two_factor_enabled).toBe(true);
    });

    it('verify with a wrong code returns 401', async () => {
      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);

      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: login.body.mfa_token, code: '000000' })
        .expect(401);
    });

    it('verify with a recovery code works, and that code is single-use', async () => {
      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const [recoveryCode] = recoveryCodes;

      const first = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: login.body.mfa_token, code: recoveryCode })
        .expect(200);
      expect(first.body).toMatchObject({ user: { email } });

      // A fresh mfa_token (new login), same recovery code — must now be rejected.
      const login2 = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: login2.body.mfa_token, code: recoveryCode })
        .expect(401);
    });

    it('an access token cannot be used as an mfa_token, and vice versa', async () => {
      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const verify = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: login.body.mfa_token, code: authenticator.generate(totpSecret) })
        .expect(200);

      // The mfa_token from the NEXT login attempt must not work as an access token on /me.
      const login2 = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login2.body.mfa_token}`)
        .expect(401);

      // And the access token issued by verify must not work as an mfa_token on /2fa/verify.
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: verify.body.access_token, code: '123456' })
        .expect(401);
    });
  });

  describe('refresh rotation and logout', () => {
    const email = uniqueEmail();

    it('refresh rotates the cookie and revokes the old refresh token', async () => {
      const signupRes = await signup(stack, email);
      const firstRefreshCookie = extractCookie(signupRes, REFRESH_COOKIE_NAME)!;

      const refreshRes = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstRefreshCookie)
        .expect(200);
      const secondRefreshCookie = extractCookie(refreshRes, REFRESH_COOKIE_NAME)!;
      expect(secondRefreshCookie).toBeDefined();
      expect(secondRefreshCookie).not.toBe(firstRefreshCookie);
      expect(refreshRes.body).toMatchObject({ user: { email } });

      // The old refresh cookie must now be dead (revoked on rotation).
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstRefreshCookie)
        .expect(401);

      // The new one still works.
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', secondRefreshCookie)
        .expect(200);
    });

    it('refresh without a cookie returns 401', async () => {
      await request(stack.app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    });

    it('logout revokes the refresh token and clears the cookie', async () => {
      const otherEmail = uniqueEmail();
      const signupRes = await signup(stack, otherEmail);
      const refreshCookie = extractCookie(signupRes, REFRESH_COOKIE_NAME)!;

      const logoutRes = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', refreshCookie)
        .expect(204);
      const clearedCookie = extractCookie(logoutRes, REFRESH_COOKIE_NAME);
      expect(clearedCookie).toBe('mam_refresh='); // res.clearCookie() sets an empty value

      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);
    });
  });

  describe('2FA disable', () => {
    it('disable with a wrong code is rejected; a valid code disables 2FA', async () => {
      const email = uniqueEmail();
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const setup = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/activate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: authenticator.generate(setup.body.secret) })
        .expect(200);

      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '000000' })
        .expect(401);

      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/disable')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: authenticator.generate(setup.body.secret) })
        .expect(204);

      const me = await request(stack.app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.two_factor_enabled).toBe(false);
    });
  });

  describe('rate limiting on /2fa/verify (contracts §11: ~10/5min per user)', () => {
    it('trips 429 after repeated bad codes for the same mfa_token/user', async () => {
      const email = uniqueEmail();
      const signupRes = await signup(stack, email);
      const accessToken = signupRes.body.access_token;

      const setup = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/setup')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/activate')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: authenticator.generate(setup.body.secret) })
        .expect(200);

      const login = await request(stack.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' })
        .expect(200);
      const mfaToken = login.body.mfa_token;

      // First 10 bad attempts are rejected as plain 401s (under the limit).
      for (let i = 0; i < 10; i++) {
        await request(stack.app.getHttpServer())
          .post('/api/v1/auth/2fa/verify')
          .send({ mfa_token: mfaToken, code: '000000' })
          .expect(401);
      }
      // The 11th trips the rate limit.
      await request(stack.app.getHttpServer())
        .post('/api/v1/auth/2fa/verify')
        .send({ mfa_token: mfaToken, code: '000000' })
        .expect(429)
        .expect('Content-Type', /application\/problem\+json/);
    }, 30_000);
  });
});
