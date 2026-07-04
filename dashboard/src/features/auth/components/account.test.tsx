import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEST_PASSWORD, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';
import { authStore } from '../store';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('AccountPage', () => {
  it('updates the display name and reflects it in the session', async () => {
    signIn();
    renderApp('/account');
    await screen.findByRole('heading', { name: 'Account' });

    const nameInput = await screen.findByLabelText('Display name');
    expect(nameInput).toHaveValue(TEST_USER.name);

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Ada Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Name updated')).toBeInTheDocument();
    await waitFor(() => expect(authStore.getState().user?.name).toBe('Ada Renamed'));
  });

  it('changes the password with a valid current password', async () => {
    signIn();
    renderApp('/account');
    await screen.findByRole('heading', { name: 'Account' });

    await userEvent.type(await screen.findByLabelText('Current password'), TEST_PASSWORD);
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });

  it('shows an inline error for a too-short new password without calling the server', async () => {
    signIn();
    renderApp('/account');
    await screen.findByRole('heading', { name: 'Account' });

    await userEvent.type(await screen.findByLabelText('Current password'), TEST_PASSWORD);
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(
      await screen.findByText('New password must be at least 8 characters'),
    ).toBeInTheDocument();
  });

  it('shows a failure toast for the wrong current password', async () => {
    signIn();
    renderApp('/account');
    await screen.findByRole('heading', { name: 'Account' });

    await userEvent.type(
      await screen.findByLabelText('Current password'),
      'totally-wrong-password',
    );
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
  });
});
