import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { FlowsQueryDefinition, FlowsResponse } from '../../../lib/api/types';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/render-app';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

const RESPONSE: FlowsResponse = {
  nodes: [
    { id: '0:app_open', step: 0, event: 'app_open', value: 1000 },
    { id: '1:browse', step: 1, event: 'browse', value: 540 },
    { id: '1:$other', step: 1, event: '$other', value: 160 },
    { id: '1:$end', step: 1, event: '$end', value: 300 },
  ],
  links: [
    { source: '0:app_open', target: '1:browse', value: 540 },
    { source: '0:app_open', target: '1:$other', value: 160 },
    { source: '0:app_open', target: '1:$end', value: 300 },
  ],
};

describe('FlowsPage', () => {
  it('posts the §15 flows body and renders the Sankey with the exact node + link values', async () => {
    let capturedBody: FlowsQueryDefinition | undefined;
    server.use(
      http.post('/api/v1/projects/:projectId/query/flows', async ({ request }) => {
        capturedBody = (await request.json()) as FlowsQueryDefinition;
        return HttpResponse.json(RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/flows`);
    await screen.findByRole('heading', { name: 'Flows' });

    await userEvent.type(screen.getByLabelText('Anchor event'), 'app_open');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-01' } });
    await userEvent.selectOptions(screen.getByLabelText('Unit'), 'user');
    fireEvent.change(screen.getByLabelText('Steps (hops)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Max nodes per step'), { target: { value: '5' } });

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByRole('img', { name: 'Event flow Sankey diagram' });

    expect(capturedBody).toEqual({
      anchor: { event: 'app_open', filters: [] },
      direction: 'forward',
      date_range: { from: '2026-06-01', to: '2026-07-01' },
      steps: 2,
      max_nodes_per_step: 5,
      unit: 'user',
    });

    // Nodes table carries exact per-node user counts.
    const nodesTable = within(screen.getByRole('table', { name: 'Flow nodes' }));
    const browseRow = nodesTable.getAllByRole('row').find((r) => within(r).queryByText('browse'));
    expect(within(browseRow as HTMLElement).getByText('540')).toBeInTheDocument();
    const endRow = nodesTable.getAllByRole('row').find((r) => within(r).queryByText('$end'));
    expect(within(endRow as HTMLElement).getByText('300')).toBeInTheDocument();

    // Transitions table carries exact per-link values.
    const linksTable = within(screen.getByRole('table', { name: 'Flow transitions' }));
    const rows = linksTable.getAllByRole('row').slice(1);
    const toBrowse = rows.find(
      (r) => within(r).queryByText('browse') && within(r).queryByText('540'),
    );
    const toEnd = rows.find((r) => within(r).queryByText('$end') && within(r).queryByText('300'));
    expect(toBrowse).toBeDefined();
    expect(toEnd).toBeDefined();

    // Legend colors real events only — synthetic $other/$end are muted, not categorical hues.
    const legend = within(screen.getByRole('list', { name: 'Flow event legend' }));
    expect(legend.getByText('app_open')).toBeInTheDocument();
    expect(legend.getByText('browse')).toBeInTheDocument();
    expect(legend.queryByText('$other')).not.toBeInTheDocument();
    expect(legend.queryByText('$end')).not.toBeInTheDocument();
  });

  it('shows the running state while the flow query is in flight', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/flows', async () => {
        await delay('infinite');
        return HttpResponse.json(RESPONSE);
      }),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/flows`);
    await screen.findByRole('heading', { name: 'Flows' });

    await userEvent.type(screen.getByLabelText('Anchor event'), 'app_open');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('renders an empty state when the flow has no nodes', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/query/flows', () =>
        HttpResponse.json({ nodes: [], links: [] } satisfies FlowsResponse),
      ),
    );

    signIn();
    renderApp(`/projects/${TEST_PROJECT.id}/flows`);
    await screen.findByRole('heading', { name: 'Flows' });

    await userEvent.type(screen.getByLabelText('Anchor event'), 'app_open');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByText('No flow data for this query yet.')).toBeInTheDocument();
  });
});
