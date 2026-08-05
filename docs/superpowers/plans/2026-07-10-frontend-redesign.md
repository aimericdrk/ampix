# MyAmpix Neon — Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard's visual layer from design tokens up — vibrant dark-first theme, an in-repo shadcn/ui-equivalent component library, expressive motion — and sweep every page onto it, preserving all existing information and functionality.

**Architecture:** Tokens-first: a rewritten `index.css` defines the whole visual language (surfaces, 5-accent family, brand gradient, motion tokens) consumed via Tailwind v4 `@theme inline`. The component library lives in `dashboard/src/components/ui/` — one file per component, cva variants, Radix behavior, `cn()` merging — existing components are rewritten **in place keeping their public props** so call sites and tests survive. Pages then adopt the library feature-by-feature.

**Tech Stack:** React 18, Tailwind CSS v4, Radix UI, class-variance-authority, `motion` (framer-motion successor), lucide-react, Recharts 3, @fontsource variable fonts, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-frontend-redesign-design.md`

## Global Constraints

- **NEVER commit** — the user commits all changes themselves (project rule; overrides any commit step convention).
- All work happens in `dashboard/`. Run commands from `/Users/aimeric/Documents/personnal-project/MyAmpix/dashboard`.
- After each task: `pnpm typecheck && pnpm lint && pnpm test` must pass.
- **Do not modify** `--series-1…8`, `--series-other`, `--chart-surface`, or the `--retention-*` ramps (accessibility-validated; copy them verbatim into the new `index.css`).
- Existing component public props/exports must not change (tests query by role/text; `Button` danger variant must keep class `bg-danger` — asserted in `ui-kit.test.tsx`).
- All motion respects `prefers-reduced-motion` (via the `useReducedMotion`/`motionSafe` helpers from Task 3).
- All information on every page is preserved. Enrichment is allowed; removal is not.
- No CDN assets; fonts and icons are bundled npm packages.
- Files stay under 500 lines; split when a component file would exceed it.
- Icons: `lucide-react`, imported per-icon (`import { ChartLine } from 'lucide-react'`).
- Numbers displaying metrics always get `tabular-nums` (the `font-display` utility includes it).

## Design language cheat-sheet (used by every task)

- **Surfaces (dark):** page `bg-bg`, cards `bg-surface`, popovers/menus `bg-surface-raised`, glass overlays `bg-overlay backdrop-blur-md`.
- **Accents:** components color themselves from `--accent` / `--accent-soft` / `--accent-fg`, which `data-accent="violet|cyan|lime|amber|pink"` on any ancestor re-points. Default is violet.
- **Brand gradient:** `bg-gradient-brand` (violet→fuchsia→orange). Primary buttons, wordmark, hero numbers. Never encodes data.
- **Radii:** cards/dialogs `rounded-xl`, buttons/inputs `rounded-lg`, chips/badges `rounded-full`.
- **Hover feel:** interactive cards lift (`hover:-translate-y-0.5 hover:shadow-lift`), primary buttons glow (`hover:shadow-glow`).
- **Entrances:** page-level content wrapped in `<Reveal>` (staggered fade-up, 250ms, ease-out); overlays scale+fade via their own CSS keyframes.
- **Typography:** `font-display` (Space Grotesk + tabular-nums) for h1/KPI numbers; Inter for everything else.

---

## Milestone A — Foundation

### Task 1: Dependencies + fonts

**Files:**
- Modify: `dashboard/package.json` (via pnpm add)
- Modify: `dashboard/src/main.tsx` (font imports)

**Interfaces:**
- Produces: all packages importable; fonts `'Inter Variable'` and `'Space Grotesk Variable'` loaded.

- [ ] **Step 1: Install dependencies**

```bash
cd dashboard
pnpm add motion class-variance-authority lucide-react \
  @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-tabs \
  @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-checkbox \
  @radix-ui/react-switch @radix-ui/react-radio-group @radix-ui/react-slider \
  @radix-ui/react-separator @radix-ui/react-avatar @radix-ui/react-progress \
  @radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-scroll-area \
  @fontsource-variable/inter @fontsource-variable/space-grotesk
```

- [ ] **Step 2: Import fonts at the top of `src/main.tsx`** (before `./index.css`):

```ts
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
```

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm test` (all pre-existing tests still pass), `pnpm build` succeeds.

### Task 2: Rewrite design tokens in `src/index.css`

**Files:**
- Modify: `dashboard/src/index.css` (full rewrite; keep chart/retention blocks verbatim)

**Interfaces:**
- Produces: Tailwind utilities `bg-bg/surface/surface-raised/overlay`, `text-text/text-muted`, `border-border/border-strong`, `bg-accent/accent-soft`, `text-accent`, `bg-success/warning/danger/info` (+ `-soft`), `bg-gradient-brand`, `shadow-glow/lift`, `font-display`, `animate-shimmer/fade-up/scale-in`, and the `data-accent` re-pointing mechanism. Every later task consumes these.

- [ ] **Step 1: Replace the token blocks.** Keep `@import 'tailwindcss';`, the `@custom-variant dark`, and copy the existing chart-series + retention blocks (both themes) verbatim. New tokens:

