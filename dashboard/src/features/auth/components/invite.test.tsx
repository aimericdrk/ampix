import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  FIXED_INVITE_ROLE,
  FIXED_INVITE_TOKEN,
  INVITE_ONLY_ORG_NAME,
  orgsState,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';
import { authStore } from '../store';

describe('InvitePage', () => {
  it('shows the org name and role for a valid invitation', async () => {
    renderApp(`/invite/${FIXED_INVITE_TOKEN}`);

    expect(await screen.findByText(INVITE_ONLY_ORG_NAME)).toBeInTheDocument();
    expect(screen.getByText(FIXED_INVITE_ROLE)).toBeInTheDocument();
  });

  it('prompts an unauthenticated visitor to log in or sign up, preserving the invite URL', async () => {
    renderApp(`/invite/${FIXED_INVITE_TOKEN}`);
    await screen.findByText(INVITE_ONLY_ORG_NAME);

    const encoded = encodeURIComponent(`/invite/${FIXED_INVITE_TOKEN}`);
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      `/login?redirect=${encoded}`,
    );
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      `/signup?redirect=${encoded}`,
    );
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
  });

  it('accepts the invitation for an authenticated user, creating the membership, then lands on projects', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/invite/${FIXED_INVITE_TOKEN}`);
    await screen.findByText(INVITE_ONLY_ORG_NAME);

    await userEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument();
  });

  it('shows a not-found message for an unknown token', async () => {
    renderApp('/invite/does-not-exist-token');
    expect(
      await screen.findByText('This invitation link is invalid or does not exist.'),
    ).toBeInTheDocument();
  });

  it('shows an expired message for an already-accepted invitation', async () => {
    // Simulate a different visitor having already consumed this link.
    const invitation = orgsState.invitations.find((inv) => inv.token === FIXED_INVITE_TOKEN);
    invitation!.acceptedBy = 'someone-else-user-id';

    renderApp(`/invite/${FIXED_INVITE_TOKEN}`);
    expect(
      await screen.findByText(/This invitation has expired or has already been used/),
    ).toBeInTheDocument();
  });
});
