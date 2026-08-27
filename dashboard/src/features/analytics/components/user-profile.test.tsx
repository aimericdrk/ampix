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

    // Screen path opens in a larger modal on top of the profile — launch it, then read its pills.
    await userEvent.click(await screen.findByRole('button', { name: /Screen path/ }));
    const explorer = await screen.findByRole('dialog', { name: 'Journey & interactions' });
    const pills = within(explorer).getAllByRole('listitem');
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

    // Tap heatmap opens in a larger modal on top of the profile — launch it, then pick a screen.
    await userEvent.click(await screen.findByRole('button', { name: /Tap heatmap/ }));
    const explorer = await screen.findByRole('dialog', { name: 'Journey & interactions' });
    await within(explorer).findByRole('option', { name: 'home' });
    await userEvent.selectOptions(within(explorer).getByLabelText('Screen'), 'home');

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

    // The path map opens on demand in the larger modal (it's data-heavy), so it only runs once launched.
    await userEvent.click(await screen.findByRole('button', { name: /Path map/ }));
    const explorer = await screen.findByRole('dialog', { name: 'Journey & interactions' });

    // The §17 identity-correct filter: the request carries the profile's exact distinct_ids set.
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.distinct_ids).toEqual(USER_PROFILE_FIXTURE.distinct_ids);

    expect(await within(explorer).findByTestId('path-map')).toBeInTheDocument();
  });

  it('re-runs the open explorer view when Refresh is clicked', async () => {
    const bodies: ScreenPathsQuery[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
        bodies.push((await request.json()) as ScreenPathsQuery);
        return HttpResponse.json(SCREEN_PATHS_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);
    await screen.findByRole('heading', { name: 'user-001' });

    await userEvent.click(await screen.findByRole('button', { name: /Path map/ }));
    const explorer = await screen.findByRole('dialog', { name: 'Journey & interactions' });
    await within(explorer).findByTestId('path-map');
    await waitFor(() => expect(bodies).toHaveLength(1));

    // Refresh pulls fresh data in place (no close/reopen), so the path map query runs again.
    await userEvent.click(within(explorer).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(2));
  });

  it('drives the path map query from its controls (steps + ends-with anchor)', async () => {
    const bodies: ScreenPathsQuery[] = [];
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
        bodies.push((await request.json()) as ScreenPathsQuery);
        return HttpResponse.json(SCREEN_PATHS_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);
    await screen.findByRole('heading', { name: 'user-001' });
    await userEvent.click(await screen.findByRole('button', { name: /Path map/ }));
    const explorer = await screen.findByRole('dialog', { name: 'Journey & interactions' });

    // Default: forward from entry, 3 steps, no anchor.
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!).toMatchObject({ direction: 'forward', steps: 3 });
    expect(bodies[0]!.anchor_screen).toBeUndefined();

    // Changing the step count re-runs with the new value.
    await userEvent.selectOptions(within(explorer).getByLabelText('Steps'), '5');
    await waitFor(() => expect(bodies.at(-1)!.steps).toBe(5));

    // "Ends with" + a chosen screen → backward direction anchored on that screen.
    await userEvent.selectOptions(within(explorer).getByLabelText('Path'), 'end');
    await userEvent.selectOptions(await within(explorer).findByLabelText('Screen'), 'home');
    await waitFor(() => {
      const last = bodies.at(-1)!;
      expect(last.direction).toBe('backward');
      expect(last.anchor_screen).toBe('home');
    });
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
    // The timeline reads /users/:id/events, not the profile's recent_events, so the rows under
    // test are stubbed there; the profile is stubbed too so the rest of the page stays coherent.
    const rows = [
      { insert_id: 'evt-link', event: '$rc_link', timestamp: '2026-07-01T10:06:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
      { insert_id: 'evt-ren', event: '$rc_renewal', timestamp: '2026-07-01T10:05:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
      { insert_id: 'evt-init', event: '$rc_initial_purchase', timestamp: '2026-07-01T09:59:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
      { insert_id: 'evt-plain', event: 'checkout_completed', timestamp: '2026-07-01T09:58:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
    ];
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId', () =>
        HttpResponse.json({
          distinct_id: 'user-001',
          last_seen: '2026-07-01T10:06:00.000Z',
          event_count: 4,
          ...USER_PROFILE_FIXTURE,
          recent_events: rows,
        }),
      ),
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', () =>
        HttpResponse.json({ events: rows, next_before: null }),
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

  it('marks where the user quit and reopened the app', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;

    // The fixture's two sessions split at 09:58 → 09:59, so exactly one break is shown, and it
    // reports the gap between the last event of one visit and the first of the next.
    const breaks = within(timeline).getAllByText(/App closed/);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toHaveTextContent('1m 00s');
    expect(breaks[0]).toHaveTextContent('reopened');
  });

  it('shows no session break when the events never leave one session', async () => {
    const ctx = USER_PROFILE_FIXTURE.recent_events[0]!.context;
    const rows = USER_PROFILE_FIXTURE.recent_events.map((event) => ({
      ...event,
      session_id: 'only-one',
      context: ctx,
    }));
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', () =>
        HttpResponse.json({ events: rows, next_before: null }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    await within(timeline).findByText('checkout_completed');
    // Same session AND every gap under 30 minutes, so nothing breaks the list.
    expect(within(timeline).queryByText(/App closed|Paused/)).not.toBeInTheDocument();
  });

  // A gap past the SDK's 30-minute session timeout reads as "they were gone" whether or not the
  // session id happened to rotate — an app left open overnight is the case this catches.
  it('separates a pause of more than 30 minutes within a single session', async () => {
    const ctx = USER_PROFILE_FIXTURE.recent_events[0]!.context;
    const rows = [
      { insert_id: 'evt-after', event: 'after_pause', timestamp: '2026-07-01T12:00:00.000Z', session_id: 'same', screen_name: null, properties: {}, context: ctx },
      { insert_id: 'evt-before', event: 'before_pause', timestamp: '2026-07-01T11:00:00.000Z', session_id: 'same', screen_name: null, properties: {}, context: ctx },
      // 20 minutes earlier — under the threshold, so this pair is NOT separated.
      { insert_id: 'evt-early', event: 'earlier_event', timestamp: '2026-07-01T10:40:00.000Z', session_id: 'same', screen_name: null, properties: {}, context: ctx },
    ];
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', () =>
        HttpResponse.json({ events: rows, next_before: null }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    await within(timeline).findByText('after_pause');

    const pauses = within(timeline).getAllByText(/Paused/);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toHaveTextContent('1h 00m');
    expect(pauses[0]).toHaveTextContent('resumed');
    // The session never changed, so it is a pause, not a quit-and-return.
    expect(within(timeline).queryByText(/App closed/)).not.toBeInTheDocument();
  });

  it('surfaces an error when the timeline page fails, instead of looking finished', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal Server Error', status: 500 },
          { status: 500 },
        ),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    expect(await within(timeline).findByRole('alert')).toHaveTextContent('Internal Server Error');
    // Crucially NOT a silent list of 50 with no way to load more.
    expect(within(timeline).queryByText(/Beginning of this user/)).not.toBeInTheDocument();
  });

  it('labels app-lifecycle events in plain language, keeping the raw name visible', async () => {
    const ctx = USER_PROFILE_FIXTURE.recent_events[0]!.context;
    const rows = [
      { insert_id: 'evt-open', event: '$app_open', timestamp: '2026-07-01T10:00:00.000Z', session_id: 's2', screen_name: null, properties: {}, context: ctx },
      { insert_id: 'evt-bg', event: '$app_background', timestamp: '2026-07-01T09:00:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
    ];
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', () =>
        HttpResponse.json({ events: rows, next_before: null }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    expect(await within(timeline).findByText('Opened the app')).toBeInTheDocument();
    expect(within(timeline).getByText('Left the app')).toBeInTheDocument();
    // The raw names stay on screen so a row can still be matched against a query or a filter.
    expect(within(timeline).getByText('$app_open')).toBeInTheDocument();
    expect(within(timeline).getByText('$app_background')).toBeInTheDocument();
    // An hour away between the two sessions.
    expect(within(timeline).getByText(/App closed/)).toHaveTextContent('1h 00m');
  });

  it('loads older events, passing the composite cursor back to the API', async () => {
    const ctx = USER_PROFILE_FIXTURE.recent_events[0]!.context;
    const page1 = [
      { insert_id: 'evt-new', event: 'newest_event', timestamp: '2026-07-01T10:00:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
    ];
    const page2 = [
      { insert_id: 'evt-old', event: 'oldest_event', timestamp: '2026-06-30T10:00:00.000Z', session_id: 's1', screen_name: null, properties: {}, context: ctx },
    ];
    const cursors: Array<string | null> = [];
    server.use(
      http.get('/api/v1/projects/:projectId/users/:distinctId/events', ({ request }) => {
        const url = new URL(request.url);
        const before = url.searchParams.get('before');
        cursors.push(before);
        return before === null
          ? HttpResponse.json({
              events: page1,
              next_before: { timestamp: page1[0]!.timestamp, insert_id: page1[0]!.insert_id },
            })
          : HttpResponse.json({ events: page2, next_before: null });
      }),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const timeline = (
      await screen.findByRole('button', { name: 'Activity timeline' })
    ).closest('.rounded-xl')! as HTMLElement;
    expect(await within(timeline).findByText('newest_event')).toBeInTheDocument();
    expect(within(timeline).queryByText('oldest_event')).not.toBeInTheDocument();

    await userEvent.click(within(timeline).getByRole('button', { name: 'Load older events' }));

    // The older page is APPENDED, not swapped in — the timeline keeps what it already had.
    expect(await within(timeline).findByText('oldest_event')).toBeInTheDocument();
    expect(within(timeline).getByText('newest_event')).toBeInTheDocument();
    // Both cursor halves travelled, so a tied millisecond can't silently drop rows.
    expect(cursors).toEqual([null, '2026-07-01T10:00:00.000Z']);
    await waitFor(() =>
      expect(within(timeline).getByText(/Beginning of this user/)).toBeInTheDocument(),
    );
  });

  it('renders no subscription card when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    await screen.findByRole('heading', { name: 'user-001' });
    await waitFor(() => expect(screen.queryByText('Subscription')).not.toBeInTheDocument());
  });
});