```css
:root {
  /* ---- Light theme (adaptation): warm paper, same accent family re-toned ---- */
  --bg: oklch(97.5% 0.006 90);
  --surface: oklch(99.3% 0.002 90);
  --surface-raised: oklch(100% 0 0);
  --overlay: oklch(100% 0 0 / 0.82);
  --border: oklch(89% 0.008 285);
  --border-strong: oklch(80% 0.012 285);
  --text: oklch(24% 0.02 285);
  --text-muted: oklch(50% 0.015 285);

  --accent-violet: oklch(50% 0.22 295);
  --accent-cyan: oklch(52% 0.11 220);
  --accent-lime: oklch(53% 0.15 140);
  --accent-amber: oklch(56% 0.13 75);
  --accent-pink: oklch(54% 0.21 355);

  --accent: var(--accent-violet);
  --accent-fg: oklch(99% 0 0);
  --accent-soft: color-mix(in oklab, var(--accent) 12%, transparent);

  --success: oklch(52% 0.15 155);
  --warning: oklch(58% 0.13 80);
  --danger: oklch(52% 0.2 25);
  --info: oklch(52% 0.11 230);
  --success-soft: color-mix(in oklab, var(--success) 12%, transparent);
  --warning-soft: color-mix(in oklab, var(--warning) 14%, transparent);
  --danger-soft: color-mix(in oklab, var(--danger) 12%, transparent);
  --info-soft: color-mix(in oklab, var(--info) 12%, transparent);

  --gradient-from: oklch(52% 0.25 295);
  --gradient-via: oklch(55% 0.24 340);
  --gradient-to: oklch(65% 0.17 55);

  --shadow-glow: 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent),
    0 4px 24px -4px color-mix(in oklab, var(--accent) 40%, transparent);
  --shadow-lift: 0 8px 24px -8px oklch(20% 0.02 285 / 0.18);

  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* [chart series + retention light blocks: copy verbatim from current file] */
}

.dark {
  /* ---- Dark theme (hero): deep indigo-black, luminous accents ---- */
  --bg: oklch(15% 0.02 285);
  --surface: oklch(18.5% 0.022 285);
  --surface-raised: oklch(22.5% 0.025 285);
  --overlay: oklch(20% 0.024 285 / 0.78);
  --border: oklch(29% 0.02 285);
  --border-strong: oklch(37% 0.025 285);
  --text: oklch(94% 0.01 285);
  --text-muted: oklch(67% 0.02 285);

  --accent-violet: oklch(69% 0.19 295);
  --accent-cyan: oklch(76% 0.13 215);
  --accent-lime: oklch(80% 0.2 135);
  --accent-amber: oklch(80% 0.16 80);
  --accent-pink: oklch(71% 0.2 350);

  --accent-fg: oklch(16% 0.02 285);

  --success: oklch(72% 0.17 155);
  --warning: oklch(78% 0.15 85);
  --danger: oklch(66% 0.21 25);
  --info: oklch(74% 0.12 230);

  --gradient-from: oklch(58% 0.25 295);
  --gradient-via: oklch(60% 0.26 340);
  --gradient-to: oklch(70% 0.19 55);

  --shadow-lift: 0 12px 32px -8px oklch(5% 0.02 285 / 0.6);

  /* [chart series + retention dark blocks: copy verbatim from current file] */
}

/* Per-section accent re-pointing: any subtree opts into a signature hue. */
[data-accent='violet'] { --accent: var(--accent-violet); }
[data-accent='cyan'] { --accent: var(--accent-cyan); }
[data-accent='lime'] { --accent: var(--accent-lime); }
[data-accent='amber'] { --accent: var(--accent-amber); }
[data-accent='pink'] { --accent: var(--accent-pink); }
```

- [ ] **Step 2: `@theme inline` mapping + base styles + keyframes:**

```css
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-overlay: var(--overlay);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --color-accent-violet: var(--accent-violet);
  --color-accent-cyan: var(--accent-cyan);
  --color-accent-lime: var(--accent-lime);
  --color-accent-amber: var(--accent-amber);
  --color-accent-pink: var(--accent-pink);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-info: var(--info);
  --color-success-soft: var(--success-soft);
  --color-warning-soft: var(--warning-soft);
  --color-danger-soft: var(--danger-soft);
  --color-info-soft: var(--info-soft);
  /* [keep the existing --color-chart-surface / --color-series-* mappings verbatim] */

  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --font-display: 'Space Grotesk Variable', 'Inter Variable', ui-sans-serif, sans-serif;

  --shadow-glow: var(--shadow-glow);
  --shadow-lift: var(--shadow-lift);

  --animate-shimmer: shimmer 1.8s linear infinite;
  --animate-fade-up: fade-up var(--duration-base) var(--ease-out-expo) both;
  --animate-scale-in: scale-in var(--duration-fast) var(--ease-out-expo) both;
}

@utility bg-gradient-brand {
  background-image: linear-gradient(135deg, var(--gradient-from), var(--gradient-via), var(--gradient-to));
}
@utility text-gradient-brand {
  background-image: linear-gradient(135deg, var(--gradient-from), var(--gradient-via), var(--gradient-to));
  background-clip: text;
  color: transparent;
}

@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

body {
  @apply bg-bg font-sans text-text antialiased;
}

.font-display {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Verify** — `pnpm typecheck && pnpm test && pnpm build`. Launch `pnpm dev`, check both themes render (page bg is warm paper in light / deep indigo in dark, text legible everywhere).

### Task 3: Motion foundation — `Reveal`, `AnimatedNumber`, reduced-motion helper

**Files:**
- Create: `dashboard/src/lib/motion.ts`
- Create: `dashboard/src/components/ui/reveal.tsx`
- Create: `dashboard/src/components/ui/animated-number.tsx`
- Test: `dashboard/src/components/ui/motion-kit.test.tsx`

**Interfaces:**
- Produces:
  - `useReducedMotion(): boolean` and `springTransition`, `easeOutTransition` presets (motion.ts)
  - `<Reveal delay?: number index?: number className?: string>` — fade-up entrance, staggers children by `index * 60ms`, renders a plain `div` when reduced motion.
  - `<AnimatedNumber value: number format?: (n: number) => string className?: string>` — counts from 0 (or previous value) to `value` over 800ms with ease-out; renders final value immediately under reduced motion or in tests (jsdom has no rAF timing guarantees — detect via `useReducedMotion() || import.meta.env.MODE === 'test'`). Always renders the formatted final value in a `<span>` with `tabular-nums`.

- [ ] **Step 1: Write failing tests** (`motion-kit.test.tsx`):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedNumber } from './animated-number';
import { Reveal } from './reveal';

describe('Reveal', () => {
  it('renders children', () => {
    render(<Reveal><p>Hello</p></Reveal>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});

describe('AnimatedNumber', () => {
  it('renders the formatted final value in test mode', () => {
    render(<AnimatedNumber value={1234} format={(n) => n.toLocaleString('en-US')} />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/components/ui/motion-kit.test.tsx` — FAIL (modules missing).

