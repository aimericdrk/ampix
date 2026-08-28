import type { IconName } from './NavIcon';

export interface NavItem {
  label: string;
  to: string;
  icon: IconName;
  /** Match only the exact path (so a parent link isn't active on its children). */
  exact?: boolean;
}

/** One of the fixed section hues (`data-accent` re-points `--accent` for everything the group wraps). */
export type NavAccent = 'violet' | 'cyan' | 'lime' | 'amber' | 'pink';

export interface NavGroup {
  heading?: string;
  items: NavItem[];
  accent?: NavAccent;
}

/** The tools the dashboard hosts. MyAmpix recreates Amplitude; MyRevenueCat mirrors RevenueCat. */
export type ToolId = 'amplitude' | 'revenuecat';

export interface Tool {
  id: ToolId;
  label: string;
  icon: IconName;
  /** Route pattern for the tool's landing page — where its rail button navigates. */
  home: string;
  groups: NavGroup[];
}

const p = (path: string) => `/projects/$projectId${path}`;

/**
 * Every page in the product, grouped by tool then by section. Single source of truth for "what
 * pages exist and where do they link": consumed by the sidebar (`AppLayout`), the tool rail, the
 * command palette's "Pages" section, and the `g <letter>` shortcuts — so they never drift apart.
 *
 * Adding a tool is one entry here. Note `router.tsx` remains the real source of truth for what
 * *resolves*; this is a hand-maintained mirror of it.
 */
export const TOOLS: Tool[] = [
  {
    id: 'amplitude',
    label: 'MyAmplitude',
    icon: 'tool-amplitude',
    home: p('/home'),
    groups: [
      {
        items: [{ label: 'Home', to: p('/home'), icon: 'home' }],
        accent: 'violet',
      },
      {
        heading: 'Explore',
        accent: 'cyan',
        items: [
          { label: 'Insights', to: p('/insights'), icon: 'insights' },
          { label: 'Funnels', to: p('/funnels'), icon: 'funnel' },
          { label: 'Flows', to: p('/flows'), icon: 'flows' },
          { label: 'Retention', to: p('/retention'), icon: 'retention' },
          // "Paths" is the interactive user-path map + Mermaid view (screen-paths, §19).
          { label: 'Paths', to: p('/paths'), icon: 'paths' },
          { label: 'Heatmap', to: p('/heatmap'), icon: 'heatmap' },
          // Revenue reads the SDK's own `$in_app_purchase` events — NOT RevenueCat data. It works
          // with no RevenueCat account, which is why it lives here and not under MyRevenueCat.
          { label: 'Revenue', to: p('/revenue'), icon: 'revenue' },
          // Journey reads RevenueCat's official webhook events out of the EVENT STREAM — the same
          // reason Revenue sits here: it needs no MyRevenueCat setup, so gating it behind that tool
          // would hide it from every project that only ever pointed the webhook at us.
          { label: 'Journey', to: p('/journey'), icon: 'journey' },
          { label: 'Distributions', to: p('/distributions'), icon: 'distributions' },
          { label: 'Properties', to: p('/properties'), icon: 'properties' },
          { label: 'Events', to: p('/events'), icon: 'events' },
        ],
      },
      {
        heading: 'Audience',
        accent: 'pink',
        items: [
          { label: 'Cohorts', to: p('/cohorts'), icon: 'cohorts' },
          { label: 'Users', to: p('/users'), icon: 'users' },
          { label: 'Sessions', to: p('/sessions'), icon: 'sessions' },
          { label: 'Live', to: p('/live'), icon: 'live' },
        ],
      },
      {
        heading: 'Saved',
        accent: 'amber',
        items: [
          { label: 'Dashboards', to: p('/dashboards'), icon: 'dashboards' },
          { label: 'Reports', to: p('/reports'), icon: 'reports' },
          { label: 'Templates', to: p('/templates'), icon: 'templates' },
        ],
      },
    ],
  },
  {
    id: 'revenuecat',
    label: 'MyRevenueCat',
    icon: 'tool-revenuecat',
    home: p('/rc/overview'),
    groups: [
      {
        heading: 'Monitor',
        accent: 'lime',
        items: [
          { label: 'Overview', to: p('/rc/overview'), icon: 'overview' },
          { label: 'Charts', to: p('/rc/charts'), icon: 'charts' },
          { label: 'Customers', to: p('/rc/customers'), icon: 'customers' },
        ],
      },
      {
        heading: 'Monetize',
        accent: 'amber',
        items: [
          { label: 'Products', to: p('/rc/products'), icon: 'products' },
          { label: 'Entitlements', to: p('/rc/entitlements'), icon: 'entitlements' },
          { label: 'Offerings', to: p('/rc/offerings'), icon: 'offerings' },
          { label: 'Paywalls', to: p('/rc/paywalls'), icon: 'paywalls' },
        ],
      },
      {
        heading: 'Analyze',
        accent: 'cyan',
        items: [
          // Correlates RC events against the SDK's event stream — a MyAmpix capability, not
          // something real RevenueCat can do. Hence its own group rather than mirroring RC's IA.
          { label: 'Conversion', to: p('/rc/conversion'), icon: 'conversion' },
        ],
      },
    ],
  },
];

/**
 * Project settings belongs to no tool: it configures the project itself, so it lives in the global
 * sidebar rather than a tool's section nav. Kept here so `allGroups` still hands it to the command
 * palette and the shortcut map, which stay tool-agnostic.
 *
 * It is also the only nav entry into MyRevenueCat's settings (`/rc/settings`): the two are scopes
 * of one settings screen, switched from a control at the top of it, so MyRevenueCat's section nav
 * carries no "Integration settings" item of its own.
 */
export const PROJECT_SETTINGS: NavItem = {
  label: 'Project settings',
  to: p(''),
  icon: 'settings',
  exact: true,
};

export interface NavOptions {
  /** Legacy real-RevenueCat-connected flag. Retained so existing callers keep type-checking, but it
   * NO LONGER hides anything: MyRevenueCat is the self-hosted clone (its pages read our own
   * `mobile_purchase` service), so the nav must never gate on a real RevenueCat connection — there
   * is nothing external to connect to. */
  rcEnabled?: boolean;
}

/** One tool's groups, for the sidebar. The clone is never gated (see NavOptions). */
export function toolGroups(toolId: ToolId, _opts?: NavOptions): NavGroup[] {
  const tool = TOOLS.find((t) => t.id === toolId);
  return tool ? tool.groups : [];
}

/**
 * Every tool's groups, flattened. The command palette stays cross-tool on purpose — its whole
 * value is jumping to *anything* — and the `g <letter>` shortcuts read it at module scope with no
 * options, which is why `_opts` is optional (and now ignored — see NavOptions).
 */
export function allGroups(_opts?: NavOptions): NavGroup[] {
  return [
    ...TOOLS.flatMap((tool) => tool.groups),
    { items: [PROJECT_SETTINGS], accent: 'lime' },
  ];
}

/** The active tool, derived from the URL — never stored. */
export function toolForPathname(pathname: string): ToolId {
  return pathname.includes('/rc/') ? 'revenuecat' : 'amplitude';
}
