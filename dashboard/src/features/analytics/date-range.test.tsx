import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultDate } from './components/builder-controls';
import { DateRangeControl, DateRangeProvider, useDateRange } from './date-range';

const PROJECT_ID = 'proj-1';

function ProbeAndControl() {
  const { from, to, preset } = useDateRange();
  return (
    <div>
      <span data-testid="from">{from}</span>
      <span data-testid="to">{to}</span>
      <span data-testid="preset">{preset}</span>
      <DateRangeControl />
    </div>
  );
}

describe('DateRangeProvider / useDateRange', () => {
  it('defaults to Last 30 days', () => {
    render(
      <DateRangeProvider projectId={PROJECT_ID}>
        <ProbeAndControl />
      </DateRangeProvider>,
    );

    expect(screen.getByTestId('from')).toHaveTextContent(defaultDate(30));
    expect(screen.getByTestId('to')).toHaveTextContent(defaultDate(0));
    expect(screen.getByTestId('preset')).toHaveTextContent('30');
  });

  it('updates the range and persists it to localStorage when a preset is chosen', async () => {
    render(
      <DateRangeProvider projectId={PROJECT_ID}>
        <ProbeAndControl />
      </DateRangeProvider>,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Last 7 days' }));

    expect(screen.getByTestId('from')).toHaveTextContent(defaultDate(7));
    expect(screen.getByTestId('to')).toHaveTextContent(defaultDate(0));
    expect(screen.getByTestId('preset')).toHaveTextContent('7');

    const stored = JSON.parse(localStorage.getItem(`myampix:daterange:${PROJECT_ID}`) ?? 'null');
    expect(stored).toEqual({ from: defaultDate(7), to: defaultDate(0), preset: '7' });
  });

  it('reads a previously persisted range for the project on mount', () => {
    localStorage.setItem(
      `myampix:daterange:${PROJECT_ID}`,
      JSON.stringify({ from: defaultDate(90), to: defaultDate(0), preset: '90' }),
    );

    render(
      <DateRangeProvider projectId={PROJECT_ID}>
        <ProbeAndControl />
      </DateRangeProvider>,
    );

    expect(screen.getByTestId('from')).toHaveTextContent(defaultDate(90));
    expect(screen.getByTestId('preset')).toHaveTextContent('90');
  });

  it('scopes persistence per project', async () => {
    render(
      <DateRangeProvider projectId={PROJECT_ID}>
        <ProbeAndControl />
      </DateRangeProvider>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Last 90 days' }));

    expect(localStorage.getItem('myampix:daterange:other-project')).toBeNull();
    expect(localStorage.getItem(`myampix:daterange:${PROJECT_ID}`)).not.toBeNull();
  });

  it('throws when useDateRange is used outside a DateRangeProvider', () => {
    const Bare = () => {
      useDateRange();
      return null;
    };
    expect(() => render(<Bare />)).toThrow('useDateRange must be used within a DateRangeProvider');
  });
});
