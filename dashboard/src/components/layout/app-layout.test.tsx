import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import { authState, TEST_USER } from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

describe('AppLayout', () => {
  it('shows navigation, the project switcher stub, and the signed-in user', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All projects/ })).toBeDisabled();
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
  });

  it('toggles the theme from the sidebar and persists it', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('myampmix-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    document.documentElement.classList.remove('dark');
  });

  it('logs out, clears the in-memory session, and returns to login', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpMix' })).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });
});
