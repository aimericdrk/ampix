# MyAmpix Dashboard Frontend Redesign — "MyAmpix Neon"

**Date:** 2026-07-10
**Status:** Approved by user (direction, theme, motion, approach, library architecture)

## Summary

Full visual redesign of the dashboard (`dashboard/`) from design tokens up. The current UI is
functional but visually bare: gray-on-white, a single accent color, no motion. The redesign keeps
**all existing information and functionality** (enrichment allowed — extra graphs/info may be
added where cheap) and rebuilds the look around three approved pillars:

1. **Vibrant & colorful** — multiple bold accents, gradients, personality (PostHog-energy).
2. **Dark-first** — dark theme is the hero and gets the full treatment; light theme is kept and
   re-derived as a faithful adaptation.
3. **Expressive motion** — staggered entrances, animated counting numbers, charts that draw in,
   hover glow/lift, springy overlays. All gated behind `prefers-reduced-motion`.

Execution approach (approved): **custom component library, rebuilt in place** — an in-repo
**shadcn/ui equivalent** styled to our theme, adopted page-by-page. No parallel rewrite; the 34
routes and existing test suites keep working throughout.

## Goals

- A cohesive, distinctive visual identity ("MyAmpix Neon") applied to every page.
- A complete, owned component library in `src/components/ui/` (shadcn-style architecture).
- Expressive but performant animation, accessible by default.
- Zero information loss: every metric, table, control, and page that exists today still exists.

## Non-goals

- No information-architecture rework (nav structure, routes, and page content stay).
- No backend/API changes.
- No replacement of the validated chart series palette or retention ramps (they are
  accessibility-validated per the dataviz spec and remain untouched).
- No SSR, no framework migration.

## 1. Design tokens (`src/index.css` rewrite)

### Dark theme (hero)

- **Background layers:** deep indigo-black, not flat gray. Three elevation levels:
  `--bg` (page, ~oklch 14% with a violet cast), `--surface` (cards, ~18%),
  `--surface-raised` (popovers/overlays, ~22%), plus `--surface-overlay` for glass/blur contexts.
- **Borders:** hairline, slightly luminous near accents (`--border`, `--border-strong`).
- **Brand gradient:** violet → fuchsia → orange (`--gradient-brand`). Used for the wordmark,
  primary buttons, display numbers, and focus moments. Never used for data encoding.
- **Accent family** (beyond the single existing `--accent`): five vivid accents —
  violet (primary), cyan, lime, amber, pink — exposed as `--accent-violet` … `--accent-pink`
  with paired `-fg` and `-soft` (translucent tint) variants. Each nav section and its pages get a
  signature hue via a `data-accent` attribute (see §3).
- **Semantic:** `--success`, `--warning`, `--danger`, `--info` (+ `-soft` tints).
- **Effects:** glow shadows (`--glow-accent`, `--glow-soft`), focus ring token.
- **Motion tokens:** durations (`--duration-fast` 150ms, `--duration-base` 250ms,
  `--duration-slow` 400ms) and easings (standard, spring-like overshoot cubic-bezier).

### Light theme (adaptation)

Same token set re-derived: warm paper background (not pure white), same five accents re-toned to
hold WCAG contrast on light surfaces, softer shadows in place of glows.

### Preserved as-is

`--series-1…8`, `--series-other`, `--chart-surface`, and the 7-step retention ramps (both themes)
are **not modified**.

### Typography

- **Inter Variable** (self-hosted via `@fontsource-variable/inter`) for all UI text.
- **Space Grotesk** (self-hosted via `@fontsource/space-grotesk`) for display headings and big
  KPI numbers.
- Tabular figures (`font-variant-numeric: tabular-nums`) on all metric/number displays.

## 2. Component library — in-repo shadcn/ui equivalent

### Architecture (identical to shadcn's)

- One file per component in `src/components/ui/`, composable exports
  (`Card`, `CardHeader`, `CardTitle`, …).
- Variants via `class-variance-authority` (cva); class merging via existing `cn()`
  (clsx + tailwind-merge).
- Behavior and accessibility from Radix primitives. Already present: dialog, toast. To add:
  dropdown-menu, tooltip, tabs, popover, select, checkbox, switch, radio-group, slider,
  separator, avatar, progress, accordion, alert-dialog, scroll-area.
- Icons from `lucide-react`, replacing hand-rolled `icons.tsx` progressively.
- Fully owned and editable — no generator, no external registry.

### Roster (~35 components)

