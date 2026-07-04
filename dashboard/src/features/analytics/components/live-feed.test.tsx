import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  LIVE_EVENTS_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('LiveFeedPage', () => {
  it('shows a loading status, then lists events newest-first', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading live events');

    const table = await screen.findByRole('table', { name: 'Live events, newest first' });
    const firstDataRow = (await within(table).findAllByRole('row'))[1]!;
    const newestEvent = LIVE_EVENTS_FIXTURE[0]!;
    expect(within(firstDataRow).getByText(newestEvent.event)).toBeInTheDocument();
    expect(within(firstDataRow).getByText(newestEvent.distinct_id)).toBeInTheDocument();
    expect(within(firstDataRow).getByText(newestEvent.os)).toBeInTheDocument();
    expect(within(firstDataRow).getByText(newestEvent.app_version)).toBeInTheDocument();
  });

  it('loads older events via next_before when "Load older" is clicked', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/live`);

    const table = await screen.findByRole('table', { name: 'Live events, newest first' });
    // header row + the first 25-event page.
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(26));

    await userEvent.click(screen.getByRole('button', { name: 'Load older' }));

    // header row + all 30 fixture events, once the older page has loaded.
    let dataRows: HTMLElement[] = [];
    await waitFor(() => {
      dataRows = within(table).getAllByRole('row').slice(1);
      expect(dataRows).toHaveLength(30);
    });
    const lastRow = dataRows[dataRows.length - 1]!;
    const oldestEvent = LIVE_EVENTS_FIXTURE[29]!;
    expect(within(lastRow).getByText(oldestEvent.event)).toBeInTheDocument();
    expect(within(lastRow).getByText(oldestEvent.distinct_id)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });
});
