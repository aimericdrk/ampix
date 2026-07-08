import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { authStore } from '../../auth/store';
import {
  HISTOGRAM_FIXTURE,
  META_EVENTS_FIXTURE,
  META_PROPERTIES_FIXTURE,
  TEST_PROJECT,
  TEST_USER,
  VALID_ACCESS_TOKEN,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';
import type { HistogramQuery } from '../../../lib/api/types';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

describe('DistributionsPage', () => {
  it('defaults to the Session length preset, POSTs its event/property/bins, and renders the histogram', async () => {
    let capturedBody: HistogramQuery | null = null;
    server.use(
      http.post('/api/v1/projects/:projectId/query/histogram', async ({ request }) => {
        capturedBody = (await request.json()) as HistogramQuery;
        return HttpResponse.json(HISTOGRAM_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/distributions`);

    await screen.findByRole('heading', { name: 'Distributions' });
    const main = within(screen.getByRole('main'));

    await main.findByText('Total');
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toMatchObject({
      event: '$session_end',
      property: '$duration_ms',
      bins: 20,
    });

    // KPI summary formatted as durations (mean=6200ms -> "6s", p50=5200ms -> "5s", p90=12000ms -> "12s").
    expect(main.getByText('75')).toBeInTheDocument(); // total
    expect(main.getByText('6s')).toBeInTheDocument(); // mean
    expect(main.getByText('5s')).toBeInTheDocument(); // p50
    expect(main.getByText('12s')).toBeInTheDocument(); // p90

    expect(await main.findByRole('img', { name: 'Session length distribution' })).toBeInTheDocument();
  });

  it('switches to the Purchase value preset and sends its event/property, formatted as currency', async () => {
    let capturedBody: HistogramQuery | null = null;
    server.use(
      http.post('/api/v1/projects/:projectId/query/histogram', async ({ request }) => {
        capturedBody = (await request.json()) as HistogramQuery;
        return HttpResponse.json(HISTOGRAM_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/distributions`);
    await screen.findByRole('heading', { name: 'Distributions' });
    const main = within(screen.getByRole('main'));
    await main.findByText('Total');

    await userEvent.click(main.getByRole('radio', { name: 'Purchase value' }));

    await screen.findByRole('img', { name: 'Purchase value distribution' });
    expect(capturedBody).toMatchObject({ event: '$in_app_purchase', property: '$price' });
    expect(main.getByText('$6,200.00')).toBeInTheDocument(); // mean, currency-formatted
  });

  it('Custom mode lets you pick a real event + property and sends them in the query', async () => {
    let capturedBody: HistogramQuery | null = null;
    server.use(
      http.post('/api/v1/projects/:projectId/query/histogram', async ({ request }) => {
        capturedBody = (await request.json()) as HistogramQuery;
        return HttpResponse.json(HISTOGRAM_FIXTURE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/distributions`);
    await screen.findByRole('heading', { name: 'Distributions' });
    const main = within(screen.getByRole('main'));
    await main.findByText('Total');

    await userEvent.click(main.getByRole('radio', { name: 'Custom…' }));

    // No result yet — nothing chosen.
    expect(main.getByText('Choose an event and a numeric property to see its distribution.')).toBeInTheDocument();

    await userEvent.click(main.getByRole('button', { name: 'Event' }));
    await userEvent.click(await screen.findByRole('option', { name: META_EVENTS_FIXTURE.events[0]! }));

    await userEvent.click(main.getByRole('button', { name: 'Property' }));
    await userEvent.click(
      await screen.findByRole('option', { name: META_PROPERTIES_FIXTURE.properties[0]!.name }),
    );

    await screen.findByText('Total');
    expect(capturedBody).toMatchObject({
      event: META_EVENTS_FIXTURE.events[0],
      property: META_PROPERTIES_FIXTURE.properties[0]!.name,
    });
    // Custom mode formats as a plain number, not duration/currency.
    expect(main.getByText('6,200')).toBeInTheDocument(); // mean
  });

  it('shows an empty state when the histogram has no data', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/histogram', () =>
        HttpResponse.json({ buckets: [], total: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/distributions`);
    await screen.findByRole('heading', { name: 'Distributions' });
    const main = within(screen.getByRole('main'));

    expect(await main.findByText('No numeric data for this property.')).toBeInTheDocument();
    expect(main.queryByText('Total')).not.toBeInTheDocument();
  });
});