- [ ] **Step 3: Implement.** `motion.ts`:

```ts
import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}

/** Springy pop for overlays/indicators (motion lib transition preset). */
export const springTransition = { type: 'spring', stiffness: 500, damping: 32 } as const;
/** Standard content entrance. */
export const easeOutTransition = { duration: 0.25, ease: [0.16, 1, 0.3, 1] } as const;
```

`reveal.tsx` uses `motion/react`'s `m.div` (with `LazyMotion`/`domAnimation` loaded once in `main.tsx` — add `<LazyMotion features={domAnimation} strict>` around the app) animating `opacity: 0→1, y: 8→0`, `transition={{ ...easeOutTransition, delay: (delay ?? 0) + (index ?? 0) * 0.06 }}`; plain `div` when `useReducedMotion()`.

`animated-number.tsx`: `useEffect` + `requestAnimationFrame` loop interpolating with `1 - Math.pow(1 - t, 3)` easing over 800ms; skip straight to final value when reduced motion / test mode.

- [ ] **Step 4: Run** the test file — PASS. Then `pnpm typecheck && pnpm lint && pnpm test`.

---

## Milestone B — Component library (in-repo shadcn equivalent)

Conventions for every component task in this milestone (the "shadcn recipe"):

1. One file per component in `src/components/ui/`, lowercase filenames matching existing style (`button.tsx`).
2. Variants declared with `cva()`; export both the component and (when useful) its `*Variants` function.
3. Radix-based components re-export styled parts exactly like shadcn does (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, …), each `forwardRef` + `cn()`.
4. Overlay contents animate with the CSS utilities `animate-scale-in` (+ Radix `data-[state]` variants), not JS, so they work in tests.
5. Focus: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent` on all interactives.

### Task 4: Button + IconButton (the canonical cva exemplar)

**Files:**
- Modify: `dashboard/src/components/ui/button.tsx` (rewrite, same exports + props)
- Create: `dashboard/src/components/ui/icon-button.tsx`
- Test: extend `dashboard/src/components/ui/ui-kit.test.tsx`

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces: `Button` (`variant: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size: 'sm' | 'md'` — unchanged), `buttonVariants`, `IconButton` (`{ 'aria-label': string; variant?: 'ghost' | 'secondary'; size?: 'sm' | 'md' }`, square, icon child).

- [ ] **Step 1: Rewrite `button.tsx` with cva:**

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
    'transition-all duration-150 active:scale-[0.98]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-gradient-brand text-white shadow-sm hover:shadow-glow hover:brightness-110',
        secondary:
          'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-raised',
        ghost: 'text-text-muted hover:bg-accent-soft hover:text-text',
        danger: 'bg-danger text-white hover:brightness-110 hover:shadow-[0_4px_16px_-4px_var(--danger)]',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
```

Note: `danger` keeps class `bg-danger` (existing test asserts it).

- [ ] **Step 2: Create `icon-button.tsx`** — same pattern, `size-8` / `size-10` square, requires `aria-label`, variants `ghost` (default) and `secondary`, `[&_svg]:size-4`.

- [ ] **Step 3: Add tests** to `ui-kit.test.tsx`: `IconButton` renders with accessible name and fires clicks; `Button` primary has `bg-gradient-brand` class.

- [ ] **Step 4: Verify** — `pnpm vitest run src/components/ui` PASS, then full `pnpm typecheck && pnpm lint && pnpm test`.

### Task 5: Small primitives — Badge, Kbd, Separator, Avatar, Spinner, Progress, Skeleton, GradientText

