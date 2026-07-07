import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../../../lib/theme';
import { StatTile } from './StatTile';
import { CompositionPieChart, type PieSlice } from './CompositionPieChart';
import { AreaTrendChart, StackedBarChart, type SeriesChartProps } from './SeriesCharts';
import { MermaidDiagram } from './MermaidDiagram';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const seriesProps: SeriesChartProps = {
  rows: [
    { t: '2026-06-29', a: 5, b: 2 },
    { t: '2026-06-30', a: 7, b: 3 },
  ],
  keys: ['a', 'b'],
  labels: new Map([
    ['a', 'Alpha'],
    ['b', 'Beta'],
  ]),
  colorFor: (key) => (key === 'a' ? 'var(--series-1)' : 'var(--series-2)'),
  ariaLabel: 'Test series chart',
};

describe('chart components', () => {
  it('StatTile shows a compact value, a delta, and a sparkline', () => {
    render(
      <StatTile
        label="Sessions"
        value={1284}
        delta={{ direction: 'up', label: '+10% vs previous' }}
        spark={[3, 5, 4, 8]}
      />,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('1.3K')).toBeInTheDocument();
    expect(screen.getByText('+10% vs previous')).toBeInTheDocument();
    // The sparkline is an inline SVG path.
    expect(document.querySelector('svg path')).not.toBeNull();
  });

  it('StatTile renders a pre-formatted string value verbatim', () => {
    render(<StatTile label="Avg. session" value="4m 5s" />);
    expect(screen.getByText('4m 5s')).toBeInTheDocument();
  });

  it('CompositionPieChart lists each slice with its exact value and percent', () => {
    const slices: PieSlice[] = [
      { key: 'a', label: 'Alpha', value: 30 },
      { key: 'b', label: 'Beta', value: 10 },
    ];
    render(
      <CompositionPieChart
        slices={slices}
        colorFor={() => 'var(--series-1)'}
        ariaLabel="Share by group"
      />,
    );
    expect(screen.getByRole('img', { name: 'Share by group' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Composition legend' });
    expect(within(legend).getByText('Alpha')).toBeInTheDocument();
    // 30 / 40 = 75%, 10 / 40 = 25% — identity + magnitude never rest on color alone.
    expect(within(legend).getByText('30')).toBeInTheDocument();
    expect(within(legend).getByText('75%')).toBeInTheDocument();
    expect(within(legend).getByText('25%')).toBeInTheDocument();
  });

  it('CompositionPieChart accepts a legendLabel override so a page with a pie and a donut can give each legend a unique name', () => {
    const slices: PieSlice[] = [{ key: 'a', label: 'Alpha', value: 30 }];
    render(
      <CompositionPieChart
        slices={slices}
        colorFor={() => 'var(--series-1)'}
        ariaLabel="Share by group"
        legendLabel="Share by group legend"
      />,
    );
    expect(screen.getByRole('list', { name: 'Share by group legend' })).toBeInTheDocument();
  });

  it('AreaTrendChart and StackedBarChart render an accessible labelled figure', () => {
    const { unmount } = render(<AreaTrendChart {...seriesProps} ariaLabel="Area figure" />);
    expect(screen.getByRole('img', { name: 'Area figure' })).toBeInTheDocument();
    unmount();
    render(<StackedBarChart {...seriesProps} ariaLabel="Stacked figure" />);
    expect(screen.getByRole('img', { name: 'Stacked figure' })).toBeInTheDocument();
  });

  it('MermaidDiagram exposes an accessible figure and the diagram source', () => {
    renderWithTheme(
      <MermaidDiagram chart={'graph TD\n  A-->B'} ariaLabel="Test diagram" />,
    );
    expect(screen.getByRole('img', { name: 'Test diagram' })).toBeInTheDocument();
    // The generated source is always available as the text alternative to the SVG.
    expect(screen.getAllByText(/A-->B/).length).toBeGreaterThan(0);
  });
});
