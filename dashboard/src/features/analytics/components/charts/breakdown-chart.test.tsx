import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BreakdownChart, type BreakdownChartProps } from './BreakdownChart';

// A wrong data shape for a given `stacked` value must fail to compile, not crash at runtime — the
// discriminated union is the whole point of this prop type.
// @ts-expect-error stacked: true requires StackedBreakdownDatum[] rows, not flat {label,value} rows.
const _invalidStackedProps: BreakdownChartProps = { stacked: true, data: [{ label: 'iOS', value: 40 }], ariaLabel: 'invalid' };
void _invalidStackedProps;

describe('BreakdownChart', () => {
  it('renders an accessible labelled figure with a bar per label, sorted desc by value', () => {
    render(
      <BreakdownChart
        data={[
          { label: 'iOS', value: 40 },
          { label: 'Android', value: 120 },
          { label: 'Web', value: 80 },
        ]}
        ariaLabel="OS breakdown"
      />,
    );
    expect(screen.getByRole('img', { name: 'OS breakdown' })).toBeInTheDocument();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // header + 3 data rows
    expect(rows).toHaveLength(4);
    // Sorted desc by value: Android (120), Web (80), iOS (40) — the caller's own order is ignored.
    expect(within(rows[1]!).getByText('Android')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Web')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('iOS')).toBeInTheDocument();
  });

  it('captions the accessible table using the ariaLabel prop, not a hardcoded string', () => {
    render(
      <BreakdownChart data={[{ label: 'iOS', value: 40 }]} ariaLabel="OS breakdown" />,
    );
    expect(screen.getByText('OS breakdown data table')).toBeInTheDocument();
  });

  it('colors every bar with one series color rather than a per-bar rainbow', () => {
    const { container } = render(
      <BreakdownChart
        data={[
          { label: 'iOS', value: 40 },
          { label: 'Android', value: 120 },
          { label: 'Web', value: 80 },
        ]}
        ariaLabel="OS breakdown"
      />,
    );
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBeGreaterThan(0);
    const fills = new Set(Array.from(bars).map((bar) => bar.getAttribute('fill')));
    expect(fills.size).toBe(1);
  });

  it('lists exact values in the accessible table', () => {
    render(
      <BreakdownChart
        data={[
          { label: 'iOS', value: 40 },
          { label: 'Android', value: 120 },
        ]}
        ariaLabel="OS breakdown"
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(within(table).getByText('40')).toBeInTheDocument();
  });

  it('does not truncate the data it is given — top-N stays the caller\'s responsibility', () => {
    const data = Array.from({ length: 12 }, (_, index) => ({ label: `Item ${index}`, value: index + 1 }));
    render(<BreakdownChart data={data} ariaLabel="Full breakdown" />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12 data rows
  });

  it('renders a legend entry and a table column per segment key when stacked', () => {
    render(
      <BreakdownChart
        stacked
        data={[
          {
            label: 'iOS',
            segments: [
              { key: 'new', value: 30 },
              { key: 'returning', value: 10 },
            ],
          },
          {
            label: 'Android',
            segments: [
              { key: 'new', value: 50 },
              { key: 'returning', value: 70 },
            ],
          },
        ]}
        ariaLabel="OS breakdown by user type"
      />,
    );
    const figure = screen.getByRole('img', { name: 'OS breakdown by user type' });
    expect(within(figure).getByText('New')).toBeInTheDocument();
    expect(within(figure).getByText('Returning')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(screen.getByText('OS breakdown by user type data table')).toBeInTheDocument();
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Label', 'New', 'Returning', 'Total']);

    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 data rows
    expect(within(rows[1]!).getByText('iOS')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('30')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('10')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('40')).toBeInTheDocument();
  });

  it('fills a missing segment for a label with a dash rather than dropping the column', () => {
    render(
      <BreakdownChart
        stacked
        data={[
          {
            label: 'iOS',
            segments: [{ key: 'new', value: 30 }],
          },
          {
            label: 'Android',
            segments: [
              { key: 'new', value: 50 },
              { key: 'returning', value: 70 },
            ],
          },
        ]}
        ariaLabel="OS breakdown by user type"
      />,
    );
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('—')).toBeInTheDocument();
  });
});
