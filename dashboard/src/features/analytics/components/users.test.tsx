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
  it('lists users as a sortable DataTable and paginates via next_cursor', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    const table = await screen.findByRole('table', { name: 'Users' });
    // header row + the first 20-user page.
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));
    expect(within(table).getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /ID \/ email/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Last seen/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Events/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    // header row + all 22 fixture users, once the next page has loaded.
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(23));
    expect(screen.getByText('User 22')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('searches by distinct_id, name, or email', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByRole('table', { name: 'Users' });

    await userEvent.type(screen.getByLabelText('Search by name, email, or ID'), 'user-021');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('User 21')).toBeInTheDocument();
    expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument();
  });

  it('renders a disambiguation table for a name/email search matching multiple users', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByRole('table', { name: 'Users' });

    await userEvent.type(screen.getByLabelText('Search by name, email, or ID'), 'alex');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('Alex Wong')).toBeInTheDocument();
    expect(screen.getByText('alex.chen@example.com')).toBeInTheDocument();
    expect(screen.getByText('alex.wong@example.com')).toBeInTheDocument();
    // Not part of this "alex" match.
    expect(screen.queryByText('Priya Singh')).not.toBeInTheDocument();
  });

  it('falls back to distinct_id / "—" when a user has no profile name or email', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    const table = await screen.findByRole('table', { name: 'Users' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(21));

    expect(screen.getByText('user-005')).toBeInTheDocument();
    const row = screen.getByText('user-005').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('—')).toBeInTheDocument();
  });

  it("opens a user's profile with properties, seen dates, event count, and a recent-activity timeline", async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByRole('table', { name: 'Users' });

    await userEvent.click(await screen.findByText('Alex Chen'));

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