| Category | Components |
|---|---|
| Primitives | Button, IconButton, Badge, Avatar, Separator, Kbd, Skeleton, Spinner, Progress |
| Forms | Input, Textarea, Label, Select, Combobox, Checkbox, Switch, RadioGroup, Slider, Segmented |
| Overlays | Dialog, AlertDialog, Sheet, DropdownMenu, Popover, Tooltip, Toast, Command |
| Layout | Card, Tabs, Accordion, CollapsibleSection, ScrollArea, Table/DataTable, PageHeader, EmptyState, Banner |
| Signature (ours) | GradientText, AnimatedNumber, Reveal, StatTile, Sparkline, GlowCard |

### Theme baked in

- Primary Button: brand gradient fill + glow on hover; secondary/ghost/danger variants restyled.
- Cards: raised surface, hover lift (translate + shadow), optional accent glow border.
- Overlays: backdrop blur ("dark glass"), scale+fade entrance with spring easing via `motion`.
- Skeleton: shimmer sweep. Toast: springy slide-in.
- Per-section accent: components read the nearest `data-accent` to tint active states.
- `prefers-reduced-motion` disables entrances/springs everywhere (motion helpers check it once).

### Compatibility rule

Existing components (button, card, input, dialog, menu, toast, combobox, data-table, skeleton,
collapsible-section) are rewritten **in place keeping their public props**, so call sites and the
existing role/text-based tests survive. New components are additive.

## 3. App shell

- **Sidebar (showpiece):** gradient wordmark; per-section colorful nav icons (lucide); active item
  gets an accent pill with a soft glow and a sliding indicator (animated via `motion` layout);
  org/project switchers restyled as compact cards; footer cluster tidied.
- **Per-section accents:** the route section sets `data-accent` on the layout (e.g. funnels=cyan,
  retention=lime, revenue=amber, users=pink, default=violet). Nav, PageHeader, tabs, and active
  states pick it up.
- **Global filter bar:** pill-shaped chips with accent tints.
- **Command palette:** dark-glass restyle on the new Command component.
- **PageShell/PageHeader:** gradient page icon + title, breadcrumb, actions slot.

## 4. Charts

Colors preserved; everything around them upgraded:

- Gradient area fills under lines (series color → transparent).
- Draw-in animation on mount (Recharts `isAnimationActive`, tuned durations).
- Dark-glass tooltip restyle (shared tooltip component).
- Subtler grid lines; axis text in muted token.
- KPI/Stat tiles: AnimatedNumber count-up, delta chips (▲/▼ with semantic colors), sparkline
  backgrounds.
- ChartCard: accent-tinted header, consistent toolbar (actions, compare, export).

## 5. Rollout phases

1. **Foundation:** tokens + fonts + motion helpers (`motion` lib, `Reveal`, reduced-motion hook).
2. **Component library:** rewrite existing 10, add ~25 new (shadcn-equivalent roster).
3. **App shell:** sidebar, nav accents, filter bar, command palette, PageHeader.
4. **Chart kit:** ChartCard, tooltips, gradients, KPI tiles, AnimatedNumber adoption.
5. **Page sweep:** all ~25 analytics pages + auth + projects + orgs + settings adopt the library,
   feature by feature. Enrichment (extra sparklines/mini-charts) where cheap.
6. **Polish:** empty states, loading states, light-theme tuning, reduced-motion audit.

Each phase ends with: `pnpm typecheck` + `pnpm lint` + `pnpm test` green, plus a visual check in
the running app (both themes).

## 6. Testing & verification

- Existing vitest suites (role/text queries) must stay green throughout — they are the functional
  safety net for the sweep.
- New components get focused tests in the existing style (`ui-kit.test.tsx` pattern).
- Visual verification per phase in the browser (dark + light, desktop + narrow viewport).
- Accessibility: focus-visible rings on all interactive elements, WCAG contrast for text tokens,
  `prefers-reduced-motion` honored, Radix semantics for overlays/menus.
- E2E (Playwright) smoke after the shell phase and after the sweep.

## 7. New dependencies (dashboard workspace)

- `motion` (animation)
- `class-variance-authority` (variants)
- `lucide-react` (icons)
- `@radix-ui/react-*`: dropdown-menu, tooltip, tabs, popover, select, checkbox, switch,
  radio-group, slider, separator, avatar, progress, accordion, alert-dialog, scroll-area
- `@fontsource-variable/inter`, `@fontsource/space-grotesk` (self-hosted fonts)

No CDN assets; everything bundled.

## Open decisions already resolved

- Direction: Vibrant & colorful ✅ (over dark-minimal, editorial, data-dense)
- Theme: Dark-first, light kept ✅
- Motion: Expressive ✅ (not maximal — no ambient animated backgrounds)
- Approach: custom in-place library ✅ (over shadcn-import or parallel rewrite)
- Library architecture: in-repo shadcn/ui equivalent ✅
