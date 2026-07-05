import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

afterEach(() => server.events.removeAllListeners());

describe('TemplatesPage', () => {
  it('renders the §19 catalog with names, descriptions and kind counts', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/templates`);

    await screen.findByRole('heading', { name: 'Templates' });

    // All seven fixed catalog entries expose an Apply action.
    expect(await screen.findAllByRole('button', { name: 'Apply' })).toHaveLength(7);

    // Card titles are headings (the sidebar links share some labels, so assert by heading role).
    expect(screen.getByRole('heading', { name: 'Acquisition' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activation funnel' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'User paths' })).toBeInTheDocument();

    expect(screen.getByText('Where new users come from and how many arrive.')).toBeInTheDocument();
    // kind_counts → human chips (several templates bundle two insights reports).
    expect(screen.getAllByText('2 insights').length).toBeGreaterThan(0);
  });

  it('applies a template, POSTs to the §19 apply endpoint, and opens the new dashboard', async () => {
    const applyRequests: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.includes('/templates/')) {
        applyRequests.push(new URL(request.url).pathname);
      }
    });

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/templates`);
    await screen.findByRole('heading', { name: 'Templates' });

    const card = (await screen.findByRole('heading', { name: 'Acquisition' })).closest('li');
    expect(card).not.toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Apply' }));

    // The materialized dashboard (named after the template) opens, showing its tiles.
    expect(await screen.findByText('New users over time')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Acquisition' })).toBeInTheDocument();

    // The action hit exactly the §19 apply endpoint for the chosen template.
    expect(applyRequests).toContain(
      `/api/v1/projects/${TEST_PROJECT.id}/templates/acquisition/apply`,
    );
  });
});
