import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  VALID_ACCESS_TOKEN,
  TEST_USER,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const OVERVIEW_URL = `/projects/${TEST_PROJECT.id}/rc/overview`;

describe('RcConnectPage', () => {
  it('offers the connect form on an unconnected project', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByRole('heading', { name: /connect revenuecat/i })).toBeInTheDocument();
    // `findByRole`, not `getByRole`: the heading resolves as soon as the project/role gate settles,
    // but `IntegrationsSection` mounts only then and has its own `useRcStatus` query to resolve
    // (briefly showing "Loading…") before the connect form's button appears.
    expect(await main.findByRole('button', { name: /connect/i })).toBeInTheDocument();
  });

  it('shows the overview, not the connect screen, once connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);
    const main = within(await screen.findByRole('main'));
    expect(await main.findByText('MRR')).toBeInTheDocument();
    expect(main.queryByRole('heading', { name: /connect revenuecat/i })).not.toBeInTheDocument();
  });

  // Regression test for the bug found in Task 1's review, deferred here: `useRcEnabled` reads off
  // `useProjects()` and returned `false` while that query was still in flight — not just when
  // RevenueCat was genuinely disconnected — so every RC-connected project briefly flashed this
  // connect screen before the real overview appeared. Asserting only the final state (as the tests
  // above do) doesn't catch this — that's exactly the gap that let it through the first time. This
  // test instead holds `/api/v1/projects` open with an infinite delay so it can inspect the loading
  // window itself (same technique `rc-pages.test.tsx` uses for `RcSettingsPage`'s equivalent fix).
  it('never shows the connect screen for an RC-connected project, including while still loading', async () => {
    server.use(
      http.get('/api/v1/projects', async () => {
        await delay('infinite');
        return HttpResponse.json({ projects: [] });
      }),
    );
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(OVERVIEW_URL);

    // The page shell renders immediately (its title is static) while `useProjects()` hangs forever.
    // `queryAllByText` (not the singular `queryByRole('heading', ...)`) so this catches the bug
    // regardless of markup shape — the old broken empty state rendered its title as a plain `<p>`,
    // not a heading, which would make a heading-role query pass for the wrong reason.
    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.queryAllByText(/connect revenuecat/i)).toHaveLength(0);
  });
});
