import type { Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from '../services/auth.service';
import type { RecoveryCodeService } from '../two-factor/recovery-code.service';
import type { RefreshTokenService } from '../tokens/refresh-token.service';
import type { TokenService } from '../tokens/token.service';
import type { TotpService } from '../two-factor/totp.service';
import type { TwoFactorAttemptLimiter } from '../two-factor/two-factor-attempt-limiter';
import type { AuthRequest } from '../auth.types';
import { REFRESH_COOKIE_NAME } from '../tokens/cookies';
import { makeAuthTestConfig } from '../test-support/config.fixture';

const USER = { id: 'user-1', email: 'a@b.com', name: 'A' };

function fakeResponse(): Response {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;
}

function fakeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return { headers: {}, cookies: {}, ...overrides } as unknown as AuthRequest;
}

describe('AuthController', () => {
  function makeController(configOverrides: Parameters<typeof makeAuthTestConfig>[0] = {}) {
    const authService = {
      signup: jest.fn(),
      login: jest.fn(),
      completeMfaLogin: jest.fn(),
      getUserById: jest.fn(),
      persistTotpSecret: jest.fn(),
      disableTwoFactor: jest.fn(),
      verifyActiveCode: jest.fn(),
      updateName: jest.fn(),
      changePassword: jest.fn(),
    };
    const tokens = {
      signAccessToken: jest.fn().mockReturnValue('new-access-token'),
      verifyMfaToken: jest.fn(),
    };
    const refreshTokens = { rotate: jest.fn(), revoke: jest.fn() };
    const totp = {
      generateSecret: jest.fn().mockReturnValue('SECRETBASE32'),
      keyUri: jest.fn().mockReturnValue('otpauth://totp/MyAmpix:a@b.com?secret=SECRETBASE32'),
      qrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,xyz'),
      storePending: jest.fn(),
      getPending: jest.fn(),
      clearPending: jest.fn(),
      verify: jest.fn(),
    };
    const recoveryCodes = { generateAndStore: jest.fn().mockResolvedValue(['code-1', 'code-2']) };
    const attemptLimiter = { assertAllowed: jest.fn().mockResolvedValue(undefined) };

    const controller = new AuthController(
      authService as unknown as AuthService,
      tokens as unknown as TokenService,
      refreshTokens as unknown as RefreshTokenService,
      totp as unknown as TotpService,
      recoveryCodes as unknown as RecoveryCodeService,
      attemptLimiter as unknown as TwoFactorAttemptLimiter,
      makeAuthTestConfig(configOverrides),
    );
    return { controller, authService, tokens, refreshTokens, totp, recoveryCodes, attemptLimiter };
  }

  describe('auth config discovery', () => {
    it('reports signups enabled by default (and when explicitly on)', () => {
      expect(makeController().controller.authConfig()).toEqual({ signup_enabled: true });
      expect(makeController({ signupEnabled: true }).controller.authConfig()).toEqual({
        signup_enabled: true,
      });
    });

    it('reports signups disabled when the flag is off', () => {
      expect(makeController({ signupEnabled: false }).controller.authConfig()).toEqual({
        signup_enabled: false,
      });
    });
  });

  describe('signup', () => {
    it('answers 403 without touching the service when signups are disabled', async () => {
      const { controller, authService } = makeController({ signupEnabled: false });
      await expect(
        controller.signup({ email: 'a@b.com', password: 'password123', name: 'A' }, fakeResponse()),
      ).rejects.toMatchObject({ problem: expect.objectContaining({ status: 403 }) });
      expect(authService.signup).not.toHaveBeenCalled();
    });

    it('sets the refresh cookie and returns access_token + user', async () => {
      const { controller, authService } = makeController();
      authService.signup.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', user: USER });
      const res = fakeResponse();

      const body = await controller.signup(
        { email: 'a@b.com', password: 'password1', name: 'A' },
        res,
      );

      expect(body).toEqual({ access_token: 'at', user: USER });
      expect(res.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'rt', expect.any(Object));
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, authService } = makeController();
      await expect(
        controller.signup({ email: 'not-an-email' }, fakeResponse()),
      ).rejects.toMatchObject({
        problem: { status: 400 },
      });
      expect(authService.signup).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a session and sets the cookie when 2FA is off', async () => {
      const { controller, authService } = makeController();
      authService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', user: USER });
      const res = fakeResponse();

      const body = await controller.login({ email: 'a@b.com', password: 'x' }, res);

      expect(body).toEqual({ access_token: 'at', user: USER });
      expect(res.cookie).toHaveBeenCalled();
    });

    it('returns mfa_required and does NOT set a cookie when 2FA is on', async () => {
      const { controller, authService } = makeController();
      authService.login.mockResolvedValue({ mfaToken: 'mfa-jwt' });
      const res = fakeResponse();

      const body = await controller.login({ email: 'a@b.com', password: 'x' }, res);

      expect(body).toEqual({ mfa_required: true, mfa_token: 'mfa-jwt' });
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('2fa/verify', () => {
    it('rejects a malformed/expired mfa_token before rate-limiting or verifying', async () => {
      const { controller, tokens, attemptLimiter } = makeController();
      tokens.verifyMfaToken.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(
        controller.verify2fa({ mfa_token: 'bad', code: '123456' }, fakeResponse()),
      ).rejects.toMatchObject({ problem: { status: 401 } });
      expect(attemptLimiter.assertAllowed).not.toHaveBeenCalled();
    });

    it('propagates a 429 from the attempt limiter', async () => {
      const { controller, tokens, attemptLimiter } = makeController();
      tokens.verifyMfaToken.mockReturnValue({ sub: 'user-1', purpose: 'mfa' });
      attemptLimiter.assertAllowed.mockRejectedValue(
        Object.assign(new Error('rate limited'), { problem: { status: 429 } }),
      );

      await expect(
        controller.verify2fa({ mfa_token: 'mfa', code: '123456' }, fakeResponse()),
      ).rejects.toMatchObject({ problem: { status: 429 } });
    });

    it('rejects an invalid code with 401', async () => {
      const { controller, tokens, authService } = makeController();
      tokens.verifyMfaToken.mockReturnValue({ sub: 'user-1', purpose: 'mfa' });
      authService.completeMfaLogin.mockResolvedValue(null);

      await expect(
        controller.verify2fa({ mfa_token: 'mfa', code: '000000' }, fakeResponse()),
      ).rejects.toMatchObject({ problem: { status: 401 } });
    });

    it('issues a session and sets the cookie on a valid code', async () => {
      const { controller, tokens, authService } = makeController();
      tokens.verifyMfaToken.mockReturnValue({ sub: 'user-1', purpose: 'mfa' });
      authService.completeMfaLogin.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        user: USER,
      });
      const res = fakeResponse();

      const body = await controller.verify2fa({ mfa_token: 'mfa', code: '123456' }, res);

      expect(body).toEqual({ access_token: 'at', user: USER });
      expect(res.cookie).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('rejects when there is no refresh cookie', async () => {
      const { controller } = makeController();
      await expect(controller.refresh(fakeRequest(), fakeResponse())).rejects.toMatchObject({
        problem: { status: 401 },
      });
    });

    it('clears the cookie and rejects when the refresh token is invalid', async () => {
      const { controller, refreshTokens } = makeController();
      refreshTokens.rotate.mockResolvedValue(null);
      const res = fakeResponse();

      await expect(
        controller.refresh(fakeRequest({ cookies: { [REFRESH_COOKIE_NAME]: 'bad' } }), res),
      ).rejects.toMatchObject({ problem: { status: 401 } });
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('clears the cookie and rejects when the user backing the token no longer exists', async () => {
      const { controller, refreshTokens, authService } = makeController();
      refreshTokens.rotate.mockResolvedValue({ userId: 'gone', token: 'new-token' });
      authService.getUserById.mockResolvedValue(null);
      const res = fakeResponse();

      await expect(
        controller.refresh(fakeRequest({ cookies: { [REFRESH_COOKIE_NAME]: 'old' } }), res),
      ).rejects.toMatchObject({ problem: { status: 401 } });
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('rotates the cookie and returns a fresh access token', async () => {
      const { controller, refreshTokens, authService, tokens } = makeController();
      refreshTokens.rotate.mockResolvedValue({ userId: USER.id, token: 'new-refresh' });
      authService.getUserById.mockResolvedValue({ ...USER, passwordHash: 'x' });
      const res = fakeResponse();

      const body = await controller.refresh(
        fakeRequest({ cookies: { [REFRESH_COOKIE_NAME]: 'old' } }),
        res,
      );

      expect(body).toEqual({ access_token: 'new-access-token', user: USER });
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'new-refresh',
        expect.any(Object),
      );
      expect(tokens.signAccessToken).toHaveBeenCalledWith(USER);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and clears the cookie when a cookie is present', async () => {
      const { controller, refreshTokens } = makeController();
      const res = fakeResponse();

      await controller.logout(fakeRequest({ cookies: { [REFRESH_COOKIE_NAME]: 'old' } }), res);

      expect(refreshTokens.revoke).toHaveBeenCalledWith('old');
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('still clears the cookie (no-op revoke) when there is no cookie', async () => {
      const { controller, refreshTokens } = makeController();
      const res = fakeResponse();

      await controller.logout(fakeRequest(), res);

      expect(refreshTokens.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('returns the user and 2FA status', async () => {
      const { controller, authService } = makeController();
      authService.getUserById.mockResolvedValue({
        ...USER,
        twoFactorEnabled: true,
        passwordHash: 'x',
      });

      const body = await controller.me(fakeRequest({ user: USER }));

      expect(body).toEqual({ user: USER, two_factor_enabled: true });
    });

    it('rejects with 401 if the user no longer exists', async () => {
      const { controller, authService } = makeController();
      authService.getUserById.mockResolvedValue(null);

      await expect(controller.me(fakeRequest({ user: USER }))).rejects.toMatchObject({
        problem: { status: 401 },
      });
    });
  });

  describe('2fa/setup', () => {
    it('generates and stores a pending secret and returns the QR payload', async () => {
      const { controller, authService, totp } = makeController();
      authService.getUserById.mockResolvedValue({ ...USER, passwordHash: 'x' });

      const body = await controller.setup2fa(fakeRequest({ user: USER }));

      expect(totp.storePending).toHaveBeenCalledWith(USER.id, 'SECRETBASE32');
      expect(body).toEqual({
        otpauth_url: 'otpauth://totp/MyAmpix:a@b.com?secret=SECRETBASE32',
        secret: 'SECRETBASE32',
        qr_data_url: 'data:image/png;base64,xyz',
      });
    });
  });

  describe('2fa/activate', () => {
    it('rejects with 409 if 2FA is already enabled', async () => {
      const { controller, authService } = makeController();
      authService.getUserById.mockResolvedValue({
        ...USER,
        twoFactorEnabled: true,
        passwordHash: 'x',
      });

      await expect(
        controller.activate2fa(fakeRequest({ user: USER }), { code: '123456' }),
      ).rejects.toMatchObject({ problem: { status: 409 } });
    });

    it('rejects with 400 when there is no pending secret', async () => {
      const { controller, authService, totp } = makeController();
      authService.getUserById.mockResolvedValue({
        ...USER,
        twoFactorEnabled: false,
        passwordHash: 'x',
      });
      totp.getPending.mockResolvedValue(null);

      await expect(
        controller.activate2fa(fakeRequest({ user: USER }), { code: '123456' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
    });

    it('rejects with 401 for a wrong code', async () => {
      const { controller, authService, totp } = makeController();
      authService.getUserById.mockResolvedValue({
        ...USER,
        twoFactorEnabled: false,
        passwordHash: 'x',
      });
      totp.getPending.mockResolvedValue('PENDINGSECRET');
      totp.verify.mockResolvedValue(false);

      await expect(
        controller.activate2fa(fakeRequest({ user: USER }), { code: '000000' }),
      ).rejects.toMatchObject({ problem: { status: 401 } });
    });

    it('persists the secret, clears pending state, and returns recovery codes on success', async () => {
      const { controller, authService, totp, recoveryCodes } = makeController();
      authService.getUserById.mockResolvedValue({
        ...USER,
        twoFactorEnabled: false,
        passwordHash: 'x',
      });
      totp.getPending.mockResolvedValue('PENDINGSECRET');
      totp.verify.mockResolvedValue(true);

      const body = await controller.activate2fa(fakeRequest({ user: USER }), { code: '123456' });

      expect(authService.persistTotpSecret).toHaveBeenCalledWith(USER.id, 'PENDINGSECRET');
      expect(totp.clearPending).toHaveBeenCalledWith(USER.id);
      expect(recoveryCodes.generateAndStore).toHaveBeenCalledWith(USER.id);
      expect(body).toEqual({ recovery_codes: ['code-1', 'code-2'] });
    });
  });

  describe('updateMe (contracts §13)', () => {
    it('parses the body and returns the updated user', async () => {
      const { controller, authService } = makeController();
      authService.updateName.mockResolvedValue({ ...USER, name: 'New Name' });

      const body = await controller.updateMe(fakeRequest({ user: USER }), { name: 'New Name' });

      expect(authService.updateName).toHaveBeenCalledWith(USER.id, 'New Name');
      expect(body).toEqual({ ...USER, name: 'New Name' });
    });

    it('rejects an invalid body before touching the service', async () => {
      const { controller, authService } = makeController();

      await expect(
        controller.updateMe(fakeRequest({ user: USER }), { name: '' }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(authService.updateName).not.toHaveBeenCalled();
    });
  });

  describe('changePassword (contracts §13)', () => {
    it('delegates to the service with the caller id and both passwords', async () => {
      const { controller, authService } = makeController();

      await controller.changePassword(fakeRequest({ user: USER }), {
        current_password: 'old-password1',
        new_password: 'new-password1',
      });

      expect(authService.changePassword).toHaveBeenCalledWith(
        USER.id,
        'old-password1',
        'new-password1',
      );
    });

    it('propagates a 401 thrown by the service for a wrong current password', async () => {
      const { controller, authService } = makeController();
      authService.changePassword.mockRejectedValue(
        Object.assign(new Error('wrong password'), { problem: { status: 401 } }),
      );

      await expect(
        controller.changePassword(fakeRequest({ user: USER }), {
          current_password: 'wrong',
          new_password: 'new-password1',
        }),
      ).rejects.toMatchObject({ problem: { status: 401 } });
    });

    it('rejects a too-short new_password before touching the service', async () => {
      const { controller, authService } = makeController();

      await expect(
        controller.changePassword(fakeRequest({ user: USER }), {
          current_password: 'old-password1',
          new_password: 'short',
        }),
      ).rejects.toMatchObject({ problem: { status: 400 } });
      expect(authService.changePassword).not.toHaveBeenCalled();
    });
  });

  describe('2fa/disable', () => {
    it('rejects with 401 for an invalid code and does not disable 2FA', async () => {
      const { controller, authService } = makeController();
      authService.verifyActiveCode.mockResolvedValue(false);

      await expect(
        controller.disable2fa(fakeRequest({ user: USER }), { code: '000000' }),
      ).rejects.toMatchObject({ problem: { status: 401 } });
      expect(authService.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('disables 2FA for a valid code', async () => {
      const { controller, authService } = makeController();
      authService.verifyActiveCode.mockResolvedValue(true);

      await controller.disable2fa(fakeRequest({ user: USER }), { code: '123456' });

      expect(authService.disableTwoFactor).toHaveBeenCalledWith(USER.id);
    });
  });
});
