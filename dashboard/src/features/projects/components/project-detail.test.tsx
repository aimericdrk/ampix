import { screen, within } from '@testing-library/react';
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
    expect(within(main).getByText(TEST_PROJECT.ingest_token)).toBeInTheDocument();

    expect(await screen.findByText('Total events')).toBeInTheDocument();
    expect(screen.getByText(String(EVENT_SUMMARY_FIXTURE.total))).toBeInTheDocument();

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
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
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
});
