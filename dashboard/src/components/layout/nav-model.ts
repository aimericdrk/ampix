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
      {
        items: [{ label: 'Project settings', to: p(''), icon: 'settings', exact: true }],
        accent: 'lime',
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
      {
        // Its own route rather than a link to project settings: the active tool is derived from
        // the pathname, so pointing this at /projects/$projectId would eject you from
        // MyRevenueCat the moment you clicked the one item whose job is configuring it.
        items: [{ label: 'Integration settings', to: p('/rc/settings'), icon: 'settings' }],
        accent: 'violet',
      },
    ],
  },
];

/** Pages that only mean anything once RevenueCat is connected. Integration settings is how you
 * connect, so it is never gated. */
const RC_GATED = new Set(['Overview', 'Charts', 'Customers', 'Products', 'Entitlements', 'Offerings', 'Paywalls', 'Conversion']);

export interface NavOptions {
  /** When false, RevenueCat's data pages are dropped. Omit to return everything ungated. */
  rcEnabled?: boolean;
}

/**
 * Scoped to the revenuecat tool deliberately: `RC_GATED` matches on labels, so applying it across
 * every tool would silently hide a future MyAmplitude page that happened to be called "Charts".
 */
function gate(groups: NavGroup[], toolId: ToolId, opts?: NavOptions): NavGroup[] {
  if (toolId !== 'revenuecat' || opts?.rcEnabled !== false) return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !RC_GATED.has(item.label)) }))
    .filter((group) => group.items.length > 0);
}

/** One tool's groups, for the sidebar. */
export function toolGroups(toolId: ToolId, opts?: NavOptions): NavGroup[] {
  const tool = TOOLS.find((t) => t.id === toolId);
  return tool ? gate(tool.groups, tool.id, opts) : [];
}

/**
 * Every tool's groups, flattened. The command palette stays cross-tool on purpose — its whole
 * value is jumping to *anything* — and the `g <letter>` shortcuts read it at module scope with no
 * options, which is why `opts` is optional.
 */
export function allGroups(opts?: NavOptions): NavGroup[] {
  return TOOLS.flatMap((tool) => gate(tool.groups, tool.id, opts));
}

/** The active tool, derived from the URL — never stored. */
export function toolForPathname(pathname: string): ToolId {
  return pathname.includes('/rc/') ? 'revenuecat' : 'amplitude';
}
