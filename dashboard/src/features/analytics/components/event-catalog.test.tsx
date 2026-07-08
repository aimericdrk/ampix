import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  META_EVENTS_FIXTURE,
  META_PROPERTIES_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/**
 * A richer local fixture than the shared `META_EVENTS_FIXTURE`/`EVENT_SUMMARY_FIXTURE` pair — it
 * adds a `$`-prefixed autocaptured event (only in `meta/events`, no all-time row) and an event
 * seen only in the all-time summary (older than the 30-day `meta/events` window), so the union
 * join and the auto/manual badge both have real cases to exercise.
 */
function useCatalogFixtures() {
  server.use(
    http.get('/api/v1/projects/:projectId/meta/events', () =>
      HttpResponse.json({ events: [...META_EVENTS_FIXTURE.events, '$app_opened'] }),
    ),
    http.get('/api/v1/projects/:projectId/events/summary', ({ params }) =>
      HttpResponse.json({
        project_id: params.projectId as string,
        total: 84,
        by_event: [
          { event: 'checkout_completed', count: 32 },
          { event: 'product_viewed', count: 20 },
          { event: 'legacy_signup', count: 8 },
        ],
      }),
    ),
  );
}

describe('EventCatalogPage', () => {
  it('renders the union of meta/events + summary counts, with volume and auto/manual badges', async () => {
    useCatalogFixtures();
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/events`);

    await screen.findByRole('heading', { name: 'Events' });
    const main = within(screen.getByRole('main'));

    // Present in meta/events with an all-time count.
    expect(await main.findByText('checkout_completed')).toBeInTheDocument();
    expect(main.getByText('32')).toBeInTheDocument();

    // Present in meta/events only (no all-time row) — falls back to 0 volume.
    expect(main.getByText('app_opened')).toBeInTheDocument();

    // Present only in the all-time summary (older than the meta/events window) — still listed.
    expect(main.getByText('legacy_signup')).toBeInTheDocument();
    expect(main.getByText('8')).toBeInTheDocument();

    // Autocaptured ($-prefixed) vs manual badges.
    const autoRow = main.getByText('$app_opened').closest('tr');
    expect(autoRow).not.toBeNull();
    expect(within(autoRow!).getByText('$ auto')).toBeInTheDocument();

    const manualRow = main.getByText('checkout_completed').closest('tr');
    expect(manualRow).not.toBeNull();
    expect(within(manualRow!).getByText('manual')).toBeInTheDocument();

    // Summary KPIs: 6 distinct events (4 from meta/events + $app_opened + legacy_signup from the
    // summary), 1 auto ($app_opened), 5 manual, total volume = 32 + 20 + 8 = 60 (app_opened,
    // signup_completed, $app_opened contribute 0).
    function kpiValue(label: string): HTMLElement {
      const tile = main.getByText(label).closest('div');
      if (!tile) throw new Error(`KpiTile for "${label}" not found`);
      return tile as HTMLElement;
    }
    expect(within(kpiValue('Distinct events')).getByText('6')).toBeInTheDocument();
    expect(within(kpiValue('Autocaptured')).getByText('1')).toBeInTheDocument();
    expect(within(kpiValue('Manual')).getByText('5')).toBeInTheDocument();
    expect(within(kpiValue('Total volume')).getByText('60')).toBeInTheDocument();
  });

  it('search filters events by name', async () => {
    useCatalogFixtures();
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/events`);

    await screen.findByRole('heading', { name: 'Events' });
    const main = within(screen.getByRole('main'));
    await main.findByText('checkout_completed');

    await userEvent.type(main.getByLabelText('Search events'), 'checkout');

    expect(main.getByText('checkout_completed')).toBeInTheDocument();
    expect(main.queryByText('product_viewed')).not.toBeInTheDocument();
    expect(main.queryByText('legacy_signup')).not.toBeInTheDocument();
  });

  it('expanding an event shows its properties', async () => {
    useCatalogFixtures();
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/events`);

    await screen.findByRole('heading', { name: 'Events' });
    const main = within(screen.getByRole('main'));
    await main.findByText('checkout_completed');

    const row = main.getByText('checkout_completed').closest('tr');
    expect(row).not.toBeNull();
    await userEvent.click(within(row!).getByRole('button', { name: 'Properties' }));

    for (const property of META_PROPERTIES_FIXTURE.properties) {
      expect(await main.findByText(property.name)).toBeInTheDocument();
    }

    // Toggling again hides the panel.
    await userEvent.click(within(row!).getByRole('button', { name: 'Hide properties' }));
    expect(main.queryByText(META_PROPERTIES_FIXTURE.properties[0]!.name)).not.toBeInTheDocument();
  });

  it('editing a description persists it', async () => {
    useCatalogFixtures();
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/events`);

    await screen.findByRole('heading', { name: 'Events' });
    const main = within(screen.getByRole('main'));
    await main.findByText('checkout_completed');

    const input = main.getByLabelText('Description for checkout_completed');
    await userEvent.type(input, 'Fires when a checkout finishes.');

    expect(input).toHaveValue('Fires when a checkout finishes.');
    const stored = JSON.parse(
      localStorage.getItem(`myampix:eventdescs:${TEST_PROJECT.id}`) ?? 'null',
    );
    expect(stored.checkout_completed).toBe('Fires when a checkout finishes.');
  });

  it('shows an empty state when there are no events at all', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/meta/events', () => HttpResponse.json({ events: [] })),
      http.get('/api/v1/projects/:projectId/events/summary', ({ params }) =>
        HttpResponse.json({ project_id: params.projectId as string, total: 0, by_event: [] }),
      ),
    );
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/events`);

    await screen.findByRole('heading', { name: 'Events' });
    expect(await screen.findByText('No events tracked yet.')).toBeInTheDocument();
  });
});
