import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ComparisonTrend } from './ComparisonTrend';

const current = [
  { day: '2026-06-29', sessions: 120 },
  { day: '2026-06-30', sessions: 150 },
  { day: '2026-07-01', sessions: 140 },
];

const previous = [
  { day: '2026-05-30', sessions: 100 },
  { day: '2026-05-31', sessions: 110 },
  { day: '2026-07-01', sessions: 130 },
];

describe('ComparisonTrend', () => {
  it('renders an accessible labelled figure for the current series only', () => {
    render(
      <ComparisonTrend
        current={current}
        xKey="day"
        valueKey="sessions"
        label="Sessions"
        ariaLabel="Sessions trend"
      />,
    );
    expect(screen.getByRole('img', { name: 'Sessions trend' })).toBeInTheDocument();
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
  });

  it('lists the current values in the accessible data table, without a previous column', () => {
    render(
      <ComparisonTrend
        current={current}
        xKey="day"
        valueKey="sessions"
        label="Sessions"
        ariaLabel="Sessions trend"
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('2026-06-29')).toBeInTheDocument();
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(within(table).queryByText('Previous')).not.toBeInTheDocument();
  });

  it('renders a dashed "Previous" overlay series with a legend entry when previous is provided', () => {
    render(
      <ComparisonTrend
        current={current}
        previous={previous}
        xKey="day"
        valueKey="sessions"
        label="Sessions"
        ariaLabel="Sessions trend"
      />,
    );
    const figure = screen.getByRole('img', { name: 'Sessions trend' });
    expect(figure).toBeInTheDocument();
    expect(within(figure).getByText('Current')).toBeInTheDocument();
    expect(within(figure).getByText('Previous')).toBeInTheDocument();
  });

  it('includes a previous column in the accessible table, aligned by index', () => {
    render(
      <ComparisonTrend
        current={current}
        previous={previous}
        xKey="day"
        valueKey="sessions"
        label="Sessions"
        ariaLabel="Sessions trend"
      />,
    );
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Day', 'Sessions', 'Previous']);
    const rows = within(table).getAllByRole('row');
    // header row + 3 data rows
    expect(rows).toHaveLength(4);
    // First data row: current day/value paired by index with the first previous-period row.
    const firstDataRow = rows[1]!;
    expect(within(firstDataRow).getByText('2026-06-29')).toBeInTheDocument();
    expect(within(firstDataRow).getByText('120')).toBeInTheDocument();
    expect(within(firstDataRow).getByText('100')).toBeInTheDocument();
  });
});
