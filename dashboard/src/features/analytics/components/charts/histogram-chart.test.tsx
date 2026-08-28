import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistogramChart } from './HistogramChart';
import { openDataTables } from '../../../../test/data-tables';

const BUCKETS = [
  { lower: 0, upper: 5000, count: 40 },
  { lower: 5000, upper: 10000, count: 30 },
  { lower: 10000, upper: 15000, count: 10 },
];

describe('HistogramChart', () => {
  it('renders an accessible labelled figure with one bar per bucket', () => {
    render(<HistogramChart buckets={BUCKETS} ariaLabel="Session length distribution" />);
    const figure = screen.getByRole('img', { name: 'Session length distribution' });
    expect(figure).toBeInTheDocument();
    const bars = figure.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBe(BUCKETS.length);
  });

  it('captions the accessible table using the ariaLabel prop', () => {
    render(<HistogramChart buckets={BUCKETS} ariaLabel="Session length distribution" />);
    expect(screen.getByText('Session length distribution data table')).toBeInTheDocument();
  });

  it('lists range, count, and percent-of-total in the accessible table (unit: number)', async () => {
    render(<HistogramChart buckets={BUCKETS} ariaLabel="Distribution" unit="number" />);
    await openDataTables();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 buckets

    expect(within(rows[1]!).getByText('0–5,000')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('40')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('50%')).toBeInTheDocument(); // 40/80

    expect(within(rows[2]!).getByText('5,000–10,000')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('30')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('37.5%')).toBeInTheDocument(); // 30/80

    expect(within(rows[3]!).getByText('10,000–15,000')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('10')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('12.5%')).toBeInTheDocument(); // 10/80
  });

  it('formats bucket ranges as durations when unit is duration', async () => {
    render(
      <HistogramChart
        buckets={[{ lower: 0, upper: 5000, count: 1 }]}
        ariaLabel="Session length"
        unit="duration"
      />,
    );
    await openDataTables();
    const table = screen.getByRole('table');
    expect(within(table).getByText('0.0s–5s')).toBeInTheDocument();
  });

  it('formats bucket ranges as currency when unit is currency', async () => {
    render(
      <HistogramChart
        buckets={[{ lower: 0, upper: 20, count: 1 }]}
        ariaLabel="Purchase value"
        unit="currency"
      />,
    );
    await openDataTables();
    const table = screen.getByRole('table');
    expect(within(table).getByText('$0.00–$20.00')).toBeInTheDocument();
  });

  it('collapses a zero-width bucket to a single value instead of duplicating the bound', async () => {
    render(<HistogramChart buckets={[{ lower: 42, upper: 42, count: 5 }]} ariaLabel="Distribution" />);
    await openDataTables();
    const table = screen.getByRole('table');
    expect(within(table).getByText('42')).toBeInTheDocument();
    expect(within(table).queryByText('42–42')).not.toBeInTheDocument();
  });

  it('colors every bar with one series color, not a per-bar rainbow', () => {
    const { container } = render(<HistogramChart buckets={BUCKETS} ariaLabel="Distribution" />);
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBeGreaterThan(0);
    const fills = new Set(Array.from(bars).map((bar) => bar.getAttribute('fill')));
    expect(fills.size).toBe(1);
  });

  it('shows a dash instead of a percent when there is no data', async () => {
    render(<HistogramChart buckets={[]} ariaLabel="Distribution" />);
    await openDataTables();
    const table = screen.getByRole('table');
    // header row only.
    expect(within(table).getAllByRole('row')).toHaveLength(1);
  });
});
