import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  TEST_PROJECT,
  TEST_USER,
  USER_PROFILE_FIXTURE,
  USERS_FIXTURE,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('UsersPage', () => {
  it('lists users and paginates via next_cursor', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    const table = await screen.findByRole('table', { name: 'Users' });
    // header row + the first 20-user page.
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    // header row + all 22 fixture users, once the next page has loaded.
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(23));
    expect(screen.getByRole('link', { name: 'user-022' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('searches by distinct_id prefix', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByRole('table', { name: 'Users' });

    await userEvent.type(screen.getByLabelText('Search by distinct ID'), 'user-021');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'user-021' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'user-001' })).not.toBeInTheDocument();
  });

  it("opens a user's profile with properties, seen dates, event count, and a recent-activity timeline", async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByRole('table', { name: 'Users' });

    await userEvent.click(await screen.findByRole('link', { name: 'user-001' }));

    expect(await screen.findByRole('heading', { name: 'user-001' })).toBeInTheDocument();
    expect(screen.getByText(USER_PROFILE_FIXTURE.profile.email as string)).toBeInTheDocument();
    expect(screen.getByText(USER_PROFILE_FIXTURE.profile.plan as string)).toBeInTheDocument();
    expect(screen.getByText(String(USERS_FIXTURE[0]!.event_count))).toBeInTheDocument();

    // The timeline lists every recent event (some event names recur, e.g. repeated $screen_view).
    const eventNames = [...new Set(USER_PROFILE_FIXTURE.recent_events.map((e) => e.event))];
    for (const name of eventNames) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });
});
