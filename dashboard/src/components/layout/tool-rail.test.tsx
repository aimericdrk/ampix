import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render-app';
import { TEST_PROJECT, VALID_ACCESS_TOKEN, TEST_USER } from '../../test/msw/handlers';
import { authStore } from '../../features/auth/store';

describe('ToolRail', () => {
  it('renders one link per tool, in its own Tools nav', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyAmplitude' })).toBeInTheDocument();
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toBeInTheDocument();
  });

  it('marks the active tool', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toHaveAttribute('aria-current', 'page');
    expect(rail.getByRole('link', { name: 'MyAmplitude' })).not.toHaveAttribute('aria-current');
  });

  it('navigates to the tool home and swaps the section list', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));

    await userEvent.click(rail.getByRole('link', { name: 'MyRevenueCat' }));

    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.queryByText('Insights')).not.toBeInTheDocument();
  });

  it('shows the MyRevenueCat button even when RC is not connected — discoverability', async () => {
    const { projectsHandlerWithoutRc } = await import('../../test/msw/handlers');
    const { server } = await import('../../test/msw/server');
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    expect(rail.getByRole('link', { name: 'MyRevenueCat' })).toBeInTheDocument();
  });

  // Regression test: `Link`'s own (non-exact, prefix-based) active match is unioned into our
  // `aria-current`, not overridden by it — see the comment on `ToolRail`'s `activeOptions`. Without
  // `activeOptions={{ exact: true }}`, a future tool whose home route is a prefix of another tool's
  // routes would silently get two rail links marked current at once.
  it('marks exactly one rail link as the current page', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const rail = within(await screen.findByRole('navigation', { name: 'Tools' }));
    const current = (await rail.findAllByRole('link')).filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(current).toHaveLength(1);
  });

  it('hides the tool buttons with no project selected, but keeps the rail column so layout does not jump', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByRole('navigation', { name: 'Tools' })).not.toBeInTheDocument();
    // ToolRail itself returns null without a projectId — this asserts the surrounding rail
    // column (monogram + identity area) still renders, not just that the tool buttons are gone.
    expect(screen.getByTestId('rail-column')).toBeInTheDocument();
  });
});
