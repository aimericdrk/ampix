import { http, HttpResponse } from 'msw';
import type {
  Activate2faResponse,
  AuthResponse,
  AuthUser,
  ListProjectsResponse,
  MeResponse,
  Setup2faResponse,
} from '../../lib/api/types';

export const TEST_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
};
export const TEST_PASSWORD = 'correct-horse-9';
export const VALID_ACCESS_TOKEN = 'valid-access-token';
export const REFRESHED_ACCESS_TOKEN = 'refreshed-access-token';

/** A fixture user with 2FA already enabled, for exercising the login step-up flow. */
export const MFA_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000002',
  email: 'mfa-user@example.com',
  name: 'Radia Perlman',
};
export const MFA_PASSWORD = 'super-secret-mfa-1';
export const MFA_STEP_UP_TOKEN = 'mfa-step-up-token';
export const MFA_ACCESS_TOKEN = 'mfa-access-token';

/** Fake TOTP: any handler that "checks a code" accepts this constant instead of running RFC 6238. */
export const TOTP_VALID_CODE = '123456';
export const MOCK_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
export const MOCK_QR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** A single pre-seeded recovery code accepted once by /2fa/verify or /2fa/disable. */
export const MFA_RECOVERY_CODE = 'RECOVERY-CODE-0';

interface Fixture {
  user: AuthUser;
  password: string;
}

const FIXTURES: Fixture[] = [
  { user: TEST_USER, password: TEST_PASSWORD },
  { user: MFA_USER, password: MFA_PASSWORD },
];

function findFixture(email?: string, password?: string): Fixture | undefined {
  return FIXTURES.find((fixture) => fixture.user.email === email && fixture.password === password);
}

/** access token -> the fixture user it belongs to, for /me and the 2FA-management endpoints. */
const TOKEN_USERS: Record<string, AuthUser> = {
  [VALID_ACCESS_TOKEN]: TEST_USER,
  [REFRESHED_ACCESS_TOKEN]: TEST_USER,
  [MFA_ACCESS_TOKEN]: MFA_USER,
};

function userForToken(token: string | null): AuthUser | null {
  return token ? (TOKEN_USERS[token] ?? null) : null;
}

/** Mutable mock-server state; reset between tests via resetAuthState(). */
export const authState = {
  /** Simulates whether the browser holds a valid httpOnly refresh cookie. */
  refreshValid: false,
  refreshCalls: 0,
  knownEmails: new Set<string>([TEST_USER.email, MFA_USER.email]),
  /** Emails with 2FA currently ON. MFA_USER starts enabled; TEST_USER starts disabled. */
  twoFactorEnabled: new Set<string>([MFA_USER.email]),
  /** Pending (not-yet-active) TOTP secret per email, set by /2fa/setup, cleared by /2fa/activate. */
  pendingSecret: new Map<string, string>(),
  /** Unused recovery codes per email — single-use, consumed by /2fa/verify or /2fa/disable. */
  recoveryCodes: new Map<string, Set<string>>([[MFA_USER.email, new Set([MFA_RECOVERY_CODE])]]),
};

export function resetAuthState(): void {
  authState.refreshValid = false;
  authState.refreshCalls = 0;
  authState.knownEmails = new Set([TEST_USER.email, MFA_USER.email]);
  authState.twoFactorEnabled = new Set([MFA_USER.email]);
  authState.pendingSecret = new Map();
  authState.recoveryCodes = new Map([[MFA_USER.email, new Set([MFA_RECOVERY_CODE])]]);
}

