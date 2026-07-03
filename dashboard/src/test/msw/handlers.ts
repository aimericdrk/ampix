import { http, HttpResponse } from 'msw';
import type { AuthResponse, AuthUser, ListProjectsResponse } from '../../lib/api/types';

export const TEST_USER: AuthUser = {
  id: '0197f6a0-0000-7000-8000-000000000001',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
};
export const TEST_PASSWORD = 'correct-horse-9';
export const VALID_ACCESS_TOKEN = 'valid-access-token';
export const REFRESHED_ACCESS_TOKEN = 'refreshed-access-token';

/** Mutable mock-server state; reset between tests via resetAuthState(). */
export const authState = {
  /** Simulates whether the browser holds a valid httpOnly refresh cookie. */
  refreshValid: false,
  refreshCalls: 0,
  knownEmails: new Set<string>([TEST_USER.email]),
};

export function resetAuthState(): void {
  authState.refreshValid = false;
  authState.refreshCalls = 0;
  authState.knownEmails = new Set([TEST_USER.email]);
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

const ACCEPTED_TOKENS = new Set([VALID_ACCESS_TOKEN, REFRESHED_ACCESS_TOKEN]);

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (body.email === TEST_USER.email && body.password === TEST_PASSWORD) {
      authState.refreshValid = true; // server Set-Cookie's the refresh token
      const response: AuthResponse = { access_token: VALID_ACCESS_TOKEN, user: TEST_USER };
      return HttpResponse.json(response);
    }
    return problem(401, 'Invalid email or password');
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
