import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IconChart,
  IconChevron,
  IconClock,
  IconExpand,
  IconSearch,
  IconSettings,
  IconTrendDown,
  IconTrendUp,
  IconUsers,
} from './icons';

const icons = [
  ['IconChevron', IconChevron],
  ['IconTrendUp', IconTrendUp],
  ['IconTrendDown', IconTrendDown],
  ['IconUsers', IconUsers],
  ['IconChart', IconChart],
  ['IconClock', IconClock],
  ['IconSettings', IconSettings],
  ['IconSearch', IconSearch],
  ['IconExpand', IconExpand],
] as const;

describe('icon set', () => {
  it.each(icons)('%s renders a decorative svg with the default 16px size', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('height', '16');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('fill', 'none');
  });

  it.each(icons)('%s respects a custom size', (_name, Icon) => {
    const { container } = render(<Icon size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it.each(icons)('%s forwards className onto the svg', (_name, Icon) => {
    const { container } = render(<Icon className="text-accent" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-accent');
  });
});
