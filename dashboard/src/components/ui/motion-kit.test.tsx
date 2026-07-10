import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMotionSafe } from '../../lib/motion';
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

describe('useMotionSafe', () => {
  function MotionProbe() {
    return <p>{useMotionSafe() ? 'motion-safe' : 'motion-off'}</p>;
  }

  it('returns false under the jsdom matchMedia stub, so charts render static in tests', () => {
    // The setup.ts stub answers `matches: false` for every query, including the affirmative
    // `(prefers-reduced-motion: no-preference)` — useMotionSafe must treat that as "no motion",
    // which is what lets animated Recharts marks render synchronously in the chart tests.
    render(<MotionProbe />);
    expect(screen.getByText('motion-off')).toBeInTheDocument();
  });
});

describe('AnimatedNumber', () => {
  it('renders the formatted final value in test mode', () => {
    render(<AnimatedNumber value={1234} format={(n) => n.toLocaleString('en-US')} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  describe('animated path (rAF driven manually)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('retargets a mid-flight value change from the currently displayed value, not a stale origin', () => {
      // Defeat the test-mode shortcut so the rAF tween actually runs, then drive the
      // frames by hand with controlled timestamps (jsdom has no real rAF timing).
      vi.stubEnv('MODE', 'development');
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
      vi.stubGlobal('cancelAnimationFrame', () => {});
      let now = 0;
      vi.stubGlobal('performance', { ...performance, now: () => now });

      const format = (n: number) => String(Math.round(n));
      const { rerender } = render(<AnimatedNumber value={100} format={format} />);

      // Halfway through the 800ms tween 0 -> 100: eased = 1 - 0.5^3 = 0.875 -> 87.5.
      act(() => frames.shift()?.(400));
      expect(screen.getByText('88')).toBeInTheDocument();

      // Retarget mid-flight. The new tween must start from the displayed 87.5, so its
      // first frame (elapsed 0) still shows 88 — with a stale origin it would jump
      // back to 0 (initial) or 100 (previous target).
      now = 400;
      rerender(<AnimatedNumber value={200} format={format} />);
      act(() => frames.pop()?.(400));
      expect(screen.getByText('88')).toBeInTheDocument();

      // And the tween completes at the new target.
      act(() => frames.pop()?.(1200));
      expect(screen.getByText('200')).toBeInTheDocument();
    });
  });
});
