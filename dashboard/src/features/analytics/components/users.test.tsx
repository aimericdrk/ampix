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
  it('lists users as cards and paginates via next_cursor', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    const list = await screen.findByRole('list', { name: 'Users' });
    // the first 20-user page (one list item per user, no header row).
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(20));

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    // all 22 fixture users, once the next page has loaded.
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(22));
    expect(screen.getByText('User 22')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows each user with their event count, first-seen and last-seen dates', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    const card = (await screen.findByText('Alex Chen')).closest('li') as HTMLElement;
    const row = within(card);
    expect(row.getByText('Events')).toBeInTheDocument();
    expect(row.getByText(String(USERS_FIXTURE[0]!.event_count))).toBeInTheDocument();
    expect(row.getByText('First seen')).toBeInTheDocument();
    expect(row.getByText('Last seen')).toBeInTheDocument();
    expect(row.getByText('alex.chen@example.com')).toBeInTheDocument();
  });

  it('searches by distinct_id, name, or email', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByText('Alex Chen');

    await userEvent.type(screen.getByLabelText('Search by name, email, or ID'), 'user-021');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('User 21')).toBeInTheDocument();
    expect(screen.queryByText('Alex Chen')).not.toBeInTheDocument();
  });

  it('surfaces every match for a name/email search matching multiple users', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);
    await screen.findByText('Alex Chen');

    await userEvent.type(screen.getByLabelText('Search by name, email, or ID'), 'alex');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('Alex Wong')).toBeInTheDocument();
    expect(screen.getByText('alex.chen@example.com')).toBeInTheDocument();
    expect(screen.getByText('alex.wong@example.com')).toBeInTheDocument();
    // Not part of this "alex" match.
    expect(screen.queryByText('Priya Singh')).not.toBeInTheDocument();
  });

  it('falls back to "Unknown user" + distinct_id when a user has no profile name or email', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    const idEl = await screen.findByText('user-005');
    const card = within(idEl.closest('li') as HTMLElement);
    expect(card.getByText('Unknown user')).toBeInTheDocument();
  });

  it('shows the phone number under the name when the profile has no email', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    // Jordan Lee has a phone but no email — the contact line is email → phone → distinct id.
    const nameEl = await screen.findByText('Jordan Lee');
    const card = within(nameEl.closest('li') as HTMLElement);
    expect(card.getByText('+1 415 555 0142')).toBeInTheDocument();
    expect(card.queryByText('user-004')).not.toBeInTheDocument();

    // Alex Chen has both, and the email still wins.
    const alexCard = within(screen.getByText('Alex Chen').closest('li') as HTMLElement);
    expect(alexCard.getByText('alex.chen@example.com')).toBeInTheDocument();
    expect(alexCard.queryByText('+33 6 12 34 56 78')).not.toBeInTheDocument();
  });

  it("opens a user's profile with properties, seen dates, event count, and a recent-activity timeline", async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users`);

    await userEvent.click(await screen.findByText('Alex Chen'));

    // The profile opens as a modal OVER the list, so scope every profile assertion to the dialog —
    // values like the event count also appear in the list card behind it.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'user-001' })).toBeInTheDocument();
    expect(within(dialog).getByText(USER_PROFILE_FIXTURE.profile.email as string)).toBeInTheDocument();
    expect(within(dialog).getByText(USER_PROFILE_FIXTURE.profile.plan as string)).toBeInTheDocument();
    expect(within(dialog).getByText(String(USERS_FIXTURE[0]!.event_count))).toBeInTheDocument();

    // The timeline lists every recent event (some event names recur, e.g. repeated $screen_view).
    const eventNames = [...new Set(USER_PROFILE_FIXTURE.recent_events.map((e) => e.event))];
    for (const name of eventNames) {
      expect(within(dialog).getAllByText(name).length).toBeGreaterThan(0);
    }
  });
});
