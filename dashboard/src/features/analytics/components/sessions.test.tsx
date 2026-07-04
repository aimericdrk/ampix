import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  SESSIONS_SUMMARY_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('SessionsPage', () => {
  it('shows number tiles for total sessions and avg duration, plus a by-day chart and table', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/sessions`);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading session summary');

    expect(await screen.findByText('Total sessions')).toBeInTheDocument();
    expect(screen.getByText(String(SESSIONS_SUMMARY_FIXTURE.sessions))).toBeInTheDocument();
    expect(screen.getByText('4m 5s')).toBeInTheDocument(); // formatDurationMs(245_000)

    expect(screen.getByRole('img', { name: 'Sessions by day chart' })).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Sessions by day' });
    for (const day of SESSIONS_SUMMARY_FIXTURE.by_day) {
      const row = within(table).getByText(day.t).closest('tr');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(String(day.sessions))).toBeInTheDocument();
    }
  });
});
