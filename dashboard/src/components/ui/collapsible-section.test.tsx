import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';
import { Skeleton } from './Skeleton';

describe('CollapsibleSection', () => {
  it('renders the title and shows content by default', () => {
    render(
      <CollapsibleSection title="Details">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeVisible();
  });

  it('exposes an accessible toggle with aria-expanded/aria-controls matching the region', async () => {
    render(
      <CollapsibleSection title="Details" id="details-section">
        <p>Body content</p>
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'details-section');
    const region = document.getElementById('details-section');
    expect(region).not.toBeNull();
    expect(region).toContainElement(screen.getByText('Body content'));

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Body content')).not.toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Body content')).toBeVisible();
  });

  it('respects defaultOpen=false', () => {
    render(
      <CollapsibleSection title="Details" defaultOpen={false}>
        <p>Body content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Body content')).not.toBeVisible();
  });
});

describe('Skeleton', () => {
  it('renders a shimmering placeholder block', () => {
    render(<Skeleton data-testid="skeleton" className="h-4 w-24" />);
    const el = screen.getByTestId('skeleton');
    expect(el).toHaveClass('animate-shimmer');
    expect(el).toHaveClass('h-4');
    expect(el).toHaveClass('w-24');
  });
});
