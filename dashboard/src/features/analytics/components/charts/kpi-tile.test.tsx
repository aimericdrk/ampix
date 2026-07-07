import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiTile } from './KpiTile';

describe('KpiTile', () => {
  it('renders the label and a full-precision formatted number value', () => {
    render(<KpiTile label="Sessions" value={1284} />);
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('1,284')).toBeInTheDocument();
  });

  it('passes a pre-formatted string value through verbatim', () => {
    render(<KpiTile label="Avg. session" value="4m 5s" />);
    expect(screen.getByText('4m 5s')).toBeInTheDocument();
  });

  it('shows an up delta chip: accent colour, ▲ glyph, rounded +X%', () => {
    render(<KpiTile label="Sessions" value={100} delta={{ pct: 12.4 }} />);
    expect(screen.getByText('▲')).toBeInTheDocument();
    const chip = screen.getByText(/\+12%/);
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass('text-accent');
  });

  it('shows a down delta chip: danger colour, ▼ glyph, rounded -X%', () => {
    render(<KpiTile label="Sessions" value={100} delta={{ pct: -8.6 }} />);
    expect(screen.getByText('▼')).toBeInTheDocument();
    const chip = screen.getByText(/-9%/);
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass('text-danger');
  });

  it('renders a Skeleton and hides the value while loading', () => {
    render(<KpiTile label="Sessions" value={100} loading />);
    expect(screen.getByTestId('kpi-tile-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('renders an inline SVG sparkline when spark values are provided', () => {
    render(<KpiTile label="Sessions" value={100} spark={[3, 5, 4, 8]} />);
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('does not render a sparkline when fewer than 2 spark values are given', () => {
    render(<KpiTile label="Sessions" value={100} spark={[3]} />);
    expect(document.querySelector('svg')).toBeNull();
  });
});
