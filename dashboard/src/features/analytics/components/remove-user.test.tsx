import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  hiddenUsersState,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Opens the Users list and clicks the remove control on the first user's row. */
async function openRemoveDialog() {
  signIn();
  renderApp(`/projects/${TEST_PROJECT.id}/users`);
  const main = within(await screen.findByRole('main'));
  const list = within(await main.findByRole('list', { name: 'Users' }));
  const removeButtons = await list.findAllByRole('button', { name: /^Remove / });
  await userEvent.click(removeButtons[0]!);
  return screen.getByRole('alertdialog');
}

describe('Removing a user', () => {
  it('offers hide and delete as separate, clearly-different choices', async () => {
    const dialog = within(await openRemoveDialog());
    expect(dialog.getByRole('button', { name: 'Hide user' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // The distinction the dialog exists to make must be stated, not implied by the button labels.
    expect(dialog.getByText(/Every event is kept/i)).toBeInTheDocument();
    expect(dialog.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('hides the user, removes them from the list, and offers an un-hide', async () => {
    const dialog = within(await openRemoveDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Hide user' }));

    // findAllBy: Radix Toast renders the text twice — once visibly, once in its aria-live region.
    expect(await screen.findAllByText('User hidden')).not.toHaveLength(0);
    expect(hiddenUsersState.map((entry) => entry.distinct_id)).toEqual(['user-001']);

    const main = within(screen.getByRole('main'));
    // They leave the visible list...
    const list = within(await main.findByRole('list', { name: 'Users' }));
    expect(list.queryByText('Alex Chen')).not.toBeInTheDocument();
    // ...and reappear in the reversible "Hidden users" section.
    await userEvent.click(await main.findByRole('button', { name: /Hidden users \(1\)/ }));
    const hiddenList = within(await main.findByRole('list', { name: 'Hidden users' }));
    expect(hiddenList.getByText('user-001')).toBeInTheDocument();
    expect(hiddenList.getByRole('button', { name: 'Un-hide' })).toBeInTheDocument();
  });

  it('restores a hidden user to the list on un-hide', async () => {
    const dialog = within(await openRemoveDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Hide user' }));
    await screen.findAllByText('User hidden');

    const main = within(screen.getByRole('main'));
    await userEvent.click(await main.findByRole('button', { name: /Hidden users \(1\)/ }));
    const hiddenList = within(await main.findByRole('list', { name: 'Hidden users' }));
    await userEvent.click(hiddenList.getByRole('button', { name: 'Un-hide' }));

    expect(await screen.findAllByText('User restored to the list')).not.toHaveLength(0);
    expect(hiddenUsersState).toHaveLength(0);
    const list = within(await main.findByRole('list', { name: 'Users' }));
    expect(await list.findByText('Alex Chen')).toBeInTheDocument();
  });

  it('keeps the permanent delete disabled until the confirm word is typed exactly', async () => {
    const dialog = within(await openRemoveDialog());
    const deleteButton = dialog.getByRole('button', { name: 'Delete permanently' });
    expect(deleteButton).toBeDisabled();

    const confirm = dialog.getByLabelText(/Type DELETE to confirm/i);
    await userEvent.type(confirm, 'delete');
    // Case matters: a near-miss must not arm an irreversible action.
    expect(deleteButton).toBeDisabled();

    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'DELETE');
    expect(deleteButton).toBeEnabled();
  });

  it('erases the user and reports the linked ids the server actually removed', async () => {
    let erasedId: string | null = null;
    server.use(
      http.delete('/api/v1/projects/:projectId/users/:distinctId', ({ params }) => {
        erasedId = params.distinctId as string;
        return HttpResponse.json({
          ids: [erasedId, `anon-${erasedId}`],
          subscriptionStates: 1,
          revenueCatWebhookEvents: 2,
        });
      }),
    );

    const dialog = within(await openRemoveDialog());
    await userEvent.type(dialog.getByLabelText(/Type DELETE to confirm/i), 'DELETE');
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findAllByText('User deleted')).not.toHaveLength(0);
    expect(erasedId).toBe('user-001');
    // The count comes from the response, not from a client-side guess.
    expect(screen.getAllByText(/across 2 linked ids/)).not.toHaveLength(0);
  });

  it('surfaces a 403 from a non-admin instead of failing silently', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/users/:distinctId/hide', () =>
        HttpResponse.json(
          { title: 'Forbidden', detail: 'Requires admin project role or higher', status: 403 },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const dialog = within(await openRemoveDialog());
    await userEvent.click(dialog.getByRole('button', { name: 'Hide user' }));

    expect(await screen.findAllByText('Forbidden')).not.toHaveLength(0);
    expect(screen.getAllByText('Requires admin project role or higher')).not.toHaveLength(0);
  });

  it('closes the dialog on Cancel without removing anything', async () => {
    const dialogEl = await openRemoveDialog();
    await userEvent.click(within(dialogEl).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(hiddenUsersState).toHaveLength(0);
    const list = within(screen.getByRole('main')).getByRole('list', { name: 'Users' });
    expect(within(list).getByText('Alex Chen')).toBeInTheDocument();
  });
});

describe('The user profile modal', () => {
  it('banners a hidden user and lets them be un-hidden from there', async () => {
    hiddenUsersState.push({
      distinct_id: 'user-001',
      hidden_at: '2026-08-01T10:00:00.000Z',
      hidden_by: 'Test Admin',
    });

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const dialog = within(await screen.findByRole('dialog'));
    // The profile still resolves on purpose — 404ing it would strand the un-hide action.
    expect(await dialog.findByText(/hidden from the Users list/i)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Un-hide' }));

    expect(hiddenUsersState).toHaveLength(0);
  });

  it('offers the same remove action from the profile header', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/users/user-001`);

    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(await dialog.findByRole('button', { name: /^Remove / }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });
});
