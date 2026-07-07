import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ScreenPathsQuery, ScreenPathsResponse } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { SCREEN_IMAGE_BYTES, TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const RESPONSE: ScreenPathsResponse = {
  nodes: [
    { id: '0:home', step: 0, event: 'home', value: 1000 },
    { id: '1:catalog', step: 1, event: 'catalog', value: 620 },
    { id: '1:$end', step: 1, event: '$end', value: 380 },
    { id: '2:checkout', step: 2, event: 'checkout', value: 240 },
  ],
  links: [
    { source: '0:home', target: '1:catalog', value: 620 },
    { source: '0:home', target: '1:$end', value: 380 },
    { source: '1:catalog', target: '2:checkout', value: 240 },
  ],
};

/** Records which screen images were requested and always returns bytes so the <img> renders. */
function trackScreenImages(): Set<string> {
  const requested = new Set<string>();
  server.use(
    http.get('/api/v1/projects/:projectId/screens/:screenName/image', ({ params }) => {
      requested.add(params.screenName as string);
      return new HttpResponse(SCREEN_IMAGE_BYTES, { headers: { 'Content-Type': 'image/jpeg' } });
    }),
  );
  return requested;
}

describe('PathsPage — user-path map', () => {
  it('posts the §19 screen-paths body, renders the interactive map (screen cards + edges + screenshots), then toggles to the Mermaid view', async () => {
    let capturedBody: ScreenPathsQuery | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
        capturedBody = (await request.json()) as ScreenPathsQuery;
        return HttpResponse.json(RESPONSE);
      }),
    );
    const imageRequests = trackScreenImages();

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/paths`);
    await screen.findByRole('heading', { name: 'Paths' });

    // The global date-range control renders in the header, defaulting to Last 30 days.
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Anchor screen' }));
    await userEvent.click(await screen.findByRole('option', { name: 'home' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-01' } });
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'user');
    fireEvent.change(screen.getByLabelText('Steps (hops)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Max screens per step'), { target: { value: '5' } });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    // Interactive map is the default view: one card per node, one SVG edge per link.
    const map = await screen.findByTestId('path-map');
    expect(within(map).getAllByTestId('path-node')).toHaveLength(4);
    expect(within(map).getAllByTestId('path-edge')).toHaveLength(3);
    // Real screens are labelled by name; the synthetic $end node reads as "Drop-off".
    expect(within(map).getByText('home')).toBeInTheDocument();
    expect(within(map).getByText('checkout')).toBeInTheDocument();
    expect(within(map).getByText('Drop-off')).toBeInTheDocument();

    // The exact §19 body — anchor_screen included, ranges + knobs carried through.
    expect(capturedBody).toEqual({
      anchor_screen: 'home',
      direction: 'forward',
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      steps: 2,
      max_nodes_per_step: 5,
      unit: 'user',
    });

    // A screenshot is requested per REAL screen node (never for synthetic $end).
    await screen.findByAltText('Screenshot of home');
    await waitFor(() => {
      expect(imageRequests).toContain('home');
      expect(imageRequests).toContain('catalog');
      expect(imageRequests).toContain('checkout');
    });
    expect(imageRequests.has('$end')).toBe(false);

    // Accessible transitions table carries exact per-link values.
    const table = within(screen.getByRole('table', { name: 'Screen-path transitions' }));
    const rows = table.getAllByRole('row').slice(1);
    const toCheckout = rows.find(
      (r) => within(r).queryByText('checkout') && within(r).queryByText('240'),
    );
    expect(toCheckout).toBeDefined();

    // A KPI tile summarizes the path's total (step-0 node value), labeled by the chosen unit.
    expect(screen.getByText('Total users')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();

    // Toggle to the Mermaid flowchart view: the map is replaced by the diagram figure.
    await userEvent.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(await screen.findByRole('img', { name: 'User path flowchart' })).toBeInTheDocument();
    expect(screen.queryByTestId('path-map')).not.toBeInTheDocument();
    // The generated diagram source is a flowchart LR — always present as the accessible text.
    expect(screen.getAllByText(/flowchart LR/).length).toBeGreaterThan(0);
  });

  it('omits anchor_screen when the anchor is left blank (start from top entry screens)', async () => {
    let capturedBody: ScreenPathsQuery | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', async ({ request }) => {
        capturedBody = (await request.json()) as ScreenPathsQuery;
        return HttpResponse.json(RESPONSE);
      }),
    );
    trackScreenImages();

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/paths`);
    await screen.findByRole('heading', { name: 'Paths' });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByTestId('path-map');

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toHaveProperty('anchor_screen');
  });

  it('opens the map in a fullscreen dialog and closes via Escape or the Close button (focus managed)', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', () =>
        HttpResponse.json(RESPONSE),
      ),
    );
    trackScreenImages();

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/paths`);
    await screen.findByRole('heading', { name: 'Paths' });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByTestId('path-map');

    const trigger = screen.getByRole('button', { name: 'Fullscreen' });
    await userEvent.click(trigger);

    // The fullscreen dialog appears and renders its own interactive map.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByTestId('path-map')).toBeInTheDocument();

    // Focus moved into the dialog (onto the Close button).
    const closeButton = within(dialog).getByRole('button', { name: 'Exit fullscreen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(closeButton);

    // Escape closes the dialog and returns focus to the Fullscreen trigger.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);

    // Re-open, then verify the Close button also dismisses it.
    await userEvent.click(trigger);
    const reopened = await screen.findByRole('dialog');
    await userEvent.click(within(reopened).getByRole('button', { name: 'Exit fullscreen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it('renders an empty state when there is no screen-path data', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/screen-paths', () =>
        HttpResponse.json({ nodes: [], links: [] } satisfies ScreenPathsResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/paths`);
    await screen.findByRole('heading', { name: 'Paths' });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('No screen-path data for this query yet.')).toBeInTheDocument();
  });
});
