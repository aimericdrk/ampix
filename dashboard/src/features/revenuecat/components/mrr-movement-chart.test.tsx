import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MrrMovementChart } from './MrrMovementChart';
import type { RcMrrMovementBucket, RcMrrMovementTotals } from '../purchase-metrics-api';

const TOTALS: RcMrrMovementTotals = {
  new_cents: 1500,
  reactivation_cents: 200,
  expansion_cents: 300,
  contraction_cents: -100,
  churn_cents: -600,
  net_cents: 1300,
};

const BUCKETS: RcMrrMovementBucket[] = [
  {
    bucket: '2026-01-01T00:00:00.000Z',
    new_cents: 1000,
    reactivation_cents: 200,
    expansion_cents: 300,
    contraction_cents: -100,
    churn_cents: -400,
    net_cents: 1000,
  },
  {
    bucket: '2026-01-02T00:00:00.000Z',
    new_cents: 500,
    reactivation_cents: 0,
    expansion_cents: 0,
    contraction_cents: 0,
    churn_cents: -200,
    net_cents: 300,
  },
];

describe('MrrMovementChart', () => {
  it('renders a legend chip per category + Net, defaulting to a subset (New, Churn, Net) so not all show at once', () => {
    render(<MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" />);

    // Visible by default:
    for (const name of [/^New/, /^Churn/, /^Net/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }
    // Hidden by default (one click away):
    for (const name of [/^Reactivation/, /^Expansion/, /^Contraction/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('shows each category total in its chip, signed (gains lead with +, losses with −)', () => {
    render(<MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" />);

    // New = +1500¢ → "+$15.00"; Churn = −600¢ → "-$6.00"; Net = +1300¢ → "+$13.00".
    expect(screen.getByRole('button', { name: /^New/ })).toHaveTextContent('+$15.00');
    expect(screen.getByRole('button', { name: /^Churn/ })).toHaveTextContent('-$6.00');
    expect(screen.getByRole('button', { name: /^Net/ })).toHaveTextContent('+$13.00');
  });

  it('toggles a category on and off when its legend chip is clicked', async () => {
    render(<MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" />);

    const expansion = screen.getByRole('button', { name: /^Expansion/ });
    expect(expansion).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(expansion);
    expect(expansion).toHaveAttribute('aria-pressed', 'true');

    const neu = screen.getByRole('button', { name: /^New/ });
    expect(neu).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(neu);
    expect(neu).toHaveAttribute('aria-pressed', 'false');
  });

  it('reveals every category on "Show all", then returns to the default subset on "Reset"', async () => {
    render(<MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" />);

    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    for (const name of [/^New/, /^Reactivation/, /^Expansion/, /^Contraction/, /^Churn/, /^Net/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    }

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: /^Reactivation/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^New/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('persists the shown/hidden selection under persistKey across remounts', async () => {
    const key = 'test:mrr-movement:persist';
    window.localStorage.removeItem(key);

    const { unmount } = render(
      <MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" persistKey={key} />,
    );
    // Expansion is hidden by default; reveal it, which should persist.
    await userEvent.click(screen.getByRole('button', { name: /^Expansion/ }));
    expect(JSON.parse(window.localStorage.getItem(key) ?? '[]')).toContain('expansion_cents');

    unmount();
    render(
      <MrrMovementChart buckets={BUCKETS} totals={TOTALS} currency="USD" granularity="day" persistKey={key} />,
    );
    expect(screen.getByRole('button', { name: /^Expansion/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
