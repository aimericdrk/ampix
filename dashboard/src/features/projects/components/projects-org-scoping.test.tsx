import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { renderApp } from '../../../test/render-app';
import {
  orgsState,
  TEST_ORG_ID,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_ID,
} from '../../../test/msw/handlers';
import { currentOrgStore } from '../../orgs/store';

describe('ProjectsPage — organization scoping', () => {
  it('shows only the selected org\'s projects and updates when the org changes', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    // TEST_ORG owns TEST_PROJECT (seed). Give the viewer org its own project so
    // switching orgs is observable both ways.
    orgsState.projects.push({
      id: 'proj-viewer-scoping-1',
      orgId: VIEWER_ORG_ID,
      name: 'Viewer Org Project',
      timezone: 'UTC',
    });

    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp('/projects');

    // Only TEST_ORG's project is visible while TEST_ORG is selected.
    await waitFor(() => expect(screen.getByText(TEST_PROJECT.name)).toBeInTheDocument());
    expect(screen.queryByText('Viewer Org Project')).not.toBeInTheDocument();

    // Switching org changes the list (this is the bug being fixed: the list used
    // to show every project across all orgs regardless of the selected org).
    currentOrgStore.setCurrentOrg(VIEWER_ORG_ID);
    await waitFor(() => expect(screen.getByText('Viewer Org Project')).toBeInTheDocument());
    expect(screen.queryByText(TEST_PROJECT.name)).not.toBeInTheDocument();
  });

  it('shows role, org, timezone, project id and a RevenueCat badge on each project row', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp('/projects');

    const nameEl = await screen.findByText(TEST_PROJECT.name);
    const row = within(nameEl.closest('a') as HTMLElement);
    expect(row.getByText(TEST_PROJECT.role)).toBeInTheDocument(); // role badge ('owner')
    expect(row.getByText(TEST_PROJECT.org_name)).toBeInTheDocument();
    expect(row.getByText(TEST_PROJECT.timezone)).toBeInTheDocument();
    expect(row.getByText(TEST_PROJECT.id)).toBeInTheDocument();
    // TEST_PROJECT is RevenueCat-connected in the fixture, so the badge shows.
    expect(row.getByText('RevenueCat')).toBeInTheDocument();
    // User count + top country come from GET /projects/stats (fixture: 1234 users, US).
    await waitFor(() => expect(row.getByText('1,234')).toBeInTheDocument());
    expect(row.getByText(/United States/)).toBeInTheDocument();
  });
});
