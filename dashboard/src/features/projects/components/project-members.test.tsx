import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  orgsState,
  TEST_PROJECT,
  TEST_USER,
  THIRD_ORG_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signInAsOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function signInAsAdmin() {
  authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
}

describe('ProjectMembersSection — owner (TEST_USER on TEST_PROJECT)', () => {
  it('sees a role select including "owner" for other members', async () => {
    signInAsOwner();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await screen.findByText(MFA_USER.email);
    const roleSelect = screen.getByLabelText(`Role for ${MFA_USER.name}`);
    expect(roleSelect).toHaveValue('admin');

    const options = within(roleSelect).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['owner', 'admin', 'analyst', 'viewer']);
  });

  it("shows the current user's own role as a read-only badge and disables their remove (last owner)", async () => {
    signInAsOwner();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await screen.findByText(TEST_USER.email);
    // Nobody may change their OWN role — the current user's row is a read-only badge, not a select.
    expect(screen.queryByLabelText(`Role for ${TEST_USER.name}`)).not.toBeInTheDocument();

    const main = screen.getByRole('main');
    const row = within(main).getByText(TEST_USER.email).closest('tr') as HTMLElement;
    expect(within(row).getByText('owner')).toBeInTheDocument();
    // Still the last owner, so removal stays disabled too.
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('lists only org members not already on the project in the add-member picker', async () => {
    signInAsOwner();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    const memberPicker = await screen.findByLabelText('Member');
    const names = within(memberPicker)
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(names.some((n) => n?.includes(THIRD_ORG_USER.name))).toBe(true);
    expect(names.some((n) => n?.includes(TEST_USER.name))).toBe(false);
    expect(names.some((n) => n?.includes(MFA_USER.name))).toBe(false);
  });
});

describe('ProjectMembersSection — admin (MFA_USER on TEST_PROJECT)', () => {
  it('sees a read-only badge (no editing control) for the owner row', async () => {
    signInAsAdmin();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await screen.findByText(TEST_USER.email);
    expect(screen.queryByLabelText(`Role for ${TEST_USER.name}`)).not.toBeInTheDocument();

    const row = screen.getByText(TEST_USER.email).closest('tr') as HTMLElement;
    expect(within(row).getByText('owner')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it("shows the admin's OWN role as a read-only badge (cannot change own role)", async () => {
    signInAsAdmin();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    // MFA_USER is an admin who CAN manage members, but must never edit their own role.
    expect(screen.queryByLabelText(`Role for ${MFA_USER.name}`)).not.toBeInTheDocument();

    const main = screen.getByRole('main');
    await within(main).findByText(MFA_USER.email);
    const row = within(main).getByText(MFA_USER.email).closest('tr') as HTMLElement;
    expect(within(row).getByText('admin')).toBeInTheDocument();
  });

  it('cannot offer "owner" as an add-member role option', async () => {
    signInAsAdmin();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    const rolePicker = await screen.findByLabelText('Role', { selector: '#add-member-role' });
    const options = within(rolePicker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['admin', 'analyst', 'viewer']);
  });
});

describe('ProjectMembersSection — analyst (read-only)', () => {
  it('shows a read-only member list with no add/role/remove controls', async () => {
    signInAsAdmin();
    // Downgrade MFA_USER from admin to analyst on TEST_PROJECT for this scenario only.
    const membership = orgsState.projectMemberships.find(
      (m) => m.projectId === TEST_PROJECT.id && m.user.id === MFA_USER.id,
    );
    if (membership) membership.role = 'analyst';

    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await screen.findByText(TEST_USER.email);
    expect(screen.queryByLabelText(`Role for ${TEST_USER.name}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Member')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
  });
});
