import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BreakdownChart, type BreakdownChartProps } from './BreakdownChart';
import { openDataTables } from '../../../../test/data-tables';

// A wrong data shape for a given `stacked` value must fail to compile, not crash at runtime — the
// discriminated union is the whole point of this prop type.
// @ts-expect-error stacked: true requires StackedBreakdownDatum[] rows, not flat {label,value} rows.
const _invalidStackedProps: BreakdownChartProps = { stacked: true, data: [{ label: 'iOS', value: 40 }], ariaLabel: 'invalid' };
void _invalidStackedProps;

describe('BreakdownChart', () => {
  it('renders an accessible labelled figure with a bar per label, sorted desc by value', async () => {
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
    await openDataTables();
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

  it('lists exact values in the accessible table', async () => {
    render(
      <BreakdownChart
        data={[
          { label: 'iOS', value: 40 },
          { label: 'Android', value: 120 },
        ]}
        ariaLabel="OS breakdown"
      />,
    );
    await openDataTables();
    const table = screen.getByRole('table');
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(within(table).getByText('40')).toBeInTheDocument();
  });

  it('does not truncate the data it is given — top-N stays the caller\'s responsibility', async () => {
    const data = Array.from({ length: 12 }, (_, index) => ({ label: `Item ${index}`, value: index + 1 }));
    render(<BreakdownChart data={data} ariaLabel="Full breakdown" />);
    await openDataTables();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12 data rows
  });

  it('renders a legend entry and a table column per segment key when stacked', async () => {
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
    await openDataTables();
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

  it('fills a missing segment for a label with a dash rather than dropping the column', async () => {
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
    await openDataTables();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('—')).toBeInTheDocument();
  });

  describe('onSelectValue (feat-03 §3.1)', () => {
    it('calls onSelectValue with the label when a bar is clicked', () => {
      const onSelectValue = vi.fn();
      const { container } = render(
        <BreakdownChart
          data={[
            { label: 'iOS', value: 40 },
            { label: 'Android', value: 120 },
          ]}
          ariaLabel="OS breakdown"
          onSelectValue={onSelectValue}
        />,
      );
      // Sorted desc by value: Android (120) is the first rendered bar.
      const bars = container.querySelectorAll('.recharts-bar-rectangle path');
      expect(bars.length).toBeGreaterThan(0);
      fireEvent.click(bars[0]!);
      expect(onSelectValue).toHaveBeenCalledWith('Android');
    });

    it('calls onSelectValue with the label when its table-row button is clicked', async () => {
      const onSelectValue = vi.fn();
      render(
        <BreakdownChart
          data={[
            { label: 'iOS', value: 40 },
            { label: 'Android', value: 120 },
          ]}
          ariaLabel="OS breakdown"
          onSelectValue={onSelectValue}
        />,
      );
      await openDataTables();
      const table = screen.getByRole('table');
      await userEvent.click(within(table).getByRole('button', { name: 'Android' }));
      expect(onSelectValue).toHaveBeenCalledWith('Android');
    });

    it('does not make a synthetic $other/Other rollup bucket selectable', async () => {
      const onSelectValue = vi.fn();
      render(
        <BreakdownChart
          data={[
            { label: 'iOS', value: 40 },
            { label: '$other', value: 5 },
            { label: 'Other', value: 3 },
          ]}
          ariaLabel="OS breakdown"
          onSelectValue={onSelectValue}
        />,
      );
      await openDataTables();
      const table = screen.getByRole('table');
      expect(within(table).queryByRole('button', { name: '$other' })).not.toBeInTheDocument();
      expect(within(table).queryByRole('button', { name: 'Other' })).not.toBeInTheDocument();
      expect(within(table).getByText('$other')).toBeInTheDocument();
      expect(within(table).getByText('Other')).toBeInTheDocument();
    });

    it('marks the active selection with aria-pressed on its table-row button', async () => {
      render(
        <BreakdownChart
          data={[
            { label: 'iOS', value: 40 },
            { label: 'Android', value: 120 },
          ]}
          ariaLabel="OS breakdown"
          onSelectValue={() => {}}
          selectedValue="Android"
        />,
      );
      await openDataTables();
      const table = screen.getByRole('table');
      expect(within(table).getByRole('button', { name: 'Android' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(table).getByRole('button', { name: 'iOS' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('renders plain label text with no click handler when onSelectValue is absent', async () => {
      render(<BreakdownChart data={[{ label: 'iOS', value: 40 }]} ariaLabel="OS breakdown" />);
      await openDataTables();
      const table = screen.getByRole('table');
      expect(within(table).queryByRole('button')).not.toBeInTheDocument();
      expect(within(table).getByText('iOS')).toBeInTheDocument();
    });
  });
});
