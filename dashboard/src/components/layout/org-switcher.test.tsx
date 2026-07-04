import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import {
  TEST_ORG_ID,
  TEST_ORG_NAME,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_NAME,
} from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('OrgSwitcher', () => {
  it('lists the caller’s organizations and defaults to the first one', async () => {
    signIn();
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    const select = await screen.findByLabelText('Organization');
    expect(within(select).getByText(TEST_ORG_NAME)).toBeInTheDocument();
    expect(within(select).getByText(VIEWER_ORG_NAME)).toBeInTheDocument();
    await waitFor(() => expect(select).toHaveValue(TEST_ORG_ID));
  });

  it('creates a new organization and switches to it', async () => {
    signIn();
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });
    await screen.findByLabelText('Organization');

    await userEvent.click(screen.getByRole('button', { name: 'New organization' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Organization name'), 'Brand New Org');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const select = await screen.findByLabelText<HTMLSelectElement>('Organization');
    expect(within(select).getByText('Brand New Org')).toBeInTheDocument();
    await waitFor(() => expect(select.selectedOptions[0]?.textContent).toBe('Brand New Org'));
  });

  it('links to the settings page for the current organization', async () => {
    signIn();
    renderApp('/projects');
    await screen.findByLabelText('Organization');

    expect(screen.getByRole('link', { name: 'Organization settings' })).toHaveAttribute(
      'href',
      `/orgs/${TEST_ORG_ID}/settings`,
    );
  });

  it('resets to the first org when the persisted selection is no longer valid', async () => {
    signIn();
    localStorage.setItem('myampmix-current-org', 'some-other-users-org');
    renderApp('/projects');

    const select = await screen.findByLabelText('Organization');
    await waitFor(() => expect(select).toHaveValue(TEST_ORG_ID));
  });
});
