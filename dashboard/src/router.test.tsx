import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authState } from './test/msw/handlers';
import { renderApp } from './test/render-app';

describe('router', () => {
  it('redirects anonymous visitors from a private route to /login', async () => {
    authState.refreshValid = false; // no refresh cookie
    const { router } = renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpMix' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: '/projects' });
  });

  it('restores the session from the refresh cookie and shows projects', async () => {
    authState.refreshValid = true; // valid refresh cookie survives a reload
    renderApp('/projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByText('Demo App')).toBeInTheDocument();
  });

  it('redirects / to /projects (then to login when anonymous)', async () => {
    authState.refreshValid = false;
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Log in to MyAmpMix' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('keeps authenticated users away from /login', async () => {
    authState.refreshValid = true;
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(router.state.location.pathname).toBe('/projects');
  });

  it('renders the invite placeholder with the token from the path', async () => {
    renderApp('/invite/tok_abc123');
    expect(await screen.findByText(/tok_abc123/)).toBeInTheDocument();
  });

  it('shows the project placeholder for /projects/:id', async () => {
    authState.refreshValid = true;
    renderApp('/projects/0197f6a0-0000-7000-8000-0000000000aa');
    expect(await screen.findByText(/later milestones/i)).toBeInTheDocument();
  });

  it('renders not-found for unknown urls', async () => {
    renderApp('/definitely-not-a-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
