import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Anomaly } from '../../anomaly';
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

  describe('anomaly markers (feat-07)', () => {
    const spikeAnomaly: Anomaly = {
      index: 1,
      t: '2026-06-30',
      value: 150,
      direction: 'spike',
      score: 3.2,
      baselineMean: 120,
    };
    const dipAnomaly: Anomaly = {
      index: 2,
      t: '2026-07-01',
      value: 140,
      direction: 'dip',
      score: 2.8,
      baselineMean: 200,
    };

    it('renders no markers and no legend note when the anomalies prop is absent', () => {
      render(
        <ComparisonTrend
          current={current}
          xKey="day"
          valueKey="sessions"
          label="Sessions"
          ariaLabel="Sessions trend"
        />,
      );
      expect(document.querySelectorAll('[data-anomaly-direction]')).toHaveLength(0);
      expect(screen.queryByText('△ anomaly')).not.toBeInTheDocument();
    });

    it('renders no markers and no legend note when the anomalies prop is an empty array', () => {
      render(
        <ComparisonTrend
          current={current}
          xKey="day"
          valueKey="sessions"
          label="Sessions"
          ariaLabel="Sessions trend"
          anomalies={[]}
        />,
      );
      expect(document.querySelectorAll('[data-anomaly-direction]')).toHaveLength(0);
      expect(screen.queryByText('△ anomaly')).not.toBeInTheDocument();
    });

    it('renders a ringed marker at the anomalous index, with a distinct shape+color per direction, and a legend note', () => {
      render(
        <ComparisonTrend
          current={current}
          xKey="day"
          valueKey="sessions"
          label="Sessions"
          ariaLabel="Sessions trend"
          anomalies={[spikeAnomaly, dipAnomaly]}
        />,
      );

      const figure = screen.getByRole('img', { name: 'Sessions trend' });

      const spikeMarker = within(figure).getByRole('img', {
        name: 'Spike anomaly at 2026-06-30: 150',
      });
      expect(spikeMarker).toHaveAttribute('data-anomaly-direction', 'spike');
      // A ring (circle) plus a filled shape (polygon) — never color alone.
      expect(spikeMarker.querySelector('circle')).toBeInTheDocument();
      const spikeShape = spikeMarker.querySelector('polygon');
      expect(spikeShape).toBeInTheDocument();

      const dipMarker = within(figure).getByRole('img', {
        name: 'Dip anomaly at 2026-07-01: 140',
      });
      expect(dipMarker).toHaveAttribute('data-anomaly-direction', 'dip');
      const dipShape = dipMarker.querySelector('polygon');
      expect(dipShape).toBeInTheDocument();

      // Shape differs between the two directions (triangle up vs. down), not just color.
      expect(dipShape?.getAttribute('points')).not.toEqual(spikeShape?.getAttribute('points'));

      expect(screen.getByText('△ anomaly')).toBeInTheDocument();
    });
  });
});
