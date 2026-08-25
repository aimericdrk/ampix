import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  TEST_ORG_ID,
  TEST_ORG_NAME,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_ID,
  VIEWER_ORG_NAME,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('OrgSettingsPage — owner (TEST_ORG)', () => {
  it('renames the organization', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    const nameInput = screen.getByLabelText('Name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Ada Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ada Renamed'),
    );
  });

  it('lists members with their roles and lets an owner change a member’s role', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await screen.findByText(MFA_USER.email);
    const roleSelect = screen.getByLabelText(`Role for ${MFA_USER.name}`);
    expect(roleSelect).toHaveValue('analyst');

    await userEvent.selectOptions(roleSelect, 'viewer');
    await waitFor(() => expect(roleSelect).toHaveValue('viewer'));
  });

  it('locks the owner’s own row (no role select, no remove)', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    const table = await screen.findByRole('table', { name: 'Organization members' });
    const row = within(table).getByText(TEST_USER.email).closest('tr') as HTMLElement;
    expect(within(row).queryByLabelText(`Role for ${TEST_USER.name}`)).toBeNull();
    expect(within(row).getByText('owner')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('transfers ownership to another member', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await screen.findByText(MFA_USER.email);
    await userEvent.click(screen.getByRole('button', { name: 'Transfer ownership' }));
    await userEvent.selectOptions(screen.getByLabelText('New owner'), MFA_USER.id);
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      const row = screen.getByText(MFA_USER.email).closest('tr') as HTMLElement;
      expect(within(row).getByText('owner')).toBeInTheDocument();
    });
  });

  it('grants a member viewer access to a project from the manage-access dialog', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await screen.findByText(MFA_USER.email);
    const row = screen.getByText(MFA_USER.email).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Manage project access' }));

    const projectSelect = await screen.findByLabelText(`${TEST_PROJECT.name} access`);
    await userEvent.selectOptions(projectSelect, 'viewer');
    await waitFor(() => expect(projectSelect).toHaveValue('viewer'));
  });

  it('removes a member after confirming in the dialog', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await screen.findByText(MFA_USER.email);
    const row = screen.getByText(MFA_USER.email).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByText(MFA_USER.email)).not.toBeInTheDocument());
  });

  it('creates an invitation and shows the shareable link, then revokes it', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await userEvent.click(screen.getByRole('button', { name: 'Create invite link' }));

    const linkCode = await screen.findByText(/\/invite\//);
    expect(linkCode.textContent).toContain(`${window.location.origin}/invite/`);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(screen.getByText('No pending invitations.')).toBeInTheDocument());
  });
});

describe('OrgSettingsPage — viewer (VIEWER_ORG)', () => {
  it('hides mutation controls for a non-admin member', async () => {
    signIn();
    renderApp(`/orgs/${VIEWER_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: VIEWER_ORG_NAME });

    expect(screen.getByText('Your role: viewer')).toBeInTheDocument();

    // Rename is disabled for a viewer.
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Members list is read-only: no role <select>, no Remove button.
    await screen.findByText(MFA_USER.email);
    expect(screen.queryByLabelText(`Role for ${MFA_USER.name}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    // The whole Invitations section is admin-only.
    expect(screen.queryByRole('heading', { name: 'Invitations' })).not.toBeInTheDocument();

    // Deleting the org is owner-only — stricter than the admin gate above.
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });
});

describe('OrgSettingsPage — admin (VIEWER_ORG, MFA_USER is admin there)', () => {
  it('lets an admin rename and invite, but NEVER exposes the delete control', async () => {
    // MFA_USER is `admin` in VIEWER_ORG — the role that CAN manage the org but must not destroy it.
    // This is the gate that matters: `viewer` is blocked by the broader canManage check, so only an
    // admin proves the delete control is gated on `isOwner` specifically and not on canManage.
    authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
    renderApp(`/orgs/${VIEWER_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: VIEWER_ORG_NAME });

    expect(screen.getByText('Your role: admin')).toBeInTheDocument();

    // Admin powers are present…
    expect(screen.getByLabelText('Name')).toBeEnabled();
    expect(await screen.findByRole('heading', { name: 'Invitations' })).toBeInTheDocument();

    // …but deletion is owner-only.
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });
});

describe('OrgSettingsPage — delete organization', () => {
  it('requires the exact org name before the delete button unlocks, then removes the org', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await userEvent.click(screen.getByRole('button', { name: 'Delete organization' }));

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete organization' });
    // Guarded until the typed name matches exactly.
    expect(confirmButton).toBeDisabled();

    const confirmInput = within(dialog).getByLabelText(/Type .* to confirm/);
    await userEvent.type(confirmInput, 'not the org name');
    expect(confirmButton).toBeDisabled();

    await userEvent.clear(confirmInput);
    await userEvent.type(confirmInput, TEST_ORG_NAME);
    await waitFor(() => expect(confirmButton).toBeEnabled());

    await userEvent.click(confirmButton);

    // Gone from the workspace switcher, and the page has navigated away from the dead route.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: TEST_ORG_NAME })).not.toBeInTheDocument(),
    );
  });

  it('closes without deleting when cancelled', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await userEvent.click(screen.getByRole('button', { name: 'Delete organization' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Still on the org, still named the same.
    expect(screen.getByRole('heading', { name: TEST_ORG_NAME })).toBeInTheDocument();
  });
});
