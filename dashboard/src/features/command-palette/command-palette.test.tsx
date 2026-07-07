import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authState, TEST_PROJECT } from '../../test/msw/handlers';
import { renderApp } from '../../test/render-app';

describe('CommandPalette', () => {
  it('opens with Ctrl+K, filters to a page by name, and navigates on Enter', async () => {
    authState.refreshValid = true;
    const { router } = renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    await userEvent.keyboard('{Control>}k{/Control}');

    const input = await screen.findByRole('combobox', {
      name: /search pages, reports, dashboards/i,
    });
    await userEvent.type(input, 'Reports');

    await screen.findByRole('option', { name: 'Reports' });
    expect(screen.queryByRole('option', { name: 'Insights' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');

    await screen.findByRole('heading', { name: 'Reports' });
    expect(router.state.location.pathname).toBe(`/projects/${TEST_PROJECT.id}/reports`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens via the header affordance and closes on Escape', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a matching user from the debounced user search', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', {
      name: /search pages, reports, dashboards/i,
    });
    await userEvent.type(input, 'Alex Chen');

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    authState.refreshValid = true;
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    await screen.findByRole('heading', { name: 'Insights' });

    await userEvent.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', {
      name: /search pages, reports, dashboards/i,
    });
    await userEvent.type(input, 'zzzzzz-no-such-thing');

    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });
});
