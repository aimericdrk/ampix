import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ClickHeatmapQuery, ScreenPathsQuery } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import {
  CLICK_HEATMAP_FIXTURE,
  projectsHandlerWithoutRc,
  SCREEN_PATHS_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  USER_PROFILE_FIXTURE,
  USER_SUBSCRIPTION_FIXTURE,
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

  it('shows the subscription card with status badge and RC link', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const card = (await screen.findByText('Subscription')).closest('.rounded-xl')! as HTMLElement;
    expect(within(card).getByText('active')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /open in revenuecat/i })).toHaveAttribute(
      'href',
      USER_SUBSCRIPTION_FIXTURE.rc_customer_url!,
    );
  });

  it('marks $rc_ timeline events and renders the first-subscribed divider', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    expect(await within(timeline).findByText('★ First subscribed')).toBeInTheDocument();
    expect(within(timeline).getAllByText('subscription').length).toBeGreaterThanOrEqual(2);
  });

  it('badges $rc_ subscription timeline events but not the $rc_link identity event', async () => {
    const ctx = USER_PROFILE_FIXTURE.recent_events[0]!.context;
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId', () =>
        HttpResponse.json({
          distinct_id: 'user-001',
          last_seen: '2026-07-01T10:06:00.000Z',
          event_count: 4,
          ...USER_PROFILE_FIXTURE,
          recent_events: [
            { insert_id: 'evt-link', event: '$rc_link', timestamp: '2026-07-01T10:06:00.000Z', screen_name: null, properties: {}, context: ctx },
            { insert_id: 'evt-ren', event: '$rc_renewal', timestamp: '2026-07-01T10:05:00.000Z', screen_name: null, properties: {}, context: ctx },
            { insert_id: 'evt-init', event: '$rc_initial_purchase', timestamp: '2026-07-01T09:59:00.000Z', screen_name: null, properties: {}, context: ctx },
            { insert_id: 'evt-plain', event: 'checkout_completed', timestamp: '2026-07-01T09:58:00.000Z', screen_name: null, properties: {}, context: ctx },
          ],
        }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;

    // Only $rc_renewal and $rc_initial_purchase are subscription events; $rc_link is an identity
    // event and checkout_completed is a regular event, so exactly two rows carry the badge.
    expect(within(timeline).getAllByText('subscription')).toHaveLength(2);

    const linkRow = within(timeline).getByText('$rc_link').closest('li')! as HTMLElement;
    expect(within(linkRow).queryByText('subscription')).not.toBeInTheDocument();
  });

  it('renders no subscription card when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    await screen.findByRole('heading', { name: 'user-001' });
    await waitFor(() => expect(screen.queryByText('Subscription')).not.toBeInTheDocument());
  });
});
