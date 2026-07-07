import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DonutChart } from './DonutChart';
import type { PieSlice } from './CompositionPieChart';

const slices: PieSlice[] = [
  { key: 'a', label: 'Alpha', value: 30 },
  { key: 'b', label: 'Beta', value: 10 },
];

describe('DonutChart', () => {
  it('renders an accessible labelled figure (SVG donut)', () => {
    render(<DonutChart slices={slices} colorFor={() => 'var(--series-1)'} ariaLabel="Share by group" />);
    expect(screen.getByRole('img', { name: 'Share by group' })).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('lists each slice label + value in the accessible table, under a donut-specific legend name', () => {
    render(<DonutChart slices={slices} colorFor={() => 'var(--series-1)'} ariaLabel="Share by group" />);
    // Defaults to a donut-specific accessible name so a page rendering both a pie and a donut never
    // exposes two identically-named lists.
    const legend = screen.getByRole('list', { name: 'Composition legend (donut)' });
    expect(within(legend).getByText('Alpha')).toBeInTheDocument();
    expect(within(legend).getByText('Beta')).toBeInTheDocument();
    expect(within(legend).getByText('30')).toBeInTheDocument();
    expect(within(legend).getByText('10')).toBeInTheDocument();
  });

  it('accepts a custom legendLabel override', () => {
    render(
      <DonutChart
        slices={slices}
        colorFor={() => 'var(--series-1)'}
        ariaLabel="Share by group"
        legendLabel="Share by group legend"
      />,
    );
    expect(screen.getByRole('list', { name: 'Share by group legend' })).toBeInTheDocument();
  });

  it('shows the center total and label when provided', () => {
    render(
      <DonutChart
        slices={slices}
        colorFor={() => 'var(--series-1)'}
        ariaLabel="Share by group"
        centerValue={40}
        centerLabel="Total"
      />,
    );
    const figure = screen.getByRole('img', { name: 'Share by group' });
    expect(within(figure).getByText('40')).toBeInTheDocument();
    expect(within(figure).getByText('Total')).toBeInTheDocument();
  });

  it('omits the center overlay entirely when centerValue is not provided', () => {
    render(<DonutChart slices={slices} colorFor={() => 'var(--series-1)'} ariaLabel="Share by group" />);
    const figure = screen.getByRole('img', { name: 'Share by group' });
    expect(within(figure).queryByText('Total')).toBeNull();
  });

  describe('onSelectValue (feat-03 §3.1)', () => {
    it('calls onSelectValue with the label when a slice is clicked', () => {
      const onSelectValue = vi.fn();
      const { container } = render(
        <DonutChart
          slices={slices}
          colorFor={() => 'var(--series-1)'}
          ariaLabel="Share by group"
          onSelectValue={onSelectValue}
        />,
      );
      const sectors = container.querySelectorAll('.recharts-pie path');
      expect(sectors.length).toBeGreaterThan(0);
      fireEvent.click(sectors[0]!);
      expect(onSelectValue).toHaveBeenCalledWith('Alpha');
    });

    it('calls onSelectValue with the label when its legend button is clicked', async () => {
      const onSelectValue = vi.fn();
      render(
        <DonutChart
          slices={slices}
          colorFor={() => 'var(--series-1)'}
          ariaLabel="Share by group"
          onSelectValue={onSelectValue}
        />,
      );
      const legend = screen.getByRole('list', { name: 'Composition legend (donut)' });
      await userEvent.click(within(legend).getByRole('button', { name: 'Alpha' }));
      expect(onSelectValue).toHaveBeenCalledWith('Alpha');
    });

    it('does not make a synthetic $other/Other rollup bucket selectable', () => {
      const onSelectValue = vi.fn();
      const syntheticSlices: PieSlice[] = [
        { key: 'a', label: 'Alpha', value: 30 },
        { key: 'other', label: '$other', value: 5 },
      ];
      render(
        <DonutChart
          slices={syntheticSlices}
          colorFor={() => 'var(--series-1)'}
          ariaLabel="Share by group"
          onSelectValue={onSelectValue}
        />,
      );
      const legend = screen.getByRole('list', { name: 'Composition legend (donut)' });
      expect(within(legend).queryByRole('button', { name: '$other' })).not.toBeInTheDocument();
      expect(within(legend).getByText('$other')).toBeInTheDocument();
    });

    it('marks the active selection with aria-pressed on its legend button', () => {
      render(
        <DonutChart
          slices={slices}
          colorFor={() => 'var(--series-1)'}
          ariaLabel="Share by group"
          onSelectValue={() => {}}
          selectedValue="Beta"
        />,
      );
      const legend = screen.getByRole('list', { name: 'Composition legend (donut)' });
      expect(within(legend).getByRole('button', { name: 'Beta' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(within(legend).getByRole('button', { name: 'Alpha' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('renders plain legend text with no click handler when onSelectValue is absent', () => {
      render(<DonutChart slices={slices} colorFor={() => 'var(--series-1)'} ariaLabel="Share by group" />);
      const legend = screen.getByRole('list', { name: 'Composition legend (donut)' });
      expect(within(legend).queryByRole('button')).not.toBeInTheDocument();
      expect(within(legend).getByText('Alpha')).toBeInTheDocument();
    });
  });
});
