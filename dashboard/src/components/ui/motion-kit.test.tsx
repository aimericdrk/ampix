import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedNumber } from './animated-number';
import { Reveal } from './reveal';

describe('Reveal', () => {
  it('renders children', () => {
    render(
      <Reveal>
        <p>Hello</p>
      </Reveal>,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});

describe('AnimatedNumber', () => {
  it('renders the formatted final value in test mode', () => {
    render(<AnimatedNumber value={1234} format={(n) => n.toLocaleString('en-US')} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});
