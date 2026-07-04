import { expect, test } from '@playwright/test';
import { trackPageErrors } from './fixtures/console-errors';

/**
 * Functional, end-to-end, NO-MOCK test: drives the real dashboard UI (two separate browser
 * contexts, one per actor) against the real backend to prove the full multi-user tenancy
 * management journey — org/member/invitation/project/token management — exactly as two real
 * humans would use it.
 *
 * Journey: ADMIN signs up (auto-provisioned org + Default project, contracts §12) -> opens
 * org settings -> creates a 'viewer' invitation, copies the real invite link out of the DOM ->
 * a MEMBER, in a brand-new incognito context so cookies never collide with the admin's
 * session, opens that link, sees "invited to <org> as viewer", signs up through the
 * invite-preserving signup flow, and accepts -> back as ADMIN, the member shows up with role
 * 'viewer'; the admin promotes them to 'analyst' via the real role <select> and the change
 * survives a reload (proves the PATCH persisted, not just optimistic client state) -> as the
 * MEMBER, admin-only controls (invite form, member-role editor) are entirely absent from the
 * DOM, and a direct backend call proves the 403 is enforced server-side too, not just hidden
 * in the UI -> ADMIN creates a new project, opens it, and creates + revokes ingest tokens,
 * with the token table reflecting each change.
 *
 * Contracts: docs/superpowers/specs/2026-07-02-shared-contracts.md §11 (auth), §12 (projects
 * auto-provisioning), §13 (orgs, members, invitations, projects & tokens management).
 */

const API_BASE_URL = 'http://localhost:8080';
const PASSWORD = 'correct-horse-battery-9';

