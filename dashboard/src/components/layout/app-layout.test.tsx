import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../features/auth/store';
import { currentOrgStore } from '../../features/orgs/store';
import {
  authState,
  TEST_ORG_ID,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  VIEWER_ORG_ID,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { expandSidebar, renderApp } from '../../test/render-app';

describe('AppLayout', () => {
  it('shows navigation, the workspace + project selectors, and the signed-in user', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();

    // The project selector is a real, enabled dropdown (no more disabled "All projects" box).
    const projectSelector = screen.getByRole('button', { name: 'Switch project' });
    expect(projectSelector).toBeEnabled();
    // Its *name* only renders once the rail is hovered out of its icon-only resting state.
    await expandSidebar();
    expect(within(projectSelector).getByText('All projects')).toBeInTheDocument();

    // The signed-in user now lives behind the rail's identity menu.
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText(TEST_USER.email)).toBeInTheDocument();
  });

  // The global sidebar carries the visible "MyAmpix" wordmark at `md+` (the top bar's copy is
  // `md:hidden`), so assistive tech always has accessible brand text. Collapsed the rail shows
  // only the "M" initial, so the wordmark is an expanded-state assertion.
  it('shows the MyAmpix wordmark in the global sidebar once expanded', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    const sidebar = screen.getByTestId('global-sidebar');
    expect(within(sidebar).getByText('M')).toBeInTheDocument();

    await expandSidebar();
    expect(within(sidebar).getByText('MyAmpix')).toBeInTheDocument();
  });

  it('collapses the rails to icons at rest and expands them on hover', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    const sidebar = screen.getByTestId('global-sidebar');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(sidebar).toHaveAttribute('data-collapsed', 'true');

    // Collapsed, section headings and link labels are visually gone but still named for AT —
    // which is exactly why the accessible-name assertions elsewhere need no hover.
    expect(within(nav).getByText('Explore')).toHaveClass('sr-only');
    expect(within(nav).getByRole('link', { name: 'Funnels' })).toBeInTheDocument();

    await expandSidebar();
    expect(sidebar).not.toHaveAttribute('data-collapsed');
    expect(within(nav).getByText('Explore')).not.toHaveClass('sr-only');
  });

  it('places Organization settings in the rail identity menu as a nav item', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));

    // Radix's DropdownMenuItem asChild intentionally overrides the wrapped <Link>'s implicit
    // "link" role with "menuitem" — every actionable item inside role="menu" must expose
    // menuitem/menuitemradio/menuitemcheckbox per the ARIA menu pattern. Same role used below
    // for "Log out".
    const link = await screen.findByRole('menuitem', { name: 'Organization settings' });
    expect(link).toHaveAttribute('href', `/orgs/${TEST_ORG_ID}/settings`);
  });

  it('renders the grouped project sidebar with the active destination marked', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    // The redesigned IA groups every destination in one persistent sidebar.
    expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Funnels' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Paths' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Templates' })).toBeInTheDocument();
    // Active-state is exposed to assistive tech via aria-current.
    expect(within(nav).getByRole('link', { name: 'Insights' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks exactly one Primary nav link aria-current="page" on a nested project route', async () => {
    // Regression test: `SidebarLink` computes its own `active` state (via `isHrefActive`) and
    // passes it through as `aria-current`, but TanStack's `Link` computes its OWN `aria-current`
    // from `activeOptions` (defaulting to non-exact prefix matching) and that wins whenever it
    // disagrees — so on a nested route like `/flows`, "Projects" and "Project settings" (both
    // meant to be exact-only) were ALSO marked current alongside "Flows", the one actually
    // tinted. A screen reader would announce three "current pages" at once.
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/flows`);
    await screen.findByRole('heading', { name: 'Flows' });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Flows');
  });

  it('renders every section heading in the sidebar', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByText('Explore')).toBeInTheDocument();
    expect(within(nav).getByText('Audience')).toBeInTheDocument();
    expect(within(nav).getByText('Saved')).toBeInTheDocument();
  });

  it('marks the MyRevenueCat Overview nav item active on the /rc/overview route', async () => {
    // Regression test: `isHrefActive` must match the resolved href against the current pathname —
    // no highlight, no NavIndicator, and aria-current="page" would never be set otherwise, even
    // though the link still navigates correctly. (Formerly covered the old "Subscriptions" item,
    // which nav-model's tool split replaced with MyRevenueCat's own "Overview".)
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const main = within(await screen.findByRole('main'));
    // Wait for the real (RC-connected) Overview content, not just the shell — the page shows the
    // same "Overview" title in its still-loading/disconnected branch, which would let this
    // assertion race ahead of the nav item's own data-dependent RC-enabled gating.
    await main.findByText('MRR');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const overviewLink = await within(nav).findByRole('link', { name: 'Overview' });
    expect(overviewLink).toHaveAttribute('aria-current', 'page');
    expect(overviewLink).toHaveAttribute('href', `/projects/${TEST_PROJECT.id}/rc/overview`);
  });

  it('tints the main content region with the active section accent', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    // Insights lives in the "Explore" group, mapped to the cyan accent.
    expect(document.getElementById('main-content')).toHaveAttribute('data-accent', 'cyan');
  });

  it('leaves a project that belongs to another org when the workspace changes', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp(`/projects/${TEST_PROJECT.id}`);
    // Sitting on TEST_ORG's project while TEST_ORG is selected — no redirect.
    await screen.findByRole('heading', { name: TEST_PROJECT.name });

    // Switching to an org that does not own this project bounces to the projects list.
    currentOrgStore.setCurrentOrg(VIEWER_ORG_ID);
    await screen.findByRole('heading', { name: 'Projects' });
  });

  it('stays on the project when the selected workspace still owns it', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    currentOrgStore.setCurrentOrg(TEST_ORG_ID);
    renderApp(`/projects/${TEST_PROJECT.id}`);

    // The active project belongs to the current org, so the guard is a no-op.
    await screen.findByRole('heading', { name: TEST_PROJECT.name });
    expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument();
  });

  it('toggles the theme from the sidebar and persists it', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('myampix-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    document.documentElement.classList.remove('dark');
  });

  it('logs out, clears the in-memory session, and returns to login', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpix' })).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });

  it('still clears the session and returns to login when the logout request fails', async () => {
    authState.refreshValid = true;
    server.use(
      http.post('/api/v1/auth/logout', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Internal server error', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in to MyAmpix' })).toBeInTheDocument();
    expect(authStore.getState().status).toBe('anonymous');
    expect(authStore.getState().accessToken).toBeNull();
  });
});
