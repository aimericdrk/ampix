import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render-app';
import { server } from '../../../test/msw/server';
import {
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
  projectsHandlerWithoutRc,
} from '../../../test/msw/handlers';
import { authStore } from '../../auth/store';

const URL = `/projects/${TEST_PROJECT.id}/insights`;

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Scope every query to the filter bar so RC copy never collides with the rest of the page. */
async function findFilterBar() {
  return within(await screen.findByRole('region', { name: 'Global filters' }));
}

describe('GlobalFilterBar — RevenueCat subscription quick filters', () => {
  it('renders subscription quick filters when RC is connected and toggles a profile-target filter', async () => {
    signIn();
    renderApp(URL);
    const bar = await findFilterBar();

    await userEvent.click(await bar.findByRole('button', { name: 'Subscribers' }));

    // The active filter chip shows the profile property and a small "profile" badge.
    expect(bar.getByText(/\$rc_status/)).toBeInTheDocument();
    expect(bar.getByText('profile')).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Subscribers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Second click on the same quick filter toggles it back off.
    await userEvent.click(bar.getByRole('button', { name: 'Subscribers' }));
    await waitFor(() => expect(bar.queryByText(/\$rc_status/)).not.toBeInTheDocument());
    expect(bar.queryByText('profile')).not.toBeInTheDocument();
  });

  it('appends the curated $rc_* properties to the Add-filter property list when RC is connected', async () => {
    signIn();
    renderApp(URL);
    const bar = await findFilterBar();

    await userEvent.click(
      await bar.findByRole('button', { name: 'Add a filter to scope the whole workspace' }),
    );
    const popover = await screen.findByRole('dialog', { name: 'Add global filter' });
    const propertySelect = within(popover).getByLabelText('Filter property');

    expect(within(propertySelect).getByRole('option', { name: '$rc_status' })).toBeInTheDocument();
    expect(
      within(propertySelect).getByRole('option', { name: '$rc_total_spent' }),
    ).toBeInTheDocument();
  });

  it('renders no subscription quick filters and no curated props when RC is off', async () => {
    server.use(projectsHandlerWithoutRc());
    signIn();
    renderApp(URL);
    const bar = await findFilterBar();

    // The always-present add affordance confirms the bar has settled before asserting absence.
    await bar.findByRole('button', { name: 'Add a filter to scope the whole workspace' });
    expect(bar.queryByRole('button', { name: 'Subscribers' })).not.toBeInTheDocument();
    expect(bar.queryByText('Subscription:')).not.toBeInTheDocument();
  });
});
