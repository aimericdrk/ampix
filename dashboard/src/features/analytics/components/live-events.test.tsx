import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  LIVE_EVENTS_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Each StatTile is its own `Card`, with the label `<p>` and the value `<p>` as siblings — scope
 * by the label's parent to avoid ambiguity when multiple tiles show the same value (e.g. "0"). */
function statTileCard(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

describe('LiveEventsPage', () => {
  it('shows a loading status, then the stream (newest first) and the derived live stats', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading live events');

    const stream = await screen.findByRole('log', { name: 'Live event stream, newest first' });
    const rows = within(stream).getAllByRole('listitem');
    // 25-per-page request against a 30-event fixture.
    expect(rows).toHaveLength(25);

    const newestEvent = LIVE_EVENTS_FIXTURE[0]!;
    expect(within(rows[0]!).getByText(newestEvent.event)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(newestEvent.distinct_id)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(newestEvent.os)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(newestEvent.app_version)).toBeInTheDocument();

    // Derived "recent" stats, computed from the loaded window (not an all-time total) — labelled
    // as such so they're never mistaken for a real aggregation.
    expect(screen.getByText('Events (recent)')).toBeInTheDocument();
    expect(screen.getByText('Active users (recent)')).toBeInTheDocument();
    expect(screen.getByText('Events/min (recent)')).toBeInTheDocument();

    const distinctUsers = new Set(LIVE_EVENTS_FIXTURE.slice(0, 25).map((e) => e.distinct_id));
    expect(
      within(statTileCard('Active users (recent)')).getByText(String(distinctUsers.size)),
    ).toBeInTheDocument();
    expect(within(statTileCard('Events (recent)')).getByText('25')).toBeInTheDocument();
  });

  it('shows the waiting-for-events empty state when there are no events yet', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/live', () =>
        HttpResponse.json({ events: [], next_before: null }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    expect(await screen.findByText('Waiting for events…')).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(within(statTileCard('Events (recent)')).getByText('0')).toBeInTheDocument();
    expect(within(statTileCard('Active users (recent)')).getByText('0')).toBeInTheDocument();
  });

  it('the Pause toggle exists and freezes the stream while paused', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    await screen.findByRole('log', { name: 'Live event stream, newest first' });

    const toggle = screen.getByRole('button', { name: 'Pause' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);

    expect(await screen.findByRole('button', { name: 'Resume' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Paused — new events are held back')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });

  it('tags $rc_ subscription events with a badge, but not the $rc_link identity event or regular events', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/events/live', () =>
        HttpResponse.json({
          events: [
            {
              insert_id: 'evt-rc',
              event: '$rc_renewal',
              distinct_id: 'user-sub',
              timestamp: '2026-07-02T12:32:00.000Z',
              os: 'iOS',
              app_version: '2.0.0',
            },
            {
              insert_id: 'evt-link',
              event: '$rc_link',
              distinct_id: 'user-sub',
              timestamp: '2026-07-02T12:31:00.000Z',
              os: 'iOS',
              app_version: '2.0.0',
            },
            {
              insert_id: 'evt-plain',
              event: 'product_viewed',
              distinct_id: 'user-002',
              timestamp: '2026-07-02T12:30:00.000Z',
              os: 'Android',
              app_version: '2.0.0',
            },
          ],
          next_before: null,
        }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    const stream = await screen.findByRole('log', { name: 'Live event stream, newest first' });
    const rows = within(stream).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const rcRow = within(rows[0]!);
    expect(rcRow.getByText('$rc_renewal')).toBeInTheDocument();
    expect(rcRow.getAllByText('subscription')).toHaveLength(1);

    // `$rc_link` shares the `$rc_` prefix but is an identity event, not a subscription event.
    const linkRow = within(rows[1]!);
    expect(linkRow.getByText('$rc_link')).toBeInTheDocument();
    expect(linkRow.queryByText('subscription')).not.toBeInTheDocument();

    const plainRow = within(rows[2]!);
    expect(plainRow.getByText('product_viewed')).toBeInTheDocument();
    expect(plainRow.queryByText('subscription')).not.toBeInTheDocument();
  });

  it('loads older events via next_before when "Load older" is clicked', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    const stream = await screen.findByRole('log', { name: 'Live event stream, newest first' });
    await waitFor(() => expect(within(stream).getAllByRole('listitem')).toHaveLength(25));

    await userEvent.click(screen.getByRole('button', { name: 'Load older' }));

    let rows: HTMLElement[] = [];
    await waitFor(() => {
      rows = within(stream).getAllByRole('listitem');
      expect(rows).toHaveLength(30);
    });
    const oldestEvent = LIVE_EVENTS_FIXTURE[29]!;
    expect(within(rows[rows.length - 1]!).getByText(oldestEvent.event)).toBeInTheDocument();
    expect(within(rows[rows.length - 1]!).getByText(oldestEvent.distinct_id)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });
});