function problem(status: number, title: string, extra?: Record<string, unknown>) {
  return HttpResponse.json(
    { type: 'about:blank', title, status, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

const ACCEPTED_TOKENS = new Set(Object.keys(TOKEN_USERS));

/** Accepts the fake TOTP code, or a still-unused recovery code (consuming it). */
function checkCode(email: string, code: string | undefined): boolean {
  if (!code) return false;
  if (code === TOTP_VALID_CODE) return true;
  const codes = authState.recoveryCodes.get(email);
  if (codes?.has(code)) {
    codes.delete(code);
    return true;
  }
  return false;
}

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    const fixture = findFixture(body.email, body.password);
    if (!fixture) return problem(401, 'Invalid email or password');

    if (authState.twoFactorEnabled.has(fixture.user.email)) {
      // No access token, no refresh cookie — just the short-lived mfa_token (contracts §11).
      const response: AuthResponse = { mfa_required: true, mfa_token: MFA_STEP_UP_TOKEN };
      return HttpResponse.json(response);
    }

    authState.refreshValid = true; // server Set-Cookie's the refresh token
    const token = fixture.user === MFA_USER ? MFA_ACCESS_TOKEN : VALID_ACCESS_TOKEN;
    const response: AuthResponse = { access_token: token, user: fixture.user };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/signup', async ({ request }) => {
    const body = (await request.json()) as { name?: string; email?: string; password?: string };
    if (!body.email || !body.password || !body.name) {
      return problem(400, 'Validation failed', {
        errors: { email: ['required'], password: ['required'], name: ['required'] },
      });
    }
    if (authState.knownEmails.has(body.email)) {
      return problem(409, 'Email already registered');
    }
    authState.knownEmails.add(body.email);
    authState.refreshValid = true;
    const response: AuthResponse = {
      access_token: VALID_ACCESS_TOKEN,
      user: { ...TEST_USER, email: body.email, name: body.name },
    };
    return HttpResponse.json(response); // 200, per contracts §7 (same as login/refresh)
  }),

  http.post('/api/v1/auth/refresh', () => {
    authState.refreshCalls += 1;
    if (!authState.refreshValid) return problem(401, 'Refresh token invalid or expired');
    const response: AuthResponse = { access_token: REFRESHED_ACCESS_TOKEN, user: TEST_USER };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/logout', () => {
    authState.refreshValid = false;
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Auth & TOTP 2FA (contracts §11) ---

  http.post('/api/v1/auth/2fa/verify', async ({ request }) => {
    const body = (await request.json()) as { mfa_token?: string; code?: string };
    if (body.mfa_token !== MFA_STEP_UP_TOKEN) {
      return problem(401, 'Session expired, please log in again');
    }
    if (!checkCode(MFA_USER.email, body.code)) {
      return problem(401, 'Invalid authentication code');
    }
    authState.refreshValid = true;
    const response: AuthResponse = { access_token: MFA_ACCESS_TOKEN, user: MFA_USER };
    return HttpResponse.json(response);
  }),

  http.get('/api/v1/auth/me', ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const response: MeResponse = {
      user,
      two_factor_enabled: authState.twoFactorEnabled.has(user.email),
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/setup', ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    authState.pendingSecret.set(user.email, MOCK_TOTP_SECRET);
    const response: Setup2faResponse = {
      otpauth_url: `otpauth://totp/MyAmpMix:${encodeURIComponent(user.email)}?secret=${MOCK_TOTP_SECRET}&issuer=MyAmpMix`,
      secret: MOCK_TOTP_SECRET,
      qr_data_url: MOCK_QR_DATA_URL,
    };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/activate', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { code?: string };
    const pending = authState.pendingSecret.get(user.email);
    if (!pending || body.code !== TOTP_VALID_CODE) {
      return problem(401, 'Invalid authentication code');
    }
    authState.pendingSecret.delete(user.email);
    authState.twoFactorEnabled.add(user.email);
    const codes = Array.from({ length: 10 }, (_, i) => `RECOVERY-CODE-${i}`);
    authState.recoveryCodes.set(user.email, new Set(codes));
    const response: Activate2faResponse = { recovery_codes: codes };
    return HttpResponse.json(response);
  }),

  http.post('/api/v1/auth/2fa/disable', async ({ request }) => {
    const user = userForToken(bearerToken(request));
    if (!user) return problem(401, 'Access token invalid or expired');
    const body = (await request.json()) as { code?: string };
    if (!checkCode(user.email, body.code)) {
      return problem(401, 'Invalid authentication code');
    }
    authState.twoFactorEnabled.delete(user.email);
    authState.recoveryCodes.delete(user.email);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/projects', ({ request }) => {
    const token = bearerToken(request);
    if (!token || !ACCEPTED_TOKENS.has(token)) {
      return problem(401, 'Access token invalid or expired');
    }
    const response: ListProjectsResponse = {
      projects: [
        {
          id: '0197f6a0-0000-7000-8000-0000000000aa',
          org_id: '0197f6a0-0000-7000-8000-0000000000bb',
          name: 'Demo App',
          timezone: 'UTC',
        },
      ],
    };
    return HttpResponse.json(response);
  }),
];
