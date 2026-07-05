import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('HomePage', () => {
  it('shows headline stat tiles, quick-create actions, and recent work', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });

    // Stat tiles derived from the events + sessions summaries (fixtures: 52 events, 128 sessions,
    // 245000ms avg = 4m 5s).
    expect(screen.getByText('Total events')).toBeInTheDocument();
    expect(await screen.findByText('52')).toBeInTheDocument();
    expect(await screen.findByText('128')).toBeInTheDocument();
    expect(screen.getByText('4m 5s')).toBeInTheDocument();

    // Quick create.
    expect(screen.getByRole('button', { name: 'New report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New cohort' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply a template' })).toBeInTheDocument();

    // Events-by-type composition (a real dataviz chart) + the workflow diagram.
    expect(screen.getByRole('img', { name: 'Events by type composition' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Analytics workflow diagram' })).toBeInTheDocument();

    // Recent reports + dashboards from the §16 seeds.
    expect(await screen.findByRole('link', { name: 'Weekly checkouts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Signup funnel' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Growth overview' })).toBeInTheDocument();
  });

  it('shows a fresh-project empty state when there are no events', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/summary', ({ params }) =>
        HttpResponse.json({ project_id: params.projectId as string, total: 0, by_event: [] }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/home`);

    await screen.findByRole('heading', { name: 'Home' });
    expect(await screen.findByText('No events yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View ingest token' })).toBeInTheDocument();
    // With no events, the composition chart is not drawn.
    expect(screen.queryByRole('img', { name: 'Events by type composition' })).not.toBeInTheDocument();
  });
});