**Files:**
- Create: `badge.tsx`, `kbd.tsx`, `separator.tsx`, `avatar.tsx`, `spinner.tsx`, `progress.tsx`, `gradient-text.tsx` in `dashboard/src/components/ui/`
- Modify: `dashboard/src/components/ui/Skeleton.tsx` (shimmer restyle, same export)
- Test: `dashboard/src/components/ui/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Badge` — `variant: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline'`; `rounded-full px-2.5 py-0.5 text-xs font-medium`; soft-tint fills (`bg-accent-soft text-accent`, `bg-success-soft text-success`, …), `default` = `bg-surface-raised text-text-muted`, `outline` = `border border-border text-text-muted`.
  - `Kbd` — `<kbd>` styled `rounded border border-border bg-surface-raised px-1.5 py-0.5 font-sans text-[11px] text-text-muted shadow-[inset_0_-1px_0_var(--border)]`.
  - `Separator` — Radix separator, `bg-border`, horizontal/vertical.
  - `Avatar`/`AvatarImage`/`AvatarFallback` — Radix avatar; fallback = initials on `bg-accent-soft text-accent`; sizes `sm(24) md(32) lg(40)`.
  - `Spinner` — `Loader2` lucide icon `animate-spin text-accent`, sizes sm/md; `role="status"` + `aria-label="Loading"`.
  - `Progress` — Radix progress, track `bg-surface-raised`, indicator `bg-gradient-brand` with `transition-transform duration-400`.
  - `GradientText` — `<span className={cn('text-gradient-brand font-display font-semibold', className)}>`.
  - `Skeleton` — same export/props as today; classes become `animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--surface)_25%,var(--surface-raised)_50%,var(--surface)_75%)] bg-[length:200%_100%]`.

- [ ] **Step 1: Write failing tests** (`primitives.test.tsx`) — each component renders: Badge shows text + variant class (`bg-success-soft` for success), Kbd renders `<kbd>`, AvatarFallback shows initials, Spinner has `role="status"`, Progress has `role="progressbar"` with `aria-valuenow`, GradientText renders text.
- [ ] **Step 2: Run — FAIL.** Implement all eight per the specs above (each ≤60 lines, cva only where there are variants).
- [ ] **Step 3: Run — PASS**, then full verify suite.

### Task 6: Card family — Card (restyle), GlowCard, EmptyState, Banner

**Files:**
- Modify: `dashboard/src/components/ui/card.tsx` (same exports; add `CardDescription`)
- Create: `glow-card.tsx`, `empty-state.tsx`, `banner.tsx`
- Test: extend `primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Card` — `rounded-xl border border-border bg-surface shadow-sm transition-all duration-250`; new optional prop `interactive?: boolean` adding `hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift`. `CardHeader/CardTitle/CardContent` keep signatures; add `CardDescription` (`text-sm text-text-muted`).
  - `GlowCard` — Card wrapper with accent glow border: outer div `relative rounded-xl bg-gradient-brand p-px` containing `rounded-[calc(theme(radius.xl)-1px)] bg-surface`; used for hero/highlight tiles.
  - `EmptyState` — `{ icon?: LucideIcon; title: string; description?: string; action?: ReactNode }`; centered column with a gradient blob behind the icon (`absolute size-24 rounded-full bg-gradient-brand opacity-20 blur-2xl`), icon in `bg-accent-soft text-accent` rounded square, `font-display` title.
  - `Banner` — `{ variant: 'info' | 'success' | 'warning' | 'danger'; title?: string; children }`; soft-tint background + matching left border (`border-l-2`), lucide icon per variant (Info, CircleCheck, TriangleAlert, CircleAlert).

- [ ] **Step 1: Failing tests** — EmptyState renders title/description/action; Banner renders role `status` (info/success) or `alert` (warning/danger) with text; Card renders as before (existing test must stay green).
- [ ] **Step 2: Implement per spec. Step 3: PASS + full verify.**

### Task 7: Form controls — Input (restyle), Textarea, Label, Select, Checkbox, Switch, RadioGroup, Slider, Segmented

**Files:**
- Modify: `dashboard/src/components/ui/input.tsx` (same export/props)
- Create: `textarea.tsx`, `label.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx`, `radio-group.tsx`, `slider.tsx`, `segmented.tsx`
- Modify: `dashboard/src/components/ui/combobox.tsx` (restyle classes only, keep API)
- Test: `dashboard/src/components/ui/forms-kit.test.tsx`

**Interfaces:**
- Produces (shadcn-shaped APIs):
  - Shared field look: `h-10 rounded-lg border border-border bg-surface px-3 text-sm transition-colors placeholder:text-text-muted/60 hover:border-border-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none aria-invalid:border-danger`.
  - `Input`, `Textarea` (min-h-20, same look), `Label` (`text-sm font-medium`, `peer-disabled` handling).
  - `Select/SelectTrigger/SelectContent/SelectItem/SelectValue/SelectGroup/SelectLabel` — Radix select; content on `bg-surface-raised rounded-xl border border-border shadow-lift animate-scale-in`; selected item shows lucide `Check` in `text-accent`.
  - `Checkbox` — Radix; `size-4 rounded border border-border-strong data-[state=checked]:bg-accent data-[state=checked]:border-accent`; check icon `text-accent-fg`.
  - `Switch` — Radix; track `h-5 w-9 rounded-full bg-surface-raised border border-border data-[state=checked]:bg-accent`; thumb slides with `transition-transform duration-150`.
  - `RadioGroup/RadioGroupItem` — Radix; dot `bg-accent`.
  - `Slider` — Radix; track `bg-surface-raised`, range `bg-accent`, thumb `size-4 rounded-full border-2 border-accent bg-surface shadow`.
  - `Segmented` — `{ options: { value: string; label: ReactNode }[]; value: string; onValueChange }` on Radix radio-group with `role`-correct items styled as a pill group: container `rounded-lg bg-surface-raised p-0.5`, active item `bg-surface shadow-sm text-text` with a `motion` `layoutId` sliding highlight (skip under reduced motion).

