import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  MFA_USER,
  TEST_ORG_ID,
  TEST_ORG_NAME,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_ID,
  VIEWER_ORG_NAME,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('OrgSettingsPage — admin (TEST_ORG)', () => {
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

  it('lists members with their roles and lets an admin change a role', async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    await screen.findByText(MFA_USER.email);
    const roleSelect = screen.getByLabelText(`Role for ${MFA_USER.name}`);
    expect(roleSelect).toHaveValue('analyst');

    await userEvent.selectOptions(roleSelect, 'viewer');
    await waitFor(() => expect(roleSelect).toHaveValue('viewer'));
  });

  it("refuses to demote the org's last admin with a friendly error", async () => {
    signIn();
    renderApp(`/orgs/${TEST_ORG_ID}/settings`);
    await screen.findByRole('heading', { name: TEST_ORG_NAME });

    const roleSelect = await screen.findByLabelText(`Role for ${TEST_USER.name}`);
    expect(roleSelect).toHaveValue('admin');

    await userEvent.selectOptions(roleSelect, 'viewer');

    expect(await screen.findByText("Can't change the last admin's role")).toBeInTheDocument();
    await waitFor(() => expect(roleSelect).toHaveValue('admin'));
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
  });
});
