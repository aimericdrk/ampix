import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  EVENT_SUMMARY_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('ProjectDetailPage', () => {
  it("renders the project's name, org, ingest token, total events, and per-event rows", async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);

    expect(await screen.findByRole('heading', { name: TEST_PROJECT.name })).toBeInTheDocument();
    // Scoped to <main>: the org name also appears in the sidebar's org switcher.
    const main = screen.getByRole('main');
    expect(within(main).getByText(TEST_PROJECT.org_name)).toBeInTheDocument();
    // The ingest token also equals the "Default" named token, so scope to its own labelled group.
    const ingestGroup = within(main).getByRole('group', { name: 'Primary ingest token' });
    expect(within(ingestGroup).getByText(TEST_PROJECT.ingest_token)).toBeInTheDocument();

    expect(await screen.findByText('Total events')).toBeInTheDocument();
    expect(screen.getByText(String(EVENT_SUMMARY_FIXTURE.total))).toBeInTheDocument();

    // The per-event table is collapsed by default — expand it before asserting the rows.
    await userEvent.click(within(main).getByRole('button', { name: 'Events by name' }));
    const table = within(main).getByRole('table', { name: 'Events by name' });
    for (const row of EVENT_SUMMARY_FIXTURE.by_event) {
      expect(screen.getByText(row.event)).toBeInTheDocument();
      expect(table).toHaveTextContent(String(row.count));
    }
  });

  it('shows an empty state when the project has no events yet', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/summary', ({ params }) =>
        HttpResponse.json({ project_id: params.projectId, total: 0, by_event: [] }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);

    expect(await screen.findByText('No events yet — send some from your app')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // No "Events by name" table when empty (the SDK-tokens table has its own distinct name).
    expect(screen.queryByRole('table', { name: 'Events by name' })).not.toBeInTheDocument();
  });

  it('shows a loading status for the summary while it fetches', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading event summary');
    await screen.findByText('Total events');
  });

  it('renders the problem title when the summary request fails', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/summary', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal server error', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(screen.queryByText('Total events')).not.toBeInTheDocument();
  });

  it('rotates a token: creates a replacement with the same label, reveals it, then revokes the old one', async () => {
    const createdBodies: Array<{ label?: string }> = [];
    const revokedIds: string[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/tokens', async ({ request }) => {
        createdBodies.push((await request.json()) as { label?: string });
        return HttpResponse.json(
          { id: 'rotated-token-id', token: 'mam_rotatednewtoken000000000000000', label: 'Default' },
          { status: 201 },
        );
      }),
      http.delete('/api/v1/projects/:projectId/tokens/:tokenId', ({ params }) => {
        revokedIds.push(params.tokenId as string);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    // The seeded "Default" token equals the ingest token — its id is token-1.
    const tokensTable = await screen.findByRole('table', { name: 'Ingest tokens' });
    const defaultRow = within(tokensTable).getByRole('row', { name: /Default/ });
    await userEvent.click(within(defaultRow).getByRole('button', { name: 'Rotate' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate' }));

    // The replacement token is revealed once for copying.
    expect(await screen.findByText('mam_rotatednewtoken000000000000000')).toBeInTheDocument();
    // Created a replacement with the SAME label, then revoked the OLD token.
    await waitFor(() => expect(revokedIds).toContain('token-1'));
    expect(createdBodies).toEqual([{ label: 'Default' }]);
    expect(await screen.findByText('Token rotated')).toBeInTheDocument();
  });

  it('deletes selected data scopes only after a scope is picked and the name is typed', async () => {
    let purgeBody: unknown;
    server.use(
      http.post('/api/v1/projects/:projectId/data/purge', async ({ request }) => {
        purgeBody = await request.json();
        return HttpResponse.json({ cleared: { analytics: true, revenuecat: false, saved: false } });
      }),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.click(await screen.findByRole('button', { name: 'Delete all data' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete all data' });

    // Confirm is blocked until a scope is chosen AND the project name is typed exactly.
    const confirm = within(dialog).getByRole('button', { name: 'Delete data' });
    expect(confirm).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Analytics events & profiles/ }));
    expect(confirm).toBeDisabled(); // scope alone isn't enough
    await userEvent.type(within(dialog).getByLabelText(/type .* to confirm/i), TEST_PROJECT.name);
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);

    await waitFor(() =>
      expect(purgeBody).toEqual({ scopes: { analytics: true, revenuecat: false, saved: false } }),
    );
    expect(await screen.findByText('Data deleted')).toBeInTheDocument();
  });
});
