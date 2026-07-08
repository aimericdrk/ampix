import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Anomaly } from '../../anomaly';
import { AnomalyCallout } from './AnomalyCallout';

function makeAnomaly(overrides: Partial<Anomaly>): Anomaly {
  return {
    index: 0,
    t: '2026-06-14',
    value: 280,
    direction: 'spike',
    score: 3,
    baselineMean: 100,
    ...overrides,
  };
}

describe('AnomalyCallout', () => {
  it('renders nothing when there are no anomalies', () => {
    const { container } = render(<AnomalyCallout anomalies={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports the count and a plain-language line per anomaly', () => {
    const anomalies = [
      makeAnomaly({ index: 0, t: '2026-06-14', value: 280, direction: 'spike', baselineMean: 100, score: 5 }),
      makeAnomaly({ index: 1, t: '2026-06-22', value: 40, direction: 'dip', baselineMean: 100, score: 4 }),
    ];
    render(<AnomalyCallout anomalies={anomalies} />);

    expect(screen.getByText('2 anomalies detected')).toBeInTheDocument();
    const spikeItem = screen.getByText('2026-06-14').closest('li')!;
    expect(within(spikeItem).getByText('spike')).toBeInTheDocument();
    expect(within(spikeItem).getByText('+180% vs. local baseline')).toBeInTheDocument();

    const dipItem = screen.getByText('2026-06-22').closest('li')!;
    expect(within(dipItem).getByText('dip')).toBeInTheDocument();
    expect(within(dipItem).getByText('-60% vs. local baseline')).toBeInTheDocument();
  });

  it('guards a zero baseline mean by showing an absolute delta instead of a percent', () => {
    const anomalies = [makeAnomaly({ index: 0, t: '2026-06-14', value: 42, baselineMean: 0 })];
    render(<AnomalyCallout anomalies={anomalies} />);
    expect(screen.getByText('+42 vs. local baseline of 0')).toBeInTheDocument();
  });

  it('caps the rendered list to the top-N by score when every point is flagged (degenerate case)', () => {
    const anomalies = Array.from({ length: 8 }, (_, i) =>
      makeAnomaly({ index: i, t: `2026-06-${10 + i}`, score: i + 1 }),
    );
    render(<AnomalyCallout anomalies={anomalies} maxItems={3} />);

    expect(screen.getByText('8 anomalies detected')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Top-3 by score (7, 6, 5 -> dates ...17, ...16, ...15), highest first.
    expect(within(items[0]!).getByText('2026-06-17')).toBeInTheDocument();
    expect(within(items[1]!).getByText('2026-06-16')).toBeInTheDocument();
    expect(within(items[2]!).getByText('2026-06-15')).toBeInTheDocument();
  });
});
