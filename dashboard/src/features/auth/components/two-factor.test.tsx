import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../store';
import {
  authState,
  MFA_ACCESS_TOKEN,
  MFA_PASSWORD,
  MFA_USER,
  MOCK_TOTP_SECRET,
  TOTP_VALID_CODE,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

describe('2FA login step-up', () => {
  it('challenges a 2FA-enabled user, then authenticates on the correct code', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), MFA_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), MFA_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    // No session yet — still on the challenge screen.
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(authStore.getState().status).not.toBe('authenticated');
    expect(localStorage.getItem('mfa_token')).toBeNull();

    await userEvent.type(screen.getByLabelText('Authentication code'), TOTP_VALID_CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(authStore.getState()).toMatchObject({
      status: 'authenticated',
      accessToken: MFA_ACCESS_TOKEN,
      user: MFA_USER,
    });
  });

  it('shows an inline error for a wrong code and allows retrying with the right one', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in to MyAmpix' });
    await userEvent.type(screen.getByLabelText('Email'), MFA_USER.email);
    await userEvent.type(screen.getByLabelText('Password'), MFA_PASSWORD);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await screen.findByLabelText('Authentication code');
    await userEvent.type(screen.getByLabelText('Authentication code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Invalid authentication code')).toBeInTheDocument();
    expect(authStore.getState().status).not.toBe('authenticated');

    await userEvent.clear(screen.getByLabelText('Authentication code'));
    await userEvent.type(screen.getByLabelText('Authentication code'), TOTP_VALID_CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(authStore.getState().status).toBe('authenticated');
  });
});

describe('Security settings — enable 2FA', () => {
  it('walks through setup and activation, revealing recovery codes once', async () => {
    authState.refreshValid = true; // authenticated as TEST_USER (2FA off) via refresh cookie
    // /settings/security redirects to /account, where the two-factor section now lives.
    const { router } = renderApp('/settings/security');
    await screen.findByRole('heading', { name: 'Account' });
    expect(router.state.location.pathname).toBe('/account');
    expect(await screen.findByRole('button', { name: 'Enable 2FA' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));

    const qr = await screen.findByRole('img', { name: '2FA setup QR code' });
    expect(qr).toHaveAttribute('src', expect.stringContaining('data:image/png'));
    expect(screen.getByText(MOCK_TOTP_SECRET)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Enter the 6-digit code'), TOTP_VALID_CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Activate 2FA' }));

    expect(await screen.findByText(/Save these recovery codes/i)).toBeInTheDocument();
    expect(screen.getByText('RECOVERY-CODE-0')).toBeInTheDocument();
    expect(screen.getByText('RECOVERY-CODE-9')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: "I've saved my recovery codes" }));

    expect(await screen.findByRole('button', { name: 'Disable 2FA' })).toBeInTheDocument();
  });
});

describe('Security settings — reflects 2FA state and disables it', () => {
  it('shows the MFA fixture as already enabled, rejects a bad code, then disables with a valid one', async () => {
    authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
    authState.refreshValid = true;
    // /settings/security redirects to /account, where the two-factor section now lives.
    const { router } = renderApp('/settings/security');
    await screen.findByRole('heading', { name: 'Account' });
    expect(router.state.location.pathname).toBe('/account');

    expect(await screen.findByRole('button', { name: 'Disable 2FA' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Authentication code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    expect(await screen.findByText('Invalid authentication code')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Authentication code'));
    await userEvent.type(screen.getByLabelText('Authentication code'), TOTP_VALID_CODE);
    await userEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enable 2FA' })).toBeInTheDocument(),
    );
  });
});
