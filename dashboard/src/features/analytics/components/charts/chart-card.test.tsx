import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionGrid } from '../../../../components/ui/SectionGrid';
import { ChartCard } from './ChartCard';

describe('ChartCard', () => {
  it('renders the title and children when ready', () => {
    render(
      <ChartCard title="Sessions over time">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText('Sessions over time')).toBeInTheDocument();
    expect(screen.getByText('Chart body')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <ChartCard title="Sessions" description="Last 30 days">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
  });

  it('renders an action in the header', () => {
    render(
      <ChartCard title="Sessions" action={<button>Breakdown</button>}>
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByRole('button', { name: 'Breakdown' })).toBeInTheDocument();
  });

  it('shows a Skeleton and hides children while loading', () => {
    render(
      <ChartCard title="Sessions" state="loading">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByTestId('chart-card-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Chart body')).not.toBeInTheDocument();
  });

  it('shows emptyText and hides children when empty', () => {
    render(
      <ChartCard title="Sessions" state="empty" emptyText="No sessions in this range">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText('No sessions in this range')).toBeInTheDocument();
    expect(screen.queryByText('Chart body')).not.toBeInTheDocument();
  });

  it('falls back to a default empty message when emptyText is omitted', () => {
    render(
      <ChartCard title="Sessions" state="empty">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it('shows errorText and hides children on error', () => {
    render(
      <ChartCard title="Sessions" state="error" errorText="Failed to load sessions">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText('Failed to load sessions')).toBeInTheDocument();
    expect(screen.queryByText('Chart body')).not.toBeInTheDocument();
  });

  it('falls back to a default error message when errorText is omitted', () => {
    render(
      <ChartCard title="Sessions" state="error">
        <p>Chart body</p>
      </ChartCard>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });
});

describe('SectionGrid', () => {
  it('renders its children', () => {
    render(
      <SectionGrid>
        <p>Item one</p>
        <p>Item two</p>
      </SectionGrid>,
    );
    expect(screen.getByText('Item one')).toBeInTheDocument();
    expect(screen.getByText('Item two')).toBeInTheDocument();
  });

  it('applies a grid template based on the min column width (default 240px)', () => {
    render(
      <SectionGrid>
        <p>Item</p>
      </SectionGrid>,
    );
    const grid = screen.getByText('Item').parentElement;
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' });
  });

  it('respects a custom min width', () => {
    render(
      <SectionGrid min={200}>
        <p>Item</p>
      </SectionGrid>,
    );
    const grid = screen.getByText('Item').parentElement;
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' });
  });
});