test('multi-user tenancy: invite, accept, role change, role-aware UI, project + token management', async ({
  page: adminPage,
  browser,
}) => {
  // Every console error / uncaught page error, from BOTH actors, asserted empty at the end.
  const errors: string[] = [];
  let adminAuthEstablished = false;
  trackPageErrors(adminPage, 'admin', errors, () => adminAuthEstablished);

  const adminName = 'Ada Admin';
  const memberName = 'Mia Member';
  const adminEmail = `admin_${Date.now()}@example.com`;
  const memberEmail = `member_${Date.now()}@example.com`;
  const orgName = `${adminName}'s Workspace`; // contracts §12: "<name>'s Workspace"

  // ---- Step 1: ADMIN signs up through the UI. Auto-provisions org + Default project. ----
  await adminPage.goto('/signup');
  await adminPage.getByLabel('Name').fill(adminName);
  await adminPage.getByLabel('Email').fill(adminEmail);
  await adminPage.getByLabel('Password').fill(PASSWORD);
  await adminPage.getByRole('button', { name: 'Create account' }).click();

  await expect(adminPage).toHaveURL(/\/projects$/);
  await expect(adminPage.getByRole('heading', { name: 'Projects' })).toBeVisible();
  adminAuthEstablished = true;

  // ---- Step 2: ADMIN opens org settings and creates a 'viewer' invitation. ----
  await adminPage.getByRole('link', { name: 'Organization settings' }).click();
  await expect(adminPage).toHaveURL(/\/orgs\/[^/]+\/settings$/);
  await expect(adminPage.getByRole('heading', { name: orgName, level: 1 })).toBeVisible();
  await expect(adminPage.getByText('Your role: admin')).toBeVisible();

  const orgId = new URL(adminPage.url()).pathname.match(/^\/orgs\/([^/]+)\/settings$/)?.[1];
  expect(orgId).toBeTruthy();

  await adminPage.locator('#invite-role').selectOption('viewer');
  await adminPage.getByRole('button', { name: 'Create invite link' }).click();

  // The UI shows a copyable invite link — read the real URL straight out of the DOM.
  const inviteLinkCode = adminPage.locator('code', { hasText: '/invite/' });
  await expect(inviteLinkCode).toBeVisible();
  const inviteUrl = (await inviteLinkCode.innerText()).trim();
  expect(inviteUrl).toMatch(/^http:\/\/localhost:5173\/invite\/[\w-]+$/);

  // ---- Step 3: MEMBER, in a SEPARATE incognito context, opens the invite, signs up, accepts. ----
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  let memberAuthEstablished = false;
  trackPageErrors(memberPage, 'member', errors, () => memberAuthEstablished);

  await memberPage.goto(inviteUrl);
  const inviteMessage = memberPage.locator('p', { hasText: "You've been invited to" });
  await expect(inviteMessage).toBeVisible();
  await expect(inviteMessage).toContainText(orgName);
  await expect(inviteMessage).toContainText('viewer');

  // Unauthenticated: the UI offers log in / sign up, preserving the invite URL as `redirect`.
  await expect(memberPage.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  await memberPage.getByRole('link', { name: 'Sign up' }).click();
  await expect(memberPage).toHaveURL(/\/signup\?redirect=/);

  await memberPage.getByLabel('Name').fill(memberName);
  await memberPage.getByLabel('Email').fill(memberEmail);
  await memberPage.getByLabel('Password').fill(PASSWORD);
  await memberPage.getByRole('button', { name: 'Create account' }).click();
  memberAuthEstablished = true;

  // Signup's redirect sends them right back to the invite page, now authenticated.
  await expect(memberPage).toHaveURL(/\/invite\//);
  await memberPage.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(memberPage).toHaveURL(/\/projects$/);
  await expect(memberPage.getByRole('heading', { name: 'Projects' })).toBeVisible();

  // ---- Step 4: back as ADMIN — the new member appears as 'viewer'; promote to 'analyst'. ----
  await adminPage.reload();
  await expect(adminPage.getByRole('heading', { name: orgName, level: 1 })).toBeVisible();

  const membersTable = adminPage.getByRole('table', { name: 'Organization members' });
  const memberRow = membersTable.locator('tbody tr', { hasText: memberEmail });
  await expect(memberRow).toHaveCount(1);
  const roleSelect = memberRow.getByLabel(`Role for ${memberName}`);
  await expect(roleSelect).toHaveValue('viewer');

  await roleSelect.selectOption('analyst');
  await expect(roleSelect).toHaveValue('analyst');

  // Reload — a fresh GET, not optimistic client state — and expect the change to have stuck.
  await adminPage.reload();
  await expect(
    adminPage
      .getByRole('table', { name: 'Organization members' })
      .locator('tbody tr', { hasText: memberEmail })
      .getByLabel(`Role for ${memberName}`),
  ).toHaveValue('analyst');

  // ---- Step 5: as the MEMBER, admin-only controls are entirely absent from the DOM. ----
  await memberPage.getByRole('link', { name: 'Organization settings' }).click();
  await expect(memberPage).toHaveURL(/\/orgs\/[^/]+\/settings$/);
  await expect(memberPage.getByRole('heading', { name: orgName, level: 1 })).toBeVisible();
  await expect(memberPage.getByText('Your role: analyst')).toBeVisible();

  // The whole Invitations card (create-invite form included) is admin-only — not rendered.
  await expect(memberPage.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);
  await expect(memberPage.locator('#invite-role')).toHaveCount(0);
  // No member gets a role <select> or a Remove button when the viewer isn't an admin.
  await expect(memberPage.getByLabel(/Role for /)).toHaveCount(0);
  await expect(memberPage.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  // The rename form is present but disabled, not hidden — also role-aware, just a different mode.
  await expect(memberPage.getByLabel('Name')).toBeDisabled();
  await expect(memberPage.getByRole('button', { name: 'Save' })).toBeDisabled();
  // Their own row now reads 'analyst' as plain text (no control at all).
  await expect(
    memberPage.getByRole('table', { name: 'Organization members' }).locator('tbody tr', {
      hasText: memberEmail,
    }),
  ).toContainText('analyst');

  // The UI can't exercise "what if a non-admin calls the mutation anyway" — there's no
  // control to click. Prove the backend itself enforces it: exchange the member's refresh
  // cookie (shared with this context's request API) for an access token and call the
  // invitation-create endpoint directly.
  const memberRefresh = await memberContext.request.post(`${API_BASE_URL}/api/v1/auth/refresh`);
  expect(memberRefresh.status()).toBe(200);
  const { access_token: memberAccessToken } = (await memberRefresh.json()) as {
    access_token: string;
  };
  const forbidden = await memberContext.request.post(
    `${API_BASE_URL}/api/v1/orgs/${orgId}/invitations`,
    {
      headers: { Authorization: `Bearer ${memberAccessToken}` },
      data: { role: 'viewer' },
    },
  );
  expect(forbidden.status()).toBe(403);

  // ---- Step 6: ADMIN creates a new project, then manages its tokens. ----
  await adminPage.getByRole('link', { name: 'Projects' }).click();
  await expect(adminPage).toHaveURL(/\/projects$/);

  const projectName = 'Mobile App';
  await adminPage.getByRole('button', { name: 'New project' }).click();
  const newProjectDialog = adminPage.getByRole('dialog');
  await newProjectDialog.getByLabel('Project name').fill(projectName);
  await newProjectDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(newProjectDialog).toHaveCount(0);

  const projectCardHeading = adminPage.getByRole('heading', { name: projectName, level: 2 });
  await expect(projectCardHeading).toBeVisible();
  await projectCardHeading.click();

  await expect(adminPage).toHaveURL(/\/projects\/[^/]+$/);
  await expect(adminPage.getByRole('heading', { name: projectName, level: 1 })).toBeVisible();
  await expect(
    adminPage.locator('#main-content').getByText(orgName, { exact: true }),
  ).toBeVisible();

  const tokensTable = adminPage.getByRole('table', { name: 'Ingest tokens' });
  await expect(tokensTable).toBeVisible();
  await expect(tokensTable.locator('tbody tr')).toHaveCount(1);
  const initialToken = (await tokensTable.locator('tbody tr').locator('code').innerText()).trim();
  expect(initialToken).toMatch(/^mam_[0-9a-f]{32}$/);

  // Create a second token.
  await adminPage.getByLabel('Label (optional)').fill('iOS app');
  await adminPage.getByRole('button', { name: 'New token' }).click();
  await expect(adminPage.getByText(/won't be shown again in full/)).toBeVisible();
  await expect(tokensTable.locator('tbody tr')).toHaveCount(2);

  // Revoke the original token; the list updates to show only the new one.
  const originalTokenRow = tokensTable.locator('tbody tr', { hasText: initialToken });
  await originalTokenRow.getByRole('button', { name: 'Revoke' }).click();
  const revokeDialog = adminPage.getByRole('dialog');
  await revokeDialog.getByRole('button', { name: 'Revoke' }).click();

  await expect(tokensTable.locator('tbody tr')).toHaveCount(1);
  await expect(tokensTable.locator('tbody tr', { hasText: initialToken })).toHaveCount(0);

  // ---- Final: no console errors, no uncaught page errors, for either actor's entire journey. ----
  await memberContext.close();
  expect(errors, `Unexpected console/page errors:\n${errors.join('\n')}`).toEqual([]);
});