- [ ] **Step 1: Failing tests** (`forms-kit.test.tsx`): Checkbox toggles aria-checked on click; Switch toggles; Select opens and selects an option (userEvent, `getByRole('option')`); Segmented switches value on click; Textarea accepts text; Label associates via htmlFor.
- [ ] **Step 2: Implement. Step 3: PASS + full verify.** Combobox: only class strings change (popover surface → `bg-surface-raised rounded-xl shadow-lift`, active option → `bg-accent-soft text-accent`); its existing tests must pass untouched.

### Task 8: Overlays — Dialog (restyle), AlertDialog, Sheet, DropdownMenu, Popover, Tooltip, Toast (restyle), Command

**Files:**
- Modify: `dialog.tsx`, `toast.tsx`, `menu.tsx` (class-level restyle, keep every export + prop)
- Create: `alert-dialog.tsx`, `sheet.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `command.tsx`
- Test: `dashboard/src/components/ui/overlays-kit.test.tsx`

**Interfaces:**
- Consumes: `springTransition` (Task 3) where JS animation is warranted; otherwise CSS `animate-scale-in`.
- Produces:
  - Shared overlay look: backdrop `bg-black/60 backdrop-blur-sm`, panel `bg-surface-raised rounded-xl border border-border shadow-lift`, entrance `data-[state=open]:animate-scale-in`.
  - `Dialog` keeps its exact exports (`Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose`, …) — restyle only; existing tests must pass.
  - `AlertDialog*` — Radix alert-dialog, same panel look, actions row right-aligned.
  - `Sheet*` — Radix dialog with side variants (`right` default: `fixed inset-y-0 right-0 w-full max-w-md`), slide-in via `data-[state=open]:animate-[slide-in-right_250ms_var(--ease-out-expo)]` (add the keyframe in index.css: `from { transform: translateX(100%) } to { transform: none }`).
  - `DropdownMenu*` — full shadcn part set (Trigger/Content/Item/CheckboxItem/RadioItem/Label/Separator/Shortcut/Sub…); items `rounded-md px-2 py-1.5 text-sm data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent`.
  - `Popover*` — Radix popover, same panel look.
  - `Tooltip` — Radix tooltip incl. a single `TooltipProvider` export (used once in `main.tsx`, `delayDuration={300}`); content `rounded-md bg-surface-raised border border-border px-2.5 py-1 text-xs shadow-lift animate-scale-in`.
  - `Command` — a styled combobox-list primitive for the palette: `Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty` built on plain listbox semantics (`role="listbox"`/`option`, aria-activedescendant keyboard nav) — no external cmdk dep; glass panel `bg-overlay backdrop-blur-md`.
  - `toast.tsx` — keep provider/hook API; restyle viewport bottom-right, toast `bg-surface-raised border border-border rounded-xl shadow-lift`, success/danger accent bar on the left, springy slide via Radix swipe + `animate-[slide-in-right…]`.
- `menu.tsx`: read it first; keep exports, restyle to the DropdownMenu look (if it's already Radix-based, only classes change; new code should prefer `dropdown-menu.tsx`).

- [ ] **Step 1: Failing tests** (`overlays-kit.test.tsx`): Tooltip shows content on focus; DropdownMenu opens on click and fires item onSelect; Sheet opens/closes; AlertDialog confirms; Command filters items as you type and fires selection on Enter.
- [ ] **Step 2: Implement. Step 3: PASS**, existing `ui-kit.test.tsx` dialog/toast tests still green, full verify.

### Task 9: Structure — Tabs, Accordion, ScrollArea, PageHeader, StatTile + restyles (CollapsibleSection, DataTable, SectionGrid)

**Files:**
- Create: `tabs.tsx`, `accordion.tsx`, `scroll-area.tsx`, `page-header.tsx`, `stat-tile.tsx`
- Modify: `CollapsibleSection.tsx`, `DataTable.tsx`, `SectionGrid.tsx` (restyle, same APIs)
- Test: `dashboard/src/components/ui/structure-kit.test.tsx`

**Interfaces:**
- Consumes: `Reveal`, `AnimatedNumber` (Task 3), `Badge` (Task 5), lucide icons.
- Produces:
  - `Tabs/TabsList/TabsTrigger/TabsContent` — Radix tabs; list `rounded-lg bg-surface-raised p-0.5`, active trigger `bg-surface text-text shadow-sm` + `motion` `layoutId` sliding pill (same pattern as Segmented).
  - `Accordion*` — Radix accordion; chevron rotates via `data-[state=open]:rotate-180 transition-transform`.
  - `ScrollArea` — Radix scroll-area, thin `bg-border-strong` thumb.
  - `PageHeader` — `{ icon?: LucideIcon; title: string; description?: ReactNode; breadcrumbs?: ReactNode; actions?: ReactNode }`; icon in a `size-10 rounded-xl bg-accent-soft text-accent` tile, title `font-display text-2xl font-semibold`, wrapped in `<Reveal>`. (PageShell adopts it in Task 11.)
  - `StatTile` — `{ label: string; value: number; format?: (n: number) => string; delta?: number; deltaLabel?: string; sparkline?: ReactNode; icon?: LucideIcon; index?: number }`; Card with `interactive`, `AnimatedNumber` value in `font-display text-3xl`, delta chip = Badge success/danger with ▲/▼ (`TrendingUp`/`TrendingDown` lucide) and `+x%` text, optional sparkline absolutely positioned bottom (`opacity-40`), entrance `<Reveal index={index}>`.
  - `DataTable` restyle: sticky header `bg-surface/80 backdrop-blur`, row `hover:bg-accent-soft/50 transition-colors`, header text `text-xs uppercase tracking-wide text-text-muted`; keep sorting/props/tests as-is.
- [ ] **Step 1: Failing tests**: Tabs switch panels on click; Accordion expands; StatTile renders label, formatted value, and delta badge (`+12%` for `delta={12}`), PageHeader renders title + actions.
- [ ] **Step 2: Implement. Step 3: PASS + full verify** (existing `collapsible-section.test.tsx`, `data-table.test.tsx` untouched and green).

---

## Milestone C — App shell

### Task 10: Sidebar redesign — nav accents, lucide icons, sliding active indicator

**Files:**
- Modify: `dashboard/src/components/layout/nav-model.ts` (add `accent` per group)
- Modify: `dashboard/src/components/layout/NavIcon.tsx` (lucide-backed, keep `IconName` union + export)
- Modify: `dashboard/src/components/layout/AppLayout.tsx`
- Modify: `dashboard/src/components/layout/OrgSwitcher.tsx`, `ProjectSwitcher.tsx`, `ThemeToggle.tsx` (restyle)
- Test: existing `app-layout.test.tsx`, `org-switcher.test.tsx`, `project-switcher.test.tsx` must stay green.

**Interfaces:**
- Produces: `NavGroup` gains `accent?: 'violet' | 'cyan' | 'lime' | 'amber' | 'pink'`; section accent map fixed as: **Home=violet, Explore=cyan, Audience=pink, Saved=amber, settings/admin rows=lime**. `AppLayout` sets `data-accent={activeGroupAccent}` on `<main>` so every page inherits its section hue.

- [ ] **Step 1:** Add `accent` to each group in `projectGroups()` per the map above.
- [ ] **Step 2:** Rewrite `NavIcon` to render lucide icons (map: home→House, insights→ChartLine, funnel→Filter, retention→Repeat, paths→GitBranch, heatmap→Grid3x3, revenue→CircleDollarSign, distributions→ChartBar, properties→Tags, events→Zap, cohorts→UsersRound, users→User, sessions→Clock, live→Radio, dashboards→LayoutDashboard, reports→FileChartLine, templates→LayoutTemplate, settings→Settings, projects→FolderOpen, org→Building2, account→CircleUser), size-4, `text-accent` when active via `[&.active]` or a prop.
- [ ] **Step 3:** AppLayout sidebar redesign:
  - Brand: `<span className="font-display text-lg font-bold text-gradient-brand">MyAmpix</span>`.
  - Each `NavSection` wraps its items in `data-accent={group.accent}`.
  - Active link: `bg-accent-soft text-accent font-medium` pill + a `motion` `layoutId="nav-indicator"` 2px accent bar on the left (`m.span` with `springTransition`; plain span under reduced motion).
  - Hover: `hover:bg-surface-raised hover:text-text`.
  - Sidebar surface: `bg-surface border-r border-border`; footer cluster unchanged structurally.
  - Compute the active group from the current location (`useRouterState` matched path against group items) and set `data-accent` on `<main>`.
- [ ] **Step 4:** Restyle switchers as compact cards (`rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-sm hover:border-border-strong`), ThemeToggle gets Sun/Moon lucide icons with a 150ms rotate transition.
- [ ] **Step 5: Verify** — `pnpm test` (all layout tests green), visual check: dark + light, indicator slides between nav items, each section shows its hue.

### Task 11: PageShell, GlobalFilterBar, CommandPalette, ShortcutsHelp restyles

**Files:**
- Modify: `dashboard/src/components/layout/PageShell.tsx` (adopt PageHeader internals; keep public props exactly)
- Modify: `dashboard/src/features/analytics/components/GlobalFilterBar.tsx` (pill chips)
- Modify: `dashboard/src/features/command-palette/CommandPalette.tsx` (adopt Command)
- Modify: `dashboard/src/features/shortcuts/ShortcutsHelp.tsx` (Kbd + new Dialog look)

**Interfaces:**
- Consumes: `PageHeader`, `Kbd`, `Badge`, `Command*` from Milestone B.
- PageShell public props unchanged (`projectId,title,description,breadcrumbs,dateRangeControl,actions,children`) — internals render `PageHeader` with breadcrumbs slot and wrap `children` in `<Reveal delay={0.05}>`.

- [ ] **Step 1:** PageShell → PageHeader (title `font-display`, breadcrumb row unchanged semantically — keep `aria-label="Breadcrumb"`).
- [ ] **Step 2:** GlobalFilterBar: each filter renders as a removable chip `rounded-full bg-accent-soft text-accent px-3 py-1 text-xs` with lucide `X` remove button; "add filter" is a ghost pill.
- [ ] **Step 3:** CommandPalette: glass panel (`bg-overlay backdrop-blur-md`), sections with `text-xs uppercase text-text-muted` headers, active row `bg-accent-soft text-accent`, kbd hints via `Kbd`. Keep all existing behavior/tests (`command-palette.test.tsx`).
- [ ] **Step 4: Verify** — full suite green + visual check of palette (⌘K), filter chips, breadcrumbs on a few pages.

---

## Milestone D — Chart kit

### Task 12: ChartCard, glass tooltip, gradient fills, grid restyle

**Files:**
- Modify: `dashboard/src/features/analytics/components/charts/ChartCard.tsx`
- Create: `dashboard/src/features/analytics/components/charts/chart-theme.tsx`
- Modify: `SeriesCharts.tsx`, `BreakdownChart.tsx`, `ComparisonTrend.tsx`, `LifecycleChart.tsx`, `HistogramChart.tsx`, `DonutChart.tsx`, `CompositionPieChart.tsx` (same dir) — adopt chart-theme helpers.
- Test: existing chart tests must stay green.

**Interfaces:**
- Produces (`chart-theme.tsx`):
  - `ChartTooltip` — shared Recharts tooltip `content` component: `rounded-lg border border-border bg-surface-raised/95 px-3 py-2 text-xs shadow-lift backdrop-blur` with series dots, tabular numbers.
  - `SeriesGradient({ id, color })` — `<linearGradient>` def (color 35% opacity → 0%) for `<Area fill="url(#…)">`.
  - `gridProps` = `{ stroke: 'var(--border)', strokeDasharray: '3 6', vertical: false }`; `axisProps` = `{ tick: { fill: 'var(--text-muted)', fontSize: 11 }, axisLine: false, tickLine: false }`.
  - `animationProps` = `{ isAnimationActive: true, animationDuration: 600, animationEasing: 'ease-out' }` — and `{ isAnimationActive: false }` when `document.documentElement` matches reduced motion (module-level check acceptable).
- ChartCard: Card base + header row (title `font-display text-sm font-semibold`, optional accent dot, actions right), body `min-h-` preserved; series colors REMAIN `var(--series-n)`.

- [ ] **Step 1:** Build `chart-theme.tsx`. **Step 2:** Sweep the seven chart components onto the shared tooltip/grid/axis/gradient/animation helpers (line/area charts get gradient under-fills; donut/pie get 2px `var(--surface)` stroke separation between slices).
- [ ] **Step 3: Verify** — all `charts/*.test.tsx` green; visual: tooltips glassy, areas gradient-filled, axes quiet, draw-in on load, both themes.

### Task 13: KPI tiles — animated numbers everywhere

**Files:**
- Modify: `dashboard/src/features/analytics/components/charts/KpiTile.tsx`, `StatTile.tsx` (charts dir), `sparkline.tsx`
- Test: `kpi-tile.test.tsx` (existing assertions must keep passing — extend, don't rewrite)

**Interfaces:**
- Consumes: `StatTile` from `ui/stat-tile.tsx` (Task 9), `AnimatedNumber`, `Reveal`.
- The two chart-dir tile components become thin adapters over `ui/stat-tile.tsx` (keeping their current props so ~every page compiles unchanged); sparkline gains a soft gradient area fill using the tile's accent.

- [ ] **Step 1:** Adapt tiles; keep formatted output identical (existing tests assert text).
- [ ] **Step 2: Verify** — `kpi-tile.test.tsx` + `home.test.tsx` green; visual: numbers count up, deltas show ▲/▼ chips.

---

## Milestone E — Page sweep + polish

**The sweep recipe applied to every page below (this is the full instruction; per-task lists name the files):**

1. Page keeps `PageShell` (now redesigned) — no structural change needed for the header.
2. Raw `<div className="rounded-lg border …">` blocks → `Card`/`CardHeader`/`CardContent`; clickable cards get `interactive`.
3. Ad-hoc status text/pills → `Badge` (map success/warn/error semantics).
4. Ad-hoc buttons/links-as-buttons → `Button`/`IconButton`; icon-only actions get `aria-label`.
5. Raw tables → keep `DataTable` (already restyled); raw `<select>`/checkbox inputs → library equivalents where props allow a drop-in swap (skip any swap that would break a test contract — restyling the raw element with field classes is acceptable fallback).
6. Empty states ("No X yet" paragraphs) → `EmptyState` with a fitting lucide icon and, where an obvious CTA exists on the page, that action.
7. Loading states → `Skeleton` blocks matching final layout shape.
8. Top-level page sections wrapped in `<Reveal index={i}>` for staggered entrance (max ~6 reveals per page; tables/charts reveal as one block).
9. KPI rows → `StatTile` grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`).
10. **Never remove information.** Enrichment allowed where listed.
11. After each task: full verify suite + visual check of the touched pages in both themes.

### Task 14: Auth screens (the first impression)

**Files:** `LoginPage.tsx`, `LoginForm.tsx`, `SignupPage.tsx`, `SignupForm.tsx`, `TwoFactorChallengeForm.tsx`, `InvitePage.tsx`, `AccountPage.tsx`, `SecuritySettingsPage.tsx` in `dashboard/src/features/auth/components/`.

- [ ] Login/Signup: centered `GlowCard` on a `bg-bg` page with two fixed ambient gradient blobs behind it (`pointer-events-none absolute size-96 rounded-full bg-gradient-brand opacity-[0.07] blur-3xl`, top-left + bottom-right — static, not animated); `text-gradient-brand` wordmark above the form; fields via restyled Input/Label; submit is primary Button full-width. 2FA: code input gets `font-display text-lg tracking-[0.3em] text-center`.
- [ ] Account/Security/Invite: recipe steps 2–8.
- [ ] Verify: `auth-forms.test.tsx`, `two-factor.test.tsx`, `account.test.tsx`, `invite.test.tsx` green + visual.

### Task 15: Projects + Orgs

**Files:** `ProjectsPage.tsx`, `ProjectDetailPage.tsx` (features/projects/components), `OrgSettingsPage.tsx` (features/orgs/components).

- [ ] Projects list: cards become `interactive` Cards with a per-project accent dot, member/env metadata as Badges, `<Reveal index>` stagger; empty state → EmptyState("Create your first project").
- [ ] Project detail ("Project settings") — **explicit user complaint: today every element renders unstyled, stacked in a single column ~1/3 of the screen wide.** Full layout redesign, not just component swaps: page uses the standard PageShell width (no artificial narrow column); content organized into titled Cards in a responsive grid (`grid gap-6 lg:grid-cols-2`, full-width Card for tables); settings rows become label + control pairs with proper alignment (`flex items-center justify-between` rows inside CardContent, Separator between rows); SDK token/key blocks get a monospace code treatment with a copy IconButton; forms use the Task 7 field components with Labels; danger zone is a full-width `Banner variant="danger"`-framed Card at the bottom.
- [ ] Org settings: recipe steps 2–8 (member tables, danger zone gets `Banner variant="danger"` framing; same titled-Card + aligned-rows treatment as project settings).
- [ ] Verify: `project-management.test.tsx`, `project-detail.test.tsx`, `projects-org-scoping.test.tsx`, `org-settings.test.tsx` green.

### Task 16: Home + Insights

**Files:** `HomePage.tsx`, `HomeHighlights.tsx`, `InsightsPage.tsx`, `InsightsChart.tsx`, `AskBar.tsx` (features/analytics/components).

- [ ] Home: KPI row → `StatTile` grid with sparkline backgrounds (**enrichment:** add sparklines to any KPI that has time-series data available in the existing query response); highlights → GlowCard; world map + country/OS cards per recipe; AskBar gets glass pill styling with a gradient `Sparkles` lucide icon.
- [ ] Insights: builder controls onto library forms (Segmented for chart-type toggles where currently ad-hoc button groups), chart area per chart kit.
- [ ] Verify: `home.test.tsx`, `insights.test.tsx`, `ask-bar.test.tsx`, `builder-controls.test.tsx` green.

### Task 17: Explore pages

**Files:** `FunnelsPage.tsx` + `FunnelChart.tsx`, `RetentionPage.tsx` + `RetentionChart.tsx`, `PathsPage.tsx` + `PathMap.tsx`, `HeatmapPage.tsx` + `HeatmapCanvas.tsx`, `DistributionsPage.tsx`, `RevenuePage.tsx`, `PropertyExplorerPage.tsx`, `EventCatalogPage.tsx`, plus shared controls `CompareControl.tsx`, `FormulaControl.tsx`, `SegmentCompareControl.tsx`, `SegmentPicker.tsx`, `explore-controls.tsx`.

- [ ] All pages: recipe. Funnel bars get gradient fills from `--accent` (cyan section hue) with step-conversion Badges; retention heatmap keeps its validated ramp untouched (cells/table restyle only — borders, radius, hover); controls become library Selects/Segmented/Popovers.
- [ ] Verify: `funnels/retention/paths-map/heatmap/distributions/revenue/property-explorer/event-catalog/explore-controls`-related tests green.

### Task 18: Audience pages

**Files:** `CohortsPage.tsx`, `UsersPage.tsx`, `UserProfileModal.tsx`, `SessionsPage.tsx`, `LiveEventsPage.tsx`.

- [ ] Recipe throughout. Live page: pulsing dot (`relative` span with `animate-ping` accent halo, static under reduced motion) next to "Live"; new events slide in with `<Reveal>`; event-type chips → Badges. UserProfileModal onto the restyled Dialog with Avatar + property Badges.
- [ ] Verify: `cohorts/users/user-profile/sessions/live-events` tests green.

### Task 19: Saved pages + presentation

**Files:** `DashboardsPage.tsx`, `DashboardGrid.tsx`, `DashboardViewPage.tsx`, `ReportsPage.tsx`, `ReportDetailPage.tsx`, `ReportChart.tsx`, `TemplatesPage.tsx`, `ChartThumbnail.tsx`, `PresentationMode.tsx`, `AnnotationsManager.tsx`, `report-actions.tsx`, `AddToDashboardButton.tsx`, `CopyLinkButton.tsx`.

- [ ] Recipe throughout; dashboard grid tiles = interactive Cards with ChartThumbnail; presentation mode gets `bg-bg` full-bleed with `font-display` slide titles.
- [ ] Verify: `dashboards/reports/templates/presentation-mode/add-to-dashboard/annotations-manager` tests green.

### Task 20: Polish + final audit

**Files:** touched-as-found across `dashboard/src/`.

- [ ] Sweep for leftover pre-redesign styling: `grep -rn "rounded-md border border-border bg-surface" src/features src/components` and migrate stragglers to Card/field classes.
- [ ] Light-theme audit: open every nav destination in light mode; fix any contrast/washout by adjusting the component (not the tokens) unless a token is provably wrong in all uses.
- [ ] Reduced-motion audit: with macOS "Reduce Motion" on (or DevTools emulation), verify no entrance/spring/count-up plays; content is immediately visible.
- [ ] Error/404 pages (`RouteErrorPage.tsx`, `NotFoundPage.tsx`, `ErrorBoundary.tsx`): EmptyState treatment with brand gradient 404 numeral.
- [ ] Run e2e smoke: `pnpm e2e` (Playwright) — navigation + core flows pass.
- [ ] Final: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Self-review notes

- Spec §1 tokens → Task 2; §2 library/roster → Tasks 3–9 (Sheet, Command, all roster rows covered); §3 shell → Tasks 10–11; §4 charts → Tasks 12–13; §5 sweep → Tasks 14–19; §6 polish/testing → Task 20 + per-task verify gates; §7 deps → Task 1.
- Chart palette preservation restated in Global Constraints and Tasks 2, 12, 17.
- Public-API compatibility restated per rewrite task; `bg-danger` test contract called out in Task 4.
- No commit steps anywhere (project rule).
