import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../store';
import { TEST_PASSWORD, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

/** Per-test MSW override: a 400 problem+json carrying an RFC 7807 per-field errors map. */
function respondWithFieldErrors(path: string, errors: Record<string, string[]>) {
  server.use(
    http.post(path, () =>
      HttpResponse.json(
        { type: 'about:blank', title: 'Validation failed', status: 400, errors },
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    ),
  );
}

describe('LoginForm', () => {
  it('shows field errors on empty submit', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('shows the problem title inline on invalid credentials', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(authStore.getState().status).not.toBe('authenticated');
  });

  it('logs in, stores the session in memory, and lands on projects', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: VALID_ACCESS_TOKEN,
    });
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('honours the ?redirect= search param after login', async () => {
    const { router } = renderApp(
      '/login?redirect=%2Fprojects%2F0197f6a0-0000-7000-8000-0000000000aa',
    );
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByRole('heading', { name: 'Demo App' });
    expect(router.state.location.pathname).toBe('/projects/0197f6a0-0000-7000-8000-0000000000aa');
  });

  /** The /login route's validated search — what useSearch hands the form. */
  function loginSearch(router: ReturnType<typeof renderApp>['router']) {
    return router.state.matches.find((m) => m.routeId === '/login')?.search;
  }

  it('ignores an absolute-URL ?redirect= and falls back to /projects (open redirect)', async () => {
    const { router } = renderApp('/login?redirect=https%3A%2F%2Fevil.com');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    // Dropped at the route boundary — the unsafe value never reaches the form.
    expect(loginSearch(router)).toEqual({});

    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByRole('heading', { name: 'Projects' });
    expect(router.state.location.pathname).toBe('/projects');
  });

  it('ignores a protocol-relative ?redirect= (//evil.com)', async () => {
    const { router } = renderApp('/login?redirect=%2F%2Fevil.com');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    expect(loginSearch(router)).toEqual({});
  });

  it('ignores backslash-based protocol-relative bypasses (/\\evil.com)', async () => {
    // Browsers treat backslashes as slashes during URL resolution, so
    // '/\\evil.com' resolves to https://evil.com — must be dropped too.
    const { router } = renderApp('/login?redirect=%2F%5Cevil.com');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    expect(loginSearch(router)).toEqual({});
  });

  it('renders server-side field errors at the matching field instead of the banner', async () => {
    respondWithFieldErrors('/api/v1/auth/login', {
      email: ['Email domain is not allowed', 'second message ignored'],
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Email domain is not allowed')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
    expect(screen.queryByText('second message ignored')).not.toBeInTheDocument();
  });
});

describe('SignupForm', () => {
  it('shows an inline conflict message when the email is taken', async () => {
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });

  it('signs up a new user and lands on projects', async () => {
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(authStore.getState().user?.email).toBe('grace@example.com');
  });

  it('renders server-side field errors at the matching field instead of the banner', async () => {
    respondWithFieldErrors('/api/v1/auth/signup', {
      email: ['Email domain is not allowed'],
    });
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Email domain is not allowed')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
  });
});

describe('signup disabled (backend SIGNUP_ENABLED=false)', () => {
  function disableSignups() {
    server.use(http.get('/api/v1/auth/config', () => HttpResponse.json({ signup_enabled: false })));
  }

  it('hides the sign-up link on the login page', async () => {
    disableSignups();
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    // The link renders optimistically, then withdraws once the config answer lands.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument(),
    );
  });

  it('redirects /signup to the login page', async () => {
    disableSignups();
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpix' })).toBeInTheDocument();
  });

  it('keeps the sign-up link when the instance is open', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    expect(await screen.findByRole('link', { name: 'Sign up' })).toBeInTheDocument();
  });
});
