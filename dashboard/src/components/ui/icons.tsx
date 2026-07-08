import { type SVGProps } from 'react';
import { cn } from '../../lib/cn';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  /** Icon size in px, applied to both width and height. Defaults to 16. */
  size?: number;
}

/**
 * Base props applied to every icon in the set — 24x24 viewBox, `currentColor` stroke,
 * matching the inline stroke-icon style used elsewhere (see `ScreenImage.tsx`'s fallback icon).
 * Icons are decorative by default (`aria-hidden="true"`); pass `aria-hidden={false}` and a
 * label if an icon ever needs to be meaningful on its own.
 */
function iconProps({ size = 16, className, ...rest }: IconProps) {
  return {
    'aria-hidden': true,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: cn(className),
    ...rest,
  };
}

/** Chevron pointing down — used for disclosure toggles, dropdowns, sort direction. */
export function IconChevron(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Upward trend arrow — pairs with a positive %-delta. */
export function IconTrendUp(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 16l6-6 4 4 6-8" />
      <path d="M14 6h6v6" />
    </svg>
  );
}

/** Downward trend arrow — pairs with a negative %-delta. */
export function IconTrendDown(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 8l6 6 4-4 6 8" />
      <path d="M14 18h6v-6" />
    </svg>
  );
}

/** Users / people — nav and audience metrics. */
export function IconUsers(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path d="M15 14c2.5 0 5.5 1.5 5.5 5" />
    </svg>
  );
}

/** Bar chart — nav and analytics sections. */
export function IconChart(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

/** Clock — time-based metrics (session duration, recency). */
export function IconClock(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Gear — settings / configuration actions. */
export function IconSettings(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7L16 16M8 8L6.3 6.3" />
    </svg>
  );
}

/** Magnifying glass — search input affordance. */
export function IconSearch(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

/** Expand / fullscreen — opens a chart or panel in a larger view. */
export function IconExpand(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M9 20H4v-5" />
      <path d="M15 20h5v-5" />
    </svg>
  );
}

/** Star — favorite toggle. `filled` swaps the outline stroke for a solid fill (favorited state). */
export function IconStar({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...iconProps(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z" />
    </svg>
  );
}
