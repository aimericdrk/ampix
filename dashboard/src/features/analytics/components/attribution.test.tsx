import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  ATTRIBUTION_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

async function renderAttribution() {
  signIn();
  renderApp(`/projects/${TEST_PROJECT.id}/attribution`);
  await screen.findByRole('heading', { name: 'Attribution' });
  return within(screen.getByRole('main'));
}

describe('AttributionPage', () => {
  it('reports installs and accounts created side by side, with the rate between them', async () => {
    const main = await renderAttribution();

    // The two populations are KPI tiles, identified by their hint lines — "Installs" and
    // "Accounts created" also appear as chart/table labels further down the page.
    expect(await main.findByText('First-ever event in this range')).toBeInTheDocument();
    expect(main.getByText('First sign-in in this range')).toBeInTheDocument();
    expect(main.getByText('1,000')).toBeInTheDocument();
    expect(main.getByText('250')).toBeInTheDocument();
    // 250 / 1000 — the gap between the two populations is the number the page exists for.
    expect(main.getByText('25.0%')).toBeInTheDocument();
  });

  it('sends the selected date range to the API', async () => {
    let capturedUrl: string | null = null;
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/attribution', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(ATTRIBUTION_FIXTURE);
      }),
    );

    await renderAttribution();
    await screen.findByText('1,000');
    expect(capturedUrl).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(capturedUrl).toMatch(/to=\d{4}-\d{2}-\d{2}/);
  });

  it('labels an unattributed bucket rather than rendering an empty cell', async () => {
    const main = await renderAttribution();
    // The `value: null` row of the fixture — the SDK captured no campaign at all for those users.
    expect(await main.findAllByText('Direct / unknown')).not.toHaveLength(0);
    expect(main.queryByText('null')).not.toBeInTheDocument();
  });

  it('switches the breakdown dimension and re-labels the chart', async () => {
    const main = await renderAttribution();
    // Appears in both the chart's accessible table and the breakdown table below it.
    expect(await main.findAllByText('google-play')).not.toHaveLength(0);

    // Asserted on the card's per-dimension DESCRIPTION, which is unique — the title phrase
    // "accounts created by campaign" also occurs inside the data table's caption.
    await userEvent.click(main.getByRole('radio', { name: 'Campaign' }));
    expect(await main.findByText(/utm_campaign` that brought them in/)).toBeInTheDocument();
    expect(await main.findAllByText('launch')).not.toHaveLength(0);

    await userEvent.click(main.getByRole('radio', { name: 'Install referrer' }));
    expect(await main.findByText(/raw Play Store install referrer string/)).toBeInTheDocument();
  });

  it('lists each account with its FIRST-touch attribution', async () => {
    const main = await renderAttribution();
    const table = within(
      await main.findByRole('table', {
        name: /Each account created in this range and the campaign it is attributed to/i,
      }),
    );
    expect(table.getByText('Alex Chen')).toBeInTheDocument();
    expect(table.getByText('user-001')).toBeInTheDocument();
    expect(table.getByText('First-touch source')).toBeInTheDocument();
  });

  it('marks an install that never became an account as "Not yet", not as a blank', async () => {
    const main = await renderAttribution();
    const table = within(
      await main.findByRole('table', {
        name: /Each account created in this range/i,
      }),
    );
    expect(table.getByText('Not yet')).toBeInTheDocument();
  });

  it('shows an empty state when nothing was created in the range', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/attribution', () =>
        HttpResponse.json({
          total_installs: 0,
          total_signups: 0,
          signup_rate: null,
          by_source: [],
          by_campaign: [],
          by_medium: [],
          by_referrer: [],
          accounts: [],
        }),
      ),
    );

    const main = await renderAttribution();
    expect(await main.findByText('No accounts created in this range')).toBeInTheDocument();
    // A rate with nothing to divide by is an em dash, never 0% — those are different facts.
    expect(main.getByText('—')).toBeInTheDocument();
  });

  it('reports a failed load instead of rendering zeroes as if they were real', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/metrics/attribution', () =>
        HttpResponse.json(
          { title: 'Internal Server Error', status: 500 },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const main = await renderAttribution();
    expect(await main.findByRole('alert')).toHaveTextContent('Failed to load attribution');
  });
});
