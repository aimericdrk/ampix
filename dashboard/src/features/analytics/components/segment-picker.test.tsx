import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { authStore } from '../../auth/store';
import { TEST_PROJECT, TEST_USER, VALID_ACCESS_TOKEN } from '../../../test/msw/handlers';
import { TEST_COHORT_ID } from '../../../test/msw/phase5-handlers';
import { server } from '../../../test/msw/server';
import { SegmentPicker } from './SegmentPicker';

function signIn() {
  authStore.setSession(VALID_ACCESS_TOKEN, TEST_USER);
}

/** Controlled wrapper so a real selection round-trips through `value`/`onChange` like a builder would. */
function ControlledSegmentPicker({ onChange }: { onChange: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <SegmentPicker
      projectId={TEST_PROJECT.id}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
    />
  );
}

function renderSegmentPicker(onChange: (id: string | null) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ControlledSegmentPicker onChange={onChange} />
    </QueryClientProvider>,
  );
}

describe('SegmentPicker', () => {
  it('renders the project\'s saved cohorts as segment options, defaulting to "All users"', async () => {
    signIn();
    renderSegmentPicker(vi.fn());

    const select = await screen.findByLabelText('Segment');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'All users (no segment)' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Recent buyers' })).toBeInTheDocument();
  });

  it('calls onChange with the cohort id when a segment is selected, and shows its live size', async () => {
    signIn();
    const onChange = vi.fn();
    renderSegmentPicker(onChange);

    const select = await screen.findByLabelText('Segment');
    await screen.findByRole('option', { name: 'Recent buyers' });

    await userEvent.selectOptions(select, 'Recent buyers');

    expect(onChange).toHaveBeenCalledWith(TEST_COHORT_ID);
    // The seeded cohort's preview count (137) is fetched live and rendered as an approximate size.
    expect(await screen.findByText('≈ 137 users')).toBeInTheDocument();
  });

  it('selecting "All users" back after a segment reverts onChange to null', async () => {
    signIn();
    const onChange = vi.fn();
    renderSegmentPicker(onChange);

    const select = await screen.findByLabelText('Segment');
    await screen.findByRole('option', { name: 'Recent buyers' });
    await userEvent.selectOptions(select, 'Recent buyers');
    await screen.findByText('≈ 137 users');

    await userEvent.selectOptions(select, 'All users (no segment)');

    expect(onChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.queryByText('≈ 137 users')).not.toBeInTheDocument());
  });

  it('renders exactly the "All users" option plus the project\'s segments — no stray extras', async () => {
    signIn();
    renderSegmentPicker(vi.fn());

    const select = await screen.findByLabelText('Segment');
    await screen.findByRole('option', { name: 'Recent buyers' });
    expect(select.querySelectorAll('option')).toHaveLength(2);
  });

  it('shows an empty-state hint when the project has no saved segments yet', async () => {
    server.use(
      http.get('/api/v1/projects/:projectId/cohorts', () => HttpResponse.json({ cohorts: [] })),
    );

    signIn();
    renderSegmentPicker(vi.fn());

    expect(await screen.findByText('No saved segments yet.')).toBeInTheDocument();
    const select = await screen.findByLabelText('Segment');
    expect(select.querySelectorAll('option')).toHaveLength(1);
  });
});
