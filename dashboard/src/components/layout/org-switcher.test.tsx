import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import {
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
  it('shows the current workspace and lists the caller’s organizations in the menu', async () => {
    signIn();
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    const trigger = await screen.findByRole('button', { name: 'Switch workspace' });
    // Defaults to the first org.
    await waitFor(() => expect(within(trigger).getByText(TEST_ORG_NAME)).toBeInTheDocument());

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Switch workspace' });
    // "New organization" is pinned at the top of the menu (no standalone button).
    expect(within(menu).getByRole('menuitem', { name: /New organization/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: TEST_ORG_NAME })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: VIEWER_ORG_NAME })).toBeInTheDocument();
    // The current org is marked for assistive tech.
    expect(within(menu).getByRole('menuitem', { name: TEST_ORG_NAME })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('switches to another organization from the menu', async () => {
    signIn();
    renderApp('/projects');
    const trigger = await screen.findByRole('button', { name: 'Switch workspace' });
    await waitFor(() => expect(within(trigger).getByText(TEST_ORG_NAME)).toBeInTheDocument());

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Switch workspace' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: VIEWER_ORG_NAME }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Switch workspace' })).getByText(VIEWER_ORG_NAME),
      ).toBeInTheDocument(),
    );
  });

  it('creates a new organization from the top of the menu and switches to it', async () => {
    signIn();
    renderApp('/projects');
    const trigger = await screen.findByRole('button', { name: 'Switch workspace' });
    await waitFor(() => expect(within(trigger).getByText(TEST_ORG_NAME)).toBeInTheDocument());

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Switch workspace' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: /New organization/ }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Organization name'), 'Brand New Org');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create organization' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: 'Switch workspace' })).getByText('Brand New Org'),
      ).toBeInTheDocument(),
    );
  });

  it('defaults to the first org when no valid selection is persisted', async () => {
    signIn();
    localStorage.setItem('myampmix-current-org', 'some-other-users-org');
    renderApp('/projects');

    const trigger = await screen.findByRole('button', { name: 'Switch workspace' });
    await waitFor(() => expect(within(trigger).getByText(TEST_ORG_NAME)).toBeInTheDocument());
  });
});
