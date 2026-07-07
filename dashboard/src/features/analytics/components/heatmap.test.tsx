import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ClickHeatmapQuery, ClickHeatmapResponse, ScreensResponse } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const SCREENS: ScreensResponse = {
  screens: [
    { screen_name: 'home', capture_count: 2, latest_captured_at: '2026-07-01T10:00:00Z', width: 390, height: 844, latest_image_hash: 'hash-home', latest_app_version: '1.0.0' },
    { screen_name: 'checkout', capture_count: 1, latest_captured_at: '2026-07-01T10:10:00Z', width: 390, height: 844, latest_image_hash: 'hash-checkout', latest_app_version: '1.0.0' },
  ],
};

const HEATMAP: ClickHeatmapResponse = {
  screen_name: 'checkout',
  total: 87,
  cells: [
    { cx: 2, cy: 5, count: 42 },
    { cx: 8, cy: 30, count: 25 },
    { cx: 15, cy: 38, count: 20 },
  ],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('HeatmapPage — click heatmap viewer', () => {
  it('posts the §19 click-heatmap body on screen select and overlays cells (with counts) on the screenshot; switching screens re-queries', async () => {
    const bodies: ClickHeatmapQuery[] = [];
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () => HttpResponse.json(SCREENS)),
      http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
        const body = (await request.json()) as ClickHeatmapQuery;
        bodies.push(body);
        return HttpResponse.json({ ...HEATMAP, screen_name: body.screen_name });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });

    // The global date-range control renders in the header, defaulting to Last 30 days.
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The screen picker lists the captured screens.
    await screen.findByRole('option', { name: 'checkout' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'checkout');

    // One overlay cell per populated grid cell, each carrying its tap count.
    const cells = await screen.findAllByTestId('heatmap-cell');
    expect(cells).toHaveLength(3);
    expect(screen.getByTitle('42 taps')).toBeInTheDocument();
    expect(screen.getByTitle('25 taps')).toBeInTheDocument();

    // The "total taps" figure and its screenshot are present — the KPI headline and the legend
    // both surface the same total (result.total), so the exact value renders at least once.
    expect(screen.getByText('Total taps')).toBeInTheDocument();
    expect(screen.getByText('total taps')).toBeInTheDocument();
    expect(screen.getAllByText('87').length).toBeGreaterThanOrEqual(1);
    await screen.findByAltText('Screenshot of checkout');

    // The §19 body: exact screen + grid + filters; the date range is a valid YYYY-MM-DD pair.
    expect(bodies).toHaveLength(1);
    const first = bodies[0]!;
    expect(first.screen_name).toBe('checkout');
    expect(first.grid).toEqual({ cols: 20, rows: 40 });
    expect(first.filters).toEqual([]);
    expect(first.date_range.from).toMatch(DATE);
    expect(first.date_range.to).toMatch(DATE);

    // Switching the picker re-queries for the newly selected screen.
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'home');
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.screen_name).toBe('home');
  });

  it('shows an empty state when the screen has no taps in range', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () => HttpResponse.json(SCREENS)),
      http.post('/api/v1/projects/:projectId/query/click-heatmap', () =>
        HttpResponse.json({ screen_name: 'checkout', total: 0, cells: [] } satisfies ClickHeatmapResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });
    await screen.findByRole('option', { name: 'checkout' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'checkout');

    expect(
      await screen.findByText('No taps recorded for this screen in the selected range.'),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('heatmap-cell')).toHaveLength(0);
  });

  it('overlays the grid on a neutral board when the screen has no screenshot yet', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () => HttpResponse.json(SCREENS)),
      http.get('/api/v1/projects/:projectId/screens/:screenName/image', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'No screenshot', status: 404 },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
      http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
        const body = (await request.json()) as ClickHeatmapQuery;
        return HttpResponse.json({ ...HEATMAP, screen_name: body.screen_name });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });
    await screen.findByRole('option', { name: 'checkout' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'checkout');

    // Cells still render, overlaid on the fallback board.
    expect(await screen.findAllByTestId('heatmap-cell')).toHaveLength(3);
    expect(await screen.findByText('No screenshot yet')).toBeInTheDocument();
  });

  it('shows a "no screens captured" hint when the project has no screenshots', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () =>
        HttpResponse.json({ screens: [] } satisfies ScreensResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });

    expect(await screen.findByText('No screens captured yet.')).toBeInTheDocument();
  });

  it('retakes/deletes the selected screen after a confirm step and refreshes the list', async () => {
    const deleteUrls: string[] = [];
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () => {
        // Once the delete has fired, 'checkout' is gone from the catalog.
        const screens =
          deleteUrls.length > 0
            ? SCREENS.screens.filter((s) => s.screen_name !== 'checkout')
            : SCREENS.screens;
        return HttpResponse.json({ screens } satisfies ScreensResponse);
      }),
      http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
        const body = (await request.json()) as ClickHeatmapQuery;
        return HttpResponse.json({ ...HEATMAP, screen_name: body.screen_name });
      }),
      http.delete('/api/v1/projects/:projectId/screens/:screenName', ({ request }) => {
        deleteUrls.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });
    await screen.findByRole('option', { name: 'checkout' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'checkout');

    // The retake/delete control surfaces for the selected screen; nothing deletes until confirmed.
    const retake = await screen.findByRole('button', {
      name: /Retake or delete screenshot for checkout/i,
    });
    await userEvent.click(retake);
    expect(deleteUrls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    // The DELETE hits the exact §18 URL for the selected screen.
    await waitFor(() => expect(deleteUrls).toHaveLength(1));
    const url = new URL(deleteUrls[0]!);
    expect(url.pathname).toBe(`/api/v1/projects/${TEST_PROJECT.id}/screens/checkout`);

    // Success toast + the screens list refetches (checkout drops out of the picker).
    expect(await screen.findByText('Screenshot deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: 'checkout' })).not.toBeInTheDocument(),
    );
  });

  it('does not delete when the confirm step is cancelled', async () => {
    const deleteUrls: string[] = [];
    server.use(
      http.get('/api/v1/projects/:projectId/screens', () => HttpResponse.json(SCREENS)),
      http.post('/api/v1/projects/:projectId/query/click-heatmap', async ({ request }) => {
        const body = (await request.json()) as ClickHeatmapQuery;
        return HttpResponse.json({ ...HEATMAP, screen_name: body.screen_name });
      }),
      http.delete('/api/v1/projects/:projectId/screens/:screenName', ({ request }) => {
        deleteUrls.push(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/heatmap`);
    await screen.findByRole('heading', { name: 'Click heatmap' });
    await screen.findByRole('option', { name: 'checkout' });
    await userEvent.selectOptions(screen.getByLabelText('Screen'), 'checkout');

    await userEvent.click(
      await screen.findByRole('button', { name: /Retake or delete screenshot for checkout/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Back to the single affordance; nothing was deleted.
    expect(
      screen.getByRole('button', { name: /Retake or delete screenshot for checkout/i }),
    ).toBeInTheDocument();
    expect(deleteUrls).toHaveLength(0);
  });
});
