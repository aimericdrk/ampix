import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authState, TEST_PROJECT } from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

describe('useKeyboardShortcuts (mounted in AppLayout)', () => {
  it('navigates to Insights on "g" then "i"', async () => {
    authState.refreshValid = true;
    const { router } = renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });

    await userEvent.keyboard('gi');

    await screen.findByRole('heading', { name: 'Insights' });
    expect(router.state.location.pathname).toBe(`/projects/${TEST_PROJECT.id}/insights`);
  });

  it('does not navigate when the "g" sequence is typed while focused in an input', async () => {
    authState.refreshValid = true;
    const { router } = renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });

    // Opening the command palette (a modal) legitimately `aria-hidden`s the page behind it —
    // the assertion that matters is the route, not the (now-hidden) background heading.
    await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    const searchInput = await screen.findByRole('combobox', {
      name: /search pages, reports, dashboards/i,
    });
    await userEvent.type(searchInput, 'gi');

    expect(searchInput).toHaveValue('gi');
    expect(router.state.location.pathname).toBe(`/projects/${TEST_PROJECT.id}/home`);
  });

  it('opens the help overlay on "?" and closes it on Escape', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.keyboard('?');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists the navigation shortcuts and general shortcuts in the overlay', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/home`);
    await screen.findByRole('heading', { name: 'Home' });

    await userEvent.keyboard('?');
    const dialog = await screen.findByRole('dialog');

    expect(dialog).toHaveTextContent('Insights');
    expect(dialog).toHaveTextContent('Funnels');
    expect(dialog).toHaveTextContent('Show this help');
    expect(dialog).toHaveTextContent('Open command palette');
    expect(dialog).toHaveTextContent('Close dialog');
  });

  it('does not disrupt existing AppLayout navigation and rendering', async () => {
    authState.refreshValid = true;
    renderApp('/projects');
    await screen.findByRole('heading', { name: 'Projects' });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });
});
