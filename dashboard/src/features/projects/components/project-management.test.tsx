import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_NAME,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signInAsAdmin() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('ProjectsPage — creating a project', () => {
  it('lets an admin create a new project in the current organization', async () => {
    signInAsAdmin();
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });
    // Wait for the org context (and admin role) to settle before creating.
    await waitFor(() => expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Mobile App');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Mobile App')).toBeInTheDocument();
  });

  it('gates project creation on the selected workspace’s role', async () => {
    authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    // MFA_USER's default workspace is TEST_ORG, where they are only an analyst → disabled.
    await waitFor(() => expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled());

    // Switching to the workspace where MFA_USER is an admin (VIEWER_ORG) enables creation.
    await userEvent.click(await screen.findByRole('button', { name: 'Switch workspace' }));
    const menu = await screen.findByRole('menu', { name: 'Switch workspace' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: VIEWER_ORG_NAME }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled());
  });
});

describe('ProjectDetailPage — admin settings', () => {
  it('renames the project', async () => {
    signInAsAdmin();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    const nameInput = await screen.findByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed App');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Renamed App'),
    );
  });

  it('creates a new ingest token and revokes it after confirming', async () => {
    signInAsAdmin();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.click(screen.getByRole('button', { name: 'New token' }));
    expect(await screen.findByText(/won't be shown again in full/)).toBeInTheDocument();

    const tokensTable = await screen.findByRole('table', { name: 'Ingest tokens' });
    const rows = within(tokensTable).getAllByRole('row');
    // header + Default token + new Untitled token
    expect(rows.length).toBe(3);

    const revokeButtons = within(tokensTable).getAllByRole('button', { name: 'Revoke' });
    await userEvent.click(revokeButtons[0]!);

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      const remainingRows = within(
        screen.getByRole('table', { name: 'Ingest tokens' }),
      ).getAllByRole('row');
      expect(remainingRows.length).toBe(2);
    });
  });

  it('deletes the project after confirming, then navigates back to the projects list', async () => {
    signInAsAdmin();
    const { router } = renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByText(TEST_PROJECT.name)).not.toBeInTheDocument();
  });
});
