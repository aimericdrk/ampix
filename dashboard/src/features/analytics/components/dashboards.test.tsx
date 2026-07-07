import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateTileRequest, UpdateLayoutRequest } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { TEST_DASHBOARD_ID } from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const dashboardUrl = `/projects/${TEST_PROJECT.id}/dashboards/${TEST_DASHBOARD_ID}`;

describe('DashboardsPage list', () => {
  it('lists dashboards, each with a preview thumbnail, and shows the tile count', async () => {
    // Two boards: the seeded 2-tile board (real preview) and a zero-tile draft (empty thumbnail).
    server.use(
      http.get('/api/v1/projects/:projectId/dashboards', () =>
        HttpResponse.json({
          dashboards: [
            { id: TEST_DASHBOARD_ID, name: 'Growth overview', tile_count: 2, updated_at: '2026-07-04T00:00:00.000Z' },
            { id: 'dashboard-empty', name: 'Draft board', tile_count: 0, updated_at: '2026-07-04T00:00:00.000Z' },
          ],
        }),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/dashboards`);
    await screen.findByRole('heading', { name: 'Dashboards' });
    expect(await screen.findByText('Growth overview')).toBeInTheDocument();
    expect(screen.getByText('Draft board')).toBeInTheDocument();
    expect(screen.getByText('2 tiles')).toBeInTheDocument();

    // One thumbnail per card; the zero-tile board short-circuits to the "Empty board" thumbnail.
    expect(screen.getAllByTestId('chart-thumbnail')).toHaveLength(2);
    expect(await screen.findByText('Empty board')).toBeInTheDocument();
  });

  it('creates a dashboard via POST /dashboards', async () => {
    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/dashboards`);
    await screen.findByRole('heading', { name: 'Dashboards' });
    expect(await screen.findByText('Growth overview')).toBeInTheDocument();
    expect(screen.getByText('2 tiles')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New dashboard' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Dashboard name'), 'Launch metrics');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create dashboard' }));

    expect(await screen.findByText('Launch metrics')).toBeInTheDocument();
  });
});

describe('DashboardViewPage', () => {
  it('renders the 12-col board with each tile’s chart from GET /dashboards/:id/data', async () => {
    signIn();
    renderApp(dashboardUrl);
    await screen.findByRole('heading', { name: 'Growth overview' });

    const checkoutTile = await screen.findByRole('article', { name: 'Checkouts' });
    expect(within(checkoutTile).getByRole('img', { name: 'Insights line chart' })).toBeInTheDocument();

    const funnelTile = screen.getByRole('article', { name: 'Funnel' });
    expect(within(funnelTile).getByRole('img', { name: 'Funnel chart' })).toBeInTheDocument();
  });

  it('saves the 12-col layout after a discrete width resize, posting the packed payload', async () => {
    let capturedBody: UpdateLayoutRequest | undefined;
    server.use(
      http.patch('/api/v1/projects/:projectId/dashboards/:id/layout', async ({ request }) => {
        capturedBody = (await request.json()) as UpdateLayoutRequest;
        return HttpResponse.json({ id: TEST_DASHBOARD_ID, name: 'Growth overview', tiles: [] });
      }),
    );

    signIn();
    renderApp(dashboardUrl);
    await screen.findByRole('article', { name: 'Checkouts' });

    await userEvent.click(screen.getByRole('button', { name: 'Increase width of Checkouts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        tiles: [
          { id: 'tile-seed-1', x: 0, y: 0, w: 7, h: 2, position: 0 },
          { id: 'tile-seed-2', x: 0, y: 2, w: 6, h: 2, position: 1 },
        ],
      }),
    );
  });

  it('reorders tiles with the Move control and persists the new positions', async () => {
    let capturedBody: UpdateLayoutRequest | undefined;
    server.use(
      http.patch('/api/v1/projects/:projectId/dashboards/:id/layout', async ({ request }) => {
        capturedBody = (await request.json()) as UpdateLayoutRequest;
        return HttpResponse.json({ id: TEST_DASHBOARD_ID, name: 'Growth overview', tiles: [] });
      }),
    );

    signIn();
    renderApp(dashboardUrl);
    await screen.findByRole('article', { name: 'Checkouts' });

    await userEvent.click(screen.getByRole('button', { name: 'Move Checkouts later' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save layout' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        tiles: [
          { id: 'tile-seed-2', x: 0, y: 0, w: 6, h: 2, position: 0 },
          { id: 'tile-seed-1', x: 6, y: 0, w: 6, h: 2, position: 1 },
        ],
      }),
    );
  });

  it('adds a tile from a saved report, posting the §16 tile body', async () => {
    let capturedBody: CreateTileRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/dashboards/:id/tiles', async ({ request }) => {
        capturedBody = (await request.json()) as CreateTileRequest;
        return HttpResponse.json(
          {
            id: 'tile-new',
            title: capturedBody.title,
            kind: capturedBody.kind,
            saved_report_id: capturedBody.saved_report_id ?? null,
            inline_definition: null,
            x: capturedBody.x,
            y: capturedBody.y,
            w: capturedBody.w,
            h: capturedBody.h,
            position: 2,
          },
          { status: 201 },
        );
      }),
    );

    signIn();
    renderApp(dashboardUrl);
    await screen.findByRole('article', { name: 'Checkouts' });

    await userEvent.click(screen.getByRole('button', { name: 'Add tile' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Weekly checkouts' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Report'), 'report-seed-insights');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add tile' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        title: 'Weekly checkouts',
        kind: 'insights',
        saved_report_id: 'report-seed-insights',
        x: 0,
        y: 2,
        w: 6,
        h: 2,
      }),
    );
  });
});
