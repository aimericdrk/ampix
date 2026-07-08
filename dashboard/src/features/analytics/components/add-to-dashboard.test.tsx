import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../../components/ui/toast';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { TEST_DASHBOARD_ID, TEST_REPORT_INSIGHTS_ID } from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import type { CreateDashboardRequest, CreateTileRequest } from '../../../lib/api/types';
import { AddToDashboardButton, type AddToDashboardDraft } from './AddToDashboardButton';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

function renderButton(draft: AddToDashboardDraft, props: { disabled?: boolean; disabledHint?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AddToDashboardButton projectId={TEST_PROJECT.id} draft={draft} {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const savedReportDraft: AddToDashboardDraft = {
  kind: 'insights',
  title: 'Weekly checkouts',
  savedReportId: TEST_REPORT_INSIGHTS_ID,
};

describe('AddToDashboardButton', () => {
  it('opens to list the project\'s dashboards, prefilled with the draft title', async () => {
    signIn();
    renderButton(savedReportDraft);

    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const dialog = await screen.findByRole('dialog');

    await within(dialog).findByRole('option', { name: 'Growth overview' });
    expect(within(dialog).getByRole('option', { name: '＋ New dashboard' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Tile title')).toHaveValue('Weekly checkouts');
  });

  it('adds a tile to the chosen dashboard, appended below its existing tiles', async () => {
    let capturedBody: CreateTileRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/dashboards/:id/tiles', async ({ request, params }) => {
        capturedBody = (await request.json()) as CreateTileRequest;
        expect(params.id).toBe(TEST_DASHBOARD_ID);
        return HttpResponse.json(
          {
            id: 'tile-new',
            title: capturedBody.title,
            kind: capturedBody.kind,
            saved_report_id: capturedBody.saved_report_id ?? null,
            inline_definition: capturedBody.inline_definition ?? null,
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
    renderButton(savedReportDraft);

    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Growth overview' });

    await userEvent.selectOptions(within(dialog).getByLabelText('Dashboard'), 'Growth overview');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(capturedBody).toEqual({
        title: 'Weekly checkouts',
        kind: 'insights',
        saved_report_id: TEST_REPORT_INSIGHTS_ID,
        x: 0,
        y: 2, // the seeded board's two tiles both end at y+h = 2
        w: 6,
        h: 4,
      }),
    );

    // Dialog closes and a confirmation toast appears once the tile is added.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Added to Growth overview')).toBeInTheDocument();
  });

  it('creates a new dashboard then adds the tile to it (append at y=0 on the fresh board)', async () => {
    let createdDashboardBody: CreateDashboardRequest | undefined;
    let tileDashboardId: string | undefined;
    let tileBody: CreateTileRequest | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/dashboards', async ({ request }) => {
        createdDashboardBody = (await request.json()) as CreateDashboardRequest;
        return HttpResponse.json(
          { id: 'dashboard-brand-new', name: createdDashboardBody.name, tile_count: 0, updated_at: '2026-07-04T00:00:00.000Z' },
          { status: 201 },
        );
      }),
      http.post('/api/v1/projects/:projectId/dashboards/:id/tiles', async ({ request, params }) => {
        tileDashboardId = params.id as string;
        tileBody = (await request.json()) as CreateTileRequest;
        return HttpResponse.json(
          {
            id: 'tile-new',
            title: tileBody.title,
            kind: tileBody.kind,
            saved_report_id: tileBody.saved_report_id ?? null,
            inline_definition: tileBody.inline_definition ?? null,
            x: tileBody.x,
            y: tileBody.y,
            w: tileBody.w,
            h: tileBody.h,
            position: 0,
          },
          { status: 201 },
        );
      }),
    );

    signIn();
    renderButton(savedReportDraft);

    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Growth overview' });

    await userEvent.selectOptions(within(dialog).getByLabelText('Dashboard'), '＋ New dashboard');
    await userEvent.type(within(dialog).getByLabelText('New dashboard name'), 'Launch metrics');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createdDashboardBody).toEqual({ name: 'Launch metrics' }));
    await waitFor(() => expect(tileDashboardId).toBe('dashboard-brand-new'));
    expect(tileBody).toEqual({
      title: 'Weekly checkouts',
      kind: 'insights',
      saved_report_id: TEST_REPORT_INSIGHTS_ID,
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    });

    expect(await screen.findByText('Added to Launch metrics')).toBeInTheDocument();
  });

  it('shows an error toast and keeps the dialog open when adding the tile fails', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/dashboards/:id/tiles', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Something went wrong', status: 500 },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );

    signIn();
    renderButton(savedReportDraft);

    await userEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Growth overview' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Dashboard'), 'Growth overview');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Could not add to dashboard')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders disabled with the given hint when the analysis is not runnable yet', async () => {
    signIn();
    renderButton(savedReportDraft, { disabled: true, disabledHint: 'Run a query first.' });

    const button = screen.getByRole('button', { name: 'Add to dashboard' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Run a query first.');
  });
});
