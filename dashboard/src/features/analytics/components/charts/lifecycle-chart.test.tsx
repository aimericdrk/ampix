import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngagementNewReturningPoint } from '../../../../lib/api/types';
import { LifecycleChart } from './LifecycleChart';

const POINTS: EngagementNewReturningPoint[] = [
  { t: '2026-06-29', new: 30, returning: 90 },
  { t: '2026-06-30', new: 35, returning: 100 },
  { t: '2026-07-01', new: 40, returning: 110 },
];

describe('LifecycleChart', () => {
  it('renders an accessible labelled figure with a legend for the two stacked series', () => {
    render(<LifecycleChart points={POINTS} ariaLabel="User lifecycle trend" />);
    expect(screen.getByRole('img', { name: 'User lifecycle trend' })).toBeInTheDocument();
    // "New"/"Returning" each appear twice: once in the recharts legend, once as a table header.
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Returning').length).toBeGreaterThanOrEqual(2);
  });

  it('lists both series plus the per-bucket total in the accessible data table', () => {
    render(<LifecycleChart points={POINTS} ariaLabel="User lifecycle trend" />);
    const table = screen.getByRole('table', { name: /User lifecycle trend/ });
    const rows = within(table).getAllByRole('row');
    // header + 3 data rows
    expect(rows).toHaveLength(4);

    const row = within(rows[1]!);
    expect(row.getByText('2026-06-29')).toBeInTheDocument();
    expect(row.getByText('30')).toBeInTheDocument();
    expect(row.getByText('90')).toBeInTheDocument();
    expect(row.getByText('120')).toBeInTheDocument(); // total = new + returning
  });

  it('renders an empty stack (no crash) for an all-zero bucket', () => {
    render(
      <LifecycleChart
        points={[{ t: '2026-06-29', new: 0, returning: 0 }]}
        ariaLabel="User lifecycle trend"
      />,
    );
    expect(screen.getByRole('img', { name: 'User lifecycle trend' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /User lifecycle trend/ });
    expect(within(table).getAllByText('0')).toHaveLength(3); // new, returning, total
  });
});
