import { screen } from '@testing-library/react';
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
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('shows the problem title inline on invalid credentials', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(authStore.getState().status).not.toBe('authenticated');
  });

  it('logs in, stores the session in memory, and lands on projects', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
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
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByText(/later milestones/i);
    expect(router.state.location.pathname).toBe('/projects/0197f6a0-0000-7000-8000-0000000000aa');
  });

  it('renders server-side field errors at the matching field instead of the banner', async () => {
    respondWithFieldErrors('/api/v1/auth/login', {
      email: ['Email domain is not allowed', 'second message ignored'],
    });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
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
    await screen.findByRole('heading', { name: 'Create your MyAmpMix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email'), TEST_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Email already registered')).toBeInTheDocument();
  });

  it('signs up a new user and lands on projects', async () => {
    renderApp('/signup');
    await screen.findByRole('heading', { name: 'Create your MyAmpMix account' });
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
    await screen.findByRole('heading', { name: 'Create your MyAmpMix account' });
    await userEvent.type(screen.getByLabelText('Name'), 'Grace Hopper');
    await userEvent.type(screen.getByLabelText('Email'), 'grace@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Email domain is not allowed')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
  });
});
