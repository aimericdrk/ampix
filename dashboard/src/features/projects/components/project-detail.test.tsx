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

  it('rotates a token: creates a replacement with the same label and source, reveals it, then revokes the old one', async () => {
    const createdBodies: Array<{ label?: string; source?: string }> = [];
    const revokedIds: string[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/tokens', async ({ request }) => {
        createdBodies.push((await request.json()) as { label?: string; source?: string });
        return HttpResponse.json(
          {
            id: 'rotated-token-id',
            token: 'mam_rotatednewtoken000000000000000',
            label: 'Default',
            source: 'client',
          },
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
    // Created a replacement with the SAME label and source, then revoked the OLD token.
    await waitFor(() => expect(revokedIds).toContain('token-1'));
    expect(createdBodies).toEqual([{ label: 'Default', source: 'client', can_erase: false }]);
    expect(await screen.findByText('Token rotated')).toBeInTheDocument();
  });

  // No handler override here: the token goes through the real one, so this also covers the source
  // surviving the round-trip into the refetched list rather than only the create response.
  it('creates a server token and labels it Server in the list', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.type(await screen.findByLabelText('Label (optional)'), 'billing worker');
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'server');
    await userEvent.click(screen.getByRole('button', { name: 'New token' }));

    const tokensTable = await screen.findByRole('table', { name: 'Ingest tokens' });
    const row = await within(tokensTable).findByRole('row', { name: /billing worker/ });
    expect(row).toHaveTextContent('Server');
    // The seeded token stays what it was — creating one kind does not relabel the others.
    expect(within(tokensTable).getByRole('row', { name: /Default/ })).toHaveTextContent('Client');
  });

  it('defaults a new token to client when the picker is left alone', async () => {
    const createdBodies: Array<{ label?: string; source?: string }> = [];
    server.use(
      http.post('/api/v1/projects/:projectId/tokens', async ({ request }) => {
        createdBodies.push((await request.json()) as { label?: string; source?: string });
        return HttpResponse.json(
          {
            id: 'client-token-id',
            token: 'mam_clienttoken00000000000000000000',
            label: 'iOS app',
            source: 'client',
          },
          { status: 201 },
        );
      }),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.type(await screen.findByLabelText('Label (optional)'), 'iOS app');
    await userEvent.click(screen.getByRole('button', { name: 'New token' }));

    await waitFor(() =>
      expect(createdBodies).toEqual([{ label: 'iOS app', source: 'client', can_erase: false }]),
    );
  });

  // The erasure capability is the reason the old global ERASURE_API_KEY is gone: it is granted per
  // token, from this page, so no shared secret has to be handed to another project's members.
  it('offers the erasure capability only for a server token', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });
    await screen.findByLabelText('Label (optional)');

    expect(screen.queryByText('Allow erasing end-user data')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Source'), 'server');
    expect(screen.getByText('Allow erasing end-user data')).toBeInTheDocument();

    // Switching back hides it again — the API rejects can_erase on a client token, so the form
    // must never be able to submit that pair.
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'client');
    expect(screen.queryByText('Allow erasing end-user data')).not.toBeInTheDocument();
  });

  it('creates a server token with the erasure capability and marks it in the list', async () => {
    const createdBodies: Array<{ label?: string; source?: string; can_erase?: boolean }> = [];
    server.use(
      http.post('/api/v1/projects/:projectId/tokens', async ({ request }) => {
        const body = (await request.json()) as {
          label?: string;
          source?: string;
          can_erase?: boolean;
        };
        createdBodies.push(body);
        return HttpResponse.json(
          {
            id: 'erase-token-id',
            token: 'mam_erasetoken0000000000000000000',
            label: 'account deletion',
            source: 'server',
            can_erase: true,
          },
          { status: 201 },
        );
      }),
      http.get('/api/v1/projects/:projectId/tokens', () =>
        HttpResponse.json({
          tokens: [
            {
              id: 'erase-token-id',
              token: 'mam_erasetoken0000000000000000000',
              label: 'account deletion',
              source: 'server',
              can_erase: true,
              created_at: new Date().toISOString(),
            },
          ],
        }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    await userEvent.type(await screen.findByLabelText('Label (optional)'), 'account deletion');
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'server');
    await userEvent.click(screen.getByRole('checkbox', { name: /Allow erasing end-user data/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New token' }));

    await waitFor(() =>
      expect(createdBodies).toEqual([
        { label: 'account deletion', source: 'server', can_erase: true },
      ]),
    );
    const tokensTable = await screen.findByRole('table', { name: 'Ingest tokens' });
    const row = await within(tokensTable).findByRole('row', { name: /account deletion/ });
    expect(row).toHaveTextContent('Erase');
  });

  it('mints a purchase server key with the erasure capability', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}`);
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    expect(await screen.findByText('No server keys.')).toBeInTheDocument();

    await userEvent.type(
      await screen.findByLabelText('Key label (optional)'),
      'account deletion job',
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Allow erasing subscriber data/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New server key' }));

    const keysTable = await screen.findByRole('table', { name: 'Server keys' });
    const row = await within(keysTable).findByRole('row', { name: /account deletion job/ });
    expect(row).toHaveTextContent('Erase');
    expect(row).toHaveTextContent(/^.*mp_srv_/);
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
