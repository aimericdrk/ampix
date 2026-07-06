import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import { currentOrgStore } from '../../features/orgs/store';
import {
  orgsState,
  TEST_ORG_ID,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_ID,
} from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('ProjectSwitcher', () => {
  it('lists the current workspace’s projects and navigates to the chosen one', async () => {
    signIn();
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    const trigger = screen.getByRole('button', { name: 'Switch project' });
    expect(within(trigger).getByText('All projects')).toBeInTheDocument();

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Switch project' });
    expect(within(menu).getByRole('menuitem', { name: 'All projects' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: TEST_PROJECT.name }));

    await screen.findByRole('heading', { name: TEST_PROJECT.name });
  });

  it('only lists projects from the selected workspace', async () => {
    signIn();
    orgsState.projects.push({
      id: 'proj-switcher-viewer-1',
      orgId: VIEWER_ORG_ID,
      name: 'Viewer Org Project',
      timezone: 'UTC',
    });
    currentOrgStore.setCurrentOrg(VIEWER_ORG_ID);
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    const menu = await screen.findByRole('menu', { name: 'Switch project' });
    expect(within(menu).getByRole('menuitem', { name: 'Viewer Org Project' })).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: TEST_PROJECT.name }),
    ).not.toBeInTheDocument();
  });

  it('shows the active project name when on a project route', async () => {
    signIn();
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    const trigger = screen.getByRole('button', { name: 'Switch project' });
    await waitFor(() => expect(within(trigger).getByText(TEST_PROJECT.name)).toBeInTheDocument());
  });

  it('returns to the projects list via the "All projects" option', async () => {
    signIn();
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    const menu = await screen.findByRole('menu', { name: 'Switch project' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'All projects' }));

    await screen.findByRole('heading', { name: 'Projects' });
  });
});
