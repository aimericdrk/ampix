import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Badge } from './badge';
import { GradientText } from './gradient-text';
import { Kbd } from './kbd';
import { Progress } from './progress';
import { Separator } from './separator';
import { Skeleton } from './Skeleton';
import { Spinner } from './spinner';

describe('Badge', () => {
  it('renders text and default variant classes', () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText('New');
    expect(badge).toHaveClass('bg-surface-raised');
    expect(badge).toHaveClass('rounded-full');
  });

  it('applies success variant soft-tint classes', () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toHaveClass('bg-success-soft');
  });
});

describe('Kbd', () => {
  it('renders a <kbd> element with the given text', () => {
    render(<Kbd>⌘K</Kbd>);
    const kbd = screen.getByText('⌘K');
    expect(kbd.tagName).toBe('KBD');
  });
});

describe('Separator', () => {
  it('renders a horizontal separator by default', () => {
    render(<Separator data-testid="sep" />);
    const sep = screen.getByTestId('sep');
    expect(sep).toHaveClass('bg-border');
  });
});

describe('Avatar', () => {
  it('renders fallback initials when image is absent', () => {
    render(
      <Avatar>
        <AvatarImage src="" alt="" />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AB')).toBeInTheDocument();
  });
});

describe('Spinner', () => {
  it('renders with role=status and an accessible label', () => {
    render(<Spinner />);
    const spinner = screen.getByRole('status', { name: 'Loading' });
    expect(spinner).toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('renders a progressbar with the given value', () => {
    render(<Progress value={42} />);
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '42');
  });
});

describe('GradientText', () => {
  it('renders its children with the gradient-brand text class', () => {
    render(<GradientText>MyAmpix</GradientText>);
    const el = screen.getByText('MyAmpix');
    expect(el).toHaveClass('text-gradient-brand');
  });
});

describe('Skeleton', () => {
  it('renders a shimmering placeholder block', () => {
    render(<Skeleton data-testid="skel" className="h-8 w-20" />);
    const skel = screen.getByTestId('skel');
    expect(skel).toHaveClass('animate-shimmer');
  });
});
