import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Inbox } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Badge } from './badge';
import { Banner } from './banner';
import { Card, CardDescription } from './card';
import { EmptyState } from './empty-state';
import { GlowCard } from './glow-card';
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

describe('Card interactive', () => {
  it('applies hover-lift classes when interactive is set', () => {
    render(
      <Card interactive data-testid="card">
        Content
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveClass('hover:-translate-y-0.5');
  });
});

describe('CardDescription', () => {
  it('renders description text', () => {
    render(<CardDescription>Supporting copy</CardDescription>);
    expect(screen.getByText('Supporting copy')).toBeInTheDocument();
  });
});

describe('GlowCard', () => {
  it('renders its children', () => {
    render(<GlowCard>Glow content</GlowCard>);
    expect(screen.getByText('Glow content')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title, description, and action', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No data yet"
        description="Come back once events start flowing in."
        action={<button type="button">Retry</button>}
      />,
    );
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.getByText('Come back once events start flowing in.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Banner', () => {
  it('renders info variant with role=status and children text', () => {
    render(<Banner variant="info">Heads up, something changed.</Banner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Heads up, something changed.');
  });

  it('renders danger variant with role=alert and a title', () => {
    render(
      <Banner variant="danger" title="Something broke">
        Please retry the request.
      </Banner>,
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Something broke');
    expect(banner).toHaveTextContent('Please retry the request.');
  });
});
