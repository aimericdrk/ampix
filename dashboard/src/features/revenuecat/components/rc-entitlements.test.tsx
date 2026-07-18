import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  MFA_ACCESS_TOKEN,
  MFA_USER,
  orgsState,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';
import type { RcEntitlement } from '../catalog-api';

const ENTITLEMENTS_URL = `/projects/${TEST_PROJECT.id}/rc/entitlements`;
const ENTITLEMENTS_BASE = '/api/v1/projects/:projectId/catalog/entitlements';

const PRO: RcEntitlement = { id: 'ent-pro', identifier: 'pro', displayName: 'Pro' };
const PREMIUM: RcEntitlement = { id: 'ent-premium', identifier: 'premium', displayName: 'Premium' };

function signInAsOwner() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function signInAsAdmin() {
  authStore.setSession(MFA_ACCESS_TOKEN, MFA_USER);
}

/** Downgrades MFA_USER's explicit role on TEST_PROJECT for the duration of one test — mirrors the
 *  "analyst (read-only)" downgrade in project-members.test.tsx. `resetOrgsState()` (test/setup.ts
 *  afterEach) restores it automatically, so no manual cleanup is needed. */
function downgradeAdminTo(role: 'viewer') {
  const membership = orgsState.projectMemberships.find(
    (m) => m.projectId === TEST_PROJECT.id && m.user.id === MFA_USER.id,
  );
  if (membership) membership.role = role;
}

/** A tiny in-memory CRUD backend for the entitlements endpoints, scoped to one test via
 *  `server.use()` — mirrors rc-charts.test.tsx's local `metrics()` helper. Not shared with
 *  Section 2's hook tests; each test file owns its own MSW fixtures. */
function entitlementsHandlers(initial: RcEntitlement[]) {
  let entitlements = [...initial];
  server.use(
    http.get(ENTITLEMENTS_BASE, () => HttpResponse.json(entitlements)),
    http.post(ENTITLEMENTS_BASE, async ({ request }) => {
      const body = (await request.json()) as { identifier: string; displayName: string };
      const created: RcEntitlement = { id: `ent-${entitlements.length + 1}`, ...body };
      entitlements = [...entitlements, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(`${ENTITLEMENTS_BASE}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as { displayName: string };
      const existing = entitlements.find((e) => e.id === params.id);
      if (!existing) {
        return HttpResponse.json(
          { type: 'about:blank', title: 'Entitlement not found', status: 404 },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
      const updated: RcEntitlement = { ...existing, displayName: body.displayName };
      entitlements = entitlements.map((e) => (e.id === updated.id ? updated : e));
      return HttpResponse.json(updated);
    }),
    http.delete(`${ENTITLEMENTS_BASE}/:id`, ({ params }) => {
      entitlements = entitlements.filter((e) => e.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

describe('RcEntitlementsPage', () => {
  it('renders the entitlements list', async () => {
    signInAsOwner();
    entitlementsHandlers([PRO, PREMIUM]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByText('pro')).toBeInTheDocument();
    expect(main.getByText('Pro')).toBeInTheDocument();
    expect(main.getByText('premium')).toBeInTheDocument();
    expect(main.getByText('Premium')).toBeInTheDocument();
  });

  it('lets an admin create a new entitlement via the dialog', async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    await userEvent.click(main.getByRole('button', { name: 'New entitlement' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Identifier'), 'premium');
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Premium');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Premium')).toBeInTheDocument();
  });

  it("lets an admin edit an entitlement's display name, with identifier read-only", async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    await userEvent.click(main.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const identifierField = within(dialog).getByLabelText('Identifier');
    expect(identifierField).toHaveValue('pro');
    expect(identifierField).toBeDisabled();

    const displayNameField = within(dialog).getByLabelText('Display name');
    await userEvent.clear(displayNameField);
    await userEvent.type(displayNameField, 'Pro tier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await main.findByText('Pro tier')).toBeInTheDocument();
  });

  it('lets an admin delete an entitlement after confirming', async () => {
    signInAsAdmin();
    entitlementsHandlers([PRO, PREMIUM]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    const proRow = main.getByText('pro').closest('tr') as HTMLElement;
    await userEvent.click(within(proRow).getByRole('button', { name: 'Delete' }));

    const alertDialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(alertDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(main.queryByText('pro')).not.toBeInTheDocument());
    expect(main.getByText('premium')).toBeInTheDocument();
  });

  it('shows a read-only surface with no write controls for a viewer', async () => {
    signInAsAdmin();
    downgradeAdminTo('viewer');
    entitlementsHandlers([PRO]);
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));
    await main.findByText('pro');

    expect(main.queryByRole('button', { name: 'New entitlement' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(main.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows the connect upsell (not the entitlements table) when RevenueCat is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    signInAsOwner();
    renderApp(ENTITLEMENTS_URL);
    const main = within(await screen.findByRole('main'));

    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    expect(main.queryByText('pro')).not.toBeInTheDocument();
  });
});
