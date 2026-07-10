import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ClickHeatmapQuery, ScreenPathsQuery } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import {
  CLICK_HEATMAP_FIXTURE,
  SCREEN_PATHS_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  USER_PROFILE_FIXTURE,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('UserProfilePage', () => {
  it('renders the activity timeline for every recent event', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')!;
    const items = within(timeline as HTMLElement).getAllByRole('listitem');
    // One timeline entry per recent event.
    expect(items).toHaveLength(USER_PROFILE_FIXTURE.recent_events.length);
    expect(within(timeline as HTMLElement).getByText('checkout_completed')).toBeInTheDocument();
    const screenViewCount = USER_PROFILE_FIXTURE.recent_events.filter(
      (e) => e.event === '$screen_view',
    ).length;
    expect(within(timeline as HTMLElement).getAllByText('$screen_view').length).toBe(screenViewCount);
  });

  it('collapses the activity timeline when its toggle is clicked', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    // Scope to the timeline card: the selected event's name also appears in the detail panel.
    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    const toggle = within(timeline).getByRole('button', { name: 'Activity timeline' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(timeline).getByText('checkout_completed')).toBeVisible();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(timeline).getByText('checkout_completed')).not.toBeVisible();
  });

  it('derives the screen-path chain in chronological order with consecutive duplicates collapsed', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    // Screen path is collapsed by default now — expand it before reading its pills.
    const toggle = await screen.findByRole('button', { name: 'Screen path' });
    await userEvent.click(toggle);
    const pathCard = toggle.closest('.rounded-xl')!;
    const pills = within(pathCard as HTMLElement).getAllByRole('listitem');
    // recent_events (newest-first) has screen views cart, catalog, catalog, home → reversed to
    // home, catalog, catalog, cart → consecutive dupes collapsed to home → catalog → cart.
    expect(pills.map((li) => li.textContent?.replace('→', '').trim())).toEqual([
      'home',
      'catalog',
      'cart',
    ]);
  });

  it('posts a click-heatmap request scoped to the profile identity set (distinct_ids) on screen select', async () => {
    const bodies: ClickHeatmapQuery[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
        const body = (await request.json()) as ClickHeatmapQuery;
        bodies.push(body);
        return HttpResponse.json({ ...CLICK_HEATMAP_FIXTURE, screen_name: body.screen_name });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);
    await screen.findByRole('heading', { name: 'user-001' });

    // Tap heatmap is collapsed by default now — expand it before picking a screen.
    await userEvent.click(await screen.findByRole('button', { name: 'Tap heatmap' }));
    await screen.findByRole('option', { name: 'home' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'home');

    // The heatmap overlays a cell per populated grid cell.
    expect(await screen.findAllByTestId('heatmap-cell')).toHaveLength(
      CLICK_HEATMAP_FIXTURE.cells.length,
    );

    // The §17 identity-correct filter: the request carries the profile's exact distinct_ids set.
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.screen_name).toBe('home');
    expect(bodies[0]!.distinct_ids).toEqual(USER_PROFILE_FIXTURE.distinct_ids);
  });

  it('runs the per-user path map scoped to the profile identity set (distinct_ids) and renders it', async () => {
    const bodies: ScreenPathsQuery[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
        const body = (await request.json()) as ScreenPathsQuery;
        bodies.push(body);
        return HttpResponse.json(SCREEN_PATHS_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);
    await screen.findByRole('heading', { name: 'user-001' });

    // The §17 identity-correct filter: the request carries the profile's exact distinct_ids set.
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.distinct_ids).toEqual(USER_PROFILE_FIXTURE.distinct_ids);

    expect(await screen.findByTestId('path-map')).toBeInTheDocument();
  });
});
