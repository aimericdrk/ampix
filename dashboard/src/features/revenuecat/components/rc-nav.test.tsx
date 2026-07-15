import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  VALID_ACCESS_TOKEN,
  TEST_USER,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

describe('MyRevenueCat nav gating', () => {
  it('lists the RC data pages in the sidebar when RC is connected', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Overview')).toBeInTheDocument();
    expect(nav.getByText('Conversion')).toBeInTheDocument();
    expect(nav.getByText('Customers')).toBeInTheDocument();
  });

  it('drops the RC data pages but keeps Integration settings when RC is not connected', async () => {
    server.use(projectsHandlerWithoutRc());
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/rc/overview`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    await waitFor(() => expect(nav.queryByText('Overview')).not.toBeInTheDocument());
    expect(nav.getByText('Integration settings')).toBeInTheDocument();
  });

  it('shows MyAmplitude pages, not RC pages, on an analytics route', async () => {
    authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
    renderApp(`/projects/${TEST_PROJECT.id}/insights`);
    const nav = within(await screen.findByRole('navigation', { name: 'Primary' }));
    expect(await nav.findByText('Insights')).toBeInTheDocument();
    expect(nav.queryByText('Overview')).not.toBeInTheDocument();
  });
});
